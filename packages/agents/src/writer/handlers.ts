/**
 * WriterAgent Tool Handlers
 * Implementations that connect tools to database operations
 */

import { ToolHandler, ToolResult, toolSuccess, toolError } from '../base/tools'
import { validateContentBlocks } from '../base/utilities'

// ============================================================================
// Repository Access
// Import directly from source to pick up latest changes
// ============================================================================

async function getContentRepository() {
  // Import from source to avoid stale dist issues during development
  const { contentRepository } = await import('@swarm-press/backend/src/db/repositories/content-repository')
  return contentRepository
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

// ============================================================================
// Export Handler Map
// ============================================================================

export const writerToolHandlers: Record<string, ToolHandler> = {
  get_content: getContentHandler,
  write_draft: writeDraftHandler,
  revise_draft: reviseDraftHandler,
  submit_for_review: submitForReviewHandler,
}
