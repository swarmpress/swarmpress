/**
 * Workflow API Routes
 * Provides endpoints for triggering and managing Temporal workflows
 */

import type { APIRoute } from 'astro'
import { trpc } from '../../../lib/trpc'

// Helper to create JSON response
function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// Helper to create error response
function errorResponse(message: string, status = 500) {
  return jsonResponse({ message }, status)
}

// GET handlers for query actions
const queryHandlers: Record<string, () => Promise<Response>> = {
  status: async () => {
    try {
      const result = await trpc.workflow.status.query()
      return jsonResponse(result)
    } catch (error) {
      console.error('[API] Workflow status error:', error)
      return errorResponse(error instanceof Error ? error.message : 'Failed to get workflow status')
    }
  },

  'season-info': async () => {
    try {
      const result = await trpc.workflow.getSeasonInfo.query()
      return jsonResponse(result)
    } catch (error) {
      console.error('[API] Season info error:', error)
      return errorResponse(error instanceof Error ? error.message : 'Failed to get season info')
    }
  },
}

// POST handlers for mutation actions
const mutationHandlers: Record<string, (body: unknown) => Promise<Response>> = {
  'start-content-production': async (body: unknown) => {
    const { contentId, writerAgentId, brief, maxRevisions } = body as {
      contentId: string
      writerAgentId: string
      brief: string
      maxRevisions?: number
    }

    if (!contentId || !writerAgentId || !brief) {
      return errorResponse('contentId, writerAgentId, and brief are required', 400)
    }

    try {
      const result = await trpc.workflow.startContentProduction.mutate({
        contentId,
        writerAgentId,
        brief,
        maxRevisions: maxRevisions ?? 3,
      })
      return jsonResponse(result)
    } catch (error) {
      console.error('[API] Start content production error:', error)
      return errorResponse(error instanceof Error ? error.message : 'Failed to start content production')
    }
  },

  'start-editorial-review': async (body: unknown) => {
    const { contentId, editorAgentId } = body as {
      contentId: string
      editorAgentId: string
    }

    if (!contentId || !editorAgentId) {
      return errorResponse('contentId and editorAgentId are required', 400)
    }

    try {
      const result = await trpc.workflow.startEditorialReview.mutate({
        contentId,
        editorAgentId,
      })
      return jsonResponse(result)
    } catch (error) {
      console.error('[API] Start editorial review error:', error)
      return errorResponse(error instanceof Error ? error.message : 'Failed to start editorial review')
    }
  },

  'start-publishing': async (body: unknown) => {
    const { contentId, websiteId, seoAgentId, engineeringAgentId } = body as {
      contentId: string
      websiteId: string
      seoAgentId: string
      engineeringAgentId: string
    }

    if (!contentId || !websiteId || !seoAgentId || !engineeringAgentId) {
      return errorResponse('contentId, websiteId, seoAgentId, and engineeringAgentId are required', 400)
    }

    try {
      const result = await trpc.workflow.startPublishing.mutate({
        contentId,
        websiteId,
        seoAgentId,
        engineeringAgentId,
      })
      return jsonResponse(result)
    } catch (error) {
      console.error('[API] Start publishing error:', error)
      return errorResponse(error instanceof Error ? error.message : 'Failed to start publishing')
    }
  },

  'start-scheduled-content': async (body: unknown) => {
    const { websiteId, dryRun } = body as {
      websiteId: string
      dryRun?: boolean
    }

    if (!websiteId) {
      return errorResponse('websiteId is required', 400)
    }

    try {
      const result = await trpc.workflow.startScheduledContent.mutate({
        websiteId,
        dryRun: dryRun ?? false,
      })
      return jsonResponse(result)
    } catch (error) {
      console.error('[API] Start scheduled content error:', error)
      return errorResponse(error instanceof Error ? error.message : 'Failed to start scheduled content')
    }
  },

  'start-full-pipeline': async (body: unknown) => {
    const { contentId, websiteId, writerAgentId, editorAgentId, seoAgentId, engineeringAgentId, brief } = body as {
      contentId: string
      websiteId: string
      writerAgentId: string
      editorAgentId: string
      seoAgentId: string
      engineeringAgentId: string
      brief: string
    }

    if (!contentId || !websiteId || !writerAgentId || !editorAgentId || !seoAgentId || !engineeringAgentId || !brief) {
      return errorResponse('All fields are required: contentId, websiteId, writerAgentId, editorAgentId, seoAgentId, engineeringAgentId, brief', 400)
    }

    try {
      const result = await trpc.workflow.startFullPipeline.mutate({
        contentId,
        websiteId,
        writerAgentId,
        editorAgentId,
        seoAgentId,
        engineeringAgentId,
        brief,
      })
      return jsonResponse(result)
    } catch (error) {
      console.error('[API] Start full pipeline error:', error)
      return errorResponse(error instanceof Error ? error.message : 'Failed to start full pipeline')
    }
  },

  'signal-approval': async (body: unknown) => {
    const { workflowId, approved, feedback } = body as {
      workflowId: string
      approved: boolean
      feedback?: string
    }

    if (!workflowId || typeof approved !== 'boolean') {
      return errorResponse('workflowId and approved (boolean) are required', 400)
    }

    try {
      const result = await trpc.workflow.signalCEOApproval.mutate({
        workflowId,
        approved,
        feedback,
      })
      return jsonResponse(result)
    } catch (error) {
      console.error('[API] Signal approval error:', error)
      return errorResponse(error instanceof Error ? error.message : 'Failed to signal approval')
    }
  },

  'get-result': async (body: unknown) => {
    const { workflowId } = body as { workflowId: string }

    if (!workflowId) {
      return errorResponse('workflowId is required', 400)
    }

    try {
      const result = await trpc.workflow.getResult.query({ workflowId })
      return jsonResponse(result)
    } catch (error) {
      console.error('[API] Get workflow result error:', error)
      return errorResponse(error instanceof Error ? error.message : 'Failed to get workflow result')
    }
  },
}

export const GET: APIRoute = async ({ params }) => {
  const { action } = params
  if (!action) {
    return errorResponse('Action is required', 400)
  }

  const handler = queryHandlers[action]
  if (!handler) {
    return errorResponse(`Unknown GET action: ${action}. Available: ${Object.keys(queryHandlers).join(', ')}`, 404)
  }

  return handler()
}

export const POST: APIRoute = async ({ params, request }) => {
  const { action } = params
  if (!action) {
    return errorResponse('Action is required', 400)
  }

  const handler = mutationHandlers[action]
  if (!handler) {
    return errorResponse(`Unknown POST action: ${action}. Available: ${Object.keys(mutationHandlers).join(', ')}`, 404)
  }

  let body = {}
  try {
    body = await request.json()
  } catch {
    // Empty body is ok for some actions
  }

  return handler(body)
}
