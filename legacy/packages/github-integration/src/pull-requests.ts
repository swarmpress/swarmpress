/**
 * Pull Request Operations
 *
 * Each export takes a `RepoClient` instance (provides per-website Octokit,
 * owner, repo). This replaces the previous global `getGitHub()` singleton —
 * see WS1 of the repo-canonical migration.
 */

import type { ContentItem } from '@swarm-press/shared'
import type { RepoClient } from './repo-client'

export interface CreateContentPRParams {
  contentId: string
  content: ContentItem
  branchName: string
  agentId: string
}

export interface PRResult {
  prNumber: number
  prUrl: string
  branch: string
}

/**
 * Sanitize a string for use in a PR title — strips control characters /
 * newlines and clamps length so GitHub does not 422 us.
 */
export function sanitizePRTitle(raw: string, maxLength = 80): string {
  const collapsed = raw
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (collapsed.length <= maxLength) return collapsed
  return collapsed.substring(0, maxLength - 1).trimEnd() + '…'
}

/**
 * Create a Pull Request for content review
 */
export async function createContentPR(
  repoClient: RepoClient,
  params: CreateContentPRParams
): Promise<PRResult> {
  const { contentId, content, branchName, agentId } = params

  // Fail fast on missing content — previously this produced a PR titled
  // "undefined-…" with broken metadata. (audit item 11)
  if (!content) {
    throw new Error(`createContentPR: content is required (contentId=${contentId})`)
  }

  const { owner, repo } = repoClient.getRepoInfo()
  const octokit = repoClient.getOctokit()

  // Create branch if it doesn't exist
  const branchExists = await repoClient.branchExists(branchName)
  if (!branchExists) {
    await repoClient.createBranch(branchName)
  }

  // Build a human-readable title. Prefer the content's own title, then slug,
  // then a deterministic fallback. `content.type` was previously used here but
  // does not always exist on the runtime payload, producing "undefined-…".
  const rawTitle =
    content.title || content.slug || `content-${contentId.substring(0, 8)}`
  const contentTitle = sanitizePRTitle(rawTitle)
  const filePath = `content/${content.website_id}/${contentId}.json`
  const fileContent = JSON.stringify(
    {
      id: content.id,
      type: content.type,
      body: content.body,
      metadata: content.metadata,
      status: content.status,
      website_id: content.website_id,
      author_agent_id: content.author_agent_id,
      page_id: content.page_id,
      created_at: content.created_at,
      updated_at: content.updated_at,
    },
    null,
    2
  )

  await repoClient.createOrUpdateFile({
    path: filePath,
    content: fileContent,
    message: `feat: add content "${contentTitle}" [${contentId}]`,
    branch: branchName,
  })

  // Create Pull Request
  const prBody = `## Content Submission for Editorial Review

**Content ID:** \`${contentId}\`
**Type:** ${content.type}
**Title:** ${contentTitle}
**Website:** ${content.website_id}
**Author:** @${agentId}

### Content Blocks
This content contains ${content.body.length} blocks:
${content.body.map((block: any, i: number) => `- Block ${i + 1}: \`${block.type}\``).join('\n')}

${content.metadata?.category ? `**Category:** ${content.metadata.category}\n` : ''}${content.metadata?.tags ? `**Tags:** ${content.metadata.tags.join(', ')}\n` : ''}
---

**Status:** \`draft\` → \`in_editorial_review\`

**Review Instructions:**
1. EditorAgent will review content quality and structure
2. High-risk content will be escalated to CEO
3. Upon approval, EngineeringAgent will build and publish

**Labels:** \`content-review\`, \`status:in-review\`
`

  const { data: pr } = await octokit.pulls.create({
    owner,
    repo,
    title: `📝 ${contentTitle}`,
    head: branchName,
    base: 'main',
    body: prBody,
    draft: false,
  })

  // Add labels
  await octokit.issues.addLabels({
    owner,
    repo,
    issue_number: pr.number,
    labels: ['content-review', 'status:in-review'],
  })

  console.log(`[GitHub] Created PR #${pr.number} for content ${contentId}`)

  return {
    prNumber: pr.number,
    prUrl: pr.html_url,
    branch: branchName,
  }
}

/**
 * Add review comment to PR
 */
export async function addPRComment(
  repoClient: RepoClient,
  prNumber: number,
  comment: string
): Promise<void> {
  const { owner, repo } = repoClient.getRepoInfo()
  const octokit = repoClient.getOctokit()

  await octokit.issues.createComment({
    owner,
    repo,
    issue_number: prNumber,
    body: comment,
  })

  console.log(`[GitHub] Added comment to PR #${prNumber}`)
}

/**
 * Request changes on a PR
 */
export async function requestPRChanges(
  repoClient: RepoClient,
  prNumber: number,
  feedback: string,
  agentId: string
): Promise<void> {
  const { owner, repo } = repoClient.getRepoInfo()
  const octokit = repoClient.getOctokit()

  // Create review requesting changes
  await octokit.pulls.createReview({
    owner,
    repo,
    pull_number: prNumber,
    body: `## Editorial Review: Changes Requested

${feedback}

---
*Review by: @${agentId}*`,
    event: 'REQUEST_CHANGES',
  })

  // Update labels
  await octokit.issues.setLabels({
    owner,
    repo,
    issue_number: prNumber,
    labels: ['content-review', 'status:needs-changes'],
  })

  console.log(`[GitHub] Requested changes on PR #${prNumber}`)
}

/**
 * Approve a PR
 */
export async function approvePR(
  repoClient: RepoClient,
  prNumber: number,
  approvalMessage: string,
  agentId: string
): Promise<void> {
  const { owner, repo } = repoClient.getRepoInfo()
  const octokit = repoClient.getOctokit()

  // Create approval review
  await octokit.pulls.createReview({
    owner,
    repo,
    pull_number: prNumber,
    body: `## Editorial Review: Approved ✅

${approvalMessage}

---
*Approved by: @${agentId}*`,
    event: 'APPROVE',
  })

  // Update labels
  await octokit.issues.setLabels({
    owner,
    repo,
    issue_number: prNumber,
    labels: ['content-review', 'status:approved'],
  })

  console.log(`[GitHub] Approved PR #${prNumber}`)
}

/**
 * Merge a PR (after approval)
 */
export async function mergePR(
  repoClient: RepoClient,
  prNumber: number,
  commitMessage?: string
): Promise<{ merged: boolean; sha: string }> {
  const { owner, repo } = repoClient.getRepoInfo()
  const octokit = repoClient.getOctokit()

  const { data: result } = await octokit.pulls.merge({
    owner,
    repo,
    pull_number: prNumber,
    commit_title: commitMessage,
    merge_method: 'squash',
  })

  // Update labels
  await octokit.issues.setLabels({
    owner,
    repo,
    issue_number: prNumber,
    labels: ['content-review', 'status:published'],
  })

  console.log(`[GitHub] Merged PR #${prNumber}`)

  return {
    merged: result.merged,
    sha: result.sha,
  }
}

/**
 * Close a PR without merging.
 */
export async function closePR(
  repoClient: RepoClient,
  prNumber: number,
  closeComment?: string
): Promise<void> {
  const { owner, repo } = repoClient.getRepoInfo()
  const octokit = repoClient.getOctokit()

  if (closeComment) {
    await addPRComment(repoClient, prNumber, closeComment)
  }

  await octokit.pulls.update({
    owner,
    repo,
    pull_number: prNumber,
    state: 'closed',
  })

  // Update labels
  await octokit.issues.setLabels({
    owner,
    repo,
    issue_number: prNumber,
    labels: ['content-review', 'status:rejected'],
  })

  console.log(`[GitHub] Closed PR #${prNumber}`)
}

/**
 * Get PR details
 */
export async function getPRDetails(
  repoClient: RepoClient,
  prNumber: number
): Promise<{
  number: number
  title: string
  state: string
  merged: boolean
  branch: string
  labels: string[]
}> {
  const { owner, repo } = repoClient.getRepoInfo()
  const octokit = repoClient.getOctokit()

  const { data: pr } = await octokit.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
  })

  return {
    number: pr.number,
    title: pr.title,
    state: pr.state,
    merged: pr.merged || false,
    branch: pr.head.ref,
    labels: pr.labels.map((label) => label.name),
  }
}

/**
 * List PRs (defaults to open).
 */
export async function listPRs(
  repoClient: RepoClient,
  options: { state?: 'open' | 'closed' | 'all'; perPage?: number } = {}
): Promise<
  Array<{
    number: number
    title: string
    state: string
    branch: string
    labels: string[]
    url: string
  }>
> {
  const { owner, repo } = repoClient.getRepoInfo()
  const octokit = repoClient.getOctokit()

  const { data: prs } = await octokit.pulls.list({
    owner,
    repo,
    state: options.state || 'open',
    per_page: options.perPage || 30,
  })

  return prs.map((pr) => ({
    number: pr.number,
    title: pr.title,
    state: pr.state,
    branch: pr.head.ref,
    labels: pr.labels.map((label: any) => label.name),
    url: pr.html_url,
  }))
}
