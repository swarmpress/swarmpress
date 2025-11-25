/**
 * EditorAgent Tool Handlers
 * Implementations that connect tools to database operations
 */

import { ToolHandler, ToolResult, toolSuccess, toolError } from '../base/tools'

// ============================================================================
// Repository Access
// ============================================================================

async function getContentRepository() {
  const { contentRepository } = await import('@swarm-press/backend')
  return contentRepository
}

async function getQuestionTicketRepository() {
  const { questionTicketRepository } = await import('@swarm-press/backend')
  return questionTicketRepository
}

// ============================================================================
// Tool Handlers
// ============================================================================

/**
 * Get content for review
 */
export const getContentForReviewHandler: ToolHandler<{ content_id: string }> = async (
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
      block_count: Array.isArray(content.body) ? content.body.length : 0,
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to fetch content')
  }
}

/**
 * Approve content
 */
export const approveContentHandler: ToolHandler<{
  content_id: string
  quality_score: number
  notes?: string
}> = async (input, context): Promise<ToolResult> => {
  try {
    // Validate quality score
    if (input.quality_score < 7) {
      return toolError(
        `Quality score ${input.quality_score} is too low for approval. Minimum score is 7. Use request_changes instead.`
      )
    }

    if (input.quality_score > 10) {
      return toolError('Quality score cannot exceed 10')
    }

    const contentRepository = await getContentRepository()

    // Check content exists and is in review
    const content = await contentRepository.findById(input.content_id)
    if (!content) {
      return toolError(`Content item not found: ${input.content_id}`)
    }

    if (content.status !== 'in_editorial_review') {
      return toolError(
        `Content must be in "in_editorial_review" status to approve. Current status: ${content.status}`
      )
    }

    // Add review to metadata
    const metadata = content.metadata || {}
    const reviews = metadata.reviews || []
    reviews.push({
      date: new Date().toISOString(),
      reviewer_id: context.agentId,
      reviewer_name: context.agentName,
      result: 'approved',
      quality_score: input.quality_score,
      notes: input.notes,
    })

    await contentRepository.update(input.content_id, {
      metadata: { ...metadata, reviews },
    })

    // Transition to approved
    const result = await contentRepository.transition(
      input.content_id,
      'approve',
      'EditorAgent',
      context.agentId,
      { quality_score: input.quality_score }
    )

    if (!result.success) {
      return toolError(`Failed to approve content: ${result.error}`)
    }

    return toolSuccess({
      content_id: input.content_id,
      previous_status: content.status,
      new_status: 'approved',
      quality_score: input.quality_score,
      message: 'Content approved and ready for publication',
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to approve content')
  }
}

/**
 * Request changes
 */
export const requestChangesHandler: ToolHandler<{
  content_id: string
  quality_score: number
  feedback: string
  required_changes: string[]
}> = async (input, context): Promise<ToolResult> => {
  try {
    const contentRepository = await getContentRepository()

    // Check content exists
    const content = await contentRepository.findById(input.content_id)
    if (!content) {
      return toolError(`Content item not found: ${input.content_id}`)
    }

    if (content.status !== 'in_editorial_review') {
      return toolError(
        `Content must be in "in_editorial_review" status. Current status: ${content.status}`
      )
    }

    // Add review to metadata
    const metadata = content.metadata || {}
    const reviews = metadata.reviews || []
    reviews.push({
      date: new Date().toISOString(),
      reviewer_id: context.agentId,
      reviewer_name: context.agentName,
      result: 'needs_changes',
      quality_score: input.quality_score,
      feedback: input.feedback,
      required_changes: input.required_changes,
    })

    await contentRepository.update(input.content_id, {
      metadata: { ...metadata, reviews },
    })

    // Transition to needs_changes
    const result = await contentRepository.transition(
      input.content_id,
      'request_changes',
      'EditorAgent',
      context.agentId,
      {
        quality_score: input.quality_score,
        feedback: input.feedback,
        required_changes: input.required_changes,
      }
    )

    if (!result.success) {
      return toolError(`Failed to request changes: ${result.error}`)
    }

    return toolSuccess({
      content_id: input.content_id,
      previous_status: content.status,
      new_status: 'needs_changes',
      quality_score: input.quality_score,
      feedback: input.feedback,
      required_changes: input.required_changes,
      message: 'Content returned to writer for revision',
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to request changes')
  }
}

/**
 * Reject content
 */
export const rejectContentHandler: ToolHandler<{
  content_id: string
  reason: string
}> = async (input, context): Promise<ToolResult> => {
  try {
    const contentRepository = await getContentRepository()

    // Check content exists
    const content = await contentRepository.findById(input.content_id)
    if (!content) {
      return toolError(`Content item not found: ${input.content_id}`)
    }

    // Add rejection to metadata
    const metadata = content.metadata || {}
    const reviews = metadata.reviews || []
    reviews.push({
      date: new Date().toISOString(),
      reviewer_id: context.agentId,
      reviewer_name: context.agentName,
      result: 'rejected',
      reason: input.reason,
    })

    await contentRepository.update(input.content_id, {
      metadata: { ...metadata, reviews },
    })

    // Transition to rejected
    const result = await contentRepository.transition(
      input.content_id,
      'reject',
      'EditorAgent',
      context.agentId,
      { reason: input.reason }
    )

    if (!result.success) {
      return toolError(`Failed to reject content: ${result.error}`)
    }

    return toolSuccess({
      content_id: input.content_id,
      previous_status: content.status,
      new_status: 'rejected',
      reason: input.reason,
      message: 'Content has been rejected',
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to reject content')
  }
}

/**
 * Escalate to CEO
 */
export const escalateToCEOHandler: ToolHandler<{
  content_id: string
  subject: string
  reason: string
  risk_factors: string[]
}> = async (input, context): Promise<ToolResult> => {
  try {
    const contentRepository = await getContentRepository()
    const questionTicketRepository = await getQuestionTicketRepository()

    // Check content exists
    const content = await contentRepository.findById(input.content_id)
    if (!content) {
      return toolError(`Content item not found: ${input.content_id}`)
    }

    // Create question ticket for CEO
    const ticket = await questionTicketRepository.create({
      subject: input.subject,
      body: `${input.reason}\n\n**Risk Factors:**\n${input.risk_factors.map((r) => `- ${r}`).join('\n')}\n\n**Content Title:** ${content.title}\n**Content ID:** ${content.id}`,
      created_by_agent_id: context.agentId,
      target: 'CEO',
      content_id: input.content_id,
      status: 'open',
    })

    // Add escalation to content metadata
    const metadata = content.metadata || {}
    const escalations = metadata.escalations || []
    escalations.push({
      date: new Date().toISOString(),
      agent_id: context.agentId,
      ticket_id: ticket.id,
      reason: input.reason,
      risk_factors: input.risk_factors,
    })

    await contentRepository.update(input.content_id, {
      metadata: { ...metadata, escalations, pending_ceo_approval: true },
    })

    return toolSuccess({
      content_id: input.content_id,
      ticket_id: ticket.id,
      status: 'escalated',
      target: 'CEO',
      subject: input.subject,
      risk_factors: input.risk_factors,
      message: 'Content escalated to CEO. Awaiting approval.',
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to escalate to CEO')
  }
}

// ============================================================================
// Export Handler Map
// ============================================================================

export const editorToolHandlers: Record<string, ToolHandler> = {
  get_content_for_review: getContentForReviewHandler,
  approve_content: approveContentHandler,
  request_changes: requestChangesHandler,
  reject_content: rejectContentHandler,
  escalate_to_ceo: escalateToCEOHandler,
}
