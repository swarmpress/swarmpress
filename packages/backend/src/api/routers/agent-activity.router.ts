/**
 * Agent Activity Router
 * API endpoints for real-time agent activity tracking
 */

import { z } from 'zod'
import { router, publicProcedure } from '../trpc'
import { agentActivityRepository } from '../../db/repositories'

export const agentActivityRouter = router({
  /**
   * Create a new activity record
   */
  create: publicProcedure
    .input(
      z.object({
        agentId: z.string().uuid(),
        activityType: z.enum(['viewing', 'editing', 'suggesting', 'reviewing', 'analyzing']),
        pageId: z.string().uuid().optional(),
        description: z.string().min(1),
        metadata: z.record(z.any()).optional(),
        durationSeconds: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const activity = await agentActivityRepository.create({
        agent_id: input.agentId,
        activity_type: input.activityType,
        page_id: input.pageId,
        description: input.description,
        metadata: input.metadata,
        duration_seconds: input.durationSeconds,
      })

      return { success: true, activity }
    }),

  /**
   * Get all active activities for a website
   */
  getActiveByWebsite: publicProcedure
    .input(z.object({ websiteId: z.string().uuid() }))
    .query(async ({ input }) => {
      const activities = await agentActivityRepository.findActiveByWebsite(input.websiteId)
      return { activities }
    }),

  /**
   * Get active activities for a specific page
   */
  getActiveByPage: publicProcedure
    .input(z.object({ pageId: z.string().uuid() }))
    .query(async ({ input }) => {
      const activities = await agentActivityRepository.findActiveByPage(input.pageId)
      return { activities }
    }),

  /**
   * Get recent activities by agent
   */
  getByAgent: publicProcedure
    .input(
      z.object({
        agentId: z.string().uuid(),
        limit: z.number().optional(),
      })
    )
    .query(async ({ input }) => {
      const activities = await agentActivityRepository.findByAgent(
        input.agentId,
        input.limit
      )
      return { activities }
    }),

  /**
   * Get activity feed for a website
   */
  getActivityFeed: publicProcedure
    .input(
      z.object({
        websiteId: z.string().uuid(),
        limit: z.number().optional(),
      })
    )
    .query(async ({ input }) => {
      const activities = await agentActivityRepository.getActivityFeed(
        input.websiteId,
        input.limit
      )
      return { activities }
    }),

  /**
   * Extend activity duration
   */
  extend: publicProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        additionalSeconds: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      const activity = await agentActivityRepository.extendActivity(
        input.id,
        input.additionalSeconds
      )

      return { success: true, activity }
    }),

  /**
   * Delete an activity
   */
  delete: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      await agentActivityRepository.delete(input.id)
      return { success: true }
    }),

  /**
   * Cleanup expired activities
   */
  cleanupExpired: publicProcedure.mutation(async () => {
    const deletedCount = await agentActivityRepository.deleteExpired()
    return { success: true, deletedCount }
  }),
})
