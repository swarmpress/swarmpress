/**
 * Content API Router
 * Endpoints for managing content items
 */

import { z } from 'zod'
import { router, publicProcedure, protectedProcedure, ceoProcedure } from '../trpc'
import { contentRepository } from '../../db/repositories'
import { TRPCError } from '@trpc/server'

export const contentRouter = router({
  /**
   * Get all content items with optional filtering
   */
  list: publicProcedure
    .input(
      z.object({
        status: z
          .enum([
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
          ])
          .optional(),
        websiteId: z.string().optional(),
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ input }) => {
      const { status, websiteId, limit, offset } = input

      const items = await contentRepository.findAll({
        status,
        website_id: websiteId,
        limit,
        offset,
      })

      return {
        items,
        total: items.length,
        limit,
        offset,
      }
    }),

  /**
   * Get content item by ID
   */
  getById: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const content = await contentRepository.findById(input.id)

      if (!content) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Content ${input.id} not found`,
        })
      }

      return content
    }),

  /**
   * Create new content item
   */
  create: protectedProcedure
    .input(
      z.object({
        type: z.enum(['article', 'section', 'hero', 'metadata', 'component']),
        websiteId: z.string(),
        authorAgentId: z.string(),
        metadata: z.record(z.unknown()).optional(),
      })
    )
    .mutation(async ({ input, ctx: _ctx }) => {
      const content = await contentRepository.create({
        type: input.type,
        website_id: input.websiteId,
        author_agent_id: input.authorAgentId,
        status: 'idea',
        body: [], // Empty JSON blocks initially
        metadata: input.metadata || {},
      })

      console.log(`[ContentRouter] Content created: ${content.id}`)

      return content
    }),

  /**
   * Update content item
   */
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        body: z.array(z.any()).optional(), // JSON blocks
        metadata: z.record(z.unknown()).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { id, ...updates } = input

      const existing = await contentRepository.findById(id)
      if (!existing) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Content ${id} not found`,
        })
      }

      const updated = await contentRepository.update(id, {
        body: updates.body,
        metadata: updates.metadata,
      })

      console.log(`[ContentRouter] Content updated: ${id} by ${ctx.user.email}`)

      return updated
    }),

  /**
   * Transition content state
   */
  transition: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        event: z.string(),
        metadata: z.record(z.unknown()).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const result = await contentRepository.transition(
        input.id,
        input.event,
        ctx.user.role === 'ceo' ? 'CEO' : 'System',
        ctx.user.id,
        input.metadata
      )

      if (!result.success) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: result.error || 'State transition failed',
        })
      }

      console.log(
        `[ContentRouter] Content ${input.id} transitioned via ${input.event} by ${ctx.user.email}`
      )

      return result
    }),

  /**
   * Get content state history
   */
  getHistory: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const history = await contentRepository.getStateHistory(input.id)
      return history
    }),

  /**
   * Archive content item
   */
  archive: ceoProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const result = await contentRepository.transition(
        input.id,
        'archive',
        'CEO',
        ctx.user.id
      )

      if (!result.success) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: result.error || 'Archive failed',
        })
      }

      console.log(`[ContentRouter] Content ${input.id} archived by CEO`)

      return result
    }),

  /**
   * Cancel content item
   */
  cancel: ceoProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const result = await contentRepository.transition(
        input.id,
        'cancel',
        'CEO',
        ctx.user.id
      )

      if (!result.success) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: result.error || 'Cancel failed',
        })
      }

      console.log(`[ContentRouter] Content ${input.id} cancelled by CEO`)

      return result
    }),
})
