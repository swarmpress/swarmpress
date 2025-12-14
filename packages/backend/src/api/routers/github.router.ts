/**
 * GitHub Router
 * API endpoints for GitHub integration and sync
 */

import { z } from 'zod'
import { router, publicProcedure } from '../trpc'
import { TRPCError } from '@trpc/server'
import { GitHubService, parseGitHubUrl } from '../../services/github.service'
import { GitHubSyncService } from '../../services/github-sync.service'
import { GitHubContentService } from '@swarm-press/github-integration'
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
        // Prepare files to deploy, including CNAME for custom domain
        const filesToDeploy = [...input.files]

        // Add CNAME file for custom domain (required for GitHub Pages custom domains)
        const customDomain = website.github_pages_custom_domain || website.domain
        if (customDomain && !customDomain.includes('github.io')) {
          // Remove any existing CNAME file from input to avoid duplicates
          const cnameIndex = filesToDeploy.findIndex(f => f.path === 'CNAME')
          if (cnameIndex !== -1) {
            filesToDeploy.splice(cnameIndex, 1)
          }
          filesToDeploy.push({
            path: 'CNAME',
            content: customDomain,
          })
          console.log(`[GitHub Pages] Adding CNAME file for custom domain: ${customDomain}`)
        }

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
          filesToDeploy.map(async (file) => {
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
          filesDeployed: filesToDeploy.length,
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

  // ============================================================================
  // REPOSITORY SETUP FOR SWARM.PRESS WEBSITES
  // ============================================================================

  /**
   * Setup a GitHub repository for swarm.press website
   * Creates labels, issue templates, PR templates, enables Pages, and adds CNAME
   */
  setupRepository: publicProcedure
    .input(
      z.object({
        websiteId: z.string().uuid(),
        enablePages: z.boolean().default(true),
        createLabels: z.boolean().default(true),
        createTemplates: z.boolean().default(true),
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

      const results: {
        labels: { created: string[]; skipped: string[] }
        templates: { created: string[]; skipped: string[] }
        pages: { enabled: boolean; url?: string }
        cname: { created: boolean }
      } = {
        labels: { created: [], skipped: [] },
        templates: { created: [], skipped: [] },
        pages: { enabled: false },
        cname: { created: false },
      }

      // ========================================
      // 1. CREATE WORKFLOW LABELS
      // ========================================
      if (input.createLabels) {
        const labels = [
          // Content workflow states
          { name: 'content:idea', color: 'e6e6e6', description: 'Content idea - not yet planned' },
          { name: 'content:planned', color: 'fbca04', description: 'Content planned for production' },
          { name: 'content:draft', color: 'fef2c0', description: 'Content in draft state' },
          { name: 'content:in-review', color: 'f9a825', description: 'Content under editorial review' },
          { name: 'content:needs-changes', color: 'e65100', description: 'Content requires revisions' },
          { name: 'content:approved', color: '2e7d32', description: 'Content approved by editor' },
          { name: 'content:scheduled', color: '1565c0', description: 'Content scheduled for publishing' },
          { name: 'content:published', color: '0d47a1', description: 'Content is live' },
          // Task types
          { name: 'task', color: 'bdbdbd', description: 'Work assignment for an agent' },
          { name: 'task:write', color: '90caf9', description: 'Writing task' },
          { name: 'task:review', color: 'ce93d8', description: 'Review task' },
          { name: 'task:seo', color: 'a5d6a7', description: 'SEO optimization task' },
          { name: 'task:media', color: 'ffcc80', description: 'Media/image task' },
          { name: 'task:publish', color: '80deea', description: 'Publishing task' },
          // Escalations
          { name: 'question-ticket', color: '7b1fa2', description: 'Escalation to CEO or Editor' },
          { name: 'high-risk', color: 'd32f2f', description: 'High-risk content requiring CEO approval' },
          { name: 'blocked', color: 'b71c1c', description: 'Workflow blocked - needs attention' },
          // Agents
          { name: 'agent:writer', color: '4fc3f7', description: 'Assigned to WriterAgent' },
          { name: 'agent:editor', color: 'ba68c8', description: 'Assigned to EditorAgent' },
          { name: 'agent:seo', color: '81c784', description: 'Assigned to SEO Agent' },
          { name: 'agent:engineering', color: '90a4ae', description: 'Assigned to EngineeringAgent' },
          { name: 'agent:ceo', color: 'ffb74d', description: 'Requires CEO attention' },
        ]

        for (const label of labels) {
          try {
            await octokit.rest.issues.createLabel({
              owner: website.github_owner,
              repo: website.github_repo,
              name: label.name,
              color: label.color,
              description: label.description,
            })
            results.labels.created.push(label.name)
          } catch (error: any) {
            if (error.status === 422) {
              // Label already exists
              results.labels.skipped.push(label.name)
            } else {
              console.error(`Failed to create label ${label.name}:`, error.message)
            }
          }
        }
      }

      // ========================================
      // 2. CREATE ISSUE TEMPLATES
      // ========================================
      if (input.createTemplates) {
        const templates = [
          {
            path: '.github/ISSUE_TEMPLATE/question-ticket.md',
            content: `---
name: Question Ticket (Escalation)
about: Escalate a question or decision to the CEO or Chief Editor
title: '[QUESTION] '
labels: question-ticket
assignees: ''
---

## 🎫 Question Ticket

**Created by Agent:** <!-- agent name -->
**Target:** <!-- CEO / Chief Editor -->
**Priority:** <!-- low / medium / high / critical -->

---

### Context
<!-- Describe the situation that led to this escalation -->

### Question
<!-- What specific question or decision needs to be made? -->

### Options Considered
<!-- List any options you've considered -->
1.
2.
3.

### Recommendation
<!-- Your recommended course of action, if any -->

### Related Content
<!-- Link to related PRs, issues, or content items -->

---
*This ticket was created by a swarm.press agent following the escalation workflow.*
`,
          },
          {
            path: '.github/ISSUE_TEMPLATE/task.md',
            content: `---
name: Task
about: Create a task for an agent
title: '[TASK] '
labels: task
assignees: ''
---

## 📋 Task

**Type:** <!-- write / review / seo / media / publish -->
**Assigned Agent:** <!-- WriterAgent / EditorAgent / etc. -->
**Priority:** <!-- low / medium / high -->
**Due:** <!-- optional deadline -->

---

### Description
<!-- What needs to be done? -->

### Acceptance Criteria
- [ ]
- [ ]
- [ ]

### Related Content
<!-- Link to related PRs, issues, or content items -->

### Notes
<!-- Any additional context -->

---
*This task is part of the swarm.press workflow system.*
`,
          },
          {
            path: '.github/ISSUE_TEMPLATE/content-idea.md',
            content: `---
name: Content Idea
about: Propose a new content piece
title: '[IDEA] '
labels: content:idea
assignees: ''
---

## 💡 Content Idea

**Proposed by:** <!-- agent or human -->
**Content Type:** <!-- article / guide / review / etc. -->
**Target Audience:** <!-- who is this for? -->

---

### Topic
<!-- What is this content about? -->

### Why This Matters
<!-- Why should we create this content? -->

### Key Points to Cover
1.
2.
3.

### SEO Considerations
- **Target Keywords:**
- **Search Intent:**

### Resources / References
<!-- Any research or sources to consider -->

---
*Content ideas are reviewed by the Editorial team before production.*
`,
          },
          {
            path: '.github/ISSUE_TEMPLATE/config.yml',
            content: `blank_issues_enabled: true
contact_links:
  - name: swarm.press Documentation
    url: https://github.com/your-org/swarm-press
    about: Learn more about the swarm.press publishing system
`,
          },
        ]

        // Get the default branch
        const { data: repo } = await octokit.rest.repos.get({
          owner: website.github_owner,
          repo: website.github_repo,
        })
        const defaultBranch = repo.default_branch

        for (const template of templates) {
          try {
            // Check if file exists
            let sha: string | undefined
            try {
              const existing = await octokit.rest.repos.getContent({
                owner: website.github_owner,
                repo: website.github_repo,
                path: template.path,
                ref: defaultBranch,
              })
              if ('sha' in existing.data) {
                sha = existing.data.sha
                results.templates.skipped.push(template.path)
                continue // Skip if exists
              }
            } catch (e: any) {
              if (e.status !== 404) throw e
            }

            // Create file
            await octokit.rest.repos.createOrUpdateFileContents({
              owner: website.github_owner,
              repo: website.github_repo,
              path: template.path,
              message: `chore: add ${template.path.split('/').pop()} template`,
              content: Buffer.from(template.content).toString('base64'),
              branch: defaultBranch,
            })
            results.templates.created.push(template.path)
          } catch (error: any) {
            console.error(`Failed to create template ${template.path}:`, error.message)
          }
        }

        // Create PR template
        const prTemplate = {
          path: '.github/PULL_REQUEST_TEMPLATE.md',
          content: `## 📝 Content Change

**Content Type:** <!-- article / page / media / template -->
**Author Agent:** <!-- WriterAgent / etc. -->
**Status:** <!-- draft / ready-for-review -->

---

### Summary
<!-- Brief description of the changes -->

### Content Checklist

#### Writer
- [ ] Content follows editorial guidelines
- [ ] Factual accuracy verified
- [ ] Links are valid
- [ ] Images have alt text

#### Editor Review
- [ ] Tone and style consistent
- [ ] Structure is clear
- [ ] No grammatical errors
- [ ] SEO metadata complete

#### Technical
- [ ] Valid JSON block structure
- [ ] No broken references
- [ ] Renders correctly

---

### Related Issues
<!-- Link any related issues or tasks -->
Closes #

### Screenshots
<!-- If applicable, add screenshots -->

---
*This PR was created as part of the swarm.press content workflow.*
`,
        }

        try {
          let prTemplateExists = false
          try {
            await octokit.rest.repos.getContent({
              owner: website.github_owner,
              repo: website.github_repo,
              path: prTemplate.path,
              ref: defaultBranch,
            })
            prTemplateExists = true
            results.templates.skipped.push(prTemplate.path)
          } catch (e: any) {
            if (e.status !== 404) throw e
          }

          if (!prTemplateExists) {
            await octokit.rest.repos.createOrUpdateFileContents({
              owner: website.github_owner,
              repo: website.github_repo,
              path: prTemplate.path,
              message: 'chore: add pull request template',
              content: Buffer.from(prTemplate.content).toString('base64'),
              branch: defaultBranch,
            })
            results.templates.created.push(prTemplate.path)
          }
        } catch (error: any) {
          console.error('Failed to create PR template:', error.message)
        }
      }

      // ========================================
      // 3. ENABLE GITHUB PAGES
      // ========================================
      if (input.enablePages) {
        try {
          // First, ensure gh-pages branch exists
          try {
            await octokit.rest.repos.getBranch({
              owner: website.github_owner,
              repo: website.github_repo,
              branch: 'gh-pages',
            })
          } catch (e: any) {
            if (e.status === 404) {
              // Create gh-pages branch
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
            }
          }

          // Enable GitHub Pages
          try {
            await octokit.rest.repos.createPagesSite({
              owner: website.github_owner,
              repo: website.github_repo,
              source: {
                branch: 'gh-pages',
                path: '/',
              },
            })
          } catch (e: any) {
            // Pages might already be enabled (409 conflict)
            if (e.status !== 409) throw e
          }

          // Get Pages URL
          const { data: pages } = await octokit.rest.repos.getPages({
            owner: website.github_owner,
            repo: website.github_repo,
          })

          results.pages.enabled = true
          results.pages.url = pages.html_url

          // Update website record
          await websiteRepository.update(input.websiteId, {
            github_pages_enabled: true,
            github_pages_url: pages.html_url,
            github_pages_branch: 'gh-pages',
            github_pages_path: '/',
          })

          // ========================================
          // 4. CREATE CNAME FILE FOR CUSTOM DOMAIN
          // ========================================
          if (website.domain && !website.domain.includes('github.io')) {
            try {
              // Check if CNAME exists on gh-pages
              let cnameExists = false
              try {
                await octokit.rest.repos.getContent({
                  owner: website.github_owner,
                  repo: website.github_repo,
                  path: 'CNAME',
                  ref: 'gh-pages',
                })
                cnameExists = true
              } catch (e: any) {
                if (e.status !== 404) throw e
              }

              if (!cnameExists) {
                await octokit.rest.repos.createOrUpdateFileContents({
                  owner: website.github_owner,
                  repo: website.github_repo,
                  path: 'CNAME',
                  message: `chore: add CNAME for ${website.domain}`,
                  content: Buffer.from(website.domain).toString('base64'),
                  branch: 'gh-pages',
                })
                results.cname.created = true

                // Also set custom domain via API
                await octokit.rest.repos.updateInformationAboutPagesSite({
                  owner: website.github_owner,
                  repo: website.github_repo,
                  cname: website.domain,
                })

                // Update website record
                await websiteRepository.update(input.websiteId, {
                  github_pages_custom_domain: website.domain,
                })
              }
            } catch (error: any) {
              console.error('Failed to create CNAME:', error.message)
            }
          }
        } catch (error: any) {
          console.error('Failed to enable GitHub Pages:', error.message)
        }
      }

      return {
        success: true,
        results,
        summary: {
          labelsCreated: results.labels.created.length,
          labelsSkipped: results.labels.skipped.length,
          templatesCreated: results.templates.created.length,
          templatesSkipped: results.templates.skipped.length,
          pagesEnabled: results.pages.enabled,
          pagesUrl: results.pages.url,
          cnameCreated: results.cname.created,
        },
      }
    }),

  // ============================================================================
  // COLLECTION OPERATIONS (GitHub as Source of Truth)
  // ============================================================================

  /**
   * List all collection types from GitHub repository
   * Discovers collections by finding _schema.json files in content/collections/
   */
  listCollectionTypes: publicProcedure
    .input(z.object({ websiteId: z.string().uuid() }))
    .query(async ({ input }) => {
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

      // Note: Content is on 'main' branch, not gh-pages (which is for built output)
      const contentService = new GitHubContentService({
        owner: website.github_owner,
        repo: website.github_repo,
        token: website.github_access_token,
        branch: 'main',
        contentPath: 'content/collections',
      })

      const types = await contentService.listCollectionTypes()
      return { types }
    }),

  /**
   * Get collection schema from GitHub
   */
  getCollectionSchema: publicProcedure
    .input(
      z.object({
        websiteId: z.string().uuid(),
        collectionType: z.string(),
      })
    )
    .query(async ({ input }) => {
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

      // Note: Content is on 'main' branch, not gh-pages (which is for built output)
      const contentService = new GitHubContentService({
        owner: website.github_owner,
        repo: website.github_repo,
        token: website.github_access_token,
        branch: 'main',
        contentPath: 'content/collections',
      })

      const schema = await contentService.getCollectionSchema(input.collectionType)

      if (!schema) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Collection schema not found for type: ${input.collectionType}`,
        })
      }

      // Destructure to separate schema type from other fields
      const { type: schemaType, ...schemaRest } = schema.content
      return {
        // Use folder name as the identifier for API calls
        type: input.collectionType,
        // Keep schema type for reference
        schema_type: schemaType,
        ...schemaRest,
      }
    }),

  /**
   * Get all collection schemas from GitHub (bulk operation)
   */
  getAllCollectionSchemas: publicProcedure
    .input(z.object({ websiteId: z.string().uuid() }))
    .query(async ({ input }) => {
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

      // Note: Content is on 'main' branch, not gh-pages (which is for built output)
      const contentService = new GitHubContentService({
        owner: website.github_owner,
        repo: website.github_repo,
        token: website.github_access_token,
        branch: 'main',
        contentPath: 'content/collections',
      })

      // Get all collection types (folder names)
      const folders = await contentService.listCollectionTypes()

      // Fetch all schemas in parallel
      const schemas = await Promise.all(
        folders.map(async (folder) => {
          const schema = await contentService.getCollectionSchema(folder)
          if (schema) {
            // Destructure to separate type from other fields
            const { type: schemaType, ...schemaRest } = schema.content
            return {
              // Use folder name as the identifier for API calls
              type: folder,
              // Keep schema type for display purposes
              schema_type: schemaType,
              ...schemaRest,
            }
          }
          return null
        })
      )

      return {
        collections: schemas.filter((s) => s !== null),
      }
    }),

  /**
   * List collection items from GitHub
   * Handles both individual and grouped item formats
   */
  listCollectionItems: publicProcedure
    .input(
      z.object({
        websiteId: z.string().uuid(),
        collectionType: z.string(),
      })
    )
    .query(async ({ input }) => {
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

      // Note: Content is on 'main' branch, not gh-pages (which is for built output)
      const contentService = new GitHubContentService({
        owner: website.github_owner,
        repo: website.github_repo,
        token: website.github_access_token,
        branch: 'main',
        contentPath: 'content/collections',
      })

      const rawItems = await contentService.listCollectionItems(input.collectionType)

      // Process items - handle grouped format (items[] array) and individual format
      const items: Array<{
        slug: string
        data: Record<string, unknown>
        published?: boolean
        featured?: boolean
        village?: string
        sourceFile: string
      }> = []

      for (const file of rawItems) {
        const content = file.content as Record<string, unknown>

        // Check if this is a grouped file (has items[] array)
        if (Array.isArray(content.items)) {
          const village = content.village as string | undefined
          for (const item of content.items as Array<Record<string, unknown>>) {
            items.push({
              slug: item.slug as string,
              data: item,
              published: (item.published as boolean) ?? true,
              featured: item.featured as boolean | undefined,
              village,
              sourceFile: file.path,
            })
          }
        } else if (content.slug && content.data) {
          // Individual item format
          items.push({
            slug: content.slug as string,
            data: content.data as Record<string, unknown>,
            published: content.published as boolean | undefined,
            featured: content.featured as boolean | undefined,
            sourceFile: file.path,
          })
        } else {
          // File is the item data itself
          const slug = file.path.split('/').pop()?.replace('.json', '') || 'unknown'
          items.push({
            slug,
            data: content,
            published: true,
            sourceFile: file.path,
          })
        }
      }

      return {
        items,
        total: items.length,
      }
    }),

  // ============================================================================
  // PAGE OPERATIONS (GitHub as Source of Truth)
  // ============================================================================

  /**
   * List all pages from GitHub repository
   * Recursively searches nested directories in content/pages/
   */
  listPages: publicProcedure
    .input(z.object({ websiteId: z.string().uuid() }))
    .query(async ({ input }) => {
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

      // Note: Content is on 'main' branch, not gh-pages (which is for built output)
      const contentService = new GitHubContentService({
        owner: website.github_owner,
        repo: website.github_repo,
        token: website.github_access_token,
        branch: 'main',
        pagesPath: 'content/pages',
      })

      const pageFiles = await contentService.listPages()

      // Transform page files into a consistent format
      const pages = pageFiles.map((file) => {
        const content = file.content as Record<string, unknown>
        // Extract path relative to content/pages for display
        const relativePath = file.path.replace('content/pages/', '').replace('.json', '')
        // Determine page type from directory structure (e.g., 'en', 'de', 'en/manarola')
        const pathParts = relativePath.split('/')
        const locale = pathParts[0] // First part is usually locale
        const pageType = pathParts.length > 2 ? pathParts[1] : 'page' // Second part might be village/category

        return {
          id: file.sha, // Use SHA as ID for now
          slug: content.slug as string || relativePath,
          title: extractLocalizedValue(content.title) || relativePath,
          description: extractLocalizedValue(content.description),
          page_type: content.page_type as string || pageType,
          template: content.template as string,
          status: content.status as string || 'published',
          locale,
          seo: content.seo as Record<string, unknown> | undefined,
          body: content.body as Array<Record<string, unknown>> | undefined,
          sourceFile: file.path,
          updated_at: content.updated_at as string || new Date().toISOString(),
          created_at: content.created_at as string || new Date().toISOString(),
        }
      })

      return {
        items: pages,
        total: pages.length,
      }
    }),

  /**
   * Get a single page from GitHub by path
   */
  getPage: publicProcedure
    .input(
      z.object({
        websiteId: z.string().uuid(),
        path: z.string(), // Relative path like 'en/manarola/index' or full path
      })
    )
    .query(async ({ input }) => {
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

      const contentService = new GitHubContentService({
        owner: website.github_owner,
        repo: website.github_repo,
        token: website.github_access_token,
        branch: 'main',
        pagesPath: 'content/pages',
      })

      // Normalize path - add content/pages prefix if not present
      let fullPath = input.path
      if (!fullPath.startsWith('content/pages/')) {
        fullPath = `content/pages/${fullPath}`
      }
      if (!fullPath.endsWith('.json')) {
        fullPath = `${fullPath}.json`
      }

      const pageFile = await contentService.getPageByPath(fullPath)

      if (!pageFile) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Page not found: ${input.path}`,
        })
      }

      return {
        ...pageFile.content,
        sourceFile: pageFile.path,
        sha: pageFile.sha,
      }
    }),

  // ============================================================
  // Site Definition (ReactFlow-based site editor)
  // ============================================================

  /**
   * Get site definition from GitHub
   * This contains the sitemap structure, content types, and agent config
   */
  getSiteDefinition: publicProcedure
    .input(
      z.object({
        websiteId: z.string().uuid(),
      })
    )
    .query(async ({ input }) => {
      const website = await websiteRepository.findById(input.websiteId)
      if (!website) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Website not found',
        })
      }

      if (!website.github_owner || !website.github_repo || !website.github_access_token) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Website not connected to GitHub',
        })
      }

      const contentService = new GitHubContentService({
        owner: website.github_owner,
        repo: website.github_repo,
        token: website.github_access_token,
        branch: 'main',
      })

      const siteDefinition = await contentService.getSiteDefinition()

      if (!siteDefinition) {
        // Return null - client should show option to create one
        return null
      }

      return {
        ...siteDefinition.content,
        sha: siteDefinition.sha,
      }
    }),

  /**
   * Save site definition to GitHub
   */
  saveSiteDefinition: publicProcedure
    .input(
      z.object({
        websiteId: z.string().uuid(),
        siteDefinition: z.any(), // Use SiteDefinitionSchema for validation
        message: z.string().optional(),
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
          code: 'PRECONDITION_FAILED',
          message: 'Website not connected to GitHub',
        })
      }

      const contentService = new GitHubContentService({
        owner: website.github_owner,
        repo: website.github_repo,
        token: website.github_access_token,
        branch: 'main',
      })

      const result = await contentService.saveSiteDefinition(
        input.siteDefinition,
        input.message || 'Update site definition'
      )

      return {
        success: true,
        sha: result.sha,
        commit: result.commit,
      }
    }),

  /**
   * Check if site definition exists
   */
  hasSiteDefinition: publicProcedure
    .input(
      z.object({
        websiteId: z.string().uuid(),
      })
    )
    .query(async ({ input }) => {
      const website = await websiteRepository.findById(input.websiteId)
      if (!website) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Website not found',
        })
      }

      if (!website.github_owner || !website.github_repo || !website.github_access_token) {
        return { exists: false, reason: 'not_connected' }
      }

      const contentService = new GitHubContentService({
        owner: website.github_owner,
        repo: website.github_repo,
        token: website.github_access_token,
        branch: 'main',
      })

      const exists = await contentService.hasSiteDefinition()

      return { exists }
    }),

  // ============================================================
  // Page Sections (Page Editor)
  // ============================================================

  /**
   * Get page sections from a page JSON file
   * Returns the body array (sections) and metadata
   */
  getPageSections: publicProcedure
    .input(
      z.object({
        websiteId: z.string().uuid(),
        pagePath: z.string(), // e.g., 'content/pages/en/index.json' or 'en/index'
      })
    )
    .query(async ({ input }) => {
      const website = await websiteRepository.findById(input.websiteId)
      if (!website) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Website not found',
        })
      }

      if (!website.github_owner || !website.github_repo || !website.github_access_token) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Website not connected to GitHub',
        })
      }

      const contentService = new GitHubContentService({
        owner: website.github_owner,
        repo: website.github_repo,
        token: website.github_access_token,
        branch: 'main',
        pagesPath: 'content/pages',
      })

      // Normalize path
      let fullPath = input.pagePath
      if (!fullPath.startsWith('content/pages/')) {
        fullPath = `content/pages/${fullPath}`
      }
      if (!fullPath.endsWith('.json')) {
        fullPath = `${fullPath}.json`
      }

      const pageFile = await contentService.getPageByPath(fullPath)
      if (!pageFile) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Page not found: ${input.pagePath}`,
        })
      }

      // Extract sections from body array
      const sections = (pageFile.content.body || []).map((block: any, index: number) => ({
        id: block.id || `section-${index}`,
        type: block.type || 'unknown',
        variant: block.variant,
        order: index,
        content: block,
        prompts: block.prompts,
        ai_hints: block.ai_hints,
        collectionSource: block.collectionSource,
        locked: block.locked,
        notes: block.notes,
      }))

      return {
        pageId: pageFile.content.id,
        title: extractLocalizedValue(pageFile.content.title) || pageFile.content.slug,
        slug: pageFile.content.slug,
        sections,
        sha: pageFile.sha,
        sourcePath: fullPath,
      }
    }),

  /**
   * Save page sections to a page JSON file
   * Updates the body array with the provided sections
   */
  savePageSections: publicProcedure
    .input(
      z.object({
        websiteId: z.string().uuid(),
        pagePath: z.string(),
        sections: z.array(z.object({
          id: z.string(),
          type: z.string(),
          variant: z.string().optional(),
          order: z.number(),
          content: z.record(z.unknown()).optional(),
          prompts: z.any().optional(),
          ai_hints: z.any().optional(),
          collectionSource: z.any().optional(),
          locked: z.boolean().optional(),
          notes: z.string().optional(),
        })),
        message: z.string().optional(),
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
          code: 'PRECONDITION_FAILED',
          message: 'Website not connected to GitHub',
        })
      }

      const contentService = new GitHubContentService({
        owner: website.github_owner,
        repo: website.github_repo,
        token: website.github_access_token,
        branch: 'main',
        pagesPath: 'content/pages',
      })

      // Normalize path
      let fullPath = input.pagePath
      if (!fullPath.startsWith('content/pages/')) {
        fullPath = `content/pages/${fullPath}`
      }
      if (!fullPath.endsWith('.json')) {
        fullPath = `${fullPath}.json`
      }

      // Get existing page
      const pageFile = await contentService.getPageByPath(fullPath)
      if (!pageFile) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Page not found: ${input.pagePath}`,
        })
      }

      // Sort sections by order and convert to body format
      const sortedSections = [...input.sections].sort((a, b) => a.order - b.order)
      const body = sortedSections.map((section) => {
        const block: Record<string, unknown> = {
          ...section.content,
          id: section.id,
          type: section.type,
        }
        if (section.variant) block.variant = section.variant
        if (section.prompts) block.prompts = section.prompts
        if (section.ai_hints) block.ai_hints = section.ai_hints
        if (section.collectionSource) block.collectionSource = section.collectionSource
        if (section.locked) block.locked = section.locked
        if (section.notes) block.notes = section.notes
        return block
      })

      // Update page with new body
      const updatedPage = {
        ...pageFile.content,
        body,
        updated_at: new Date().toISOString(),
      }

      const result = await contentService.savePageByPath(
        fullPath,
        updatedPage,
        input.message || `Update page sections: ${fullPath}`
      )

      return {
        success: true,
        sha: result.sha,
        commit: result.commit,
      }
    }),

  // ============================================================================
  // Template Collection Endpoints
  // ============================================================================

  /**
   * Get resolved pages for a collection instance
   * Uses the Template + Override pattern to determine which pages exist for an instance
   */
  getInstancePages: publicProcedure
    .input(
      z.object({
        websiteId: z.string().uuid(),
        collectionType: z.string(), // e.g., 'villages'
        instanceId: z.string(),
      })
    )
    .query(async ({ input }) => {
      const website = await websiteRepository.findById(input.websiteId)
      if (!website) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Website not found',
        })
      }

      if (!website.github_owner || !website.github_repo || !website.github_access_token) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Website not connected to GitHub',
        })
      }

      const contentService = new GitHubContentService({
        owner: website.github_owner,
        repo: website.github_repo,
        token: website.github_access_token,
        branch: 'main',
        pagesPath: 'content/pages',
      })

      // Load site definition
      const siteDefinition = await contentService.getSiteDefinition()
      if (!siteDefinition) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Site definition not found',
        })
      }

      // Find the collection type
      const collectionTypeDef = siteDefinition.types.collections?.[input.collectionType]
      if (!collectionTypeDef) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Collection type not found: ${input.collectionType}`,
        })
      }

      // Check if this collection has a page structure (is a template collection)
      if (!collectionTypeDef.pageStructure?.pages?.length) {
        return {
          pages: [],
          isTemplateCollection: false,
        }
      }

      // Find the sitemap node for this collection to get instance overrides
      const collectionNode = siteDefinition.sitemap.nodes.find(
        (n: any) => n.type === `collection:${input.collectionType}`
      )

      const instanceOverride = collectionNode?.data?.instanceOverrides?.find(
        (o: any) => o.instanceId === input.instanceId
      )

      // Resolve pages for this instance
      const templatePages = collectionTypeDef.pageStructure.pages
      const skipPages = new Set(instanceOverride?.skipPages || [])

      const resolvedPages = templatePages
        .filter((page: any) => !skipPages.has(page.slug))
        .map((page: any) => {
          const pageOverride = instanceOverride?.pageOverrides?.[page.slug]
          return {
            slug: page.slug,
            pageType: page.pageType,
            title: page.title,
            required: page.required ?? true,
            sections: pageOverride?.sections || page.sections,
            prompts: pageOverride?.prompts || page.prompts,
            ai_hints: pageOverride?.ai_hints || page.ai_hints,
            collectionBinding: page.collectionBinding,
            isFromTemplate: true,
            isOverridden: !!pageOverride,
          }
        })

      // Add any additional pages from the instance override
      const additionalPages = (instanceOverride?.additionalPages || []).map((page: any) => ({
        ...page,
        isFromTemplate: false,
        isOverridden: false,
      }))

      return {
        pages: [...resolvedPages, ...additionalPages],
        isTemplateCollection: true,
        instanceOverride,
        urlPattern: collectionTypeDef.pageStructure.urlPattern,
      }
    }),

  /**
   * Get template page structure for a collection type
   * Returns the pageStructure definition from the content type
   */
  getTemplatePageStructure: publicProcedure
    .input(
      z.object({
        websiteId: z.string().uuid(),
        collectionType: z.string(),
      })
    )
    .query(async ({ input }) => {
      const website = await websiteRepository.findById(input.websiteId)
      if (!website) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Website not found',
        })
      }

      if (!website.github_owner || !website.github_repo || !website.github_access_token) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Website not connected to GitHub',
        })
      }

      const contentService = new GitHubContentService({
        owner: website.github_owner,
        repo: website.github_repo,
        token: website.github_access_token,
        branch: 'main',
        pagesPath: 'content/pages',
      })

      // Load site definition
      const siteDefinition = await contentService.getSiteDefinition()
      if (!siteDefinition) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Site definition not found',
        })
      }

      // Find the collection type
      const collectionTypeDef = siteDefinition.types.collections?.[input.collectionType]
      if (!collectionTypeDef) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Collection type not found: ${input.collectionType}`,
        })
      }

      return {
        pageStructure: collectionTypeDef.pageStructure,
        contentType: collectionTypeDef,
      }
    }),

  /**
   * Save instance override for a collection instance
   * Updates the site definition with the new override configuration
   */
  saveInstanceOverride: publicProcedure
    .input(
      z.object({
        websiteId: z.string().uuid(),
        collectionType: z.string(),
        override: z.object({
          instanceId: z.string(),
          skipPages: z.array(z.string()).optional(),
          additionalPages: z.array(z.any()).optional(),
          pageOverrides: z.record(z.any()).optional(),
        }),
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
          code: 'PRECONDITION_FAILED',
          message: 'Website not connected to GitHub',
        })
      }

      const contentService = new GitHubContentService({
        owner: website.github_owner,
        repo: website.github_repo,
        token: website.github_access_token,
        branch: 'main',
        pagesPath: 'content/pages',
      })

      // Load current site definition
      const siteDefinition = await contentService.getSiteDefinition()
      if (!siteDefinition) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Site definition not found',
        })
      }

      // Find the sitemap node for this collection
      const nodeIndex = siteDefinition.sitemap.nodes.findIndex(
        (n: any) => n.type === `collection:${input.collectionType}`
      )

      if (nodeIndex === -1) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Collection node not found: collection:${input.collectionType}`,
        })
      }

      const node = siteDefinition.sitemap.nodes[nodeIndex]
      const currentOverrides = (node.data?.instanceOverrides || []) as Array<{
        instanceId: string
        skipPages?: string[]
        additionalPages?: unknown[]
        pageOverrides?: Record<string, unknown>
      }>

      // Check if override has any actual content
      const hasContent = input.override.skipPages?.length ||
                        input.override.additionalPages?.length ||
                        (input.override.pageOverrides && Object.keys(input.override.pageOverrides).length)

      let newOverrides: typeof currentOverrides
      const existingIndex = currentOverrides.findIndex(
        o => o.instanceId === input.override.instanceId
      )

      if (hasContent) {
        if (existingIndex >= 0) {
          // Update existing
          newOverrides = currentOverrides.map((o, i) =>
            i === existingIndex ? input.override : o
          )
        } else {
          // Add new
          newOverrides = [...currentOverrides, input.override]
        }
      } else {
        // Remove if no content
        newOverrides = currentOverrides.filter(
          o => o.instanceId !== input.override.instanceId
        )
      }

      // Update the site definition
      const updatedSiteDefinition = {
        ...siteDefinition,
        sitemap: {
          ...siteDefinition.sitemap,
          nodes: siteDefinition.sitemap.nodes.map((n: any, i: number) =>
            i === nodeIndex
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    instanceOverrides: newOverrides.length > 0 ? newOverrides : undefined,
                  },
                }
              : n
          ),
        },
        updatedAt: new Date().toISOString(),
      }

      // Save back to GitHub
      const result = await contentService.saveSiteDefinition(
        updatedSiteDefinition,
        `Update instance override for ${input.override.instanceId} in ${input.collectionType}`
      )

      return {
        success: true,
        sha: result.sha,
        override: input.override,
      }
    }),
})

// Helper to extract value from potentially localized fields
function extractLocalizedValue(value: unknown): string | undefined {
  if (!value) return undefined
  if (typeof value === 'string') return value
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, string>
    // Try common locales
    return obj.en || obj.de || obj.it || obj.fr || Object.values(obj)[0]
  }
  return undefined
}
