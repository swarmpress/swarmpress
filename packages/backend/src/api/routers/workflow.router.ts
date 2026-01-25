/**
 * Workflow API Router
 * Endpoints for triggering and managing Temporal workflows
 */

import { z } from 'zod'
import { router, publicProcedure, protectedProcedure, ceoProcedure } from '../trpc'
import { TRPCError } from '@trpc/server'

// Lazy import Temporal client to avoid connection issues at startup
async function getTemporalClient() {
  const { temporalClient, startWorkflow, signalWorkflow, getWorkflowResult } = await import(
    '@swarm-press/workflows'
  )
  return { temporalClient, startWorkflow, signalWorkflow, getWorkflowResult }
}

export const workflowRouter = router({
  /**
   * Start content production workflow
   * Triggers writer agent to create content from a brief
   */
  startContentProduction: protectedProcedure
    .input(
      z.object({
        contentId: z.string().describe('UUID of the content item'),
        writerAgentId: z.string().describe('UUID of the writer agent to use'),
        brief: z.string().describe('Content brief for the writer'),
        maxRevisions: z.number().min(1).max(10).default(3),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const { startWorkflow } = await getTemporalClient()

        const workflowId = `content-production-${input.contentId}-${Date.now()}`

        const handle = await startWorkflow('contentProductionWorkflow', [
          {
            contentId: input.contentId,
            writerAgentId: input.writerAgentId,
            brief: input.brief,
            maxRevisions: input.maxRevisions,
          },
        ], {
          workflowId,
          taskQueue: 'swarmpress-default',
        })

        console.log(`[WorkflowRouter] Started content production workflow: ${workflowId}`)

        return {
          success: true,
          workflowId: handle.workflowId,
          runId: handle.runId,
          message: `Content production workflow started for content ${input.contentId}`,
        }
      } catch (error) {
        console.error('[WorkflowRouter] Failed to start content production:', error)
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to start workflow',
        })
      }
    }),

  /**
   * Start editorial review workflow
   * Triggers editor agent to review content
   */
  startEditorialReview: protectedProcedure
    .input(
      z.object({
        contentId: z.string().describe('UUID of the content to review'),
        editorAgentId: z.string().describe('UUID of the editor agent to use'),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const { startWorkflow } = await getTemporalClient()

        const workflowId = `editorial-review-${input.contentId}-${Date.now()}`

        const handle = await startWorkflow('editorialReviewWorkflow', [
          {
            contentId: input.contentId,
            editorAgentId: input.editorAgentId,
          },
        ], {
          workflowId,
          taskQueue: 'swarmpress-default',
        })

        console.log(`[WorkflowRouter] Started editorial review workflow: ${workflowId}`)

        return {
          success: true,
          workflowId: handle.workflowId,
          runId: handle.runId,
          message: `Editorial review workflow started for content ${input.contentId}`,
        }
      } catch (error) {
        console.error('[WorkflowRouter] Failed to start editorial review:', error)
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to start workflow',
        })
      }
    }),

  /**
   * Start publishing workflow
   * Triggers full publish flow: SEO -> Engineering -> Deploy
   */
  startPublishing: protectedProcedure
    .input(
      z.object({
        contentId: z.string().describe('UUID of the content to publish'),
        websiteId: z.string().describe('UUID of the target website'),
        seoAgentId: z.string().describe('UUID of the SEO agent'),
        engineeringAgentId: z.string().describe('UUID of the engineering agent'),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const { startWorkflow } = await getTemporalClient()

        const workflowId = `publishing-${input.contentId}-${Date.now()}`

        const handle = await startWorkflow('publishingWorkflow', [
          {
            contentId: input.contentId,
            websiteId: input.websiteId,
            seoAgentId: input.seoAgentId,
            engineeringAgentId: input.engineeringAgentId,
          },
        ], {
          workflowId,
          taskQueue: 'swarmpress-default',
        })

        console.log(`[WorkflowRouter] Started publishing workflow: ${workflowId}`)

        return {
          success: true,
          workflowId: handle.workflowId,
          runId: handle.runId,
          message: `Publishing workflow started for content ${input.contentId}`,
        }
      } catch (error) {
        console.error('[WorkflowRouter] Failed to start publishing:', error)
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to start workflow',
        })
      }
    }),

  /**
   * Signal CEO approval for high-risk content
   * Sends approval/rejection to waiting editorial review workflow
   */
  signalCEOApproval: ceoProcedure
    .input(
      z.object({
        workflowId: z.string().describe('The workflow ID waiting for approval'),
        approved: z.boolean().describe('Whether CEO approves the content'),
        feedback: z.string().optional().describe('Optional feedback from CEO'),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const { signalWorkflow } = await getTemporalClient()

        await signalWorkflow(input.workflowId, 'ceoApproval', [
          input.approved,
          input.feedback,
        ])

        console.log(
          `[WorkflowRouter] CEO approval signal sent to ${input.workflowId}: ${input.approved}`
        )

        return {
          success: true,
          workflowId: input.workflowId,
          approved: input.approved,
          message: `CEO ${input.approved ? 'approved' : 'rejected'} content`,
          approvedBy: ctx.user.email,
        }
      } catch (error) {
        console.error('[WorkflowRouter] Failed to signal CEO approval:', error)
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to signal workflow',
        })
      }
    }),

  /**
   * Get workflow result
   * Waits for workflow to complete and returns result
   */
  getResult: publicProcedure
    .input(
      z.object({
        workflowId: z.string().describe('The workflow ID to get result for'),
      })
    )
    .query(async ({ input }) => {
      try {
        const { getWorkflowResult } = await getTemporalClient()

        const result = await getWorkflowResult(input.workflowId)

        return {
          success: true,
          workflowId: input.workflowId,
          result,
        }
      } catch (error) {
        console.error('[WorkflowRouter] Failed to get workflow result:', error)
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to get workflow result',
        })
      }
    }),

  /**
   * Start full pipeline workflow
   * Combines content production, editorial review, and publishing
   */
  startFullPipeline: protectedProcedure
    .input(
      z.object({
        contentId: z.string().describe('UUID of the content item'),
        websiteId: z.string().describe('UUID of the target website'),
        writerAgentId: z.string().describe('UUID of the writer agent'),
        editorAgentId: z.string().describe('UUID of the editor agent'),
        seoAgentId: z.string().describe('UUID of the SEO agent'),
        engineeringAgentId: z.string().describe('UUID of the engineering agent'),
        brief: z.string().describe('Content brief for the writer'),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const { startWorkflow } = await getTemporalClient()

        // Start content production first
        const productionWorkflowId = `full-pipeline-production-${input.contentId}-${Date.now()}`

        const productionHandle = await startWorkflow('contentProductionWorkflow', [
          {
            contentId: input.contentId,
            writerAgentId: input.writerAgentId,
            brief: input.brief,
          },
        ], {
          workflowId: productionWorkflowId,
          taskQueue: 'swarmpress-default',
        })

        console.log(`[WorkflowRouter] Started full pipeline: ${productionWorkflowId}`)

        return {
          success: true,
          pipelineId: `pipeline-${input.contentId}-${Date.now()}`,
          contentProductionWorkflowId: productionHandle.workflowId,
          message: `Full pipeline started. Content production workflow running, editorial review and publishing will follow.`,
          nextSteps: [
            'Content production will create draft',
            'Editorial review will be triggered after draft submission',
            'Publishing will be triggered after editorial approval',
          ],
        }
      } catch (error) {
        console.error('[WorkflowRouter] Failed to start full pipeline:', error)
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to start pipeline',
        })
      }
    }),

  /**
   * Check Temporal connection status
   */
  status: publicProcedure.query(async () => {
    try {
      const { temporalClient } = await getTemporalClient()

      return {
        connected: temporalClient.isConnected(),
        message: temporalClient.isConnected()
          ? 'Temporal client connected'
          : 'Temporal client not connected',
      }
    } catch (error) {
      return {
        connected: false,
        message: error instanceof Error ? error.message : 'Failed to check status',
      }
    }
  }),

  /**
   * Start scheduled content workflow
   * Checks content calendar and generates due content
   */
  startScheduledContent: protectedProcedure
    .input(
      z.object({
        websiteId: z.string().describe('UUID of the website'),
        dryRun: z.boolean().default(false).describe('If true, only log what would be created'),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const { startWorkflow } = await getTemporalClient()

        const workflowId = `scheduled-content-${input.websiteId}-${Date.now()}`

        const handle = await startWorkflow('scheduledContentWorkflow', [
          {
            websiteId: input.websiteId,
            dryRun: input.dryRun,
          },
        ], {
          workflowId,
          taskQueue: 'swarmpress-default',
        })

        console.log(`[WorkflowRouter] Started scheduled content workflow: ${workflowId}`)

        return {
          success: true,
          workflowId: handle.workflowId,
          runId: handle.runId,
          dryRun: input.dryRun,
          message: input.dryRun
            ? 'Scheduled content check started (dry run - no content will be created)'
            : 'Scheduled content check started',
        }
      } catch (error) {
        console.error('[WorkflowRouter] Failed to start scheduled content:', error)
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to start workflow',
        })
      }
    }),

  /**
   * Get current season info for content calendar
   */
  getSeasonInfo: publicProcedure.query(() => {
    const now = new Date()
    const month = now.getMonth() + 1
    const day = now.getDate()
    const mmdd = `${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`

    let currentSeason: string
    let nextSeason: string
    let seasonStart: string
    let seasonEnd: string

    if (mmdd >= '03-01' && mmdd <= '05-31') {
      currentSeason = 'spring'
      nextSeason = 'summer'
      seasonStart = '03-01'
      seasonEnd = '05-31'
    } else if (mmdd >= '06-01' && mmdd <= '08-31') {
      currentSeason = 'summer'
      nextSeason = 'fall'
      seasonStart = '06-01'
      seasonEnd = '08-31'
    } else if (mmdd >= '09-01' && mmdd <= '11-30') {
      currentSeason = 'fall'
      nextSeason = 'winter'
      seasonStart = '09-01'
      seasonEnd = '11-30'
    } else {
      currentSeason = 'winter'
      nextSeason = 'spring'
      seasonStart = '12-01'
      seasonEnd = '02-28'
    }

    return {
      currentDate: now.toISOString(),
      currentSeason,
      nextSeason,
      seasonWindow: { start: seasonStart, end: seasonEnd },
    }
  }),
})
