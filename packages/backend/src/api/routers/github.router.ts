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

  // ============================================================================
  // GITHUB PAGES DEPLOYMENT
  // ============================================================================

  /**
   * Enable GitHub Pages for a website's repository
   */
  enablePages: publicProcedure
    .input(
      z.object({
        websiteId: z.string().uuid(),
        branch: z.enum(['gh-pages', 'main']).default('gh-pages'),
        path: z.enum(['/', '/docs']).default('/'),
      })
    )
    .mutation(async ({ input }) => {
      const website = await websiteRepository.findById(input.websiteId)

      if (!website) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Website not found',
        })
      }

      if (!website.github_owner || !website.github_repo || !website.github_access_token) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Website is not connected to a GitHub repository',
        })
      }

      const { Octokit } = await import('@octokit/rest')
      const octokit = new Octokit({ auth: website.github_access_token })

      try {
        // First, ensure the branch exists (for gh-pages)
        if (input.branch === 'gh-pages') {
          try {
            await octokit.rest.repos.getBranch({
              owner: website.github_owner,
              repo: website.github_repo,
              branch: 'gh-pages',
            })
          } catch (e: any) {
            if (e.status === 404) {
              // Create gh-pages branch from default branch
              const { data: repo } = await octokit.rest.repos.get({
                owner: website.github_owner,
                repo: website.github_repo,
              })

              const { data: ref } = await octokit.rest.git.getRef({
                owner: website.github_owner,
                repo: website.github_repo,
                ref: `heads/${repo.default_branch}`,
              })

              await octokit.rest.git.createRef({
                owner: website.github_owner,
                repo: website.github_repo,
                ref: 'refs/heads/gh-pages',
                sha: ref.object.sha,
              })
            } else {
              throw e
            }
          }
        }

        // Enable GitHub Pages
        await octokit.rest.repos.createPagesSite({
          owner: website.github_owner,
          repo: website.github_repo,
          source: {
            branch: input.branch,
            path: input.path as '/' | '/docs',
          },
        })

        // Get the Pages URL
        const { data: pages } = await octokit.rest.repos.getPages({
          owner: website.github_owner,
          repo: website.github_repo,
        })

        // Update website with Pages config
        await websiteRepository.update(input.websiteId, {
          github_pages_enabled: true,
          github_pages_url: pages.html_url,
          github_pages_branch: input.branch,
          github_pages_path: input.path,
          deployment_status: 'never_deployed',
        })

        return {
          success: true,
          pagesUrl: pages.html_url,
          branch: input.branch,
          path: input.path,
        }
      } catch (error: any) {
        // Pages might already be enabled
        if (error.status === 409) {
          const { data: pages } = await octokit.rest.repos.getPages({
            owner: website.github_owner,
            repo: website.github_repo,
          })

          await websiteRepository.update(input.websiteId, {
            github_pages_enabled: true,
            github_pages_url: pages.html_url,
            github_pages_branch: input.branch,
            github_pages_path: input.path,
          })

          return {
            success: true,
            pagesUrl: pages.html_url,
            branch: input.branch,
            path: input.path,
            alreadyEnabled: true,
          }
        }

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message || 'Failed to enable GitHub Pages',
        })
      }
    }),

  /**
   * Deploy files to GitHub Pages
   * Creates a commit with the provided files and pushes to the Pages branch
   */
  deployToPages: publicProcedure
    .input(
      z.object({
        websiteId: z.string().uuid(),
        files: z.array(
          z.object({
            path: z.string(),
            content: z.string(),
          })
        ),
        commitMessage: z.string().default('Deploy site'),
      })
    )
    .mutation(async ({ input }) => {
      const website = await websiteRepository.findById(input.websiteId)

      if (!website) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Website not found',
        })
      }

      if (!website.github_owner || !website.github_repo || !website.github_access_token) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Website is not connected to a GitHub repository',
        })
      }

      if (!website.github_pages_enabled) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'GitHub Pages is not enabled for this website',
        })
      }

      // Update status to deploying
      await websiteRepository.update(input.websiteId, {
        deployment_status: 'deploying',
        deployment_error: null,
      })

      const { Octokit } = await import('@octokit/rest')
      const octokit = new Octokit({ auth: website.github_access_token })

      const branch = website.github_pages_branch || 'gh-pages'
      const basePath = website.github_pages_path === '/docs' ? 'docs/' : ''

      try {
        // Get the current commit SHA for the branch
        const { data: ref } = await octokit.rest.git.getRef({
          owner: website.github_owner,
          repo: website.github_repo,
          ref: `heads/${branch}`,
        })

        const latestCommitSha = ref.object.sha

        // Get the tree SHA for the commit
        const { data: commit } = await octokit.rest.git.getCommit({
          owner: website.github_owner,
          repo: website.github_repo,
          commit_sha: latestCommitSha,
        })

        // Create blobs for each file
        const blobs = await Promise.all(
          input.files.map(async (file) => {
            const { data: blob } = await octokit.rest.git.createBlob({
              owner: website.github_owner!,
              repo: website.github_repo!,
              content: Buffer.from(file.content).toString('base64'),
              encoding: 'base64',
            })
            return {
              path: basePath + file.path,
              mode: '100644' as const,
              type: 'blob' as const,
              sha: blob.sha,
            }
          })
        )

        // Create a new tree
        const { data: tree } = await octokit.rest.git.createTree({
          owner: website.github_owner,
          repo: website.github_repo,
          base_tree: commit.tree.sha,
          tree: blobs,
        })

        // Create a new commit
        const { data: newCommit } = await octokit.rest.git.createCommit({
          owner: website.github_owner,
          repo: website.github_repo,
          message: input.commitMessage,
          tree: tree.sha,
          parents: [latestCommitSha],
        })

        // Update the branch reference
        await octokit.rest.git.updateRef({
          owner: website.github_owner,
          repo: website.github_repo,
          ref: `heads/${branch}`,
          sha: newCommit.sha,
        })

        // Update website with deployment info
        await websiteRepository.update(input.websiteId, {
          deployment_status: 'deployed',
          last_deployed_at: new Date().toISOString(),
          deployment_error: null,
        })

        return {
          success: true,
          commitSha: newCommit.sha,
          filesDeployed: input.files.length,
          pagesUrl: website.github_pages_url,
        }
      } catch (error: any) {
        // Update status to failed
        await websiteRepository.update(input.websiteId, {
          deployment_status: 'failed',
          deployment_error: error.message || 'Deployment failed',
        })

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message || 'Failed to deploy to GitHub Pages',
        })
      }
    }),

  /**
   * Get deployment status for a website
   */
  getDeploymentStatus: publicProcedure
    .input(z.object({ websiteId: z.string().uuid() }))
    .query(async ({ input }) => {
      const website = await websiteRepository.findById(input.websiteId)

      if (!website) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Website not found',
        })
      }

      // Only try to get Pages status from GitHub if we have stored that Pages is enabled
      // AND we have a valid access token
      if (website.github_pages_enabled && website.github_access_token && website.github_owner && website.github_repo) {
        try {
          const { Octokit } = await import('@octokit/rest')
          const octokit = new Octokit({ auth: website.github_access_token })

          const { data: pages } = await octokit.rest.repos.getPages({
            owner: website.github_owner,
            repo: website.github_repo,
          })

          // Get latest build
          let latestBuild = null
          try {
            const { data: builds } = await octokit.rest.repos.listPagesBuilds({
              owner: website.github_owner,
              repo: website.github_repo,
              per_page: 1,
            })
            latestBuild = builds[0] || null
          } catch {
            // Builds may not exist yet
          }

          return {
            configured: true,
            pagesEnabled: true,
            pagesUrl: pages.html_url,
            customDomain: pages.cname,
            status: website.deployment_status || 'never_deployed',
            lastDeployedAt: website.last_deployed_at,
            error: website.deployment_error,
            latestBuild: latestBuild
              ? {
                  status: latestBuild.status,
                  createdAt: latestBuild.created_at,
                  duration: latestBuild.duration,
                  error: latestBuild.error?.message,
                }
              : null,
          }
        } catch (error: any) {
          // If Pages is not found (404), update database to reflect reality
          if (error.status === 404) {
            console.log('[GitHub] Pages not enabled on repo, updating database')
            await websiteRepository.update(input.websiteId, {
              github_pages_enabled: false,
              github_pages_url: null,
            })
          }
          // Fall back to database info below
        }
      }

      // Return status from database (or defaults if not set)
      return {
        configured: !!(website.github_repo_url && website.github_owner && website.github_repo),
        pagesEnabled: Boolean(website.github_pages_enabled),
        pagesUrl: website.github_pages_url || null,
        customDomain: website.github_pages_custom_domain || null,
        status: website.deployment_status || 'never_deployed',
        lastDeployedAt: website.last_deployed_at || null,
        error: website.deployment_error || null,
        latestBuild: null,
      }
    }),

  /**
   * Set custom domain for GitHub Pages
   */
  setCustomDomain: publicProcedure
    .input(
      z.object({
        websiteId: z.string().uuid(),
        domain: z.string().nullable(), // null to remove custom domain
      })
    )
    .mutation(async ({ input }) => {
      const website = await websiteRepository.findById(input.websiteId)

      if (!website) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Website not found',
        })
      }

      if (!website.github_owner || !website.github_repo || !website.github_access_token) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Website is not connected to a GitHub repository',
        })
      }

      if (!website.github_pages_enabled) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'GitHub Pages is not enabled for this website',
        })
      }

      const { Octokit } = await import('@octokit/rest')
      const octokit = new Octokit({ auth: website.github_access_token })

      try {
        if (input.domain) {
          // Set custom domain
          await octokit.rest.repos.updateInformationAboutPagesSite({
            owner: website.github_owner,
            repo: website.github_repo,
            cname: input.domain,
          })
        } else {
          // Remove custom domain
          await octokit.rest.repos.updateInformationAboutPagesSite({
            owner: website.github_owner,
            repo: website.github_repo,
            cname: '',
          })
        }

        // Update database
        await websiteRepository.update(input.websiteId, {
          github_pages_custom_domain: input.domain,
        })

        return {
          success: true,
          customDomain: input.domain,
          dnsInstructions: input.domain
            ? {
                type: 'CNAME',
                name: input.domain,
                value: `${website.github_owner}.github.io`,
                note: 'Add this DNS record to your domain provider',
              }
            : null,
        }
      } catch (error: any) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error.message || 'Failed to set custom domain',
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
