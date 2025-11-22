/**
 * Pull Request Operations
 * Create and manage PRs for content review
 */

import { getGitHub } from './client'
import type { ContentItem } from '@swarm-press/shared'

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
 * Create a Pull Request for content review
 */
export async function createContentPR(params: CreateContentPRParams): Promise<PRResult> {
  const { contentId, content, branchName, agentId } = params
  const github = getGitHub()
  const { owner, repo } = github.getRepoInfo()
  const octokit = github.getOctokit()

  // Create branch if it doesn't exist
  const branchExists = await github.branchExists(branchName)
  if (!branchExists) {
    await github.createBranch(branchName)
  }

  // Create content file
  const filePath = `content/${content.website_id}/${content.slug || contentId}.json`
  const fileContent = JSON.stringify(
    {
      id: content.id,
      title: content.title,
      slug: content.slug,
      brief: content.brief,
      body: content.body,
      metadata: content.metadata,
      status: content.status,
      website_id: content.website_id,
      created_at: content.created_at,
      updated_at: content.updated_at,
    },
    null,
    2
  )

  await github.createOrUpdateFile({
    path: filePath,
    content: fileContent,
    message: `feat: add content "${content.title}" [${contentId}]`,
    branch: branchName,
  })

  // Create Pull Request
  const prBody = `## Content Submission for Editorial Review

**Content ID:** \`${contentId}\`
**Title:** ${content.title}
**Website:** ${content.website_id}
**Author:** @${agentId}

### Brief
${content.brief || 'No brief provided'}

### Content Blocks
This content contains ${content.body.length} blocks:
${content.body.map((block: any, i: number) => `- Block ${i + 1}: \`${block.type}\``).join('\n')}

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
    title: `📝 ${content.title}`,
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
export async function addPRComment(prNumber: number, comment: string): Promise<void> {
  const github = getGitHub()
  const { owner, repo } = github.getRepoInfo()
  const octokit = github.getOctokit()

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
  prNumber: number,
  feedback: string,
  agentId: string
): Promise<void> {
  const github = getGitHub()
  const { owner, repo } = github.getRepoInfo()
  const octokit = github.getOctokit()

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
  prNumber: number,
  approvalMessage: string,
  agentId: string
): Promise<void> {
  const github = getGitHub()
  const { owner, repo } = github.getRepoInfo()
  const octokit = github.getOctokit()

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
  prNumber: number,
  commitMessage?: string
): Promise<{ merged: boolean; sha: string }> {
  const github = getGitHub()
  const { owner, repo } = github.getRepoInfo()
  const octokit = github.getOctokit()

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
 * Get PR details
 */
export async function getPRDetails(prNumber: number): Promise<{
  number: number
  title: string
  state: string
  merged: boolean
  branch: string
  labels: string[]
}> {
  const github = getGitHub()
  const { owner, repo } = github.getRepoInfo()
  const octokit = github.getOctokit()

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
