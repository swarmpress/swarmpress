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
      // Look for agents with 'write' capability
      const allAgents = await agentRepository.findAll()
      const writerAgent = allAgents.find(agent => {
        const caps = agent.capabilities as string[] || []
        return caps.includes('write_draft') || caps.includes('research_topic')
      })

      if (!writerAgent && mode === 'generate') {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'No writer agent found. Please create an agent with write_draft capability.',
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
