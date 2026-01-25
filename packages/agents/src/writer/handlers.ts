/**
 * WriterAgent Tool Handlers
 * Implementations that connect tools to database operations
 */

import { ToolHandler, ToolResult, toolSuccess, toolError } from '../base/tools'
import { validateContentBlocks } from '../base/utilities'
import {
  getAgentForPageType,
  getCollectionsForPageType,
  getAgentExpertise,
  loadCollectionItems,
  type ContentServiceInterface,
  type LoadedCollectionItem,
} from '@swarm-press/shared'
import { getLanguageGuidelines, isSupportedLanguage, type SupportedLanguage } from './language-guidelines'

// ============================================================================
// Repository Access
// Import directly from source to pick up latest changes
// ============================================================================

async function getContentRepository() {
  // Import from source to avoid stale dist issues during development
  const { contentRepository } = await import('@swarm-press/backend/src/db/repositories/content-repository')
  return contentRepository
}

async function getWebsiteRepository() {
  const { websiteRepository } = await import('@swarm-press/backend/src/db/repositories/website-repository')
  return websiteRepository
}

async function getGitHubContentService(websiteId: string) {
  // Dynamic import to avoid circular dependencies
  const githubIntegration = await import('@swarm-press/github-integration/src/content-service')
  const websiteRepository = await getWebsiteRepository()
  const website = await websiteRepository.findById(websiteId)

  if (!website || !website.github_repo) {
    throw new Error(`Website ${websiteId} not found or not connected to GitHub`)
  }

  return new githubIntegration.GitHubContentService({
    owner: website.github_owner || '',
    repo: website.github_repo,
    token: website.github_access_token || '',
    branch: 'main',
    contentPath: 'content/collections',
    pagesPath: 'content/pages',
  })
}

// ============================================================================
// Tool Handlers
// ============================================================================

/**
 * Get content - fetch a content item by ID
 */
export const getContentHandler: ToolHandler<{ content_id: string }> = async (
  input,
  _context
): Promise<ToolResult> => {
  try {
    const contentRepository = await getContentRepository()
    const content = await contentRepository.findById(input.content_id)

    if (!content) {
      return toolError(`Content item not found: ${input.content_id}`)
    }

    return toolSuccess({
      id: content.id,
      title: content.title,
      brief: content.brief,
      status: content.status,
      body: content.body,
      metadata: content.metadata,
      website_id: content.website_id,
      author_agent_id: content.author_agent_id,
      created_at: content.created_at,
      updated_at: content.updated_at,
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to fetch content')
  }
}

/**
 * Write draft - create or update content body
 */
export const writeDraftHandler: ToolHandler<{
  content_id: string
  title: string
  body: any[]
}> = async (input, context): Promise<ToolResult> => {
  try {
    console.log(`[WriterHandler] write_draft called:`, {
      content_id: input.content_id,
      title: input.title,
      bodyType: typeof input.body,
      bodyIsArray: Array.isArray(input.body),
      bodyLength: Array.isArray(input.body) ? input.body.length : 'N/A',
      firstBlock: Array.isArray(input.body) && input.body[0] ? JSON.stringify(input.body[0]).substring(0, 200) : 'N/A',
    })

    // Validate body is an array of blocks
    if (!Array.isArray(input.body)) {
      return toolError('Body must be an array of content blocks')
    }

    // Validate each block has a type
    for (let i = 0; i < input.body.length; i++) {
      const block = input.body[i]
      if (!block || typeof block !== 'object') {
        return toolError(`Block at index ${i} is not a valid object`)
      }
      if (!block.type) {
        return toolError(`Block at index ${i} is missing required "type" field`)
      }
    }

    // Validate content blocks structure
    const validation = validateContentBlocks(input.body)
    if (!validation.valid) {
      return toolError(`Invalid content blocks: ${validation.errors?.join(', ')}`)
    }

    const contentRepository = await getContentRepository()

    // Check content exists
    const existing = await contentRepository.findById(input.content_id)
    if (!existing) {
      return toolError(`Content item not found: ${input.content_id}`)
    }

    // Update content
    const updated = await contentRepository.update(input.content_id, {
      title: input.title,
      body: input.body,
      updated_at: new Date().toISOString(),
    })

    if (!updated) {
      return toolError('Failed to update content')
    }

    // If content is in brief_created status, transition to draft
    if (existing.status === 'brief_created') {
      const transitionResult = await contentRepository.transition(
        input.content_id,
        'writer.started',  // Matches state machine event name
        'Writer',  // Matches state machine allowedActors
        context.agentId
      )
      if (!transitionResult.success) {
        console.warn(`[WriterHandler] Could not transition to draft: ${transitionResult.error}`)
      }
    }

    return toolSuccess({
      content_id: updated.id,
      title: updated.title,
      status: updated.status,
      block_count: input.body.length,
      message: 'Draft saved successfully',
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to write draft')
  }
}

/**
 * Revise draft - update content based on feedback
 */
export const reviseDraftHandler: ToolHandler<{
  content_id: string
  title?: string
  body: any[]
  revision_notes?: string
}> = async (input, context): Promise<ToolResult> => {
  try {
    // Validate body
    if (!Array.isArray(input.body)) {
      return toolError('Body must be an array of content blocks')
    }

    const validation = validateContentBlocks(input.body)
    if (!validation.valid) {
      return toolError(`Invalid content blocks: ${validation.errors?.join(', ')}`)
    }

    const contentRepository = await getContentRepository()

    // Check content exists
    const existing = await contentRepository.findById(input.content_id)
    if (!existing) {
      return toolError(`Content item not found: ${input.content_id}`)
    }

    // Build update data
    const updateData: Record<string, any> = {
      body: input.body,
      updated_at: new Date().toISOString(),
    }

    if (input.title) {
      updateData.title = input.title
    }

    // Add revision notes to metadata
    if (input.revision_notes) {
      const metadata = existing.metadata || {}
      const revisions = metadata.revisions || []
      revisions.push({
        date: new Date().toISOString(),
        agent_id: context.agentId,
        notes: input.revision_notes,
      })
      updateData.metadata = { ...metadata, revisions }
    }

    // Update content
    const updated = await contentRepository.update(input.content_id, updateData)

    if (!updated) {
      return toolError('Failed to update content')
    }

    // If content is in needs_changes status, transition back to draft
    if (existing.status === 'needs_changes') {
      const transitionResult = await contentRepository.transition(
        input.content_id,
        'revisions_applied',  // Matches state machine event name
        'Writer',  // Matches state machine allowedActors
        context.agentId
      )
      if (transitionResult.success) {
        console.log(`[WriterHandler] Transitioned content back to draft`)
      }
    }

    return toolSuccess({
      content_id: updated.id,
      title: updated.title,
      status: updated.status,
      block_count: input.body.length,
      revision_notes: input.revision_notes,
      message: 'Revision saved successfully',
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to revise draft')
  }
}

/**
 * Submit for review - transition content to editorial review
 */
export const submitForReviewHandler: ToolHandler<{ content_id: string }> = async (
  input,
  context
): Promise<ToolResult> => {
  try {
    const contentRepository = await getContentRepository()

    // Check content exists
    const content = await contentRepository.findById(input.content_id)
    if (!content) {
      return toolError(`Content item not found: ${input.content_id}`)
    }

    // Check content has a body
    if (!content.body || !Array.isArray(content.body) || content.body.length === 0) {
      return toolError('Cannot submit empty content for review. Please write a draft first.')
    }

    // Transition to in_editorial_review
    const result = await contentRepository.transition(
      input.content_id,
      'submit_for_review',
      'Writer',  // Matches state machine allowedActors
      context.agentId
    )

    if (!result.success) {
      return toolError(`Failed to submit for review: ${result.error}`)
    }

    return toolSuccess({
      content_id: input.content_id,
      previous_status: content.status,
      new_status: 'in_editorial_review',
      message: 'Content submitted for editorial review',
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to submit for review')
  }
}

/**
 * Generate page content - load page and collections for content generation
 */
export const generatePageContentHandler: ToolHandler<{
  website_id: string
  page_path: string
}> = async (input, _context): Promise<ToolResult> => {
  try {
    console.log(`[WriterHandler] generate_page_content called:`, {
      website_id: input.website_id,
      page_path: input.page_path,
    })

    const contentService = await getGitHubContentService(input.website_id)

    // Get the page from GitHub
    const pageFile = await contentService.getPageByPath(input.page_path)
    if (!pageFile) {
      return toolError(`Page not found: ${input.page_path}`)
    }

    const page = pageFile.content
    const metadata = page.metadata || {}

    // Extract village and page_type from metadata or path
    const village = (metadata.city as string) || extractVillageFromPath(input.page_path)
    const pageType = page.page_type || (metadata.page_type as string) || extractPageTypeFromPath(input.page_path)
    const language = (metadata.lang as string) || 'en'

    // Determine which agent should write this page
    const suggestedAgent = getAgentForPageType(pageType)
    const agentExpertise = getAgentExpertise(suggestedAgent)

    // Get relevant collection types for this page type
    const relevantCollections = getCollectionsForPageType(pageType)

    // Load collection items filtered by village
    const collectionContext: string[] = []
    const loadedItems: Record<string, LoadedCollectionItem[]> = {}

    for (const collectionType of relevantCollections) {
      try {
        const items = await loadCollectionItems(
          contentService as ContentServiceInterface,
          collectionType,
          { village, published: true, limit: 20 }
        )

        if (items.length > 0) {
          loadedItems[collectionType] = items
          collectionContext.push(
            `\n### ${collectionType} (${items.length} items in ${village})\n` +
            items.map((item) =>
              `- **${item.title}**${item.summary ? `: ${item.summary.slice(0, 100)}...` : ''} [slug: ${item.slug}]`
            ).join('\n')
          )
        }
      } catch (error) {
        console.warn(`[WriterHandler] Failed to load collection ${collectionType}:`, error)
      }
    }

    // Get language-specific guidelines
    const langCode = isSupportedLanguage(language) ? language : 'en'
    const languageGuidelinesText = getLanguageGuidelines(langCode as SupportedLanguage)

    // Build the brief for the agent
    const brief = {
      page: {
        id: page.id,
        path: input.page_path,
        title: page.title,
        slug: page.slug,
        page_type: pageType,
        current_body: page.body,
        seo: page.seo,
      },
      context: {
        village,
        language,
        suggested_agent: suggestedAgent,
        agent_expertise: agentExpertise,
        relevant_collections: relevantCollections,
      },
      collections: loadedItems,
      instructions: `
## Your Task
Create engaging, emotional content for the "${page.title}" page in ${village}.
**IMPORTANT: Write ALL content in ${language.toUpperCase()} language.**

## Page Context
- Village: ${village}
- Page Type: ${pageType}
- Target Language: ${language.toUpperCase()}
- Suggested Writer: ${suggestedAgent} (${agentExpertise})

${languageGuidelinesText}

## Available Collections
${collectionContext.length > 0 ? collectionContext.join('\n') : 'No collection items available for this village.'}

## Content Guidelines
1. Write in your unique voice and persona
2. Create an engaging narrative that naturally incorporates the collection items
3. Use collection-embed blocks to showcase curated items
4. Include practical tips, local insights, and personal touches
5. Make readers feel the essence of ${village}
6. **Write everything in ${language.toUpperCase()} - do not use other languages**

## Block Types to Use
- hero: For the page header with an evocative title and subtitle
- paragraph: For narrative content (use markdown for formatting)
- collection-embed: To embed filtered collection items
- callout: For tips, warnings, or special recommendations
- quote: For local sayings or testimonials
- list: For bullet points or numbered lists
- faq: For frequently asked questions

When ready, use the write_page_content tool to save your content.
`,
    }

    return toolSuccess(brief)
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to generate page content')
  }
}

/**
 * Write page content - save content to a GitHub page
 */
export const writePageContentHandler: ToolHandler<{
  website_id: string
  page_path: string
  title: string
  body: any[]
  seo?: Record<string, unknown>
}> = async (input, context): Promise<ToolResult> => {
  try {
    console.log(`[WriterHandler] write_page_content called:`, {
      website_id: input.website_id,
      page_path: input.page_path,
      title: input.title,
      bodyLength: Array.isArray(input.body) ? input.body.length : 'N/A',
    })

    // Validate body is an array of blocks
    if (!Array.isArray(input.body)) {
      return toolError('Body must be an array of content blocks')
    }

    // Validate each block has a type
    for (let i = 0; i < input.body.length; i++) {
      const block = input.body[i]
      if (!block || typeof block !== 'object') {
        return toolError(`Block at index ${i} is not a valid object`)
      }
      if (!block.type) {
        return toolError(`Block at index ${i} is missing required "type" field`)
      }
    }

    const contentService = await getGitHubContentService(input.website_id)

    // Get the existing page
    const pageFile = await contentService.getPageByPath(input.page_path)
    if (!pageFile) {
      return toolError(`Page not found: ${input.page_path}`)
    }

    // Update the page
    const updatedPage = {
      ...pageFile.content,
      title: input.title,
      body: input.body,
      seo: input.seo || pageFile.content.seo,
      status: 'draft',
      updated_at: new Date().toISOString(),
    }

    // Save to GitHub
    const result = await contentService.savePageByPath(
      input.page_path,
      updatedPage,
      `Update page content: ${input.title} [by ${context.agentName}]`
    )

    return toolSuccess({
      page_path: input.page_path,
      title: input.title,
      block_count: input.body.length,
      commit: result.commit,
      message: 'Page content saved successfully to GitHub',
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to write page content')
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function extractVillageFromPath(path: string): string {
  // Path format: content/pages/{lang}/{village}/{page_type}.json
  const parts = path.split('/')
  if (parts.length >= 4) {
    return parts[parts.length - 2] || 'unknown' // Second to last part
  }
  return 'unknown'
}

function extractPageTypeFromPath(path: string): string {
  // Path format: content/pages/{lang}/{village}/{page_type}.json
  const parts = path.split('/')
  const filename = parts[parts.length - 1] || 'unknown.json'
  return filename.replace('.json', '')
}

// ============================================================================
// Section Generation & Optimization Handlers
// ============================================================================

/**
 * Generate page sections - return recommended section structure
 * The agent generates the sections based on the context and questionnaire
 */
export const generatePageSectionsHandler: ToolHandler<{
  page_context: {
    pageType?: string
    pageTitle?: string
    pageId?: string
    siteName?: string
    siteDescription?: string
  }
  questionnaire: {
    purpose: string
    audience: string
    keySections: string[]
    tone?: string
  }
}> = async (input, _context): Promise<ToolResult> => {
  try {
    console.log(`[WriterHandler] generate_page_sections called:`, {
      pageType: input.page_context.pageType,
      pageTitle: input.page_context.pageTitle,
      purpose: input.questionnaire.purpose,
      keySections: input.questionnaire.keySections,
    })

    // This handler provides the context for the agent to generate sections
    // The agent will use its knowledge to recommend appropriate sections
    const sectionGuide = {
      availableSectionTypes: [
        { type: 'hero-section', description: 'Large banner section with title, subtitle, and optional CTA' },
        { type: 'header-section', description: 'Simple header with title and optional description' },
        { type: 'content-section', description: 'Rich text content area for narrative copy' },
        { type: 'feature-section', description: 'Grid or list of features/benefits with icons' },
        { type: 'stats-section', description: 'Key statistics or metrics display' },
        { type: 'cta-section', description: 'Call-to-action section with buttons' },
        { type: 'faq-section', description: 'Frequently asked questions accordion' },
        { type: 'testimonial-section', description: 'Customer quotes and testimonials' },
        { type: 'pricing-section', description: 'Pricing plans or packages' },
        { type: 'team-section', description: 'Team member profiles' },
        { type: 'contact-section', description: 'Contact form or information' },
        { type: 'logo-cloud-section', description: 'Partner or client logos' },
        { type: 'newsletter-section', description: 'Email signup form' },
      ],
      context: input.page_context,
      userRequirements: input.questionnaire,
      instructions: `Based on the page context and user requirements, recommend a set of sections.
For each section, provide:
- type: one of the available section types
- variant: the recommended variant (e.g., "centered", "split-with-image")
- order: position in the page (0-indexed)
- prompts: { purpose: "what this section should accomplish" }
- ai_hints: { tone: "${input.questionnaire.tone || 'professional'}" }

The user requested these key sections: ${input.questionnaire.keySections.join(', ')}
Page purpose: ${input.questionnaire.purpose}
Target audience: ${input.questionnaire.audience}`,
    }

    return toolSuccess(sectionGuide)
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to generate page sections')
  }
}

/**
 * Optimize section content - generate content for a single section
 */
export const optimizeSectionHandler: ToolHandler<{
  section: {
    id: string
    type: string
    variant?: string
    content?: Record<string, unknown>
    prompts?: Record<string, unknown>
    ai_hints?: Record<string, unknown>
  }
  page_context: {
    pageTitle?: string
    pageId?: string
    pagePurpose?: string
    siteName?: string
  }
}> = async (input, _context): Promise<ToolResult> => {
  try {
    console.log(`[WriterHandler] optimize_section called:`, {
      sectionId: input.section.id,
      sectionType: input.section.type,
      variant: input.section.variant,
      hasExistingContent: !!input.section.content && Object.keys(input.section.content).length > 0,
    })

    // Build content generation instructions based on section type
    const sectionContentSchemas: Record<string, object> = {
      'hero-section': {
        title: 'string - compelling headline',
        subtitle: 'string - supporting text',
        cta: { text: 'string - button text', url: 'string - button URL' },
        backgroundImage: 'string - image URL or leave empty',
      },
      'header-section': {
        title: 'string - section title',
        description: 'string - optional description',
      },
      'content-section': {
        heading: 'string - section heading',
        content: 'string - markdown formatted content',
      },
      'feature-section': {
        heading: 'string - section heading',
        subheading: 'string - optional subheading',
        features: [{ title: 'string', description: 'string', icon: 'string - icon name' }],
      },
      'stats-section': {
        heading: 'string - section heading',
        stats: [{ value: 'string - the number/metric', label: 'string - what it represents', description: 'string - optional detail' }],
      },
      'cta-section': {
        heading: 'string - compelling headline',
        description: 'string - supporting text',
        primaryCta: { text: 'string', url: 'string' },
        secondaryCta: { text: 'string', url: 'string' },
      },
      'faq-section': {
        heading: 'string - section heading',
        items: [{ question: 'string', answer: 'string' }],
      },
      'testimonial-section': {
        heading: 'string - section heading',
        testimonials: [{ quote: 'string', author: 'string', role: 'string', company: 'string' }],
      },
    }

    const contentSchema = sectionContentSchemas[input.section.type] || { content: 'object - section-specific content' }

    const optimizationContext = {
      section: input.section,
      pageContext: input.page_context,
      contentSchema,
      instructions: `Generate optimized content for this ${input.section.type} section.

Page: "${input.page_context.pageTitle}" - ${input.page_context.pagePurpose || 'No specific purpose defined'}

Section prompts/hints:
${JSON.stringify(input.section.prompts || {}, null, 2)}
${JSON.stringify(input.section.ai_hints || {}, null, 2)}

${input.section.content && Object.keys(input.section.content).length > 0
  ? `Current content to improve:\n${JSON.stringify(input.section.content, null, 2)}`
  : 'No existing content - generate fresh content.'}

Generate content matching this schema:
${JSON.stringify(contentSchema, null, 2)}

Return ONLY the content object, properly structured.`,
    }

    return toolSuccess(optimizationContext)
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to optimize section')
  }
}

/**
 * Optimize all sections - generate content for all sections on a page
 */
export const optimizeAllSectionsHandler: ToolHandler<{
  sections: Array<{
    id: string
    type: string
    variant?: string
    content?: Record<string, unknown>
    prompts?: Record<string, unknown>
    ai_hints?: Record<string, unknown>
  }>
  page_context: {
    pageTitle?: string
    pageId?: string
    pagePurpose?: string
    siteName?: string
  }
}> = async (input, _context): Promise<ToolResult> => {
  try {
    console.log(`[WriterHandler] optimize_all_sections called:`, {
      sectionCount: input.sections.length,
      sectionTypes: input.sections.map(s => s.type),
      pageTitle: input.page_context.pageTitle,
    })

    const optimizationContext = {
      sections: input.sections,
      pageContext: input.page_context,
      instructions: `Generate optimized content for ALL ${input.sections.length} sections on this page.

Page: "${input.page_context.pageTitle}" - ${input.page_context.pagePurpose || 'No specific purpose defined'}

Ensure consistency across all sections:
- Maintain consistent tone and style
- Create a logical narrative flow
- Avoid repetition between sections
- Each section should complement the others

For each section, generate appropriate content based on its type and configured prompts/hints.

Return an array of objects with structure: { sectionId: string, content: object }`,
    }

    return toolSuccess(optimizationContext)
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to optimize sections')
  }
}

// ============================================================================
// Content Integrity Audit Handlers
// ============================================================================

/**
 * Audit links handler - scan content for broken links
 */
export const auditLinksHandler: ToolHandler<{
  content_path: string
  sitemap_slugs?: string[]
  check_external?: boolean
}> = async (input, _context): Promise<ToolResult> => {
  try {
    console.log(`[WriterHandler] audit_links called:`, {
      content_path: input.content_path,
      check_external: input.check_external,
    })

    const { runContentAudit, filterIssuesByCategory } = await import('@swarm-press/shared')

    const auditResult = await runContentAudit({
      contentPath: input.content_path,
      checks: ['links'],
      sitemapSlugs: input.sitemap_slugs || [],
      options: {
        concurrency: 10,
      },
    })

    const brokenLinks = filterIssuesByCategory(auditResult.issues, 'broken_link')

    return toolSuccess({
      summary: {
        totalLinksChecked: auditResult.summary.totalUrlsChecked,
        brokenLinks: brokenLinks.length,
        internalIssues: brokenLinks.filter((i) => i.url?.startsWith('/') || !i.url?.startsWith('http')).length,
        externalIssues: brokenLinks.filter((i) => i.url?.startsWith('http')).length,
      },
      issues: brokenLinks.map((issue) => ({
        file: issue.relativePath,
        jsonPath: issue.jsonPath,
        url: issue.url,
        description: issue.description,
        suggestedFix: issue.suggestedFix,
        severity: issue.severity,
      })),
      generatedAt: auditResult.generatedAt,
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to audit links')
  }
}

/**
 * Find internal link opportunities handler
 */
export const findInternalLinkOpportunitiesHandler: ToolHandler<{
  content_path: string
  sitemap_path?: string
  min_relevance?: number
}> = async (input, _context): Promise<ToolResult> => {
  try {
    console.log(`[WriterHandler] find_internal_link_opportunities called:`, {
      content_path: input.content_path,
    })

    const { readFile, readdir } = await import('fs/promises')
    const { join } = await import('path')

    // Load sitemap if available
    let sitemapPages: Array<{ slug: string; title: string; village?: string; pageType?: string }> = []
    if (input.sitemap_path) {
      try {
        const sitemapContent = await readFile(input.sitemap_path, 'utf-8')
        const sitemap = JSON.parse(sitemapContent)
        if (sitemap.pages) {
          sitemapPages = sitemap.pages
        }
      } catch {
        console.log('[WriterHandler] Could not load sitemap')
      }
    }

    // Scan content files and analyze for linking opportunities
    const opportunities: Array<{
      sourcePage: string
      targetPage: string
      relationship: string
      suggestedAnchorText: string
      relevance: number
    }> = []

    // Simple heuristic: pages in same village directory should link to each other
    const minRelevance = input.min_relevance || 0.5

    async function scanDirectory(dirPath: string, basePath: string): Promise<void> {
      const entries = await readdir(dirPath, { withFileTypes: true })

      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue

        const fullPath = join(dirPath, entry.name)

        if (entry.isDirectory()) {
          await scanDirectory(fullPath, basePath)
        } else if (entry.name.endsWith('.json')) {
          try {
            const content = JSON.parse(await readFile(fullPath, 'utf-8'))
            const relativePath = fullPath.replace(basePath + '/', '')

            // Extract village from path
            const pathParts = relativePath.split('/')
            const village = pathParts.length > 1 ? pathParts[pathParts.length - 2] : null

            // Find related pages in same village
            if (village && sitemapPages.length > 0) {
              const relatedPages = sitemapPages.filter(
                (p) => p.village === village && p.slug !== content.slug
              )

              for (const related of relatedPages) {
                // Check if link already exists in content
                const contentStr = JSON.stringify(content)
                if (!contentStr.includes(related.slug)) {
                  opportunities.push({
                    sourcePage: relativePath,
                    targetPage: related.slug,
                    relationship: 'same_village',
                    suggestedAnchorText: related.title || related.slug,
                    relevance: 0.7,
                  })
                }
              }
            }
          } catch {
            // Skip invalid JSON
          }
        }
      }
    }

    await scanDirectory(input.content_path, input.content_path)

    // Filter by relevance and deduplicate
    const filteredOpportunities = opportunities
      .filter((o) => o.relevance >= minRelevance)
      .slice(0, 50) // Limit to top 50

    return toolSuccess({
      opportunities: filteredOpportunities,
      totalFound: opportunities.length,
      filteredCount: filteredOpportunities.length,
      minRelevanceUsed: minRelevance,
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to find link opportunities')
  }
}

/**
 * Audit translations handler - check for missing translations
 */
export const auditTranslationsHandler: ToolHandler<{
  content_path: string
  required_languages?: string[]
}> = async (input, _context): Promise<ToolResult> => {
  try {
    console.log(`[WriterHandler] audit_translations called:`, {
      content_path: input.content_path,
      required_languages: input.required_languages,
    })

    const { runContentAudit, filterIssuesByCategory } = await import('@swarm-press/shared')

    const auditResult = await runContentAudit({
      contentPath: input.content_path,
      checks: ['translations'],
      requiredLanguages: input.required_languages || ['en', 'de', 'fr', 'it'],
    })

    const translationIssues = filterIssuesByCategory(auditResult.issues, 'missing_translation')

    // Group by missing language
    const byLanguage: Record<string, number> = {}
    for (const issue of translationIssues) {
      const langs = (issue.details?.missingLanguages as string[]) || []
      for (const lang of langs) {
        byLanguage[lang] = (byLanguage[lang] || 0) + 1
      }
    }

    return toolSuccess({
      summary: {
        totalFields: auditResult.summary.totalFilesScanned,
        missingTranslations: translationIssues.length,
        byLanguage,
      },
      issues: translationIssues.slice(0, 100).map((issue) => ({
        file: issue.relativePath,
        jsonPath: issue.jsonPath,
        missingLanguages: issue.details?.missingLanguages,
        existingContent: issue.details?.existingContent,
        severity: issue.severity,
      })),
      generatedAt: auditResult.generatedAt,
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to audit translations')
  }
}

/**
 * Generate translation handler - create missing translation
 */
export const generateTranslationHandler: ToolHandler<{
  source_text: string
  target_language: string
  context?: string
  content_path?: string
  json_path?: string
}> = async (input, _context): Promise<ToolResult> => {
  try {
    console.log(`[WriterHandler] generate_translation called:`, {
      target_language: input.target_language,
      sourceLength: input.source_text.length,
    })

    // Use Claude for translation
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const client = new Anthropic()

    const languageNames: Record<string, string> = {
      de: 'German',
      fr: 'French',
      it: 'Italian',
    }

    const targetLangName = languageNames[input.target_language] || input.target_language

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: `Translate the following English text to ${targetLangName}.
${input.context ? `Context: ${input.context}` : ''}

Maintain the same tone, style, and formatting. For Cinque Terre travel content, use appropriate local terminology.

Text to translate:
${input.source_text}

Return ONLY the translated text, nothing else.`,
        },
      ],
    })

    const textContent = response.content.find((c) => c.type === 'text')
    if (!textContent || textContent.type !== 'text') {
      return toolError('No translation returned')
    }

    const translation = textContent.text.trim()

    // If content_path and json_path provided, update the file
    if (input.content_path && input.json_path) {
      const { readFile, writeFile } = await import('fs/promises')

      const content = JSON.parse(await readFile(input.content_path, 'utf-8'))

      // Navigate to json_path and update
      const pathParts = input.json_path.split(/[.\[\]]/).filter(Boolean)
      let current: any = content
      for (let i = 0; i < pathParts.length - 1; i++) {
        const part = pathParts[i]
        if (part) {
          current = current[isNaN(Number(part)) ? part : Number(part)]
        }
      }
      const lastPart = pathParts[pathParts.length - 1]
      if (lastPart && current && typeof current === 'object') {
        current[input.target_language] = translation
      }

      await writeFile(input.content_path, JSON.stringify(content, null, 2), 'utf-8')

      return toolSuccess({
        translation,
        targetLanguage: input.target_language,
        saved: true,
        contentPath: input.content_path,
        jsonPath: input.json_path,
      })
    }

    return toolSuccess({
      translation,
      targetLanguage: input.target_language,
      saved: false,
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to generate translation')
  }
}

/**
 * Add internal link handler - insert link into content
 */
export const addInternalLinkHandler: ToolHandler<{
  content_path: string
  target_url: string
  anchor_text: string
  context_hint?: string
}> = async (input, _context): Promise<ToolResult> => {
  try {
    console.log(`[WriterHandler] add_internal_link called:`, {
      content_path: input.content_path,
      target_url: input.target_url,
    })

    const { readFile, writeFile } = await import('fs/promises')

    const content = JSON.parse(await readFile(input.content_path, 'utf-8'))

    // Find a suitable location to add the link
    // Look for paragraphs that might relate to the context_hint
    if (Array.isArray(content.body)) {
      for (let i = 0; i < content.body.length; i++) {
        const block = content.body[i]
        if (block.type === 'paragraph' && block.text) {
          // Check if this paragraph relates to the hint
          const textLower = (block.text as string).toLowerCase()
          const hintLower = (input.context_hint || '').toLowerCase()

          if (!hintLower || textLower.includes(hintLower.split(' ')[0] || '')) {
            // Add link to this paragraph if it doesn't already contain the target
            if (!block.text.includes(input.target_url)) {
              // Append link at end of paragraph
              block.text = `${block.text} [${input.anchor_text}](${input.target_url})`

              await writeFile(input.content_path, JSON.stringify(content, null, 2), 'utf-8')

              return toolSuccess({
                added: true,
                contentPath: input.content_path,
                location: `body[${i}]`,
                targetUrl: input.target_url,
                anchorText: input.anchor_text,
              })
            }
          }
        }
      }
    }

    return toolSuccess({
      added: false,
      reason: 'Could not find suitable location for link',
      suggestion: 'Add link manually or provide better context_hint',
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to add internal link')
  }
}

/**
 * Fix broken link handler - repair or remove broken link
 */
export const fixBrokenLinkHandler: ToolHandler<{
  content_path: string
  json_path: string
  broken_url: string
  action: 'replace' | 'remove_link' | 'remove_element'
  replacement_url?: string
}> = async (input, _context): Promise<ToolResult> => {
  try {
    console.log(`[WriterHandler] fix_broken_link called:`, {
      content_path: input.content_path,
      json_path: input.json_path,
      action: input.action,
    })

    const { readFile, writeFile } = await import('fs/promises')

    const content = JSON.parse(await readFile(input.content_path, 'utf-8'))

    // Navigate to the json_path
    const pathParts = input.json_path.split(/[.\[\]]/).filter(Boolean)
    let parent: any = content
    let current: any = content

    for (let i = 0; i < pathParts.length; i++) {
      const part = pathParts[i]
      if (part) {
        parent = current
        current = current[isNaN(Number(part)) ? part : Number(part)]
      }
    }

    const lastPart = pathParts[pathParts.length - 1]

    switch (input.action) {
      case 'replace':
        if (!input.replacement_url) {
          return toolError('replacement_url required for replace action')
        }
        if (typeof current === 'string' && current.includes(input.broken_url)) {
          const key = isNaN(Number(lastPart)) ? lastPart : Number(lastPart)
          parent[key!] = current.replace(input.broken_url, input.replacement_url)
        } else if (current === input.broken_url) {
          const key = isNaN(Number(lastPart)) ? lastPart : Number(lastPart)
          parent[key!] = input.replacement_url
        }
        break

      case 'remove_link':
        // Remove just the link markup, keep the text
        if (typeof current === 'string') {
          const linkRegex = new RegExp(`\\[([^\\]]+)\\]\\(${input.broken_url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`, 'g')
          const key = isNaN(Number(lastPart)) ? lastPart : Number(lastPart)
          parent[key!] = current.replace(linkRegex, '$1')
        }
        break

      case 'remove_element':
        // Remove the entire element containing the link
        if (Array.isArray(parent)) {
          const index = Number(lastPart)
          parent.splice(index, 1)
        } else {
          delete parent[lastPart!]
        }
        break
    }

    await writeFile(input.content_path, JSON.stringify(content, null, 2), 'utf-8')

    return toolSuccess({
      fixed: true,
      contentPath: input.content_path,
      jsonPath: input.json_path,
      action: input.action,
      brokenUrl: input.broken_url,
      replacementUrl: input.replacement_url,
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to fix broken link')
  }
}

/**
 * Audit tool handlers
 */
export const auditToolHandlers: Record<string, ToolHandler> = {
  audit_links: auditLinksHandler,
  find_internal_link_opportunities: findInternalLinkOpportunitiesHandler,
  audit_translations: auditTranslationsHandler,
  generate_translation: generateTranslationHandler,
  add_internal_link: addInternalLinkHandler,
  fix_broken_link: fixBrokenLinkHandler,
}

// ============================================================================
// Context Tool Handlers (Weather & Content Calendar)
// ============================================================================

/**
 * Get backend API URL (defaults to localhost:3000)
 */
function getBackendApiUrl(): string {
  return process.env.BACKEND_API_URL || 'http://localhost:3000'
}

/**
 * Fetch weather - get current weather and forecast for Cinque Terre
 */
export const fetchWeatherHandler: ToolHandler<{ format?: string }> = async (
  input,
  _context
): Promise<ToolResult> => {
  try {
    const format = input.format || 'full'
    const apiUrl = getBackendApiUrl()

    // Map format to the correct endpoint type
    const typeMap: Record<string, string> = {
      current: 'current',
      forecast: 'forecast',
      full: 'full',
    }
    const type = typeMap[format] || 'full'

    const response = await fetch(`${apiUrl}/api/trpc/weather.${type}`, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer system',
      },
    })

    if (!response.ok) {
      throw new Error(`Weather API error: ${response.status}`)
    }

    const result = await response.json()

    // tRPC wraps the result in a result.data structure
    const data = result?.result?.data || result

    return toolSuccess({
      format,
      weather: data,
      cached: data?.cached ?? false,
      generated_at: data?.generated_at || new Date().toISOString(),
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to fetch weather')
  }
}

/**
 * Get content calendar - access seasonal content topics
 */
export const getContentCalendarHandler: ToolHandler<{
  season?: string
  priority?: string
}> = async (input, _context): Promise<ToolResult> => {
  try {
    const season = input.season || 'current'
    const priority = input.priority || 'all'
    const apiUrl = getBackendApiUrl()

    // Get season info from backend
    const seasonResponse = await fetch(`${apiUrl}/api/trpc/workflow.getSeasonInfo`, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer system',
      },
    })

    if (!seasonResponse.ok) {
      throw new Error(`Season info API error: ${seasonResponse.status}`)
    }

    const seasonResult = await seasonResponse.json()
    const seasonInfo = seasonResult?.result?.data || seasonResult

    // Define seasonal topics (same as in content-calendar.ts API)
    const SEASONAL_TOPICS: Record<string, Array<{ id: string; title: string; priority: string; category: string }>> = {
      spring: [
        { id: 'spring-wildflowers', title: 'Spring Wildflowers on the Hiking Trails', priority: 'high', category: 'nature' },
        { id: 'spring-festivals', title: 'Easter & Spring Festivals Guide', priority: 'high', category: 'events' },
        { id: 'spring-fishing', title: 'Traditional Spring Fishing Season', priority: 'medium', category: 'culture' },
        { id: 'spring-weather', title: 'Spring Weather Guide & What to Pack', priority: 'medium', category: 'travel' },
        { id: 'spring-crowds', title: 'Visiting Before Peak Season', priority: 'high', category: 'travel' },
      ],
      summer: [
        { id: 'summer-beaches', title: 'Best Beaches & Swimming Spots', priority: 'critical', category: 'beaches' },
        { id: 'summer-heat', title: 'Surviving the Summer Heat', priority: 'high', category: 'travel' },
        { id: 'summer-crowds', title: 'Navigating Peak Season Crowds', priority: 'critical', category: 'travel' },
        { id: 'summer-nightlife', title: 'Summer Nightlife & Evening Activities', priority: 'medium', category: 'entertainment' },
        { id: 'summer-ferries', title: 'Ferry Services & Day Trips', priority: 'high', category: 'transport' },
        { id: 'summer-gelato', title: 'Best Gelato Spots in Each Village', priority: 'medium', category: 'food' },
      ],
      fall: [
        { id: 'fall-harvest', title: 'Grape Harvest & Wine Season', priority: 'critical', category: 'food' },
        { id: 'fall-hiking', title: 'Perfect Fall Hiking Weather', priority: 'high', category: 'nature' },
        { id: 'fall-crowds', title: 'Enjoying Quieter Villages', priority: 'high', category: 'travel' },
        { id: 'fall-mushrooms', title: 'Mushroom Foraging Season', priority: 'medium', category: 'food' },
        { id: 'fall-photography', title: 'Fall Colors Photography Guide', priority: 'medium', category: 'nature' },
      ],
      winter: [
        { id: 'winter-christmas', title: 'Christmas Markets & Traditions', priority: 'high', category: 'events' },
        { id: 'winter-local-life', title: 'Experience Authentic Local Life', priority: 'high', category: 'culture' },
        { id: 'winter-restaurants', title: 'Cozy Winter Restaurants', priority: 'medium', category: 'food' },
        { id: 'winter-trails', title: 'Winter Trail Conditions', priority: 'high', category: 'nature' },
        { id: 'winter-deals', title: 'Off-Season Accommodation Deals', priority: 'medium', category: 'travel' },
      ],
    }

    // Build topics list based on filters
    let topics: Array<{
      id: string
      title: string
      priority: string
      category: string
      season: string
    }> = []

    if (season === 'all') {
      for (const [seasonName, seasonTopics] of Object.entries(SEASONAL_TOPICS)) {
        topics.push(...seasonTopics.map(t => ({ ...t, season: seasonName })))
      }
    } else {
      const targetSeason = season === 'current' ? seasonInfo.currentSeason : season
      const seasonTopics = SEASONAL_TOPICS[targetSeason] || []
      topics = seasonTopics.map(t => ({ ...t, season: targetSeason }))
    }

    // Apply priority filter
    if (priority !== 'all') {
      if (priority === 'high') {
        topics = topics.filter(t => t.priority === 'high' || t.priority === 'critical')
      } else if (priority === 'critical') {
        topics = topics.filter(t => t.priority === 'critical')
      }
    }

    return toolSuccess({
      seasonInfo: {
        currentDate: seasonInfo.currentDate,
        currentSeason: seasonInfo.currentSeason,
        nextSeason: seasonInfo.nextSeason,
        seasonWindow: seasonInfo.seasonWindow,
      },
      topics,
      totalTopics: topics.length,
      filters: { season, priority },
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to get content calendar')
  }
}

/**
 * Context tool handlers
 */
export const contextToolHandlers: Record<string, ToolHandler> = {
  fetch_weather: fetchWeatherHandler,
  get_content_calendar: getContentCalendarHandler,
}

// ============================================================================
// Import Media Handlers
// ============================================================================

import { mediaHandlers } from './media-handlers'

// ============================================================================
// Export Handler Map
// ============================================================================

/**
 * Core writer tool handlers
 */
export const coreWriterToolHandlers: Record<string, ToolHandler> = {
  get_content: getContentHandler,
  write_draft: writeDraftHandler,
  revise_draft: reviseDraftHandler,
  submit_for_review: submitForReviewHandler,
  generate_page_content: generatePageContentHandler,
  write_page_content: writePageContentHandler,
  generate_page_sections: generatePageSectionsHandler,
  optimize_section: optimizeSectionHandler,
  optimize_all_sections: optimizeAllSectionsHandler,
}

/**
 * All writer tool handlers including media, audit, and context capabilities
 */
export const writerToolHandlers: Record<string, ToolHandler> = {
  ...coreWriterToolHandlers,
  ...mediaHandlers,
  ...auditToolHandlers,
  ...contextToolHandlers,
}
