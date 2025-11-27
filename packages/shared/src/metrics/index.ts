/**
 * Agent Metrics Module
 *
 * Provides types and utilities for tracking agent API call metrics.
 * This module has no dependencies on agent or backend packages to avoid circular imports.
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Metrics for a single API call
 */
export interface APICallMetrics {
  requestId: string
  agentId: string
  agentName: string
  capability?: string
  model: string
  startTime: number
  endTime?: number
  inputTokens?: number
  outputTokens?: number
  cacheCreationTokens?: number
  cacheReadTokens?: number
  stopReason?: string
  toolsUsed?: string[]
  error?: string
  estimatedCost?: number
}

/**
 * Aggregated metrics for multiple API calls
 */
export interface MetricsAggregation {
  totalCalls: number
  totalTokens: {
    input: number
    output: number
  }
  totalCost: number
  averageLatency: number
  errorRate: number
  toolUsage: Record<string, number>
}

// ============================================================================
// Metrics Collector
// ============================================================================

/**
 * In-memory metrics collector for agent calls
 * For production, this would integrate with a metrics service
 */
class MetricsCollector {
  private metrics: APICallMetrics[] = []
  private maxSize = 1000

  /**
   * Record a completed API call
   */
  record(metrics: APICallMetrics): void {
    this.metrics.push(metrics)

    // Trim old entries
    if (this.metrics.length > this.maxSize) {
      this.metrics = this.metrics.slice(-this.maxSize)
    }
  }

  /**
   * Get aggregated metrics
   */
  aggregate(filter?: {
    agentId?: string
    capability?: string
    since?: Date
  }): MetricsAggregation {
    let filtered = this.metrics

    if (filter?.agentId) {
      filtered = filtered.filter((m) => m.agentId === filter.agentId)
    }
    if (filter?.capability) {
      filtered = filtered.filter((m) => m.capability === filter.capability)
    }
    if (filter?.since) {
      const sinceTime = filter.since.getTime()
      filtered = filtered.filter((m) => m.startTime >= sinceTime)
    }

    const totalCalls = filtered.length
    if (totalCalls === 0) {
      return {
        totalCalls: 0,
        totalTokens: { input: 0, output: 0 },
        totalCost: 0,
        averageLatency: 0,
        errorRate: 0,
        toolUsage: {},
      }
    }

    const totalInputTokens = filtered.reduce(
      (sum, m) => sum + (m.inputTokens || 0),
      0
    )
    const totalOutputTokens = filtered.reduce(
      (sum, m) => sum + (m.outputTokens || 0),
      0
    )
    const totalCost = filtered.reduce(
      (sum, m) => sum + (m.estimatedCost || 0),
      0
    )

    const latencies = filtered
      .filter((m) => m.endTime && m.startTime)
      .map((m) => m.endTime! - m.startTime)
    const averageLatency =
      latencies.length > 0
        ? latencies.reduce((a, b) => a + b, 0) / latencies.length
        : 0

    const errorCount = filtered.filter((m) => m.error).length
    const errorRate = errorCount / totalCalls

    const toolUsage: Record<string, number> = {}
    for (const m of filtered) {
      for (const tool of m.toolsUsed || []) {
        toolUsage[tool] = (toolUsage[tool] || 0) + 1
      }
    }

    return {
      totalCalls,
      totalTokens: { input: totalInputTokens, output: totalOutputTokens },
      totalCost,
      averageLatency,
      errorRate,
      toolUsage,
    }
  }

  /**
   * Get recent metrics
   */
  getRecent(count = 100): APICallMetrics[] {
    return this.metrics.slice(-count)
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.metrics = []
  }
}

/**
 * Global metrics collector instance
 */
export const metricsCollector = new MetricsCollector()

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Format metrics for display
 */
export function formatMetricsSummary(metrics: APICallMetrics): string {
  const duration = metrics.endTime
    ? `${metrics.endTime - metrics.startTime}ms`
    : 'N/A'

  return [
    `Request: ${metrics.requestId}`,
    `Agent: ${metrics.agentName}`,
    `Model: ${metrics.model}`,
    `Tokens: ${metrics.inputTokens || 0} in / ${metrics.outputTokens || 0} out`,
    `Cost: $${(metrics.estimatedCost || 0).toFixed(4)}`,
    `Duration: ${duration}`,
    `Tools: ${metrics.toolsUsed?.join(', ') || 'none'}`,
    metrics.error ? `Error: ${metrics.error}` : null,
  ]
    .filter(Boolean)
    .join(' | ')
}

/**
 * Format aggregation for display
 */
export function formatAggregationSummary(agg: MetricsAggregation): string {
  return [
    `Total Calls: ${agg.totalCalls}`,
    `Total Tokens: ${agg.totalTokens.input} in / ${agg.totalTokens.output} out`,
    `Total Cost: $${agg.totalCost.toFixed(4)}`,
    `Avg Latency: ${agg.averageLatency.toFixed(0)}ms`,
    `Error Rate: ${(agg.errorRate * 100).toFixed(1)}%`,
    `Top Tools: ${Object.entries(agg.toolUsage)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => `${name}(${count})`)
      .join(', ') || 'none'}`,
  ].join(' | ')
}
