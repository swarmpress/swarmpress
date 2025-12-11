/**
 * GitHub Sync Layer
 * Bidirectional synchronization between GitHub and internal state
 */

import { contentRepository, questionTicketRepository, taskRepository, websiteRepository } from '@swarm-press/backend'
import { createContentPR, approvePR, requestPRChanges, mergePR } from './pull-requests'
import { createQuestionIssue, createTaskIssue } from './issues'
import { initializeGitHub } from './client'
import type { ContentItem, Website } from '@swarm-press/shared'

/**
 * Initialize GitHub client for a website
 * Uses the website's stored OAuth credentials
 */
async function initializeGitHubForWebsite(websiteId: string): Promise<void> {
  const website = await websiteRepository.findById(websiteId) as Website | null
  if (!website) {
    throw new Error(`Website ${websiteId} not found`)
  }

  if (!website.github_owner || !website.github_repo) {
    throw new Error(`Website ${websiteId} is not connected to GitHub`)
  }

  // Use website's OAuth token if available, fall back to env var
  const token = (website as any).github_access_token || process.env.GITHUB_TOKEN
  if (!token) {
    throw new Error(`No GitHub token available for website ${websiteId}`)
  }

  initializeGitHub({
    token,
    owner: website.github_owner,
    repo: website.github_repo,
  })

  console.log(`[Sync] GitHub client initialized for ${website.github_owner}/${website.github_repo}`)
}

/**
 * Map to track GitHub PR/Issue numbers for entities
 */
interface GitHubMapping {
  entity_type: 'content' | 'task' | 'ticket'
  entity_id: string
  github_type: 'pr' | 'issue'
  github_number: number
  github_url: string
  branch?: string
  created_at: string
}

// In-memory store for MVP (should be in DB for production)
const githubMappings = new Map<string, GitHubMapping>()

/**
 * Get GitHub mapping for an entity
 */
export function getGitHubMapping(entityType: string, entityId: string): GitHubMapping | undefined {
  return githubMappings.get(`${entityType}:${entityId}`)
}

/**
 * Store GitHub mapping for an entity
 */
export function storeGitHubMapping(mapping: GitHubMapping): void {
  githubMappings.set(`${mapping.entity_type}:${mapping.entity_id}`, mapping)
}

/**
 * Sync: Internal ContentItem → GitHub PR
 * Called when content transitions to in_editorial_review
 */
export async function syncContentToGitHub(contentId: string): Promise<void> {
  const content = await contentRepository.findById(contentId)
  if (!content) {
    throw new Error(`Content ${contentId} not found`)
  }

  // Initialize GitHub client for this content's website
  if (!content.website_id) {
    throw new Error(`Content ${contentId} has no website_id`)
  }
  await initializeGitHubForWebsite(content.website_id)

  // Check if PR already exists
  const existing = getGitHubMapping('content', contentId)
  if (existing) {
    console.log(`[Sync] PR already exists for content ${contentId}: #${existing.github_number}`)
    return
  }

  // Create PR
  const branchName = `content/${contentId}`
  const result = await createContentPR({
    contentId,
    content: content as ContentItem,
    branchName,
    agentId: content.author_agent_id || 'writer-agent',
  })

  // Store mapping
  storeGitHubMapping({
    entity_type: 'content',
    entity_id: contentId,
    github_type: 'pr',
    github_number: result.prNumber,
    github_url: result.prUrl,
    branch: result.branch,
    created_at: new Date().toISOString(),
  })

  console.log(`[Sync] Created PR #${result.prNumber} for content ${contentId}`)
}

/**
 * Sync: Internal approval → GitHub PR approval
 */
export async function syncApprovalToGitHub(
  contentId: string,
  approvalMessage: string,
  agentId: string
): Promise<void> {
  const mapping = getGitHubMapping('content', contentId)
  if (!mapping) {
    console.warn(`[Sync] No GitHub mapping found for content ${contentId}`)
    return
  }

  // Initialize GitHub client for this content's website
  const content = await contentRepository.findById(contentId)
  if (content?.website_id) {
    await initializeGitHubForWebsite(content.website_id)
  }

  await approvePR(mapping.github_number, approvalMessage, agentId)
  console.log(`[Sync] Approved PR #${mapping.github_number} for content ${contentId}`)
}

/**
 * Sync: Internal rejection → GitHub PR changes requested
 */
export async function syncRejectionToGitHub(
  contentId: string,
  feedback: string,
  agentId: string
): Promise<void> {
  const mapping = getGitHubMapping('content', contentId)
  if (!mapping) {
    console.warn(`[Sync] No GitHub mapping found for content ${contentId}`)
    return
  }

  // Initialize GitHub client for this content's website
  const content = await contentRepository.findById(contentId)
  if (content?.website_id) {
    await initializeGitHubForWebsite(content.website_id)
  }

  await requestPRChanges(mapping.github_number, feedback, agentId)
  console.log(`[Sync] Requested changes on PR #${mapping.github_number} for content ${contentId}`)
}

/**
 * Sync: Internal publish → GitHub PR merge
 */
export async function syncPublishToGitHub(contentId: string): Promise<void> {
  const mapping = getGitHubMapping('content', contentId)
  if (!mapping) {
    console.warn(`[Sync] No GitHub mapping found for content ${contentId}`)
    return
  }

  // Initialize GitHub client for this content's website
  const content = await contentRepository.findById(contentId)
  if (content?.website_id) {
    await initializeGitHubForWebsite(content.website_id)
  }

  await mergePR(
    mapping.github_number,
    `Publish content: ${contentId}`
  )

  console.log(`[Sync] Merged PR #${mapping.github_number} for content ${contentId}`)
}

/**
 * Sync: Internal QuestionTicket → GitHub Issue
 */
export async function syncQuestionToGitHub(ticketId: string): Promise<void> {
  const ticket = await questionTicketRepository.findById(ticketId)
  if (!ticket) {
    throw new Error(`Question ticket ${ticketId} not found`)
  }

  // Check if issue already exists
  const existing = getGitHubMapping('ticket', ticketId)
  if (existing) {
    console.log(`[Sync] Issue already exists for ticket ${ticketId}: #${existing.github_number}`)
    return
  }

  // Create issue
  const result = await createQuestionIssue({
    ticket,
  })

  // Store mapping
  storeGitHubMapping({
    entity_type: 'ticket',
    entity_id: ticketId,
    github_type: 'issue',
    github_number: result.issueNumber,
    github_url: result.issueUrl,
    created_at: new Date().toISOString(),
  })

  console.log(`[Sync] Created issue #${result.issueNumber} for ticket ${ticketId}`)
}

/**
 * Sync: Internal Task → GitHub Issue
 */
export async function syncTaskToGitHub(taskId: string): Promise<void> {
  const task = await taskRepository.findById(taskId)
  if (!task) {
    throw new Error(`Task ${taskId} not found`)
  }

  // Check if issue already exists
  const existing = getGitHubMapping('task', taskId)
  if (existing) {
    console.log(`[Sync] Issue already exists for task ${taskId}: #${existing.github_number}`)
    return
  }

  // Create issue
  const result = await createTaskIssue({ task })

  // Store mapping
  storeGitHubMapping({
    entity_type: 'task',
    entity_id: taskId,
    github_type: 'issue',
    github_number: result.issueNumber,
    github_url: result.issueUrl,
    created_at: new Date().toISOString(),
  })

  console.log(`[Sync] Created issue #${result.issueNumber} for task ${taskId}`)
}

/**
 * Sync: GitHub PR opened → Trigger Editorial Review workflow
 * Called from webhook handler
 */
export async function syncPRToInternal(pr: any): Promise<void> {
  // Extract content ID from branch name or PR body
  const branchName = pr.head.ref
  const contentIdMatch = branchName.match(/content\/(.+)/)

  if (!contentIdMatch) {
    console.warn(`[Sync] Could not extract content ID from branch: ${branchName}`)
    return
  }

  const contentId = contentIdMatch[1]

  // Check if content exists in database
  const content = await contentRepository.findById(contentId)
  if (!content) {
    console.warn(`[Sync] Content ${contentId} not found in database`)
    return
  }

  // Store mapping
  storeGitHubMapping({
    entity_type: 'content',
    entity_id: contentId,
    github_type: 'pr',
    github_number: pr.number,
    github_url: pr.html_url,
    branch: branchName,
    created_at: pr.created_at,
  })

  console.log(`[Sync] Mapped PR #${pr.number} to content ${contentId}`)

  // Trigger Editorial Review workflow if not already in review
  if (content.status !== 'in_editorial_review') {
    await contentRepository.transition(
      contentId,
      'submit_for_review',
      'WriterAgent',
      'writer-agent'
    )
    console.log(`[Sync] Transitioned content ${contentId} to in_editorial_review`)
  }
}

/**
 * Sync: GitHub PR review → Update internal state
 */
export async function syncPRReviewToInternal(pr: any, review: any): Promise<void> {
  // Find content by PR number
  let contentId: string | undefined
  for (const [, mapping] of githubMappings.entries()) {
    if (mapping.github_number === pr.number && mapping.entity_type === 'content') {
      contentId = mapping.entity_id
      break
    }
  }

  if (!contentId) {
    console.warn(`[Sync] No content mapping found for PR #${pr.number}`)
    return
  }

  // Handle different review states
  if (review.state === 'approved') {
    await contentRepository.transition(
      contentId,
      'approve',
      'EditorAgent',
      'editor-agent',
      { github_review_id: review.id }
    )
    console.log(`[Sync] Approved content ${contentId} from PR review`)
  } else if (review.state === 'changes_requested') {
    await contentRepository.transition(
      contentId,
      'request_changes',
      'EditorAgent',
      'editor-agent',
      { github_review_id: review.id, feedback: review.body }
    )
    console.log(`[Sync] Requested changes for content ${contentId} from PR review`)
  }
}

/**
 * Sync: GitHub Issue comment → Answer QuestionTicket
 */
export async function syncIssueCommentToInternal(issue: any, comment: any): Promise<void> {
  // Check if this is a question-ticket
  const hasQuestionLabel = issue.labels.some((label: any) => label.name === 'question-ticket')
  if (!hasQuestionLabel) {
    return
  }

  // Find ticket by issue number
  let ticketId: string | undefined
  for (const [, mapping] of githubMappings.entries()) {
    if (mapping.github_number === issue.number && mapping.entity_type === 'ticket') {
      ticketId = mapping.entity_id
      break
    }
  }

  if (!ticketId) {
    console.warn(`[Sync] No ticket mapping found for issue #${issue.number}`)
    return
  }

  // If comment is from CEO, mark as answered
  // (In production, check actual user permissions and map GitHub user to agent)
  if (comment.user.login === 'CEO' || comment.author_association === 'OWNER') {
    await questionTicketRepository.update(ticketId, {
      answer_body: comment.body,
      status: 'answered',
      // TODO: Map GitHub user to answer_agent_id
    })

    console.log(`[Sync] Answered ticket ${ticketId} from issue comment by ${comment.user.login}`)
  }
}
