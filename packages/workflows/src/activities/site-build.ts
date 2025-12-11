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
 * Clean up build artifacts
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
