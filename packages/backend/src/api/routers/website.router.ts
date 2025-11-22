/**
 * Website API Router
 * Endpoints for managing websites
 */

import { z } from 'zod'
import { router, publicProcedure, ceoProcedure } from '../trpc'
import { websiteRepository } from '../../db/repositories'
import { TRPCError } from '@trpc/server'

export const websiteRouter = router({
  /**
   * Get all websites
   */
  list: publicProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ input }) => {
      const { limit, offset } = input

      const websites = await websiteRepository.findAll({
        limit,
        offset,
      })

      return {
        items: websites,
        total: websites.length,
        limit,
        offset,
      }
    }),

  /**
   * Get website by ID
   */
  getById: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const website = await websiteRepository.findById(input.id)

      if (!website) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Website ${input.id} not found`,
        })
      }

      return website
    }),

  /**
   * Create new website
   */
  create: ceoProcedure
    .input(
      z.object({
        title: z.string().min(1),
        domain: z.string().min(1),
        description: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx: _ctx }) => {
      const website = await websiteRepository.create({
        title: input.title,
        domain: input.domain,
        description: input.description,
      })

      console.log(`[WebsiteRouter] Website created: ${website.id} by CEO`)

      return website
    }),

  /**
   * Update website
   */
  update: ceoProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        domain: z.string().optional(),
        description: z.string().optional(),
        config: z.record(z.unknown()).optional(),
      })
    )
    .mutation(async ({ input, ctx: _ctx }) => {
      const { id, ...updates } = input

      const existing = await websiteRepository.findById(id)
      if (!existing) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Website ${id} not found`,
        })
      }

      const updated = await websiteRepository.update(id, updates)

      console.log(`[WebsiteRouter] Website updated: ${id} by CEO`)

      return updated
    }),

  /**
   * Delete website
   */
  delete: ceoProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx: _ctx }) => {
      const existing = await websiteRepository.findById(input.id)
      if (!existing) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Website ${input.id} not found`,
        })
      }

      await websiteRepository.delete(input.id)

      console.log(`[WebsiteRouter] Website deleted: ${input.id} by CEO`)

      return { success: true }
    }),

  /**
   * Get website content items
   */
  getContent: publicProcedure
    .input(
      z.object({
        id: z.string(),
        status: z.enum([
          'idea',
          'planned',
          'brief_created',
          'draft',
          'in_editorial_review',
          'needs_changes',
          'approved',
          'scheduled',
          'published',
          'archived',
        ]).optional(),
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ input }) => {
      const { id, status, limit, offset } = input

      const website = await websiteRepository.findById(id)
      if (!website) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Website ${id} not found`,
        })
      }

      // Import contentRepository to avoid circular dependency
      const { contentRepository } = await import('../../db/repositories')

      const content = await contentRepository.findAll({
        website_id: id,
        status,
        limit,
        offset,
      })

      return {
        website,
        items: content,
        total: content.length,
        limit,
        offset,
      }
    }),
})
