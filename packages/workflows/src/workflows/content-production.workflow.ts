/**
 * Content Production Workflow
 * Orchestrates the content creation process from idea to draft
 */

import { proxyActivities, sleep } from '@temporalio/workflow'
import type * as activities from '../activities'

const {
  invokeWriterAgent,
  getContentItem,
  transitionContentState,
  publishContentEvent,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '15 minutes',
  retry: {
    maximumAttempts: 3,
  },
})

export interface ContentProductionInput {
  contentId: string
  writerAgentId: string
  brief: string
  maxRevisions?: number
}

export interface ContentProductionResult {
  success: boolean
  contentId: string
  status: string
  finalState?: string
  revisionsCount?: number
  error?: string
}

/**
 * Content Production Workflow
 *
 * Flow:
 * 1. Writer creates initial draft from brief
 * 2. Transition to draft state
 * 3. Writer can make revisions (up to maxRevisions)
 * 4. Submit for editorial review
 * 5. Publish content.submittedForReview event
 */
export async function contentProductionWorkflow(
  input: ContentProductionInput
): Promise<ContentProductionResult> {
  const { contentId, writerAgentId, brief, maxRevisions = 3 } = input
  let revisionsCount = 0

  try {
    console.log(`[ContentProduction] Starting workflow for ${contentId}`)

    // Step 1: Get current content to check state
    const content = await getContentItem(contentId)
    if (!content) {
      throw new Error(`Content ${contentId} not found`)
    }

    console.log(`[ContentProduction] Current content state: ${content.status}`)

    // Step 2: Writer creates draft
    console.log(`[ContentProduction] Invoking writer agent to create draft`)

    const writerTask = `Create a content draft for content ID ${contentId}.

Brief:
${brief}

Please use your write_draft tool to create content using JSON blocks.
Include appropriate blocks like headings, paragraphs, images, lists, etc.
Ensure all blocks are properly structured and validated.`

    const writerResult = await invokeWriterAgent({
      agentId: writerAgentId,
      task: writerTask,
      contentId,
    })

    if (!writerResult.success) {
      throw new Error(`Writer agent failed: ${writerResult.error}`)
    }

    console.log(`[ContentProduction] Draft created successfully`)

    // Step 3: Ensure transition to draft state
    if (content.status === 'brief_created') {
      await transitionContentState({
        contentId,
        event: 'writer.started',
        actor: 'Writer',
        actorId: writerAgentId,
      })
      console.log(`[ContentProduction] Transitioned to draft state`)
    }

    // Step 4: Publish content created event
    await publishContentEvent({
      type: 'content.created',
      contentId,
      data: {
        content_id: contentId,
        author_agent_id: writerAgentId,
      },
    })

    // Step 5: Check if revisions are needed (simplified - could be based on quality check)
    // In a real scenario, this could involve review by another agent
    // For now, we'll just proceed to submission

    // Optional revision loop (if writer wants to make improvements)
    let needsRevision = false // This could be determined by quality checks

    while (needsRevision && revisionsCount < maxRevisions) {
      console.log(`[ContentProduction] Applying revision ${revisionsCount + 1}`)

      const revisionTask = `Revise the content for ${contentId}.
Review the current draft and make improvements where needed.
Use your revise_draft tool to update the content.`

      const revisionResult = await invokeWriterAgent({
        agentId: writerAgentId,
        task: revisionTask,
        contentId,
      })

      if (!revisionResult.success) {
        console.warn(`[ContentProduction] Revision failed: ${revisionResult.error}`)
        break
      }

      revisionsCount++

      // Small delay between revisions
      await sleep('2 seconds')

      // In real implementation, check if more revisions needed
      needsRevision = false
    }

    // Step 6: Submit for review
    console.log(`[ContentProduction] Submitting for editorial review`)

    const submitTask = `Submit content ${contentId} for editorial review.
Use your submit_for_review tool to transition the content to in_editorial_review state.`

    const submitResult = await invokeWriterAgent({
      agentId: writerAgentId,
      task: submitTask,
      contentId,
    })

    if (!submitResult.success) {
      throw new Error(`Failed to submit for review: ${submitResult.error}`)
    }

    // Step 7: Publish submission event
    await publishContentEvent({
      type: 'content.submittedForReview',
      contentId,
      data: {
        content_id: contentId,
        submitted_by: writerAgentId,
      },
    })

    console.log(`[ContentProduction] Workflow completed successfully`)

    return {
      success: true,
      contentId,
      status: 'submitted_for_review',
      finalState: 'in_editorial_review',
      revisionsCount,
    }
  } catch (error) {
    console.error(`[ContentProduction] Workflow failed:`, error)
    return {
      success: false,
      contentId,
      status: 'failed',
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
