/**
 * Content Generation Router
 * API endpoints for triggering autonomous content generation
 */

import { z } from 'zod'
import { router, publicProcedure, ceoProcedure } from '../trpc'
import {
  websiteRepository,
  editorialTaskRepository,
  contentRepository,
  agentRepository,
} from '../../db/repositories'
import { TRPCError } from '@trpc/server'
import { v4 as uuidv4 } from 'uuid'
import { db } from '../../db/connection'
import Anthropic from '@anthropic-ai/sdk'
import { getEnv, getTextFields, getMediaFields } from '@swarm-press/shared'

// Initialize Anthropic client
let anthropicClient: Anthropic | null = null

function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    const apiKey = getEnv().ANTHROPIC_API_KEY
    if (!apiKey) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'ANTHROPIC_API_KEY not configured',
      })
    }
    anthropicClient = new Anthropic({ apiKey })
  }
  return anthropicClient
}

// Schema for section optimization
const SectionSchema = z.object({
  id: z.string(),
  type: z.string(),
  variant: z.string().nullish(),
  content: z.record(z.unknown()).nullish(),
  prompts: z.record(z.unknown()).nullish(),
  ai_hints: z.record(z.unknown()).nullish(),
})

const PageContextSchema = z.object({
  pageId: z.string().optional(),
  pageTitle: z.string().optional(),
  pagePurpose: z.string().optional(),
  pageType: z.string().optional(),
  siteName: z.string().optional(),
  siteDescription: z.string().optional(),
  websiteId: z.string().optional(),
})

// Website AI context type (matches WebsiteAIContextSchema from shared)
// Note: Tone and writing style are defined at agent level, not website level
interface WebsiteAIContext {
  target_audience?: string
  audience_demographics?: string[]
  purpose?: string
  primary_goals?: string[]
  unique_value_proposition?: string
  primary_language?: string
  supported_languages?: string[]
  content_guidelines?: string
  keywords?: string[]
  topics_to_avoid?: string[]
}

const QuestionnaireSchema = z.object({
  purpose: z.string(),
  audience: z.string(),
  keySections: z.array(z.string()),
  tone: z.string().optional(),
})

// Generation job status tracking (in-memory for now, could be Redis/DB)
const generationJobs = new Map<string, {
  id: string
  websiteId: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  startedAt: Date
  completedAt?: Date
  totalTasks: number
  completedTasks: number
  currentTask?: string
  error?: string
  logs: Array<{ timestamp: Date; message: string; level: 'info' | 'warn' | 'error' }>
}>()

export const contentGenerationRouter = router({
  /**
   * Get generation status for a website
   */
  getStatus: publicProcedure
    .input(z.object({ websiteId: z.string() }))
    .query(async ({ input }) => {
      // Find any active job for this website
      const activeJob = Array.from(generationJobs.values()).find(
        job => job.websiteId === input.websiteId &&
        (job.status === 'pending' || job.status === 'running')
      )

      // Get editorial task statistics
      const stats = await editorialTaskRepository.getStatistics(input.websiteId)

      // Get content statistics
      const contentStats = await db.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'brief_created') as briefs,
          COUNT(*) FILTER (WHERE status = 'draft') as drafts,
          COUNT(*) FILTER (WHERE status = 'in_editorial_review') as in_review,
          COUNT(*) FILTER (WHERE status = 'approved') as approved,
          COUNT(*) FILTER (WHERE status = 'published') as published
        FROM content_items
        WHERE website_id = $1
      `, [input.websiteId])

      return {
        activeJob: activeJob || null,
        taskStats: stats,
        contentStats: contentStats.rows[0] || {
          briefs: 0,
          drafts: 0,
          in_review: 0,
          approved: 0,
          published: 0,
        },
      }
    }),

  /**
   * Get job details
   */
  getJob: publicProcedure
    .input(z.object({ jobId: z.string() }))
    .query(async ({ input }) => {
      const job = generationJobs.get(input.jobId)
      if (!job) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Job ${input.jobId} not found`,
        })
      }
      return job
    }),

  /**
   * Start content generation for a website
   * This creates content items from editorial tasks and optionally triggers workflows
   */
  startGeneration: ceoProcedure
    .input(z.object({
      websiteId: z.string(),
      mode: z.enum(['prepare', 'generate']).default('prepare'),
      limit: z.number().min(1).max(100).optional(),
      priority: z.enum(['urgent', 'high', 'medium', 'low']).optional(),
    }))
    .mutation(async ({ input }) => {
      const { websiteId, mode, limit, priority } = input

      // Check website exists
      const website = await websiteRepository.findById(websiteId)
      if (!website) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Website ${websiteId} not found`,
        })
      }

      // Check for existing active job
      const activeJob = Array.from(generationJobs.values()).find(
        job => job.websiteId === websiteId &&
        (job.status === 'pending' || job.status === 'running')
      )

      if (activeJob) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `Generation already in progress for this website (Job: ${activeJob.id})`,
        })
      }

      // Get editorial tasks that are ready to start
      const filters: any = {
        website_id: websiteId,
        status: ['backlog', 'ready'],
      }
      if (priority) {
        filters.priority = priority
      }

      let tasks = await editorialTaskRepository.findWithFilters(filters)

      // Apply limit if specified
      if (limit) {
        tasks = tasks.slice(0, limit)
      }

      if (tasks.length === 0) {
        return {
          success: true,
          message: 'No tasks ready for content generation',
          jobId: null,
          tasksProcessed: 0,
        }
      }

      // Find a writer agent for this website
      // Look for agents with writing capability
      const allAgents = await agentRepository.findAll()
      const writerAgent = allAgents.find(agent => {
        const caps = agent.capabilities as Array<{ name: string; enabled: boolean }> | string[] || []
        // Support both new format (array of objects) and old format (array of strings)
        const capabilityNames = caps.map(c => typeof c === 'string' ? c : c.name)
        return capabilityNames.includes('content_writing') ||
               capabilityNames.includes('write_draft') ||
               capabilityNames.includes('research_topic') ||
               capabilityNames.includes('content_research')
      })

      if (!writerAgent && mode === 'generate') {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'No writer agent found. Please create an agent with content_writing capability.',
        })
      }

      // Create job
      const jobId = uuidv4()
      const job = {
        id: jobId,
        websiteId,
        status: 'running' as const,
        startedAt: new Date(),
        totalTasks: tasks.length,
        completedTasks: 0,
        logs: [{ timestamp: new Date(), message: `Starting ${mode} mode for ${tasks.length} tasks`, level: 'info' as const }],
      }
      generationJobs.set(jobId, job)

      // Process tasks (async - don't await)
      processGeneration(jobId, tasks, websiteId, mode, writerAgent?.id).catch(error => {
        const job = generationJobs.get(jobId)
        if (job) {
          job.status = 'failed'
          job.error = error.message
          job.completedAt = new Date()
          job.logs.push({ timestamp: new Date(), message: `Failed: ${error.message}`, level: 'error' })
        }
      })

      return {
        success: true,
        message: `Started ${mode} mode for ${tasks.length} tasks`,
        jobId,
        tasksProcessed: tasks.length,
      }
    }),

  /**
   * Cancel an ongoing generation job
   */
  cancelGeneration: ceoProcedure
    .input(z.object({ jobId: z.string() }))
    .mutation(async ({ input }) => {
      const job = generationJobs.get(input.jobId)
      if (!job) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Job ${input.jobId} not found`,
        })
      }

      if (job.status !== 'running' && job.status !== 'pending') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Job is already ${job.status}`,
        })
      }

      job.status = 'cancelled'
      job.completedAt = new Date()
      job.logs.push({ timestamp: new Date(), message: 'Job cancelled by user', level: 'warn' })

      return { success: true }
    }),

  /**
   * Get all jobs for a website
   */
  listJobs: publicProcedure
    .input(z.object({ websiteId: z.string() }))
    .query(async ({ input }) => {
      const jobs = Array.from(generationJobs.values())
        .filter(job => job.websiteId === input.websiteId)
        .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
        .slice(0, 10) // Last 10 jobs

      return { jobs }
    }),

  // ============================================================================
  // Section Generation & Optimization Endpoints
  // ============================================================================

  /**
   * Generate recommended sections for a page based on questionnaire
   */
  generateSections: publicProcedure
    .input(z.object({
      pageContext: PageContextSchema,
      questionnaire: QuestionnaireSchema,
      agentId: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { questionnaire } = input
      // pageContext and agentId reserved for future AI-driven section generation

      // For now, generate sections based on the questionnaire without invoking the agent
      // This provides immediate feedback while the full agent integration is built
      const sectionTypeMap: Record<string, { type: string; variant: string }> = {
        hero: { type: 'hero-section', variant: 'centered' },
        features: { type: 'feature-section', variant: 'three-column-grid' },
        content: { type: 'content-section', variant: 'prose' },
        stats: { type: 'stats-section', variant: 'simple-grid' },
        testimonials: { type: 'testimonial-section', variant: 'simple-centered' },
        faq: { type: 'faq-section', variant: 'centered' },
        cta: { type: 'cta-section', variant: 'simple-centered' },
        pricing: { type: 'pricing-section', variant: 'three-tiers' },
        team: { type: 'team-section', variant: 'grid' },
        contact: { type: 'contact-section', variant: 'split' },
        newsletter: { type: 'newsletter-section', variant: 'simple-centered' },
        logos: { type: 'logo-cloud-section', variant: 'simple-grid' },
      }

      const sections = questionnaire.keySections.map((key, index) => {
        const mapping = sectionTypeMap[key] || { type: 'content-section', variant: 'prose' }
        return {
          id: `${mapping.type.replace('-section', '')}-${index + 1}`,
          type: mapping.type,
          variant: mapping.variant,
          order: index,
          content: {},
          ai_hints: {
            tone: questionnaire.tone || 'professional',
            purpose: questionnaire.purpose,
            audience: questionnaire.audience,
          },
        }
      })

      return {
        success: true,
        sections,
        message: `Generated ${sections.length} sections based on your requirements`,
      }
    }),

  /**
   * Optimize a single section's content using AI
   */
  optimizeSection: publicProcedure
    .input(z.object({
      section: SectionSchema,
      pageContext: PageContextSchema,
      agentId: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { section, pageContext, agentId } = input

      // Find writer agent if not specified
      let writerAgentId = agentId
      if (!writerAgentId) {
        const allAgents = await agentRepository.findAll()
        const writerAgent = allAgents.find(agent => {
          const caps = agent.capabilities as Array<{ name: string; enabled: boolean }> | string[] || []
          // Support both new format (array of objects) and old format (array of strings)
          const capabilityNames = caps.map(c => typeof c === 'string' ? c : c.name)
          return capabilityNames.includes('content_writing') ||
                 capabilityNames.includes('write_draft') ||
                 capabilityNames.includes('research_topic') ||
                 capabilityNames.includes('content_research')
        })
        writerAgentId = writerAgent?.id
      }

      if (!writerAgentId) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'No writer agent available. Please configure a writer agent first.',
        })
      }

      // Get agent details
      const agent = await agentRepository.findById(writerAgentId)
      if (!agent) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Agent ${writerAgentId} not found`,
        })
      }

      // Get website AI context if websiteId is provided
      let websiteAIContext: WebsiteAIContext | undefined
      if (pageContext.websiteId) {
        const website = await websiteRepository.findById(pageContext.websiteId)
        if (website) {
          const metadata = (website as any).metadata
          websiteAIContext = metadata?.ai_context
        }
      }

      // Generate content using AI
      const optimization = await generateSectionContentWithAI(
        section,
        pageContext,
        websiteAIContext,
        agent.name
      )

      return {
        success: true,
        sectionId: section.id,
        content: optimization.content,
        ai_hints: optimization.ai_hints,
        prompts: optimization.prompts,
        agentId: writerAgentId,
        agentName: agent.name,
        message: `Section content generated by AI (agent: ${agent.name})`,
      }
    }),

  /**
   * Optimize all sections on a page
   */
  optimizeAllSections: publicProcedure
    .input(z.object({
      sections: z.array(SectionSchema),
      pageContext: PageContextSchema,
      agentId: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { sections, pageContext, agentId } = input

      if (sections.length === 0) {
        return {
          success: true,
          results: [],
          message: 'No sections to optimize',
        }
      }

      // Find writer agent if not specified
      let writerAgentId = agentId
      if (!writerAgentId) {
        const allAgents = await agentRepository.findAll()
        const writerAgent = allAgents.find(agent => {
          const caps = agent.capabilities as Array<{ name: string; enabled: boolean }> | string[] || []
          // Support both new format (array of objects) and old format (array of strings)
          const capabilityNames = caps.map(c => typeof c === 'string' ? c : c.name)
          return capabilityNames.includes('content_writing') ||
                 capabilityNames.includes('write_draft') ||
                 capabilityNames.includes('research_topic') ||
                 capabilityNames.includes('content_research')
        })
        writerAgentId = writerAgent?.id
      }

      if (!writerAgentId) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'No writer agent available. Please configure a writer agent first.',
        })
      }

      // Get agent details
      const agent = await agentRepository.findById(writerAgentId)
      if (!agent) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Agent ${writerAgentId} not found`,
        })
      }

      // Get website AI context if websiteId is provided
      let websiteAIContext: WebsiteAIContext | undefined
      if (pageContext.websiteId) {
        const website = await websiteRepository.findById(pageContext.websiteId)
        if (website) {
          const metadata = (website as any).metadata
          websiteAIContext = metadata?.ai_context
        }
      }

      // Generate optimizations with AI for each section
      const results: Array<{
        sectionId: string
        content: Record<string, unknown>
        ai_hints: Record<string, unknown>
        prompts: Record<string, unknown>
      }> = []

      for (const section of sections) {
        console.log(`[ContentGeneration] Optimizing section ${section.id} (${section.type})`)
        const optimization = await generateSectionContentWithAI(
          section,
          pageContext,
          websiteAIContext,
          agent.name
        )
        results.push({
          sectionId: section.id,
          content: optimization.content,
          ai_hints: optimization.ai_hints,
          prompts: optimization.prompts,
        })
      }

      return {
        success: true,
        results,
        agentId: writerAgentId,
        agentName: agent.name,
        message: `${results.length} sections optimized by AI (agent: ${agent.name})`,
      }
    }),
})

/**
 * Process generation asynchronously
 */
async function processGeneration(
  jobId: string,
  tasks: any[],
  websiteId: string,
  mode: 'prepare' | 'generate',
  writerAgentId?: string
) {
  const job = generationJobs.get(jobId)
  if (!job) return

  for (const task of tasks) {
    // Check if job was cancelled
    if (job.status === 'cancelled') {
      break
    }

    job.currentTask = task.title
    job.logs.push({
      timestamp: new Date(),
      message: `Processing: ${task.title}`,
      level: 'info'
    })

    try {
      if (mode === 'prepare') {
        // Just create content items with brief status
        await createContentFromTask(task, websiteId)
      } else if (mode === 'generate' && writerAgentId) {
        // Create content and trigger workflow
        const content = await createContentFromTask(task, websiteId, writerAgentId)

        // Try to trigger Temporal workflow
        try {
          const { temporalClient, startWorkflow } = await import('@swarm-press/workflows')

          // Check if Temporal is connected
          if (temporalClient.isConnected()) {
            await startWorkflow('contentProductionWorkflow', [{
              contentId: content.id,
              writerAgentId,
              brief: task.description || task.title,
            }], {
              workflowId: `content-${content.id}`,
            })

            job.logs.push({
              timestamp: new Date(),
              message: `Workflow started for: ${task.title}`,
              level: 'info'
            })
          } else {
            job.logs.push({
              timestamp: new Date(),
              message: `Temporal not connected - content prepared but workflow not started`,
              level: 'warn'
            })
          }
        } catch (workflowError: any) {
          job.logs.push({
            timestamp: new Date(),
            message: `Workflow error for ${task.title}: ${workflowError.message}`,
            level: 'warn'
          })
        }
      }

      // Update task status to in_progress
      await editorialTaskRepository.update(task.id, { status: 'in_progress' })

      job.completedTasks++
    } catch (error: any) {
      job.logs.push({
        timestamp: new Date(),
        message: `Error processing ${task.title}: ${error.message}`,
        level: 'error'
      })
    }

    // Small delay between tasks
    await new Promise(resolve => setTimeout(resolve, 100))
  }

  job.status = job.status === 'cancelled' ? 'cancelled' : 'completed'
  job.completedAt = new Date()
  job.currentTask = undefined
  job.logs.push({
    timestamp: new Date(),
    message: `Completed: ${job.completedTasks}/${job.totalTasks} tasks processed`,
    level: 'info'
  })
}

/**
 * Create content item from editorial task
 */
async function createContentFromTask(
  task: any,
  websiteId: string,
  authorAgentId?: string
): Promise<any> {
  // Check if content already exists for this task
  const existing = await db.query(
    `SELECT id FROM content_items WHERE metadata->>'editorial_task_id' = $1`,
    [task.id]
  )

  if (existing.rows.length > 0) {
    return await contentRepository.findById(existing.rows[0].id)
  }

  // Create new content item
  const content = await contentRepository.create({
    title: task.title,
    slug: task.title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    content_type: task.task_type === 'article' ? 'article' : 'page',
    status: 'brief_created',
    website_id: websiteId,
    author_agent_id: authorAgentId,
    body: [],
    metadata: {
      editorial_task_id: task.id,
      seo_primary_keyword: task.seo_primary_keyword,
      seo_secondary_keywords: task.seo_secondary_keywords,
      word_count_target: task.word_count_target,
      sitemap_targets: task.sitemap_targets,
    },
  })

  // Link to page if specified
  if (task.sitemap_targets && task.sitemap_targets.length > 0) {
    const pageId = task.sitemap_targets[0]
    await contentRepository.update(content.id, { page_id: pageId })
  }

  return content
}

// ============================================================================
// AI Content Generation
// ============================================================================

/**
 * Generate section content using Claude AI
 */
async function generateSectionContentWithAI(
  section: z.infer<typeof SectionSchema>,
  pageContext: z.infer<typeof PageContextSchema>,
  websiteAIContext?: WebsiteAIContext,
  agentName?: string
): Promise<{
  content: Record<string, unknown>
  ai_hints: Record<string, unknown>
  prompts: Record<string, unknown>
}> {
  const client = getAnthropicClient()

  // Build the system prompt with website context
  const systemPrompt = buildAISystemPrompt(websiteAIContext, agentName)

  // Build the user prompt for section generation
  const userPrompt = buildSectionGenerationPrompt(section, pageContext, websiteAIContext)

  console.log(`[ContentGeneration] Calling Claude for section ${section.id} (${section.type})`)

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: userPrompt,
        },
      ],
    })

    console.log(`[ContentGeneration] Claude response received: ${response.usage.input_tokens}/${response.usage.output_tokens} tokens`)

    // Extract text content from response
    const textContent = response.content
      .filter((block: Anthropic.ContentBlock): block is Anthropic.TextBlock => block.type === 'text')
      .map((block: Anthropic.TextBlock) => block.text)
      .join('\n')

    // Parse the JSON response
    const parsedContent = parseAIContentResponse(textContent, section.type)

    // Generate AI hints based on website context
    const aiHints = generateAIHintsFromContext(section.type, pageContext, websiteAIContext)

    // Generate prompts based on website context (pass generated content for field hints)
    const prompts = generatePromptsFromContext(section.type, pageContext, websiteAIContext, parsedContent)

    return {
      content: parsedContent,
      ai_hints: aiHints,
      prompts: prompts,
    }
  } catch (error) {
    console.error(`[ContentGeneration] AI generation failed:`, error)
    // Fall back to placeholder content
    const placeholderContent = generatePlaceholderContent(section.type, pageContext)
    return {
      content: placeholderContent,
      ai_hints: generatePlaceholderAIHints(section.type, pageContext, websiteAIContext),
      prompts: generatePlaceholderPrompts(section.type, pageContext, websiteAIContext, placeholderContent),
    }
  }
}

/**
 * Build system prompt for content generation with website context
 */
function buildAISystemPrompt(websiteAIContext?: WebsiteAIContext, agentName?: string): string {
  let prompt = `You are ${agentName || 'a professional content writer'} creating high-quality website content.

Your task is to generate compelling, well-structured content for website sections. You must return your response as a valid JSON object that matches the expected schema for the section type.

IMPORTANT: Return ONLY a valid JSON object. No markdown code blocks, no explanations, just the JSON.`

  if (websiteAIContext) {
    prompt += `\n\n## Website Context\n`

    if (websiteAIContext.purpose) {
      prompt += `\n### Website Purpose\n${websiteAIContext.purpose}\n`
    }

    if (websiteAIContext.target_audience) {
      prompt += `\n### Target Audience\n${websiteAIContext.target_audience}\n`
    }

    if (websiteAIContext.unique_value_proposition) {
      prompt += `\n### Unique Value Proposition\n${websiteAIContext.unique_value_proposition}\n`
    }

    if (websiteAIContext.content_guidelines) {
      prompt += `\n### Content Guidelines\n${websiteAIContext.content_guidelines}\n`
    }

    if (websiteAIContext.primary_goals && websiteAIContext.primary_goals.length > 0) {
      prompt += `\n### Primary Goals\n${websiteAIContext.primary_goals.map(g => `- ${g}`).join('\n')}\n`
    }

    if (websiteAIContext.topics_to_avoid && websiteAIContext.topics_to_avoid.length > 0) {
      prompt += `\n### Topics to Avoid\n${websiteAIContext.topics_to_avoid.map(t => `- ${t}`).join('\n')}\n`
    }

    if (websiteAIContext.keywords && websiteAIContext.keywords.length > 0) {
      prompt += `\n### SEO Keywords to Consider\n${websiteAIContext.keywords.slice(0, 10).join(', ')}\n`
    }

    if (websiteAIContext.primary_language) {
      const langMap: Record<string, string> = {
        en: 'English',
        de: 'German',
        fr: 'French',
        it: 'Italian',
        es: 'Spanish',
      }
      prompt += `\n### Language\nWrite in ${langMap[websiteAIContext.primary_language] || websiteAIContext.primary_language}.\n`
    }
  }

  return prompt
}

/**
 * Build user prompt for section content generation
 */
function buildSectionGenerationPrompt(
  section: z.infer<typeof SectionSchema>,
  pageContext: z.infer<typeof PageContextSchema>,
  _websiteAIContext?: WebsiteAIContext
): string {
  const sectionSchemas = getSectionContentSchemas()
  const schema = sectionSchemas[section.type] || sectionSchemas['default']

  let prompt = `Generate content for a "${section.type}" section.

## Page Context
- Page Title: ${pageContext.pageTitle || 'Untitled Page'}
- Page Purpose: ${pageContext.pagePurpose || 'General information page'}
- Site Name: ${pageContext.siteName || 'Website'}

## Section Type: ${section.type}
${section.variant ? `- Variant: ${section.variant}` : ''}

## Expected JSON Schema
${schema}

## Instructions
1. Create compelling, authentic content that matches the website's tone and purpose
2. Ensure content is specific and relevant to the page context
3. Use natural, engaging language appropriate for the target audience
4. Return ONLY a valid JSON object matching the schema above
5. Do not include markdown code blocks or any text outside the JSON

Generate the JSON content now:`

  return prompt
}

/**
 * Get expected content schemas for each section type
 */
function getSectionContentSchemas(): Record<string, string> {
  return {
    'hero-section': `{
  "title": "string - Compelling headline (5-10 words)",
  "subtitle": "string - Supporting text that expands on the headline (15-25 words)",
  "cta": {
    "text": "string - Call to action button text (2-4 words)",
    "url": "string - Link URL"
  }
}`,
    'header-section': `{
  "title": "string - Section title",
  "description": "string - Brief description (optional)"
}`,
    'content-section': `{
  "heading": "string - Section heading",
  "content": "string - Main content (markdown supported, 100-300 words)"
}`,
    'feature-section': `{
  "heading": "string - Section heading",
  "subheading": "string - Optional subheading",
  "features": [
    {
      "title": "string - Feature title",
      "description": "string - Feature description (20-40 words)",
      "icon": "string - Icon name (star, check, heart, shield, zap, etc.)"
    }
  ]
}`,
    'stats-section': `{
  "heading": "string - Section heading",
  "stats": [
    {
      "value": "string - Numeric value with unit (e.g., '100+', '24/7', '5M+')",
      "label": "string - What the stat represents",
      "description": "string - Brief context (optional)"
    }
  ]
}`,
    'cta-section': `{
  "heading": "string - Compelling call-to-action headline",
  "description": "string - Supporting text (20-40 words)",
  "primaryCta": {
    "text": "string - Primary button text",
    "url": "string - Primary button URL"
  },
  "secondaryCta": {
    "text": "string - Secondary button text (optional)",
    "url": "string - Secondary button URL"
  }
}`,
    'faq-section': `{
  "heading": "string - Section heading",
  "items": [
    {
      "question": "string - The question",
      "answer": "string - Detailed answer (40-100 words)"
    }
  ]
}`,
    'testimonial-section': `{
  "heading": "string - Section heading",
  "testimonials": [
    {
      "quote": "string - The testimonial quote (30-60 words)",
      "author": "string - Person's name",
      "role": "string - Their role/title",
      "company": "string - Company name (optional)"
    }
  ]
}`,
    'default': `{
  "title": "string - Section title",
  "content": "string - Section content"
}`
  }
}

/**
 * Parse AI response and extract JSON content
 */
function parseAIContentResponse(
  response: string,
  sectionType: string
): Record<string, unknown> {
  // Try to extract JSON from the response
  let jsonStr = response.trim()

  // Remove markdown code blocks if present
  if (jsonStr.startsWith('```json')) {
    jsonStr = jsonStr.slice(7)
  } else if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.slice(3)
  }
  if (jsonStr.endsWith('```')) {
    jsonStr = jsonStr.slice(0, -3)
  }
  jsonStr = jsonStr.trim()

  try {
    const parsed = JSON.parse(jsonStr)
    return parsed
  } catch (e) {
    // Try to find JSON object in the response
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0])
      } catch (e2) {
        console.warn(`[ContentGeneration] Failed to parse JSON from AI response for ${sectionType}`)
      }
    }
  }

  // Return a basic structure if parsing fails
  return {
    title: `${sectionType} Content`,
    content: 'Content generation in progress...',
  }
}

/**
 * Generate AI hints based on website context
 */
function generateAIHintsFromContext(
  sectionType: string,
  _pageContext: z.infer<typeof PageContextSchema>,
  websiteAIContext?: WebsiteAIContext
): Record<string, unknown> {
  const hints: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    source: 'ai',
  }

  if (websiteAIContext?.target_audience) {
    hints.audience = websiteAIContext.target_audience.slice(0, 200) + (websiteAIContext.target_audience.length > 200 ? '...' : '')
  }

  if (websiteAIContext?.purpose) {
    hints.purpose = websiteAIContext.purpose.slice(0, 200) + (websiteAIContext.purpose.length > 200 ? '...' : '')
  }

  if (websiteAIContext?.unique_value_proposition) {
    hints.uniqueValue = websiteAIContext.unique_value_proposition
  }

  // Add section-specific word ranges
  const wordRanges: Record<string, { min: number; max: number }> = {
    'hero-section': { min: 30, max: 80 },
    'header-section': { min: 10, max: 30 },
    'content-section': { min: 100, max: 300 },
    'feature-section': { min: 50, max: 150 },
    'stats-section': { min: 20, max: 60 },
    'cta-section': { min: 20, max: 50 },
    'faq-section': { min: 150, max: 400 },
    'testimonial-section': { min: 50, max: 150 },
  }
  hints.wordRange = wordRanges[sectionType] || { min: 50, max: 200 }

  return hints
}

/**
 * Generate prompts based on website context
 */
function generatePromptsFromContext(
  sectionType: string,
  pageContext: z.infer<typeof PageContextSchema>,
  websiteAIContext?: WebsiteAIContext,
  generatedContent?: Record<string, unknown>
): Record<string, unknown> {
  const prompts: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    source: 'ai',
  }

  // Build writing prompt
  let writingPrompt = `Write content for the ${sectionType} section`
  if (pageContext.pageTitle) {
    writingPrompt += ` on the "${pageContext.pageTitle}" page`
  }
  if (websiteAIContext?.target_audience) {
    writingPrompt += `. Target audience: ${websiteAIContext.target_audience.slice(0, 100)}...`
  }
  prompts.writingPrompt = writingPrompt

  // Add keywords
  if (websiteAIContext?.keywords && websiteAIContext.keywords.length > 0) {
    prompts.keywords = websiteAIContext.keywords.slice(0, 10)
  }

  // Generate field hints based on section type and generated content
  const fieldHints = generateFieldHints(sectionType, pageContext, websiteAIContext, generatedContent)
  if (Object.keys(fieldHints).length > 0) {
    prompts.fieldHints = fieldHints
  }

  return prompts
}

/**
 * Generate per-field hints for section content fields
 */
function generateFieldHints(
  sectionType: string,
  pageContext: z.infer<typeof PageContextSchema>,
  websiteAIContext?: WebsiteAIContext,
  generatedContent?: Record<string, unknown>
): Record<string, Record<string, unknown>> {
  const fieldHints: Record<string, Record<string, unknown>> = {}

  // Get text fields for this section type
  const textFields = getTextFields(sectionType)
  const mediaFields = getMediaFields(sectionType)

  const pageTitle = pageContext.pageTitle || 'the page'
  const targetAudience = websiteAIContext?.target_audience
  const contentGuidelines = websiteAIContext?.content_guidelines

  // Generate hints for text fields
  for (const field of textFields) {
    const hint: Record<string, unknown> = {}

    // Generate field-specific prompts based on field name and type
    switch (field.name) {
      case 'title':
        hint.prompt = `Write a compelling headline that captures attention${targetAudience ? ` for ${targetAudience}` : ''}`
        hint.maxLength = 80
        break
      case 'subtitle':
        hint.prompt = `Write supporting text that expands on the headline and provides context`
        hint.maxLength = 200
        break
      case 'eyebrow':
        hint.prompt = `Write a short category label or teaser (2-4 words)`
        hint.maxLength = 40
        break
      case 'content':
        hint.prompt = `Write engaging body content${contentGuidelines ? `. Guidelines: ${contentGuidelines.slice(0, 100)}` : ''}`
        break
      case 'description':
        hint.prompt = `Write a clear description that explains the main idea`
        hint.maxLength = 300
        break
      case 'features':
        hint.prompt = `Write feature descriptions that highlight key benefits and value`
        break
      case 'stats':
        hint.prompt = `Present compelling statistics with clear labels`
        break
      default:
        hint.prompt = `Write ${field.label.toLowerCase()} content for ${pageTitle}`
    }

    // Add generated content summary if available
    if (generatedContent && generatedContent[field.name]) {
      const contentValue = generatedContent[field.name]
      if (typeof contentValue === 'string' && contentValue.length > 0) {
        hint.generatedPreview = contentValue.length > 100
          ? contentValue.slice(0, 100) + '...'
          : contentValue
      }
    }

    fieldHints[field.name] = hint
  }

  // Generate hints for media fields
  for (const field of mediaFields) {
    const hint: Record<string, unknown> = {}

    switch (field.name) {
      case 'backgroundImage':
        hint.prompt = `Full-width background image that sets the visual tone`
        hint.style = 'photographic'
        hint.aspectRatio = '16:9'
        break
      case 'image':
        hint.prompt = `Featured image that supports the section content`
        hint.style = 'photographic'
        break
      case 'screenshot':
        hint.prompt = `Product or app screenshot showing key functionality`
        hint.style = 'photographic'
        hint.aspectRatio = '16:9'
        break
      case 'images':
        hint.prompt = `Gallery of related images that tell a visual story`
        hint.style = 'photographic'
        break
      default:
        hint.prompt = `${field.label} for the section`
    }

    // Add mood based on website context
    if (websiteAIContext?.target_audience) {
      hint.mood = 'inviting, professional'
    }

    fieldHints[field.name] = hint
  }

  return fieldHints
}

// ============================================================================
// Section Optimization Helpers (Fallback)
// ============================================================================

/**
 * Generate placeholder content for a section type
 * Used as fallback when AI generation fails
 */
function generatePlaceholderContent(
  sectionType: string,
  pageContext: z.infer<typeof PageContextSchema>
): Record<string, unknown> {
  const pageTitle = pageContext.pageTitle || 'Your Page'
  const siteName = pageContext.siteName || 'Your Site'

  const templates: Record<string, Record<string, unknown>> = {
    'hero-section': {
      title: `Welcome to ${pageTitle}`,
      subtitle: `Discover what makes ${siteName} special`,
      cta: { text: 'Learn More', url: '#features' },
    },
    'header-section': {
      title: pageTitle,
      description: `Explore the content of ${pageTitle}`,
    },
    'content-section': {
      heading: 'About This Page',
      content: `This is the content section for ${pageTitle}. Add your compelling narrative here to engage your visitors.`,
    },
    'feature-section': {
      heading: 'Key Features',
      subheading: 'What sets us apart',
      features: [
        { title: 'Feature 1', description: 'Description of the first feature', icon: 'star' },
        { title: 'Feature 2', description: 'Description of the second feature', icon: 'check' },
        { title: 'Feature 3', description: 'Description of the third feature', icon: 'heart' },
      ],
    },
    'stats-section': {
      heading: 'By the Numbers',
      stats: [
        { value: '100+', label: 'Happy Customers', description: 'And growing' },
        { value: '50+', label: 'Projects Completed', description: 'Successfully delivered' },
        { value: '24/7', label: 'Support Available', description: 'Always here for you' },
      ],
    },
    'cta-section': {
      heading: 'Ready to Get Started?',
      description: 'Take the next step and join us today.',
      primaryCta: { text: 'Get Started', url: '/contact' },
      secondaryCta: { text: 'Learn More', url: '/about' },
    },
    'faq-section': {
      heading: 'Frequently Asked Questions',
      items: [
        { question: 'What is this about?', answer: 'This is a placeholder FAQ answer.' },
        { question: 'How does it work?', answer: 'Our process is simple and straightforward.' },
        { question: 'How can I get started?', answer: 'Contact us to begin your journey.' },
      ],
    },
    'testimonial-section': {
      heading: 'What Our Customers Say',
      testimonials: [
        { quote: 'Amazing experience!', author: 'John Doe', role: 'CEO', company: 'Example Corp' },
        { quote: 'Highly recommended!', author: 'Jane Smith', role: 'Director', company: 'Sample Inc' },
      ],
    },
  }

  return templates[sectionType] || {
    title: `${sectionType} Content`,
    description: 'Placeholder content for this section.',
  }
}

/**
 * Generate placeholder AI hints for a section type
 * This includes purpose, audience, word count, etc.
 * If websiteAIContext is provided, use it to enhance the hints
 *
 * Note: Tone and writing style come from the agent, not the website
 */
function generatePlaceholderAIHints(
  sectionType: string,
  pageContext: z.infer<typeof PageContextSchema>,
  websiteAIContext?: WebsiteAIContext
): Record<string, unknown> {
  const pageTitle = pageContext.pageTitle || 'Your Page'
  const siteName = pageContext.siteName || 'Your Site'

  // Use website context if available
  const targetAudience = websiteAIContext?.target_audience || 'Website visitors'
  const websitePurpose = websiteAIContext?.purpose || ''
  const uniqueValueProp = websiteAIContext?.unique_value_proposition || ''

  const hintTemplates: Record<string, Record<string, unknown>> = {
    'hero-section': {
      purpose: websitePurpose
        ? `Capture visitor attention and communicate: ${websitePurpose}`
        : `Capture visitor attention and communicate the main value proposition of ${pageTitle}`,
      wordRange: { min: 30, max: 80 },
      audience: targetAudience,
      uniqueValue: uniqueValueProp || undefined,
    },
    'header-section': {
      purpose: `Introduce the section topic for ${pageTitle}`,
      wordRange: { min: 10, max: 30 },
      audience: targetAudience,
    },
    'content-section': {
      purpose: websitePurpose
        ? `Provide detailed information about ${websitePurpose}`
        : `Provide detailed information and engage readers with valuable content`,
      wordRange: { min: 100, max: 300 },
      audience: targetAudience,
    },
    'feature-section': {
      purpose: uniqueValueProp
        ? `Highlight key features that showcase: ${uniqueValueProp}`
        : `Highlight key features and benefits that differentiate ${siteName}`,
      wordRange: { min: 50, max: 150 },
      audience: targetAudience,
    },
    'stats-section': {
      purpose: `Build credibility with impressive metrics and achievements`,
      wordRange: { min: 20, max: 60 },
      audience: targetAudience,
    },
    'cta-section': {
      purpose: `Drive conversions and encourage visitors to take the next step`,
      wordRange: { min: 20, max: 50 },
      audience: targetAudience,
    },
    'faq-section': {
      purpose: `Address common questions and reduce friction for ${targetAudience}`,
      wordRange: { min: 150, max: 400 },
      audience: targetAudience,
    },
    'testimonial-section': {
      purpose: `Build social proof through success stories`,
      wordRange: { min: 50, max: 150 },
      audience: targetAudience,
    },
  }

  const result = hintTemplates[sectionType] || {
    purpose: websitePurpose || `Provide relevant content for this ${sectionType}`,
    wordRange: { min: 50, max: 200 },
    audience: targetAudience,
  }

  // Clean up undefined values
  Object.keys(result).forEach(key => {
    if (result[key] === undefined) {
      delete result[key]
    }
  })

  return result
}

/**
 * Generate placeholder prompts (writing instructions) for a section type
 * If websiteAIContext is provided, use it to enhance the prompts
 */
function generatePlaceholderPrompts(
  sectionType: string,
  pageContext: z.infer<typeof PageContextSchema>,
  websiteAIContext?: WebsiteAIContext,
  generatedContent?: Record<string, unknown>
): Record<string, unknown> {
  const pageTitle = pageContext.pageTitle || 'Your Page'
  const siteName = pageContext.siteName || 'Your Site'

  // Use website context if available
  const targetAudience = websiteAIContext?.target_audience || ''
  const websitePurpose = websiteAIContext?.purpose || ''
  const contentGuidelines = websiteAIContext?.content_guidelines || ''
  const websiteKeywords = websiteAIContext?.keywords || []
  const topicsToAvoid = websiteAIContext?.topics_to_avoid || []
  const primaryGoals = websiteAIContext?.primary_goals || []
  const uniqueValueProp = websiteAIContext?.unique_value_proposition || ''

  // Build context string for prompts
  const contextNotes = [
    targetAudience ? `Target audience: ${targetAudience}.` : '',
    websitePurpose ? `Website purpose: ${websitePurpose}.` : '',
    uniqueValueProp ? `Unique value: ${uniqueValueProp}.` : '',
    contentGuidelines ? `Guidelines: ${contentGuidelines}.` : '',
    primaryGoals.length > 0 ? `Goals: ${primaryGoals.join(', ')}.` : '',
    topicsToAvoid.length > 0 ? `Avoid: ${topicsToAvoid.join(', ')}.` : '',
  ].filter(Boolean).join(' ')

  const promptTemplates: Record<string, Record<string, unknown>> = {
    'hero-section': {
      writingPrompt: `Write a compelling hero section for ${pageTitle}${siteName ? ` on ${siteName}` : ''}. Create a headline that grabs attention and a subtitle that explains the key value. Include a strong call-to-action.${contextNotes ? ` ${contextNotes}` : ''}`,
      keywords: [...new Set(['welcome', 'discover', 'start', 'journey', ...websiteKeywords.slice(0, 3)])],
    },
    'header-section': {
      writingPrompt: `Write a clear section header for ${pageTitle} that introduces the content below.${contextNotes ? ` ${contextNotes}` : ''}`,
      keywords: websiteKeywords.slice(0, 3),
    },
    'content-section': {
      writingPrompt: `Write engaging body content for ${pageTitle}. Use storytelling techniques to connect with readers and explain the topic in depth.${contextNotes ? ` ${contextNotes}` : ''}`,
      keywords: [...new Set(['learn', 'understand', 'explore', ...websiteKeywords.slice(0, 3)])],
    },
    'feature-section': {
      writingPrompt: `Describe 3-4 key features or benefits${uniqueValueProp ? ` that showcase: ${uniqueValueProp}` : ''}. Focus on how each feature solves a problem or adds value for the user.${contextNotes ? ` ${contextNotes}` : ''}`,
      keywords: [...new Set(['benefit', 'advantage', 'unique', ...websiteKeywords.slice(0, 3)])],
    },
    'stats-section': {
      writingPrompt: `Present 3-4 impressive statistics or metrics. Each stat should have a clear label and brief description of its significance.${contextNotes ? ` ${contextNotes}` : ''}`,
      keywords: [...new Set(['results', 'achievement', 'success', ...websiteKeywords.slice(0, 3)])],
    },
    'cta-section': {
      writingPrompt: `Write a compelling call-to-action${primaryGoals.length > 0 ? ` that drives: ${primaryGoals[0]}` : ''}. Create urgency and clearly communicate what happens when users click.${contextNotes ? ` ${contextNotes}` : ''}`,
      keywords: [...new Set(['start', 'get', 'try', 'join', ...websiteKeywords.slice(0, 3)])],
    },
    'faq-section': {
      writingPrompt: `Write 3-5 frequently asked questions with thorough, helpful answers${targetAudience ? ` for ${targetAudience}` : ''}. Address common concerns and objections.${contextNotes ? ` ${contextNotes}` : ''}`,
      keywords: [...new Set(['question', 'how', 'what', 'why', ...websiteKeywords.slice(0, 3)])],
    },
    'testimonial-section': {
      writingPrompt: `Write authentic-sounding testimonials from satisfied customers. Include specific results and genuine-feeling quotes.${contextNotes ? ` ${contextNotes}` : ''}`,
      keywords: [...new Set(['recommend', 'experience', 'results', ...websiteKeywords.slice(0, 3)])],
    },
  }

  const basePrompt = promptTemplates[sectionType] || {
    writingPrompt: `Write appropriate content for this ${sectionType} section on ${pageTitle}.${contextNotes ? ` ${contextNotes}` : ''}`,
    keywords: websiteKeywords.slice(0, 5),
  }

  // Add field hints
  const fieldHints = generateFieldHints(sectionType, pageContext, websiteAIContext, generatedContent)
  if (Object.keys(fieldHints).length > 0) {
    return { ...basePrompt, fieldHints }
  }

  return basePrompt
}

/**
 * Generate complete section optimization result including content, AI hints, and prompts
 * Uses website AI context to enhance the generated content when available
 * NOTE: Reserved for fallback - prefixed with _ to suppress unused warnings
 */
function _generateSectionOptimization(
  section: z.infer<typeof SectionSchema>,
  pageContext: z.infer<typeof PageContextSchema>,
  websiteAIContext?: WebsiteAIContext
): {
  content: Record<string, unknown>
  ai_hints: Record<string, unknown>
  prompts: Record<string, unknown>
} {
  const content = generatePlaceholderContent(section.type, pageContext)
  return {
    content,
    ai_hints: generatePlaceholderAIHints(section.type, pageContext, websiteAIContext),
    prompts: generatePlaceholderPrompts(section.type, pageContext, websiteAIContext, content),
  }
}

/**
 * Build prompt for optimizing a single section
 * NOTE: Reserved for future agent integration - prefixed with _ to suppress unused warnings
 */
function _buildSectionOptimizationPrompt(
  section: z.infer<typeof SectionSchema>,
  pageContext: z.infer<typeof PageContextSchema>
): string {
  const hints = section.ai_hints || {}
  const prompts = section.prompts || {}

  return `Generate optimized content for a ${section.type} section.

## Page Context
- Title: ${pageContext.pageTitle || 'Untitled Page'}
- Purpose: ${pageContext.pagePurpose || 'No specific purpose defined'}
- Site: ${pageContext.siteName || 'Website'}

## Section Details
- Type: ${section.type}
- Variant: ${section.variant || 'default'}

## Content Guidelines
${hints.purpose ? `- Purpose: ${hints.purpose}` : ''}
${hints.tone ? `- Tone: ${hints.tone}` : ''}
${hints.audience ? `- Target Audience: ${hints.audience}` : ''}
${(prompts as any).writingPrompt ? `- Writing Instructions: ${(prompts as any).writingPrompt}` : ''}

## Current Content
${section.content && Object.keys(section.content).length > 0
  ? JSON.stringify(section.content, null, 2)
  : 'No existing content - generate fresh content.'}

## Task
Generate engaging, well-structured content for this section. Return ONLY a valid JSON object with the content fields appropriate for this section type.

For ${section.type}, the content should include:
${_getSectionContentFields(section.type)}

Return the content as a JSON object.`
}

/**
 * Build prompt for optimizing all sections
 * NOTE: Reserved for future agent integration - prefixed with _ to suppress unused warnings
 */
function _buildAllSectionsOptimizationPrompt(
  sections: z.infer<typeof SectionSchema>[],
  pageContext: z.infer<typeof PageContextSchema>
): string {
  const sectionsInfo = sections.map((s, i) => {
    const hints = s.ai_hints || {}
    return `### Section ${i + 1}: ${s.type}
- Variant: ${s.variant || 'default'}
- Purpose: ${(hints as any).purpose || 'Not specified'}
- Current content: ${s.content && Object.keys(s.content).length > 0 ? 'Has existing content' : 'Empty'}`
  }).join('\n\n')

  return `Generate optimized content for ALL sections on this page.

## Page Context
- Title: ${pageContext.pageTitle || 'Untitled Page'}
- Purpose: ${pageContext.pagePurpose || 'No specific purpose defined'}
- Site: ${pageContext.siteName || 'Website'}

## Sections to Optimize
${sectionsInfo}

## Task
Generate cohesive, well-structured content for all ${sections.length} sections.
Ensure consistency in tone and style across sections.
Create a logical narrative flow from section to section.

Return a JSON array where each item has:
- sectionId: string (matching the section's id)
- content: object (the generated content for that section)

Example format:
[
  { "sectionId": "hero-1", "content": { "title": "...", "subtitle": "..." } },
  { "sectionId": "features-2", "content": { "heading": "...", "features": [...] } }
]`
}

/**
 * Get expected content fields for a section type
 * NOTE: Reserved for future agent integration - prefixed with _ to suppress unused warnings
 */
function _getSectionContentFields(sectionType: string): string {
  const fields: Record<string, string> = {
    'hero-section': '- title: compelling headline\n- subtitle: supporting text\n- cta: { text, url } - call to action button',
    'header-section': '- title: section title\n- description: optional supporting text',
    'content-section': '- heading: section heading\n- content: markdown formatted content',
    'feature-section': '- heading: section heading\n- subheading: optional\n- features: array of { title, description, icon }',
    'stats-section': '- heading: section heading\n- stats: array of { value, label, description }',
    'cta-section': '- heading: compelling headline\n- description: supporting text\n- primaryCta: { text, url }\n- secondaryCta: { text, url }',
    'faq-section': '- heading: section heading\n- items: array of { question, answer }',
    'testimonial-section': '- heading: section heading\n- testimonials: array of { quote, author, role, company }',
    'pricing-section': '- heading: section heading\n- plans: array of { name, price, features, cta }',
    'team-section': '- heading: section heading\n- members: array of { name, role, bio, image }',
    'contact-section': '- heading: section heading\n- description: optional\n- email, phone, address fields',
    'newsletter-section': '- heading: section heading\n- description: value proposition\n- buttonText: submit button label',
  }
  return fields[sectionType] || '- content: appropriate content for this section type'
}

/**
 * Parse agent response for single section optimization
 * NOTE: Reserved for future agent integration - prefixed with _ to suppress unused warnings
 */
function _parseAgentResponse(
  result: any,
  _sectionType: string // Reserved for type-specific parsing
): Record<string, unknown> {
  // The agent should return structured content
  // Try to extract JSON from the response
  if (typeof result === 'object' && result !== null) {
    // If it's already an object, return it
    if (result.content) return result.content
    return result
  }

  if (typeof result === 'string') {
    // Try to parse JSON from the string
    const jsonMatch = result.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0])
      } catch (e) {
        console.warn('[ContentGeneration] Failed to parse JSON from agent response')
      }
    }
  }

  // Return a default structure if parsing fails
  return {
    title: 'Generated Content',
    description: 'Content generation in progress...',
  }
}

/**
 * Parse agent response for multi-section optimization
 * NOTE: Reserved for future agent integration - prefixed with _ to suppress unused warnings
 */
function _parseMultiSectionResponse(
  result: any,
  sections: z.infer<typeof SectionSchema>[]
): Array<{ sectionId: string; content: Record<string, unknown> }> {
  // Try to parse the result as an array of section updates
  if (Array.isArray(result)) {
    return result
  }

  if (typeof result === 'string') {
    // Try to parse JSON array from the string
    const jsonMatch = result.match(/\[[\s\S]*\]/)
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0])
      } catch (e) {
        console.warn('[ContentGeneration] Failed to parse JSON array from agent response')
      }
    }
  }

  // Fallback: return empty content for each section
  return sections.map(s => ({
    sectionId: s.id,
    content: { _generated: false, _message: 'Content generation pending' },
  }))
}
