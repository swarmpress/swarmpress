/**
 * Analytics Router
 * API endpoints for sitemap analytics, agent metrics, and API call tracking
 */

import { z } from 'zod'
import { router, publicProcedure } from '../trpc'
import { sitemapAnalyticsRepository } from '../../db/repositories'
import {
  metricsCollector,
  formatMetricsSummary,
  formatAggregationSummary,
  type APICallMetrics,
} from '@swarm-press/shared'

export const analyticsRouter = router({
  // ============================================================================
  // Sitemap Analytics
  // ============================================================================

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

  // ============================================================================
  // Agent API Call Metrics
  // ============================================================================

  /**
   * Get aggregated agent metrics
   * Filters by agent ID, capability, or time range
   */
  getAgentMetrics: publicProcedure
    .input(
      z.object({
        agentId: z.string().uuid().optional(),
        capability: z.string().optional(),
        sinceMinutes: z.number().optional(), // e.g., 60 = last hour
      })
    )
    .query(async ({ input }) => {
      const since = input.sinceMinutes
        ? new Date(Date.now() - input.sinceMinutes * 60 * 1000)
        : undefined

      const aggregation = metricsCollector.aggregate({
        agentId: input.agentId,
        capability: input.capability,
        since,
      })

      return {
        ...aggregation,
        summary: formatAggregationSummary(aggregation),
      }
    }),

  /**
   * Get recent API call metrics
   * Returns raw metrics for detailed analysis
   */
  getRecentCalls: publicProcedure
    .input(
      z.object({
        count: z.number().min(1).max(500).optional(),
      })
    )
    .query(async ({ input }) => {
      const recent: APICallMetrics[] = metricsCollector.getRecent(input.count || 100)
      return {
        calls: recent.map((m: APICallMetrics) => ({
          ...m,
          summary: formatMetricsSummary(m),
        })),
        total: recent.length,
      }
    }),

  /**
   * Get cost breakdown by model
   */
  getCostByModel: publicProcedure
    .input(
      z.object({
        sinceMinutes: z.number().optional(),
      })
    )
    .query(async ({ input }) => {
      const since = input.sinceMinutes
        ? new Date(Date.now() - input.sinceMinutes * 60 * 1000)
        : undefined

      const recent: APICallMetrics[] = metricsCollector.getRecent(1000)
      const filtered = since
        ? recent.filter((m: APICallMetrics) => m.startTime >= since.getTime())
        : recent

      // Group by model
      const byModel: Record<
        string,
        {
          calls: number
          inputTokens: number
          outputTokens: number
          cost: number
          avgLatency: number
        }
      > = {}

      for (const m of filtered) {
        const model = m.model || 'unknown'
        if (!byModel[model]) {
          byModel[model] = {
            calls: 0,
            inputTokens: 0,
            outputTokens: 0,
            cost: 0,
            avgLatency: 0,
          }
        }
        byModel[model].calls++
        byModel[model].inputTokens += m.inputTokens || 0
        byModel[model].outputTokens += m.outputTokens || 0
        byModel[model].cost += m.estimatedCost || 0
        if (m.endTime && m.startTime) {
          const latency = m.endTime - m.startTime
          byModel[model].avgLatency =
            (byModel[model].avgLatency * (byModel[model].calls - 1) + latency) /
            byModel[model].calls
        }
      }

      return {
        byModel,
        totalCost: Object.values(byModel).reduce((sum, m) => sum + m.cost, 0),
        totalCalls: filtered.length,
      }
    }),

  /**
   * Get cost breakdown by agent
   */
  getCostByAgent: publicProcedure
    .input(
      z.object({
        sinceMinutes: z.number().optional(),
      })
    )
    .query(async ({ input }) => {
      const since = input.sinceMinutes
        ? new Date(Date.now() - input.sinceMinutes * 60 * 1000)
        : undefined

      const recent: APICallMetrics[] = metricsCollector.getRecent(1000)
      const filtered = since
        ? recent.filter((m: APICallMetrics) => m.startTime >= since.getTime())
        : recent

      // Group by agent
      const byAgent: Record<
        string,
        {
          agentName: string
          calls: number
          inputTokens: number
          outputTokens: number
          cost: number
          errorCount: number
          capabilities: Set<string>
        }
      > = {}

      for (const m of filtered) {
        const agentId = m.agentId || 'unknown'
        if (!byAgent[agentId]) {
          byAgent[agentId] = {
            agentName: m.agentName || 'Unknown',
            calls: 0,
            inputTokens: 0,
            outputTokens: 0,
            cost: 0,
            errorCount: 0,
            capabilities: new Set(),
          }
        }
        byAgent[agentId].calls++
        byAgent[agentId].inputTokens += m.inputTokens || 0
        byAgent[agentId].outputTokens += m.outputTokens || 0
        byAgent[agentId].cost += m.estimatedCost || 0
        if (m.error) byAgent[agentId].errorCount++
        if (m.capability) byAgent[agentId].capabilities.add(m.capability)
      }

      // Convert Sets to arrays for JSON serialization
      const result = Object.entries(byAgent).map(([agentId, data]) => ({
        agentId,
        agentName: data.agentName,
        calls: data.calls,
        inputTokens: data.inputTokens,
        outputTokens: data.outputTokens,
        cost: data.cost,
        errorCount: data.errorCount,
        errorRate: data.errorCount / data.calls,
        capabilities: Array.from(data.capabilities),
      }))

      return {
        byAgent: result,
        totalCost: result.reduce((sum, a) => sum + a.cost, 0),
        totalCalls: filtered.length,
      }
    }),

  /**
   * Clear all agent metrics
   * Useful for testing or after deployment
   */
  clearAgentMetrics: publicProcedure.mutation(async () => {
    metricsCollector.clear()
    return { success: true }
  }),
})
