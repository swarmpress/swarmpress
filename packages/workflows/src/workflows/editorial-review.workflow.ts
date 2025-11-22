/**
 * Editorial Review Workflow
 * Orchestrates the editorial review process with CEO escalation
 */

import { proxyActivities, condition, defineSignal, setHandler } from '@temporalio/workflow'
import type * as activities from '../activities'

const {
  invokeEditorAgent,
  getContentItem,
  transitionContentState,
  publishContentEvent,
  createQuestionTicket,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '15 minutes',
  retry: {
    maximumAttempts: 3,
  },
})

export interface EditorialReviewInput {
  contentId: string
  editorAgentId: string
}

export interface EditorialReviewResult {
  success: boolean
  contentId: string
  reviewResult: 'approved' | 'needs_changes' | 'escalated' | 'error'
  qualityScore?: number
  feedback?: string
  ticketId?: string
  error?: string
}

// Signal for CEO approval
export const ceoApprovalSignal = defineSignal<[boolean, string?]>('ceoApproval')

/**
 * Editorial Review Workflow
 *
 * Flow:
 * 1. Editor retrieves and reviews content
 * 2. Detect high-risk content
 * 3. If high-risk: escalate to CEO and wait for approval
 * 4. Check quality score
 * 5. Approve (score >= 7) or reject content
 * 6. Publish appropriate events
 */
export async function editorialReviewWorkflow(
  input: EditorialReviewInput
): Promise<EditorialReviewResult> {
  const { contentId, editorAgentId } = input
  let ceoApproved: boolean | null = null
  let ceoFeedback: string | undefined

  // Set up CEO approval signal handler
  setHandler(ceoApprovalSignal, (approved: boolean, feedback?: string) => {
    ceoApproved = approved
    ceoFeedback = feedback
    console.log(`[EditorialReview] CEO decision received: ${approved}`)
  })

  try {
    console.log(`[EditorialReview] Starting workflow for ${contentId}`)

    // Step 1: Get content
    const content = await getContentItem(contentId)
    if (!content) {
      throw new Error(`Content ${contentId} not found`)
    }

    console.log(`[EditorialReview] Content status: ${content.status}`)

    // Step 2: Editor reviews content
    console.log(`[EditorialReview] Invoking editor for review`)

    const reviewTask = `Review content ${contentId} for quality and editorial standards.

Use your review_content tool to:
1. Analyze content quality (score 1-10)
2. Check grammar, style, and accuracy
3. Identify any issues
4. Provide detailed feedback

Then use detect_high_risk_content to check for sensitive content.`

    const editorResult = await invokeEditorAgent({
      agentId: editorAgentId,
      task: reviewTask,
      contentId,
    })

    if (!editorResult.success) {
      throw new Error(`Editor review failed: ${editorResult.error}`)
    }

    console.log(`[EditorialReview] Review completed`)

    // Step 3: Detect high-risk content
    const detectTask = `Use your detect_high_risk_content tool to analyze content ${contentId} for:
- Legal issues
- Medical claims
- Financial advice
- Controversial topics

Return the risk assessment.`

    const riskResult = await invokeEditorAgent({
      agentId: editorAgentId,
      task: detectTask,
      contentId,
    })

    const isHighRisk =
      riskResult.success && riskResult.result?.is_high_risk === true

    console.log(`[EditorialReview] High-risk detection: ${isHighRisk}`)

    // Step 4: Handle high-risk content
    if (isHighRisk) {
      console.log(`[EditorialReview] Escalating to CEO`)

      const escalateTask = `Use your escalate_to_ceo tool to create a question ticket for content ${contentId}.

Reason: High-risk content detected
Risk factors: ${JSON.stringify(riskResult.result?.risk_factors || [])}

This requires CEO approval before proceeding.`

      const escalateResult = await invokeEditorAgent({
        agentId: editorAgentId,
        task: escalateTask,
        contentId,
      })

      if (!escalateResult.success) {
        throw new Error(`Escalation failed: ${escalateResult.error}`)
      }

      // Extract ticket ID (simplified - in real impl would parse from result)
      const ticketId = 'ticket-' + Date.now()

      console.log(`[EditorialReview] Question ticket ${ticketId} created, waiting for CEO...`)

      // Wait for CEO approval signal (with 24 hour timeout)
      const ceoDecided = await condition(() => ceoApproved !== null, '24 hours')

      if (!ceoDecided || ceoApproved === false) {
        console.log(`[EditorialReview] CEO rejected or timeout`)

        // Reject content
        await transitionContentState({
          contentId,
          event: 'request_changes',
          actor: 'CEO',
          actorId: 'ceo-001',
          metadata: { ceo_rejected: true, feedback: ceoFeedback },
        })

        await publishContentEvent({
          type: 'content.needsChanges',
          contentId,
          data: {
            content_id: contentId,
            editor_id: editorAgentId,
            comments: ceoFeedback || 'CEO rejected high-risk content',
          },
        })

        return {
          success: true,
          contentId,
          reviewResult: 'needs_changes',
          feedback: ceoFeedback || 'CEO rejected',
        }
      }

      console.log(`[EditorialReview] CEO approved high-risk content`)
      // Continue with normal review process
    }

    // Step 5: Check quality score
    // Parse quality score from editor result (simplified)
    const qualityScore = editorResult.result?.quality_score || 7

    console.log(`[EditorialReview] Quality score: ${qualityScore}`)

    if (qualityScore >= 7) {
      // Step 6a: Approve content
      console.log(`[EditorialReview] Approving content`)

      const approveTask = `Use your approve_content tool to approve content ${contentId}.

Quality score: ${qualityScore}
Approval notes: Content meets editorial standards.`

      const approveResult = await invokeEditorAgent({
        agentId: editorAgentId,
        task: approveTask,
        contentId,
      })

      if (!approveResult.success) {
        throw new Error(`Approval failed: ${approveResult.error}`)
      }

      // Transition handled by agent's approve_content tool
      // Publish event
      await publishContentEvent({
        type: 'content.approved',
        contentId,
        data: {
          content_id: contentId,
          approved_by: editorAgentId,
        },
      })

      console.log(`[EditorialReview] Content approved successfully`)

      return {
        success: true,
        contentId,
        reviewResult: 'approved',
        qualityScore,
      }
    } else {
      // Step 6b: Reject content
      console.log(`[EditorialReview] Rejecting content (quality score: ${qualityScore})`)

      const feedback =
        editorResult.result?.feedback ||
        `Content needs improvement. Quality score: ${qualityScore}/10`

      const rejectTask = `Use your reject_content tool to reject content ${contentId}.

Feedback: ${feedback}
Required changes: Improve quality to meet editorial standards (score 7+)`

      const rejectResult = await invokeEditorAgent({
        agentId: editorAgentId,
        task: rejectTask,
        contentId,
      })

      if (!rejectResult.success) {
        throw new Error(`Rejection failed: ${rejectResult.error}`)
      }

      // Transition handled by agent's reject_content tool
      // Publish event
      await publishContentEvent({
        type: 'content.needsChanges',
        contentId,
        data: {
          content_id: contentId,
          editor_id: editorAgentId,
          comments: feedback,
        },
      })

      console.log(`[EditorialReview] Content sent back for revisions`)

      return {
        success: true,
        contentId,
        reviewResult: 'needs_changes',
        qualityScore,
        feedback,
      }
    }
  } catch (error) {
    console.error(`[EditorialReview] Workflow failed:`, error)
    return {
      success: false,
      contentId,
      reviewResult: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
