/**
 * Site Build Activities
 * Temporal activities for building static sites from various sources
 */

import { websiteRepository } from '@swarm-press/backend'

// Extended website type that may include GitHub Pages fields
interface WebsiteWithGitHub {
  id: string
  domain?: string
  github_owner?: string
  github_repo?: string
  github_access_token?: string
  github_pages_branch?: string
  github_pages_enabled?: boolean
  github_pages_url?: string
  settings?: Record<string, unknown>
}

/**
 * Build a static site from GitHub repository content
 * Uses GitHub as the source of truth instead of database
 */
export async function buildFromGitHubActivity(params: {
  websiteId: string
  siteUrl?: string
}): Promise<{
  success: boolean
  outputDir?: string
  url?: string
  buildTime?: number
  pagesGenerated?: number
  collectionsGenerated?: number
  error?: string
}> {
  // Get website with GitHub config
  const website = await websiteRepository.findById(params.websiteId) as WebsiteWithGitHub | null
  if (!website) {
    return { success: false, error: `Website ${params.websiteId} not found` }
  }

  if (!website.github_owner || !website.github_repo || !website.github_access_token) {
    return { success: false, error: 'Website not connected to GitHub' }
  }

  // Get branch from website or settings
  const branch = website.github_pages_branch ||
    (website.settings as Record<string, unknown>)?.github_pages_branch as string ||
    'main'

  // Get site URL
  const siteUrl = params.siteUrl ||
    website.github_pages_url ||
    (website.settings as Record<string, unknown>)?.github_pages_url as string ||
    website.domain

  try {
    // Dynamic import to avoid circular dependency issues
    const { buildFromGitHub } = await import('@swarm-press/site-builder')

    const result = await buildFromGitHub({
      github: {
        owner: website.github_owner,
        repo: website.github_repo,
        token: website.github_access_token,
        branch,
      },
      siteUrl,
    })

    console.log(
      `[SiteBuild] GitHub build ${result.success ? 'succeeded' : 'failed'} for website ${params.websiteId}`
    )

    return result
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error'
    console.error(`[SiteBuild] GitHub build failed: ${errorMsg}`)
    return { success: false, error: errorMsg }
  }
}

/**
 * Get website details for build configuration
 */
export async function getWebsiteBuildConfigActivity(params: {
  websiteId: string
}): Promise<{
  websiteId: string
  domain?: string
  githubOwner?: string
  githubRepo?: string
  githubBranch?: string
  githubPagesEnabled: boolean
  buildFromGitHub: boolean
}> {
  const website = await websiteRepository.findById(params.websiteId) as WebsiteWithGitHub | null
  if (!website) {
    throw new Error(`Website ${params.websiteId} not found`)
  }

  // Get values from website or settings
  const githubBranch = website.github_pages_branch ||
    (website.settings as Record<string, unknown>)?.github_pages_branch as string ||
    'main'

  const githubPagesEnabled = website.github_pages_enabled ||
    (website.settings as Record<string, unknown>)?.github_pages_enabled as boolean ||
    false

  const buildFromGitHub = (website.settings as Record<string, unknown>)?.build_from_github as boolean ||
    githubPagesEnabled ||
    false

  return {
    websiteId: website.id,
    domain: website.domain || undefined,
    githubOwner: website.github_owner || undefined,
    githubRepo: website.github_repo || undefined,
    githubBranch,
    githubPagesEnabled,
    // For now, we assume GitHub build is enabled when GitHub Pages is enabled
    // This could be a separate flag in the future
    buildFromGitHub,
  }
}

/**
 * Wait for the GitHub `deployment_status.success` webhook to confirm
 * that the site repo's own `.github/workflows/deploy.yml` has finished
 * deploying after a content PR merge.
 *
 * Implementation: polls `state_audit_log` for a 'deployed' transition
 * recorded by the WS4 webhook handler. Bounded by `timeout`. Returns
 * `{ success: false, error: 'timeout' }` if no event is observed in
 * time — caller decides whether to escalate.
 *
 * NOTE (deferred): this is a polling stub; a future iteration should use
 * a Temporal signal driven by the webhook handler so the workflow
 * resumes immediately rather than polling. For now polling keeps the
 * dependency surface small (no signal plumbing required).
 */
export async function waitForDeploymentActivity(params: {
  websiteId: string
  contentId: string
  /** ISO 8601 duration or a Temporal-style "30 minutes" string. */
  timeout?: string
}): Promise<{
  success: boolean
  publishedUrl?: string
  deployedAt?: string
  error?: string
}> {
  // Best-effort timeout parser: supports "<n> minutes" / "<n> seconds"
  // / "<n>m" / "<n>s". Defaults to 30 minutes.
  const parseTimeoutMs = (s: string): number => {
    const m = s.match(/^(\d+)\s*(minutes?|seconds?|m|s)$/i)
    if (!m) return 30 * 60 * 1000
    const n = Number(m[1])
    const unit = m[2]?.toLowerCase() ?? 'm'
    return unit.startsWith('s') ? n * 1000 : n * 60 * 1000
  }

  const timeoutMs = parseTimeoutMs(params.timeout || '30 minutes')
  const pollIntervalMs = 10_000
  const deadline = Date.now() + timeoutMs

  // Lazy import to avoid pulling backend into the workflow bundle.
  // The repository name is the canonical state-audit log surface; if
  // it's unavailable we fall back to a no-op success after a short
  // grace period so the workflow doesn't hard-fail in environments
  // where the audit log isn't wired up.
  let stateAuditLogRepository: {
    findRecent?: (filter: {
      websiteId?: string
      entityId?: string
      to?: string
      limit?: number
    }) => Promise<Array<{ to: string; metadata?: Record<string, unknown>; created_at: string }>>
  } = {}

  try {
    const backend = (await import('@swarm-press/backend')) as Record<string, unknown>
    if (backend.stateAuditLogRepository) {
      stateAuditLogRepository = backend.stateAuditLogRepository as typeof stateAuditLogRepository
    }
  } catch (err) {
    console.warn(`[waitForDeployment] backend import failed: ${err instanceof Error ? err.message : err}`)
  }

  // If we have no way to observe deploy events, surface that — don't
  // silently claim success.
  if (!stateAuditLogRepository.findRecent) {
    console.warn(
      '[waitForDeployment] state_audit_log not available; cannot observe deployment_status webhook. ' +
        'Returning success=false so the workflow surfaces the gap rather than guessing.'
    )
    return {
      success: false,
      error:
        'Cannot observe deployment_status webhook: stateAuditLogRepository.findRecent not available. ' +
        'Confirm WS4 webhook handler is wired and the audit log repo is exported from @swarm-press/backend.',
    }
  }

  while (Date.now() < deadline) {
    try {
      const events = await stateAuditLogRepository.findRecent({
        websiteId: params.websiteId,
        entityId: params.contentId,
        to: 'deployed',
        limit: 1,
      })

      if (events && events.length > 0 && events[0]) {
        const evt = events[0]
        const url = (evt.metadata?.url as string | undefined) || undefined
        return {
          success: true,
          publishedUrl: url,
          deployedAt: evt.created_at,
        }
      }
    } catch (err) {
      console.warn(
        `[waitForDeployment] poll failed: ${err instanceof Error ? err.message : err}`
      )
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
  }

  return {
    success: false,
    error: `Timed out after ${params.timeout || '30 minutes'} waiting for deployment_status webhook`,
  }
}

/**
 * Clean up build artifacts
 *
 * @deprecated Repo-canonical migration: build artifacts now live inside
 * the site repo's GitHub Actions runner, not on the platform's
 * filesystem. Retained for backward compat with existing callers.
 */
export async function cleanBuildArtifactsActivity(params: {
  websiteId: string
}): Promise<{ success: boolean; error?: string }> {
  const website = await websiteRepository.findById(params.websiteId) as WebsiteWithGitHub | null
  if (!website) {
    return { success: false, error: `Website ${params.websiteId} not found` }
  }

  if (!website.github_owner || !website.github_repo) {
    return { success: false, error: 'Website not connected to GitHub' }
  }

  try {
    const { cleanGitHubBuildDir } = await import('@swarm-press/site-builder')
    await cleanGitHubBuildDir(website.github_owner, website.github_repo)

    console.log(`[SiteBuild] Cleaned build artifacts for ${website.github_owner}/${website.github_repo}`)

    return { success: true }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error'
    return { success: false, error: errorMsg }
  }
}
