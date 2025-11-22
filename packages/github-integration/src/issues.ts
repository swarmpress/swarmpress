/**
 * GitHub Issues Operations
 * Create and manage issues for tasks and question tickets
 */

import { getGitHub } from './client'
import type { QuestionTicket, Task } from '@swarm-press/shared'

export interface CreateQuestionIssueParams {
  ticket: QuestionTicket
  contentId?: string
}

export interface CreateTaskIssueParams {
  task: Task
}

export interface IssueResult {
  issueNumber: number
  issueUrl: string
}

/**
 * Create a GitHub Issue for a QuestionTicket
 */
export async function createQuestionIssue(
  params: CreateQuestionIssueParams
): Promise<IssueResult> {
  const { ticket, contentId } = params
  const github = getGitHub()
  const { owner, repo } = github.getRepoInfo()
  const octokit = github.getOctokit()

  const issueTitle = `❓ ${ticket.subject.substring(0, 100)}${ticket.subject.length > 100 ? '...' : ''}`

  const issueBody = `## Question Ticket: CEO Input Required

**Ticket ID:** \`${ticket.id}\`
**Created by:** @${ticket.created_by_agent_id}
**Target:** ${ticket.target}
${contentId ? `**Related Content:** \`${contentId}\`\n` : ''}
### Question

${ticket.subject}

### Details

${ticket.body}

---

**Status:** \`${ticket.status}\`

**Action Required:**
This question requires CEO input. Please review and provide your answer in a comment below.

Once answered, the agent will be notified and can proceed with their task.

**Labels:** \`question-ticket\`, \`ceo-action-required\`
`

  const { data: issue } = await octokit.issues.create({
    owner,
    repo,
    title: issueTitle,
    body: issueBody,
    labels: ['question-ticket', 'ceo-action-required', `status:${ticket.status}`],
    assignees: ['CEO'], // Assign to CEO user (configure this)
  })

  console.log(`[GitHub] Created question issue #${issue.number} for ticket ${ticket.id}`)

  return {
    issueNumber: issue.number,
    issueUrl: issue.html_url,
  }
}

/**
 * Create a GitHub Issue for a Task
 */
export async function createTaskIssue(params: CreateTaskIssueParams): Promise<IssueResult> {
  const { task } = params
  const github = getGitHub()
  const { owner, repo } = github.getRepoInfo()
  const octokit = github.getOctokit()

  // Task type emoji mapping
  const typeEmoji = {
    create_brief: '📝',
    write_draft: '✍️',
    revise_draft: '📝',
    editorial_review: '👁️',
    seo_optimization: '🔍',
    generate_media: '🖼️',
    prepare_build: '🔨',
    publish_site: '🚀',
  }

  const issueTitle = `${typeEmoji[task.type] || '📋'} ${task.type.replace(/_/g, ' ').toUpperCase()}`

  const issueBody = `## Task

**Task ID:** \`${task.id}\`
**Type:** \`${task.type}\`
**Assigned to:** @${task.agent_id}
${task.content_id ? `**Related Content:** \`${task.content_id}\`\n` : ''}${task.website_id ? `**Related Website:** \`${task.website_id}\`\n` : ''}
${task.notes ? `### Notes\n\n${task.notes}\n\n` : ''}---

**Status:** \`${task.status}\`

**Labels:** \`task\`, \`type:${task.type}\`, \`status:${task.status}\`
`

  const { data: issue } = await octokit.issues.create({
    owner,
    repo,
    title: issueTitle,
    body: issueBody,
    labels: ['task', `type:${task.type}`, `status:${task.status}`],
    assignees: [task.agent_id],
  })

  console.log(`[GitHub] Created task issue #${issue.number} for task ${task.id}`)

  return {
    issueNumber: issue.number,
    issueUrl: issue.html_url,
  }
}

/**
 * Add comment to issue (e.g., CEO answering a question)
 */
export async function addIssueComment(issueNumber: number, comment: string): Promise<void> {
  const github = getGitHub()
  const { owner, repo } = github.getRepoInfo()
  const octokit = github.getOctokit()

  await octokit.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body: comment,
  })

  console.log(`[GitHub] Added comment to issue #${issueNumber}`)
}

/**
 * Close an issue
 */
export async function closeIssue(
  issueNumber: number,
  closeComment?: string
): Promise<void> {
  const github = getGitHub()
  const { owner, repo } = github.getRepoInfo()
  const octokit = github.getOctokit()

  if (closeComment) {
    await addIssueComment(issueNumber, closeComment)
  }

  await octokit.issues.update({
    owner,
    repo,
    issue_number: issueNumber,
    state: 'closed',
  })

  console.log(`[GitHub] Closed issue #${issueNumber}`)
}

/**
 * Update issue labels
 */
export async function updateIssueLabels(
  issueNumber: number,
  labels: string[]
): Promise<void> {
  const github = getGitHub()
  const { owner, repo } = github.getRepoInfo()
  const octokit = github.getOctokit()

  await octokit.issues.setLabels({
    owner,
    repo,
    issue_number: issueNumber,
    labels,
  })

  console.log(`[GitHub] Updated labels on issue #${issueNumber}`)
}

/**
 * Get issue details
 */
export async function getIssueDetails(issueNumber: number): Promise<{
  number: number
  title: string
  state: string
  labels: string[]
  comments: Array<{ body: string; user: string; created_at: string }>
}> {
  const github = getGitHub()
  const { owner, repo } = github.getRepoInfo()
  const octokit = github.getOctokit()

  const { data: issue } = await octokit.issues.get({
    owner,
    repo,
    issue_number: issueNumber,
  })

  const { data: comments } = await octokit.issues.listComments({
    owner,
    repo,
    issue_number: issueNumber,
  })

  return {
    number: issue.number,
    title: issue.title,
    state: issue.state,
    labels: issue.labels.map((label: any) => label.name),
    comments: comments.map((comment) => ({
      body: comment.body || '',
      user: comment.user?.login || 'unknown',
      created_at: comment.created_at,
    })),
  }
}
