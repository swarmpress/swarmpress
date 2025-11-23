/**
 * Analytics Router
 * API endpoints for sitemap analytics and metrics
 */

import { z } from 'zod'
import { router, publicProcedure } from '../trpc'
import { sitemapAnalyticsRepository } from '../../db/repositories'

export const analyticsRouter = router({
  /**
   * Get analytics for a website (cached or fresh)
   */
  getAnalytics: publicProcedure
    .input(
      z.object({
        websiteId: z.string().uuid(),
        maxAgeMinutes: z.number().optional(),
      })
    )
    .query(async ({ input }) => {
      const analytics = await sitemapAnalyticsRepository.getAnalytics(
        input.websiteId,
        input.maxAgeMinutes
      )
      return { analytics }
    }),

  /**
   * Force recompute analytics (bypasses cache)
   */
  recomputeAnalytics: publicProcedure
    .input(z.object({ websiteId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const analytics = await sitemapAnalyticsRepository.computeAnalytics(input.websiteId)
      return { success: true, analytics }
    }),

  /**
   * Clear analytics cache for a website
   */
  clearCache: publicProcedure
    .input(z.object({ websiteId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      await sitemapAnalyticsRepository.clearCache(input.websiteId)
      return { success: true }
    }),
})
