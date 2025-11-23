/**
 * Graph Position Router
 * Handles React Flow node positions for visual sitemap editor
 */

import { z } from 'zod'
import { router, publicProcedure } from '../trpc'
import { graphPositionRepository } from '../../db/repositories'
import { TRPCError } from '@trpc/server'

export const graphPositionRouter = router({
  /**
   * Get all positions for a website
   */
  listByWebsite: publicProcedure
    .input(z.object({ websiteId: z.string().uuid() }))
    .query(async ({ input }) => {
      const positions = await graphPositionRepository.findByWebsite(input.websiteId)
      return { items: positions }
    }),

  /**
   * Get position for a specific node
   */
  getByNode: publicProcedure
    .input(z.object({
      websiteId: z.string().uuid(),
      nodeId: z.string(),
      nodeType: z.string().optional()
    }))
    .query(async ({ input }) => {
      const position = await graphPositionRepository.findByNode(
        input.websiteId,
        input.nodeId,
        input.nodeType
      )
      if (!position) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Position not found'
        })
      }
      return position
    }),

  /**
   * Bulk update positions (for drag-and-drop operations)
   */
  bulkUpdate: publicProcedure
    .input(z.object({
      website_id: z.string().uuid(),
      positions: z.array(z.object({
        node_id: z.string(),
        node_type: z.string(),
        position_x: z.number(),
        position_y: z.number()
      }))
    }))
    .mutation(async ({ input }) => {
      await graphPositionRepository.bulkUpdate(input)
      return { success: true }
    }),

  /**
   * Update single position
   */
  updatePosition: publicProcedure
    .input(z.object({
      websiteId: z.string().uuid(),
      nodeId: z.string(),
      nodeType: z.string(),
      x: z.number(),
      y: z.number()
    }))
    .mutation(async ({ input }) => {
      const position = await graphPositionRepository.updatePosition(
        input.websiteId,
        input.nodeId,
        input.nodeType,
        input.x,
        input.y
      )
      return position
    }),

  /**
   * Toggle node collapsed state
   */
  toggleCollapsed: publicProcedure
    .input(z.object({
      websiteId: z.string().uuid(),
      nodeId: z.string(),
      nodeType: z.string()
    }))
    .mutation(async ({ input }) => {
      const position = await graphPositionRepository.toggleCollapsed(
        input.websiteId,
        input.nodeId,
        input.nodeType
      )
      if (!position) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Position not found'
        })
      }
      return position
    }),

  /**
   * Toggle node hidden state
   */
  toggleHidden: publicProcedure
    .input(z.object({
      websiteId: z.string().uuid(),
      nodeId: z.string(),
      nodeType: z.string()
    }))
    .mutation(async ({ input }) => {
      const position = await graphPositionRepository.toggleHidden(
        input.websiteId,
        input.nodeId,
        input.nodeType
      )
      if (!position) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Position not found'
        })
      }
      return position
    }),

  /**
   * Reset all positions for a website (for auto-layout)
   */
  resetPositions: publicProcedure
    .input(z.object({ websiteId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      await graphPositionRepository.resetPositions(input.websiteId)
      return { success: true }
    })
})
