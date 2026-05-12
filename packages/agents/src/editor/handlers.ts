/**
 * EditorAgent Tool Handlers
 * Implementations that connect tools to database operations + GitHub PR ops
 *
 * REPO-CANONICAL MIGRATION (WS3):
 * - approve_content merges the PR (squash) before transitioning state
 * - request_changes additionally comments on the PR
 * - reject_content additionally closes the PR
 * - PR lookup: prefers pr_content_mappings table (WS4); falls back to
 *   branch-name pattern `drafts/content-{contentId}` if the table/repo is
 *   not yet available.
 */

import { ToolHandler, ToolResult, toolSuccess, toolError } from '../base/tools'

// ============================================================================
// Error Types
// ============================================================================

/**
 * Thrown when the editor's approval cannot be propagated to GitHub
 * (no PR found, merge conflict, GitHub API failure, etc.).
 *
 * Workflow callers can `instanceof PRMergeError` to decide whether to
 * retry, escalate to the CEO, or surface as a question ticket.
 */
export class PRMergeError extends Error {
  constructor(
    public prNumber: number | null,
    public reason: string,
    public underlying?: Error
  ) {
    super(`Failed to merge PR ${prNumber ?? '(not found)'}: ${reason}`)
    this.name = 'PRMergeError'
  }
}

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

async function getWebsiteRepository() {
  const { websiteRepository } = await import('@swarm-press/backend')
  return websiteRepository
}

/**
 * Build a per-website GitHub client. Used for direct PR/Octokit operations
 * (merge, comment, close, list-by-branch) — the existing GitHubContentService
 * doesn't expose them.
 *
 * Once WS1's RepoClient + getRepoClient() factory ships, this helper should
 * be replaced by `getRepoClient(websiteId)` and the call sites should use
 * the high-level methods (.mergePR, .commentOnPR, .closePR) instead of
 * raw Octokit calls.
 */
async function getGitHubClientForWebsite(websiteId: string) {
  // Dynamic import mirrors the pattern used in writer/handlers.ts —
  // avoids circular deps and matches the existing convention.
  const { GitHubClient } = await import('@swarm-press/github-integration/src/client')
  const websiteRepository = await getWebsiteRepository()
  const website = await websiteRepository.findById(websiteId)

  if (!website || !website.github_repo) {
    throw new Error(`Website ${websiteId} not found or not connected to GitHub`)
  }

  return {
    client: new GitHubClient({
      owner: website.github_owner || '',
      repo: website.github_repo,
      token: website.github_access_token || '',
    }),
    owner: website.github_owner || '',
    repo: website.github_repo,
  }
}

// ============================================================================
// PR Lookup Helper
// ============================================================================

interface PRLookupResult {
  prNumber: number
  prUrl: string
  branchName: string
}

/**
 * Find the open PR associated with a content item.
 *
 * Lookup order:
 *   1. (preferred) Query pr_content_mappings table introduced by WS4. If
 *      the repository module isn't available yet, silently skip.
 *   2. (fallback) Compute the conventional draft branch name
 *      `drafts/content-{contentId}` and ask GitHub for the open PR with
 *      that head branch.
 *
 * Returns null if neither path turns up an open PR.
 */
async function findPRForContent(
  websiteId: string,
  contentId: string
): Promise<PRLookupResult | null> {
  // ---- Path 1: pr_content_mappings table (WS4) ----
  try {
    // The repository may not exist yet (WS4 hasn't merged). Use a guarded
    // dynamic import so a missing module doesn't break the editor.
    const mod: any = await import('@swarm-press/backend' as string).catch(() => null)
    const repo = mod?.prContentMappingRepository
    if (repo && typeof repo.findOpenByContentId === 'function') {
      const mapping = await repo.findOpenByContentId(contentId)
      if (mapping) {
        return {
          prNumber: mapping.pr_number,
          prUrl: mapping.pr_url,
          branchName: mapping.branch_name,
        }
      }
      // Table exists, no open mapping — fall through to branch-name lookup
      // (covers PRs opened outside the platform that webhooks may not have
      // upserted yet).
    }
  } catch (err) {
    console.warn(
      `[EditorHandler] pr_content_mappings lookup failed (will fall back to branch name):`,
      err instanceof Error ? err.message : err
    )
  }

  // ---- Path 2: branch-name fallback ----
  // WriterAgent commits drafts to `drafts/content-{contentId}` (see
  // WS2's submit_for_review handler). Reverse the lookup by listing open
  // PRs for that head branch.
  const expectedBranch = `drafts/content-${contentId}`

  try {
    const { client, owner, repo } = await getGitHubClientForWebsite(websiteId)
    const octokit = client.getOctokit()

    // GitHub's `head` filter requires owner-prefix when filtering across
    // forks; for same-repo branches `owner:branch` works.
    const { data: prs } = await octokit.pulls.list({
      owner,
      repo,
      state: 'open',
      head: `${owner}:${expectedBranch}`,
      per_page: 5,
    })

    if (prs.length === 0) {
      // Try the older `content/{contentId}` convention too (backwards-compat
      // with the pre-migration branch naming used by createContentPR).
      const legacyBranch = `content/${contentId}`
      const { data: legacyPrs } = await octokit.pulls.list({
        owner,
        repo,
        state: 'open',
        head: `${owner}:${legacyBranch}`,
        per_page: 5,
      })
      if (legacyPrs.length === 0) return null
      const pr = legacyPrs[0]!
      return {
        prNumber: pr.number,
        prUrl: pr.html_url,
        branchName: legacyBranch,
      }
    }

    const pr = prs[0]!
    return {
      prNumber: pr.number,
      prUrl: pr.html_url,
      branchName: expectedBranch,
    }
  } catch (err) {
    console.warn(
      `[EditorHandler] branch-name PR lookup failed:`,
      err instanceof Error ? err.message : err
    )
    return null
  }
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

    // REPO-CANONICAL: the actual draft body lives on the GitHub draft branch
    // (`drafts/content-{id}` at `content/pages/drafts/{id}.json`), NOT in
    // `content_items.body` (which is null since the migration). Read the
    // draft from the repo so the editor sees real content to review.
    let body: unknown[] = Array.isArray(content.body) ? (content.body as unknown[]) : []
    let title: string = content.title
    let draftSource: 'repo' | 'db' = 'db'
    let draftCommitSha: string | undefined
    let draftError: string | undefined

    if (content.website_id) {
      try {
        const { GitHubContentService } = await import(
          '@swarm-press/github-integration/src/content-service'
        )
        const websiteRepository = await getWebsiteRepository()
        const website = await websiteRepository.findById(content.website_id)
        if (website?.github_owner && website?.github_repo) {
          const draftBranch = `drafts/content-${input.content_id}`
          const draftPath = `content/pages/drafts/${input.content_id}.json`
          const contentService = new GitHubContentService({
            owner: website.github_owner,
            repo: website.github_repo,
            token: website.github_access_token || '',
            branch: draftBranch,
          })
          const draftFile = await contentService.getPageByPath(draftPath)
          if (draftFile?.content) {
            const page = draftFile.content as { title?: string; body?: unknown[] }
            if (Array.isArray(page.body) && page.body.length > 0) {
              body = page.body
              draftSource = 'repo'
              draftCommitSha = draftFile.sha
              if (typeof page.title === 'string' && page.title.trim()) {
                title = page.title
              }
            }
          }
        }
      } catch (err) {
        draftError = err instanceof Error ? err.message : String(err)
        console.warn(
          `[EditorHandler] Could not load draft for ${input.content_id} from repo (will fall back to DB):`,
          draftError
        )
      }
    }

    return toolSuccess({
      id: content.id,
      title,
      brief: (content as { brief?: string }).brief,
      status: content.status,
      body,
      metadata: content.metadata,
      website_id: content.website_id,
      author_agent_id: content.author_agent_id,
      created_at: content.created_at,
      updated_at: content.updated_at,
      block_count: body.length,
      draft_source: draftSource,
      draft_commit_sha: draftCommitSha,
      draft_load_error: draftError,
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to fetch content')
  }
}

/**
 * Approve content
 *
 * REPO-CANONICAL: Approval is the act of merging the content's PR into main.
 * The site repo's own GitHub Actions handles the build+deploy; we only
 * record the audit trail in Postgres after a successful merge.
 *
 * Throws PRMergeError if the PR cannot be located or merged — the workflow
 * caller is expected to catch it and escalate (do NOT silently transition
 * to `approved` without a corresponding repo merge, or repo and DB drift).
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

    // ---- 1. Find the PR for this content ----
    const prInfo = await findPRForContent(content.website_id, input.content_id)
    if (!prInfo) {
      throw new PRMergeError(
        null,
        `No open PR found for content ${input.content_id} (looked in pr_content_mappings and on draft branches)`
      )
    }

    // ---- 2. Merge the PR (squash) BEFORE transitioning state ----
    let mergeSha: string | undefined
    try {
      const { client, owner, repo } = await getGitHubClientForWebsite(content.website_id)
      const octokit = client.getOctokit()

      const commitTitle = `Approved: ${content.title || `content-${input.content_id.substring(0, 8)}`}`
      const commitBody = [
        `Quality score: ${input.quality_score}/10`,
        input.notes ? `\nNotes: ${input.notes}` : '',
        `\nApproved by: ${context.agentName} (${context.agentId})`,
      ].join('')

      const { data: mergeResult } = await octokit.pulls.merge({
        owner,
        repo,
        pull_number: prInfo.prNumber,
        commit_title: commitTitle,
        commit_message: commitBody,
        merge_method: 'squash',
      })

      if (!mergeResult.merged) {
        throw new PRMergeError(
          prInfo.prNumber,
          mergeResult.message || 'GitHub reported merged=false'
        )
      }
      mergeSha = mergeResult.sha
      console.log(`[EditorHandler] Merged PR #${prInfo.prNumber} (sha=${mergeSha})`)
    } catch (err) {
      if (err instanceof PRMergeError) throw err
      const e = err as Error & { status?: number }
      // 405 = Method Not Allowed (merge conflict / unmergeable)
      // 409 = Conflict
      // 404 = PR not found
      const reason =
        e.status === 405
          ? 'PR is not mergeable (likely a conflict — needs rebase)'
          : e.status === 409
            ? 'Merge conflict on base branch'
            : e.status === 404
              ? 'PR no longer exists'
              : e.message || 'Unknown merge failure'
      throw new PRMergeError(prInfo.prNumber, reason, e)
    }

    // ---- 3. Persist the review record (after successful merge) ----
    const metadata = content.metadata || {}
    const reviews = metadata.reviews || []
    reviews.push({
      date: new Date().toISOString(),
      reviewer_id: context.agentId,
      reviewer_name: context.agentName,
      result: 'approved',
      quality_score: input.quality_score,
      notes: input.notes,
      pr_number: prInfo.prNumber,
      pr_url: prInfo.prUrl,
      merge_sha: mergeSha,
    })

    await contentRepository.update(input.content_id, {
      metadata: { ...metadata, reviews },
    })

    // ---- 4. Transition state to approved ----
    const result = await contentRepository.transition(
      input.content_id,
      'approve',
      'Editor',
      context.agentId,
      {
        quality_score: input.quality_score,
        pr_number: prInfo.prNumber,
        merge_sha: mergeSha,
      }
    )

    if (!result.success) {
      return toolError(`Failed to approve content: ${result.error}`)
    }

    return toolSuccess({
      content_id: input.content_id,
      previous_status: content.status,
      new_status: 'approved',
      quality_score: input.quality_score,
      pr_number: prInfo.prNumber,
      pr_url: prInfo.prUrl,
      merge_sha: mergeSha,
      message: 'Content approved, PR merged, ready for site repo to deploy',
    })
  } catch (error) {
    if (error instanceof PRMergeError) {
      // Re-throw typed errors so workflow callers can branch on them.
      throw error
    }
    return toolError(error instanceof Error ? error.message : 'Failed to approve content')
  }
}

/**
 * Request changes
 *
 * REPO-CANONICAL: In addition to the DB review record + state transition
 * (which remains the source of truth for ops/audit), we also post a comment
 * on the PR so the WriterAgent (or a human reviewer) can iterate against
 * real GitHub PR comments. PR commenting failures are non-fatal — the DB
 * transition still happens.
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

    // ---- 1. Best-effort: comment on the PR (non-fatal on failure) ----
    let prInfo: PRLookupResult | null = null
    let prCommentPosted = false
    try {
      prInfo = await findPRForContent(content.website_id, input.content_id)
      if (prInfo) {
        const reviewBody = [
          `## Editorial Review: Changes Requested`,
          ``,
          `**Quality score:** ${input.quality_score}/10`,
          ``,
          `### Feedback`,
          input.feedback,
          ``,
          `### Required Changes`,
          ...input.required_changes.map((c) => `- ${c}`),
          ``,
          `---`,
          `*Review by: ${context.agentName} (${context.agentId})*`,
        ].join('\n')

        const { client, owner, repo } = await getGitHubClientForWebsite(content.website_id)
        const octokit = client.getOctokit()
        await octokit.issues.createComment({
          owner,
          repo,
          issue_number: prInfo.prNumber,
          body: reviewBody,
        })
        prCommentPosted = true
        console.log(
          `[EditorHandler] Posted change-request comment on PR #${prInfo.prNumber}`
        )
      } else {
        console.warn(
          `[EditorHandler] No PR found for content ${input.content_id}; skipping PR comment (DB transition still proceeding)`
        )
      }
    } catch (err) {
      console.warn(
        `[EditorHandler] Failed to comment on PR (non-fatal):`,
        err instanceof Error ? err.message : err
      )
    }

    // ---- 2. Persist the review record (DB is canonical for ops state) ----
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
      pr_number: prInfo?.prNumber,
      pr_url: prInfo?.prUrl,
      pr_comment_posted: prCommentPosted,
    })

    await contentRepository.update(input.content_id, {
      metadata: { ...metadata, reviews },
    })

    // ---- 3. Transition to needs_changes ----
    const result = await contentRepository.transition(
      input.content_id,
      'request_changes',
      'Editor',
      context.agentId,
      {
        quality_score: input.quality_score,
        feedback: input.feedback,
        required_changes: input.required_changes,
        pr_number: prInfo?.prNumber,
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
      pr_number: prInfo?.prNumber,
      pr_url: prInfo?.prUrl,
      pr_comment_posted: prCommentPosted,
      message: 'Content returned to writer for revision',
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to request changes')
  }
}

/**
 * Reject content
 *
 * REPO-CANONICAL: In addition to the DB review record + state transition,
 * we close the associated PR (without merging) so the draft branch stops
 * showing as open work. PR-close failures are non-fatal — the DB
 * transition still happens.
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

    if (content.status !== 'in_editorial_review') {
      return toolError(
        `Content must be in "in_editorial_review" status to reject. Current status: ${content.status}`
      )
    }

    // ---- 1. Look up PR (read-only, no side effect yet) ----
    const prInfo: PRLookupResult | null = await findPRForContent(
      content.website_id,
      input.content_id
    )

    // ---- 2. Transition state FIRST. If the state machine rejects (wrong
    //     event/actor/state), bail out BEFORE touching the PR. Closing a PR
    //     is irreversible from the editor's tools — we don't want a
    //     "rejected" PR with content still in_editorial_review. ----
    const result = await contentRepository.transition(
      input.content_id,
      'reject',
      'Editor',
      context.agentId,
      { reason: input.reason, pr_number: prInfo?.prNumber }
    )

    if (!result.success) {
      return toolError(`Failed to reject content: ${result.error}`)
    }

    // ---- 3. Best-effort: close the PR (state already advanced) ----
    let prClosed = false
    if (prInfo) {
      try {
        const { client, owner, repo } = await getGitHubClientForWebsite(content.website_id)
        const octokit = client.getOctokit()
        await octokit.issues.createComment({
          owner,
          repo,
          issue_number: prInfo.prNumber,
          body: [
            `## Editorial Review: Rejected`,
            ``,
            `**Reason:** ${input.reason}`,
            ``,
            `---`,
            `*Rejected by: ${context.agentName} (${context.agentId})*`,
          ].join('\n'),
        })
        await octokit.pulls.update({
          owner,
          repo,
          pull_number: prInfo.prNumber,
          state: 'closed',
        })
        prClosed = true
        console.log(`[EditorHandler] Closed PR #${prInfo.prNumber}`)
      } catch (err) {
        console.warn(
          `[EditorHandler] Failed to close PR (non-fatal — state already 'rejected'):`,
          err instanceof Error ? err.message : err
        )
      }
    } else {
      console.warn(
        `[EditorHandler] No PR found for content ${input.content_id}; state transitioned to rejected`
      )
    }

    // ---- 4. Persist the rejection record (after state + PR) ----
    const metadata = content.metadata || {}
    const reviews = metadata.reviews || []
    reviews.push({
      date: new Date().toISOString(),
      reviewer_id: context.agentId,
      reviewer_name: context.agentName,
      result: 'rejected',
      reason: input.reason,
      pr_number: prInfo?.prNumber,
      pr_url: prInfo?.prUrl,
      pr_closed: prClosed,
    })

    await contentRepository.update(input.content_id, {
      metadata: { ...metadata, reviews },
    })

    return toolSuccess({
      content_id: input.content_id,
      previous_status: content.status,
      new_status: 'rejected',
      reason: input.reason,
      pr_number: prInfo?.prNumber,
      pr_url: prInfo?.prUrl,
      pr_closed: prClosed,
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

    // Create question ticket for CEO. The question_tickets table has no
    // dedicated `content_id` column — keep the linkage in metadata so the
    // INSERT only references real columns.
    const ticket = await questionTicketRepository.create({
      subject: input.subject,
      body: `${input.reason}\n\n**Risk Factors:**\n${input.risk_factors.map((r) => `- ${r}`).join('\n')}\n\n**Content Title:** ${content.title}\n**Content ID:** ${content.id}`,
      created_by_agent_id: context.agentId,
      target: 'CEO',
      status: 'open',
      metadata: {
        content_id: input.content_id,
        risk_factors: input.risk_factors,
      },
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
