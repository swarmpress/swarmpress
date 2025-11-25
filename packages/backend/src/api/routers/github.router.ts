/**
 * GitHub Router
 * API endpoints for GitHub integration and sync
 */

import { z } from 'zod'
import { router, publicProcedure } from '../trpc'
import { TRPCError } from '@trpc/server'
import { GitHubService, parseGitHubUrl } from '../../services/github.service'
import { GitHubSyncService } from '../../services/github-sync.service'
import { websiteRepository } from '../../db/repositories'
import { randomBytes } from 'crypto'

import { createHmac } from 'crypto'

// Store pending OAuth states (in production, use Redis or database)
const pendingOAuthStates = new Map<string, { websiteId: string; expiresAt: number }>()

/**
 * Create a signed state that encodes websiteId + expiration
 * This is a stateless approach that doesn't require server-side storage
 */
function createSignedState(websiteId: string): string {
  const secret = process.env.API_SECRET || 'swarmpress-dev-secret-key-change-in-production'
  const expiresAt = Date.now() + 10 * 60 * 1000 // 10 minutes
  const payload = JSON.stringify({ websiteId, expiresAt })
  const payloadBase64 = Buffer.from(payload).toString('base64url')
  const signature = createHmac('sha256', secret).update(payloadBase64).digest('base64url')
  return `${payloadBase64}.${signature}`
}

/**
 * Verify and decode a signed state
 */
function verifySignedState(state: string): { websiteId: string; expiresAt: number } | null {
  const secret = process.env.API_SECRET || 'swarmpress-dev-secret-key-change-in-production'
  const parts = state.split('.')
  if (parts.length !== 2) return null

  const [payloadBase64, signature] = parts
  const expectedSignature = createHmac('sha256', secret).update(payloadBase64).digest('base64url')

  if (signature !== expectedSignature) {
    console.log('[GitHub OAuth] Signature mismatch')
    return null
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadBase64, 'base64url').toString())
    return payload
  } catch {
    console.log('[GitHub OAuth] Failed to parse payload')
    return null
  }
}

export const githubRouter = router({
  /**
   * Get GitHub OAuth URL for connecting a repository
   * Uses 'repo' scope to allow read/write access to repositories
   */
  getRepoAuthUrl: publicProcedure
    .input(
      z.object({
        websiteId: z.string().uuid(),
      })
    )
    .query(async ({ input }) => {
      const clientId = process.env.GITHUB_CLIENT_ID
      if (!clientId) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'GitHub OAuth not configured. Set GITHUB_CLIENT_ID environment variable.',
        })
      }

      // Use signed state (stateless approach - no server-side storage needed)
      const state = createSignedState(input.websiteId)
      console.log(`[GitHub OAuth] Created signed state for website ${input.websiteId}`)

      const callbackUrl = process.env.GITHUB_REPO_CALLBACK_URL || 'http://localhost:3002/auth/github/repo-callback'
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: callbackUrl,
        scope: 'repo', // Full repo access for read/write
        state,
      })

      return {
        url: `https://github.com/login/oauth/authorize?${params.toString()}`,
        state,
      }
    }),

  /**
   * Handle GitHub OAuth callback for repository connection
   */
  handleRepoCallback: publicProcedure
    .input(
      z.object({
        code: z.string(),
        state: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      console.log(`[GitHub OAuth] Handling callback with state: ${input.state.substring(0, 20)}...`)

      // Verify signed state (stateless approach)
      const stateData = verifySignedState(input.state)
      if (!stateData) {
        console.log('[GitHub OAuth] Invalid state signature')
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Invalid OAuth state',
        })
      }

      if (stateData.expiresAt < Date.now()) {
        console.log('[GitHub OAuth] State expired')
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'OAuth state expired',
        })
      }

      console.log(`[GitHub OAuth] State verified for website ${stateData.websiteId}`)

      const clientId = process.env.GITHUB_CLIENT_ID
      const clientSecret = process.env.GITHUB_CLIENT_SECRET

      if (!clientId || !clientSecret) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'GitHub OAuth not configured',
        })
      }

      console.log('[GitHub OAuth] Exchanging code for token...')

      // Exchange code for token
      const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code: input.code,
        }),
      })

      const tokenData = await tokenResponse.json()
      console.log('[GitHub OAuth] Token response:', tokenData.error || 'success')

      if (tokenData.error) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `GitHub OAuth error: ${tokenData.error_description || tokenData.error}`,
        })
      }

      const accessToken = tokenData.access_token
      console.log('[GitHub OAuth] Got access token, fetching user info...')

      // Get user's repositories to let them choose
      const { Octokit } = await import('@octokit/rest')
      const octokit = new Octokit({ auth: accessToken })

      // Get user info
      const { data: user } = await octokit.rest.users.getAuthenticated()
      console.log('[GitHub OAuth] User:', user.login)

      // Get repositories (user's own + orgs they have access to)
      console.log('[GitHub OAuth] Fetching repositories...')
      const { data: repos } = await octokit.rest.repos.listForAuthenticatedUser({
        sort: 'updated',
        per_page: 100,
        affiliation: 'owner,collaborator,organization_member',
      })
      console.log(`[GitHub OAuth] Found ${repos.length} repositories`)

      return {
        success: true,
        websiteId: stateData.websiteId,
        accessToken, // Return token to store with website
        user: {
          login: user.login,
          avatar_url: user.avatar_url,
        },
        repositories: repos.map((repo) => ({
          id: repo.id,
          full_name: repo.full_name,
          name: repo.name,
          owner: repo.owner.login,
          private: repo.private,
          url: repo.html_url,
          default_branch: repo.default_branch,
          permissions: repo.permissions,
        })),
      }
    }),

  /**
   * Connect a repository to a website (after OAuth flow)
   */
  connectRepository: publicProcedure
    .input(
      z.object({
        websiteId: z.string().uuid(),
        repoFullName: z.string(), // e.g., "owner/repo"
        accessToken: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const [owner, repo] = input.repoFullName.split('/')

      if (!owner || !repo) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Invalid repository name',
        })
      }

      // Verify token has access to repo
      const github = new GitHubService({
        owner,
        repo,
        token: input.accessToken,
      })

      const permissions = await github.verifyPermissions()
      if (!permissions.hasAccess) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Token does not have push access to this repository',
        })
      }

      const repoInfo = await github.getRepositoryInfo()

      // Update website with GitHub connection
      // Note: In production, encrypt the access token before storing
      await websiteRepository.update(input.websiteId, {
        github_repo_url: repoInfo.htmlUrl,
        github_owner: owner,
        github_repo: repo,
        github_access_token: input.accessToken, // Store token for this website
        github_connected_at: new Date().toISOString(),
      })

      return {
        success: true,
        repository: repoInfo,
      }
    }),

  /**
   * Verify GitHub repository access
   */
  verifyAccess: publicProcedure
    .input(
      z.object({
        repoUrl: z.string(),
        token: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const parsed = parseGitHubUrl(input.repoUrl)

      if (!parsed) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Invalid GitHub repository URL',
        })
      }

      try {
        const github = new GitHubService({
          owner: parsed.owner,
          repo: parsed.repo,
          token: input.token,
        })

        const permissions = await github.verifyPermissions()
        const repoInfo = await github.getRepositoryInfo()

        return {
          hasAccess: permissions.hasAccess,
          permissions: permissions.permissions,
          repository: repoInfo,
        }
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to verify repository access',
        })
      }
    }),

  /**
   * Sync sitemap to GitHub
   */
  syncSitemap: publicProcedure
    .input(
      z.object({
        websiteId: z.string().uuid(),
        createPR: z.boolean().optional(),
        prTitle: z.string().optional(),
        prBody: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      // Get website to retrieve GitHub config
      const website = await websiteRepository.findById(input.websiteId)

      if (!website) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Website not found',
        })
      }

      if (!website.github_repo_url) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Website does not have GitHub repository configured',
        })
      }

      // Parse GitHub URL
      const parsed = parseGitHubUrl(website.github_repo_url)

      if (!parsed) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Invalid GitHub repository URL',
        })
      }

      // Get GitHub token from environment
      const token = process.env.GITHUB_TOKEN

      if (!token) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'GitHub token not configured',
        })
      }

      try {
        const syncService = new GitHubSyncService({
          owner: parsed.owner,
          repo: parsed.repo,
          token,
        })

        const result = await syncService.syncSitemapToGitHub({
          websiteId: input.websiteId,
          githubConfig: {
            owner: parsed.owner,
            repo: parsed.repo,
            token,
          },
          createPR: input.createPR,
          prTitle: input.prTitle,
          prBody: input.prBody,
        })

        if (!result.success) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: result.error || 'Sync failed',
          })
        }

        return result
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to sync sitemap',
        })
      }
    }),

  /**
   * Import sitemap from GitHub
   */
  importSitemap: publicProcedure
    .input(z.object({ websiteId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const website = await websiteRepository.findById(input.websiteId)

      if (!website || !website.github_repo_url) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Website does not have GitHub repository configured',
        })
      }

      const parsed = parseGitHubUrl(website.github_repo_url)

      if (!parsed) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Invalid GitHub repository URL',
        })
      }

      const token = process.env.GITHUB_TOKEN

      if (!token) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'GitHub token not configured',
        })
      }

      try {
        const syncService = new GitHubSyncService({
          owner: parsed.owner,
          repo: parsed.repo,
          token,
        })

        const result = await syncService.importSitemapFromGitHub(input.websiteId)

        return result
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to import sitemap',
        })
      }
    }),

  /**
   * Get sync status
   */
  getSyncStatus: publicProcedure
    .input(z.object({ websiteId: z.string().uuid() }))
    .query(async ({ input }) => {
      const website = await websiteRepository.findById(input.websiteId)

      if (!website || !website.github_repo_url) {
        return {
          configured: false,
          inSync: false,
          localPages: 0,
          remotePages: 0,
          conflicts: [],
        }
      }

      const parsed = parseGitHubUrl(website.github_repo_url)

      if (!parsed) {
        return {
          configured: false,
          inSync: false,
          localPages: 0,
          remotePages: 0,
          conflicts: ['Invalid repository URL'],
        }
      }

      const token = process.env.GITHUB_TOKEN

      if (!token) {
        return {
          configured: false,
          inSync: false,
          localPages: 0,
          remotePages: 0,
          conflicts: ['GitHub token not configured'],
        }
      }

      try {
        const syncService = new GitHubSyncService({
          owner: parsed.owner,
          repo: parsed.repo,
          token,
        })

        const status = await syncService.getSyncStatus(input.websiteId)

        return {
          configured: true,
          ...status,
        }
      } catch (error) {
        return {
          configured: true,
          inSync: false,
          localPages: 0,
          remotePages: 0,
          conflicts: [error instanceof Error ? error.message : 'Failed to get sync status'],
        }
      }
    }),

  /**
   * Create content change PR
   */
  createContentPR: publicProcedure
    .input(
      z.object({
        websiteId: z.string().uuid(),
        pageIds: z.array(z.string().uuid()),
        title: z.string(),
        description: z.string(),
        agentId: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const website = await websiteRepository.findById(input.websiteId)

      if (!website || !website.github_repo_url) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Website does not have GitHub repository configured',
        })
      }

      const parsed = parseGitHubUrl(website.github_repo_url)

      if (!parsed) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Invalid GitHub repository URL',
        })
      }

      const token = process.env.GITHUB_TOKEN

      if (!token) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'GitHub token not configured',
        })
      }

      try {
        const syncService = new GitHubSyncService({
          owner: parsed.owner,
          repo: parsed.repo,
          token,
        })

        const result = await syncService.createContentChangePR({
          websiteId: input.websiteId,
          pageIds: input.pageIds,
          title: input.title,
          description: input.description,
          agentId: input.agentId,
        })

        return result
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to create PR',
        })
      }
    }),

  /**
   * Sync blueprints to GitHub
   */
  syncBlueprints: publicProcedure
    .input(
      z.object({
        repoUrl: z.string(),
        createPR: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const parsed = parseGitHubUrl(input.repoUrl)

      if (!parsed) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Invalid GitHub repository URL',
        })
      }

      const token = process.env.GITHUB_TOKEN

      if (!token) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'GitHub token not configured',
        })
      }

      try {
        const syncService = new GitHubSyncService({
          owner: parsed.owner,
          repo: parsed.repo,
          token,
        })

        const result = await syncService.syncBlueprintsToGitHub({
          githubConfig: {
            owner: parsed.owner,
            repo: parsed.repo,
            token,
          },
          createPR: input.createPR,
        })

        if (!result.success) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: result.error || 'Sync failed',
          })
        }

        return result
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to sync blueprints',
        })
      }
    }),
})
