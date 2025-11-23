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

export const githubRouter = router({
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
