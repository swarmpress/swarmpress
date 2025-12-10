/**
 * GitHub Webhook Handler Service
 * Bridges GitHub events to Temporal workflow signals
 *
 * This is the critical Human-in-the-Loop component that allows
 * CEO actions in GitHub to control agent workflows.
 */

import { Client, Connection } from '@temporalio/client'
import { findWorkflowByBranch } from './workflow-registry'
import { ceoApprovalSignal } from '../workflows/editorial-review.workflow'

// Temporal client singleton
let temporalClient: Client | null = null

/**
 * Initialize Temporal client for sending signals
 */
export async function initializeTemporalClient(): Promise<Client> {
  if (temporalClient) {
    return temporalClient
  }

  const connection = await Connection.connect({
    address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
  })

  temporalClient = new Client({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE || 'default',
  })

  console.log('[GitHubWebhookHandler] Temporal client initialized')
  return temporalClient
}

/**
 * Handle PR review submitted event
 * This is the main Human-in-the-Loop trigger
 *
 * CEO reviews in GitHub trigger:
 * - approved → continue workflow, publish content
 * - changes_requested → send back for revision
 * - commented → log only, don't change workflow state
 */
export async function handlePRReviewSubmitted(
  pr: {
    number: number
    head: { ref: string }
    html_url: string
  },
  review: {
    id: number
    state: 'approved' | 'changes_requested' | 'commented' | 'dismissed'
    body: string | null
    user: { login: string; id: number }
  }
): Promise<{ handled: boolean; action?: string; error?: string }> {
  console.log(`[GitHubWebhookHandler] PR #${pr.number} review: ${review.state} by ${review.user.login}`)

  // Find the workflow for this PR
  const workflowEntry = findWorkflowByBranch(pr.head.ref)

  if (!workflowEntry) {
    console.log(`[GitHubWebhookHandler] No workflow found for branch ${pr.head.ref}`)
    return { handled: false, error: 'No workflow found for this PR' }
  }

  if (workflowEntry.status !== 'running') {
    console.log(`[GitHubWebhookHandler] Workflow ${workflowEntry.workflowId} is not running (status: ${workflowEntry.status})`)
    return { handled: false, error: 'Workflow is not running' }
  }

  // Only handle approval and changes_requested for CEO decisions
  if (review.state === 'commented') {
    console.log(`[GitHubWebhookHandler] Comment only, no workflow action needed`)
    return { handled: true, action: 'logged_comment' }
  }

  if (review.state === 'dismissed') {
    console.log(`[GitHubWebhookHandler] Review dismissed, no workflow action needed`)
    return { handled: true, action: 'review_dismissed' }
  }

  try {
    const client = await initializeTemporalClient()
    const handle = client.workflow.getHandle(workflowEntry.workflowId, workflowEntry.runId)

    if (review.state === 'approved') {
      // CEO approved - signal workflow to continue
      console.log(`[GitHubWebhookHandler] Sending CEO approval signal to workflow ${workflowEntry.workflowId}`)
      await handle.signal(ceoApprovalSignal, true, review.body || 'Approved by CEO')
      return { handled: true, action: 'ceo_approved' }
    }

    if (review.state === 'changes_requested') {
      // CEO requested changes - signal workflow to reject
      console.log(`[GitHubWebhookHandler] Sending CEO rejection signal to workflow ${workflowEntry.workflowId}`)
      await handle.signal(ceoApprovalSignal, false, review.body || 'Changes requested by CEO')
      return { handled: true, action: 'ceo_rejected' }
    }

    return { handled: false, error: `Unhandled review state: ${review.state}` }
  } catch (error) {
    console.error(`[GitHubWebhookHandler] Error signaling workflow:`, error)
    return {
      handled: false,
      error: error instanceof Error ? error.message : 'Failed to signal workflow',
    }
  }
}

/**
 * Handle Issue comment event
 * CEO answering a QuestionTicket
 */
export async function handleIssueComment(
  issue: {
    number: number
    labels: Array<{ name: string }>
    title: string
    html_url: string
  },
  comment: {
    id: number
    body: string
    user: { login: string; id: number }
    author_association: string
  }
): Promise<{ handled: boolean; action?: string; error?: string }> {
  console.log(`[GitHubWebhookHandler] Issue #${issue.number} comment by ${comment.user.login}`)

  // Check if this is a question-ticket issue
  const isQuestionTicket = issue.labels.some((label) => label.name === 'question-ticket')

  if (!isQuestionTicket) {
    console.log(`[GitHubWebhookHandler] Not a question-ticket issue, ignoring`)
    return { handled: false, error: 'Not a question-ticket issue' }
  }

  // Check if comment is from CEO/owner (has authority to answer)
  const hasAuthority = ['OWNER', 'MEMBER', 'COLLABORATOR'].includes(comment.author_association)

  if (!hasAuthority) {
    console.log(`[GitHubWebhookHandler] Commenter ${comment.user.login} does not have authority`)
    return { handled: false, error: 'Commenter does not have authority to answer' }
  }

  // Parse ticket ID from issue title or body
  // Format: "[Question Ticket] {ticketId}: {subject}"
  const ticketIdMatch = issue.title.match(/\[Question Ticket\]\s*([a-f0-9-]+)/)
  if (!ticketIdMatch) {
    console.log(`[GitHubWebhookHandler] Could not extract ticket ID from issue title`)
    return { handled: false, error: 'Could not extract ticket ID' }
  }

  const ticketId = ticketIdMatch[1]

  // TODO: Update question ticket in database
  // TODO: Signal any waiting workflow
  console.log(`[GitHubWebhookHandler] CEO answered question ticket ${ticketId}`)

  return { handled: true, action: 'question_answered' }
}

/**
 * Handle PR merged event
 * Content has been published
 */
export async function handlePRMerged(pr: {
  number: number
  head: { ref: string }
  merged: boolean
  merge_commit_sha: string | null
}): Promise<{ handled: boolean; action?: string; error?: string }> {
  if (!pr.merged) {
    return { handled: false, error: 'PR was closed but not merged' }
  }

  console.log(`[GitHubWebhookHandler] PR #${pr.number} merged`)

  const workflowEntry = findWorkflowByBranch(pr.head.ref)
  if (!workflowEntry) {
    console.log(`[GitHubWebhookHandler] No workflow found for merged PR`)
    return { handled: false, error: 'No workflow found' }
  }

  // Log the merge - workflow should already be completing via syncPublishToGitHub
  console.log(`[GitHubWebhookHandler] Content ${workflowEntry.contentId} published (PR merged)`)

  return { handled: true, action: 'content_published' }
}

/**
 * Handle PR closed without merge
 * Content review cancelled
 */
export async function handlePRClosed(pr: {
  number: number
  head: { ref: string }
  merged: boolean
}): Promise<{ handled: boolean; action?: string; error?: string }> {
  if (pr.merged) {
    // Merged PRs are handled by handlePRMerged
    return { handled: false }
  }

  console.log(`[GitHubWebhookHandler] PR #${pr.number} closed without merge`)

  const workflowEntry = findWorkflowByBranch(pr.head.ref)
  if (!workflowEntry) {
    return { handled: false, error: 'No workflow found' }
  }

  // TODO: Signal workflow to cancel or handle abandoned content
  console.log(`[GitHubWebhookHandler] Content ${workflowEntry.contentId} review cancelled`)

  return { handled: true, action: 'review_cancelled' }
}

export {
  ceoApprovalSignal,
}
