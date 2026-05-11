/**
 * Content Production Workflow
 * Orchestrates the content creation process from idea to draft
 *
 * GitHub Integration: Each agent step is logged to the content's PR
 * for full visibility into the workflow chain.
 */

import { proxyActivities } from '@temporalio/workflow'
import type * as activities from '../activities'

const {
  invokeWriterAgent,
  getContentItem,
  transitionContentState,
  publishContentEvent,
  syncContentToGitHubActivity,
  logAgentActivityToGitHub,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '15 minutes',
  retry: {
    maximumAttempts: 3,
    initialInterval: '1s',
    backoffCoefficient: 2,
    maximumInterval: '30s',
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
  githubPrUrl?: string
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
  // `maxRevisions` is currently unused — see deferred-revision comment
  // below; it is retained on the input shape for forward-compat.
  const { contentId, writerAgentId, brief } = input
  const revisionsCount = 0
  // Track current stage for failure event reporting
  let currentStage: string = 'init'

  try {
    console.log(`[ContentProduction] Starting workflow for ${contentId}`)

    // Step 1: Get current content to check state
    currentStage = 'load_content'
    const content = await getContentItem(contentId)
    if (!content) {
      throw new Error(`Content ${contentId} not found`)
    }

    console.log(`[ContentProduction] Current content state: ${content.status}`)

    // Step 2: Writer creates draft
    currentStage = 'write_draft'
    console.log(`[ContentProduction] Invoking writer agent to create draft`)

    // Log workflow start to GitHub (if PR exists)
    await logAgentActivityToGitHub({
      contentId,
      agentId: writerAgentId,
      agentName: 'WriterAgent',
      activity: 'Starting content production workflow',
      details: `**Brief:**\n${brief.substring(0, 500)}${brief.length > 500 ? '...' : ''}`,
      result: 'pending',
    })

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
      websiteId: content.website_id, // Pass websiteId for external tools
    })

    // Log writer result to GitHub
    await logAgentActivityToGitHub({
      contentId,
      agentId: writerAgentId,
      agentName: 'WriterAgent',
      activity: 'Draft creation',
      details: writerResult.success
        ? 'Draft created successfully with content blocks'
        : `Error: ${writerResult.error}`,
      result: writerResult.success ? 'success' : 'failure',
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

    // Quality-driven revisions are deferred to a future workflow.
    // The post-QAGate feedback loop is the planned path: QAGate flags
    // issues -> emits a needs-changes event -> triggers a revision
    // workflow that loops back to the writer. See plan-doc /
    // autonomy migration. Today, content goes straight from initial
    // draft to submit-for-review.
    //
    // `maxRevisions` is retained on the input shape for forward-compat
    // but is currently unused; `revisionsCount` will always be 0 in
    // the result.

    // Step 6: Submit for review
    currentStage = 'submit_for_review'
    console.log(`[ContentProduction] Submitting for editorial review`)

    const submitTask = `Submit content ${contentId} for editorial review.
Use your submit_for_review tool to transition the content to in_editorial_review state.`

    const submitResult = await invokeWriterAgent({
      agentId: writerAgentId,
      task: submitTask,
      contentId,
      websiteId: content.website_id,
    })

    if (!submitResult.success) {
      // Log failure to GitHub
      await logAgentActivityToGitHub({
        contentId,
        agentId: writerAgentId,
        agentName: 'WriterAgent',
        activity: 'Submit for review',
        details: `Error: ${submitResult.error}`,
        result: 'failure',
      })
      throw new Error(`Failed to submit for review: ${submitResult.error}`)
    }

    // Step 7: Create GitHub PR for editorial review
    currentStage = 'create_github_pr'
    console.log(`[ContentProduction] Creating GitHub PR for editorial review`)
    const prResult = await syncContentToGitHubActivity({ contentId })

    if (prResult.success && prResult.prUrl) {
      console.log(`[ContentProduction] Created PR: ${prResult.prUrl}`)
    }

    // Log submission to GitHub (now PR exists)
    await logAgentActivityToGitHub({
      contentId,
      agentId: writerAgentId,
      agentName: 'WriterAgent',
      activity: 'Submitted for editorial review',
      details: `Content submitted successfully. Ready for EditorAgent review.\n\n**Revisions made:** ${revisionsCount}`,
      result: 'success',
    })

    // Step 8: Publish submission event
    await publishContentEvent({
      type: 'content.submittedForReview',
      contentId,
      data: {
        content_id: contentId,
        submitted_by: writerAgentId,
        github_pr_url: prResult.prUrl,
      },
    })

    console.log(`[ContentProduction] Workflow completed successfully`)

    return {
      success: true,
      contentId,
      status: 'submitted_for_review',
      finalState: 'in_editorial_review',
      revisionsCount,
      githubPrUrl: prResult.prUrl,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error(`[ContentProduction] Workflow failed at stage "${currentStage}":`, error)

    // Emit content.productionFailed CloudEvent so subscribers (admin dashboard,
    // observability, escalation handlers) can react to the failure. Failure to
    // publish the event must NOT mask the original failure.
    try {
      await publishContentEvent({
        type: 'content.productionFailed',
        contentId,
        // Note: publishContentEvent uses Object.values(data) to spread args, so
        // ORDER must match events.contentProductionFailed(contentId, error, stage, agentId).
        data: {
          content_id: contentId,
          error: errorMessage,
          stage: currentStage,
          agent_id: writerAgentId,
        },
      })
    } catch (eventError) {
      console.error(
        `[ContentProduction] Failed to publish content.productionFailed event:`,
        eventError
      )
    }

    return {
      success: false,
      contentId,
      status: 'failed',
      error: errorMessage,
    }
  }
}
