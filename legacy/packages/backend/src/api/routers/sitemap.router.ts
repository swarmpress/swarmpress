/**
 * Sitemap (Pages) Router
 * Handles CRUD operations for sitemap pages
 */

import { z } from 'zod'
import { router, publicProcedure } from '../trpc'
import { pageRepository } from '../../db/repositories'
import { TRPCError } from '@trpc/server'
import type {
  CreatePageInput,
  UpdatePageInput,
  InternalLinks,
  PageTask,
  AISuggestion
} from '@swarm-press/shared'

export const sitemapRouter = router({
  /**
   * List all pages for a website
   */
  listByWebsite: publicProcedure
    .input(z.object({ websiteId: z.string().uuid() }))
    .query(async ({ input }) => {
      const pages = await pageRepository.findByWebsite(input.websiteId)
      return { items: pages }
    }),

  /**
   * Get page by ID
   */
  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const page = await pageRepository.findById(input.id)
      if (!page) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Page with id ${input.id} not found`
        })
      }
      return page
    }),

  /**
   * Get page by slug
   */
  getBySlug: publicProcedure
    .input(z.object({
      websiteId: z.string().uuid(),
      slug: z.string()
    }))
    .query(async ({ input }) => {
      const page = await pageRepository.findBySlug(input.websiteId, input.slug)
      if (!page) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Page with slug "${input.slug}" not found`
        })
      }
      return page
    }),

  /**
   * Get pages by status
   */
  listByStatus: publicProcedure
    .input(z.object({
      websiteId: z.string().uuid(),
      status: z.string()
    }))
    .query(async ({ input }) => {
      const pages = await pageRepository.findByStatus(input.websiteId, input.status)
      return { items: pages }
    }),

  /**
   * Get pages by page type
   */
  listByPageType: publicProcedure
    .input(z.object({
      websiteId: z.string().uuid(),
      pageType: z.string()
    }))
    .query(async ({ input }) => {
      const pages = await pageRepository.findByPageType(input.websiteId, input.pageType)
      return { items: pages }
    }),

  /**
   * Get children of a page
   */
  listChildren: publicProcedure
    .input(z.object({ parentId: z.string().uuid() }))
    .query(async ({ input }) => {
      const children = await pageRepository.findChildren(input.parentId)
      return { items: children }
    }),

  /**
   * Get orphan pages (no incoming links, no parent)
   */
  listOrphans: publicProcedure
    .input(z.object({ websiteId: z.string().uuid() }))
    .query(async ({ input }) => {
      const orphans = await pageRepository.findOrphanPages(input.websiteId)
      return { items: orphans }
    }),

  /**
   * Get pages needing updates (low freshness score)
   */
  listNeedingUpdate: publicProcedure
    .input(z.object({
      websiteId: z.string().uuid(),
      threshold: z.number().min(0).max(100).optional()
    }))
    .query(async ({ input }) => {
      const pages = await pageRepository.findPagesNeedingUpdate(
        input.websiteId,
        input.threshold
      )
      return { items: pages }
    }),

  /**
   * Get page tree (hierarchical structure)
   */
  getPageTree: publicProcedure
    .input(z.object({ websiteId: z.string().uuid() }))
    .query(async ({ input }) => {
      const tree = await pageRepository.getPageTree(input.websiteId)
      return { tree }
    }),

  /**
   * Create a new page
   */
  create: publicProcedure
    .input(z.object({
      website_id: z.string().uuid(),
      slug: z.string(),
      title: z.string(),
      page_type: z.string(),
      status: z.string().optional(),
      parent_id: z.string().uuid().optional(),
      order_index: z.number().optional(),
      seo_profile: z.any().optional(),
      internal_links: z.any().optional(),
      owners: z.any().optional(),
      tasks: z.any().optional(),
      suggestions: z.any().optional(),
      analytics: z.any().optional()
    }))
    .mutation(async ({ input }) => {
      try {
        const page = await pageRepository.createPage(input as CreatePageInput)
        return page
      } catch (error) {
        if (error instanceof Error && error.message.includes('already exists')) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: error.message
          })
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to create page'
        })
      }
    }),

  /**
   * Update a page
   */
  update: publicProcedure
    .input(z.object({
      id: z.string().uuid(),
      slug: z.string().optional(),
      title: z.string().optional(),
      page_type: z.string().optional(),
      status: z.string().optional(),
      parent_id: z.string().uuid().optional(),
      order_index: z.number().optional(),
      seo_profile: z.any().optional(),
      internal_links: z.any().optional(),
      owners: z.any().optional(),
      tasks: z.any().optional(),
      suggestions: z.any().optional(),
      analytics: z.any().optional()
    }))
    .mutation(async ({ input }) => {
      const { id, ...updates } = input
      try {
        const page = await pageRepository.updatePage(id, updates as UpdatePageInput)
        if (!page) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to update page'
          })
        }
        return page
      } catch (error) {
        if (error instanceof Error && error.message.includes('already exists')) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: error.message
          })
        }
        throw error
      }
    }),

  /**
   * Update internal links for a page
   */
  updateLinks: publicProcedure
    .input(z.object({
      pageId: z.string().uuid(),
      links: z.object({
        outgoing: z.array(z.any()),
        incoming: z.array(z.any())
      })
    }))
    .mutation(async ({ input }) => {
      const page = await pageRepository.updateLinks(
        input.pageId,
        input.links as InternalLinks
      )
      if (!page) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Page not found'
        })
      }
      return page
    }),

  /**
   * Add a suggestion to a page
   */
  addSuggestion: publicProcedure
    .input(z.object({
      pageId: z.string().uuid(),
      suggestion: z.object({
        suggestion_type: z.enum(['new_page', 'improve_content', 'add_links', 'update_blueprint']),
        reason: z.string(),
        estimated_value: z.enum(['low', 'medium', 'high']),
        proposed_slug: z.string().optional(),
        keywords: z.array(z.string()).optional()
      })
    }))
    .mutation(async ({ input }) => {
      const page = await pageRepository.addSuggestion(
        input.pageId,
        input.suggestion as AISuggestion
      )
      if (!page) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Page not found'
        })
      }
      return page
    }),

  /**
   * Add a task to a page
   */
  addTask: publicProcedure
    .input(z.object({
      pageId: z.string().uuid(),
      task: z.object({
        id: z.string(),
        type: z.string(),
        description: z.string(),
        assigned_to: z.string(),
        status: z.string(),
        priority: z.string(),
        due_date: z.string().optional(),
        created_at: z.string()
      })
    }))
    .mutation(async ({ input }) => {
      const page = await pageRepository.addTask(
        input.pageId,
        input.task as PageTask
      )
      if (!page) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Page not found'
        })
      }
      return page
    }),

  /**
   * Update freshness score
   */
  updateFreshnessScore: publicProcedure
    .input(z.object({
      pageId: z.string().uuid(),
      score: z.number().min(0).max(100)
    }))
    .mutation(async ({ input }) => {
      const page = await pageRepository.updateFreshnessScore(
        input.pageId,
        input.score
      )
      if (!page) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Page not found'
        })
      }
      return page
    }),

  /**
   * Delete a page
   */
  delete: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const deleted = await pageRepository.delete(input.id)
      if (!deleted) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Page with id ${input.id} not found`
        })
      }
      return { success: true }
    })
})
