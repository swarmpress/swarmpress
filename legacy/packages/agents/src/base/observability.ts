/**
 * Agent Observability Module
 *
 * Provides structured logging and metrics for agent API calls.
 * Integrates with the shared logging infrastructure and adds
 * agent-specific context and metrics tracking.
 */

import {
  createLogger,
  type LogContext,
  type APICallMetrics,
  type MetricsAggregation,
  metricsCollector,
  formatMetricsSummary,
  formatAggregationSummary,
} from '@swarm-press/shared'
import type { AgentContext } from './agent'

// Re-export from shared for backward compatibility
export {
  type APICallMetrics,
  type MetricsAggregation,
  metricsCollector,
  formatMetricsSummary,
  formatAggregationSummary,
}

// ============================================================================
// Types
// ============================================================================

export interface AgentLogContext extends LogContext {
  agentId?: string
  agentName?: string
  capability?: string
  model?: string
  requestId?: string
  iteration?: number
  inputTokens?: number
  outputTokens?: number
  estimatedCost?: number
  toolsUsed?: string[]
  stopReason?: string
  duration?: number
}

// ============================================================================
// Agent Logger
// ============================================================================

/**
 * Create an agent-specific logger with context
 */
export function createAgentLogger(
  agentName: string,
  context?: Partial<AgentLogContext>
) {
  const logger = createLogger('info', {
    component: 'agent',
    agentName,
    ...context,
  })

  return {
    /**
     * Log API call start
     */
    callStart(
      requestId: string,
      model: string,
      capability?: string
    ): void {
      logger.info('API call started', {
        requestId,
        model,
        capability,
        event: 'api_call_start',
      })
    },

    /**
     * Log API call completion
     */
    callComplete(
      metrics: APICallMetrics,
      context?: Partial<AgentLogContext>
    ): void {
      const duration = metrics.endTime
        ? metrics.endTime - metrics.startTime
        : undefined

      logger.info('API call completed', {
        requestId: metrics.requestId,
        model: metrics.model,
        capability: metrics.capability,
        inputTokens: metrics.inputTokens,
        outputTokens: metrics.outputTokens,
        estimatedCost: metrics.estimatedCost,
        stopReason: metrics.stopReason,
        toolsUsed: metrics.toolsUsed,
        duration,
        event: 'api_call_complete',
        ...context,
      })
    },

    /**
     * Log API call error
     */
    callError(
      requestId: string,
      error: Error | string,
      context?: Partial<AgentLogContext>
    ): void {
      const errorObj = typeof error === 'string' ? new Error(error) : error
      logger.error('API call failed', errorObj, {
        requestId,
        event: 'api_call_error',
        ...context,
      })
    },

    /**
     * Log tool execution
     */
    toolExecution(
      toolName: string,
      success: boolean,
      duration?: number,
      context?: Partial<AgentLogContext>
    ): void {
      logger.info(`Tool ${success ? 'completed' : 'failed'}: ${toolName}`, {
        toolName,
        success,
        duration,
        event: 'tool_execution',
        ...context,
      })
    },

    /**
     * Log iteration in tool-use loop
     */
    iteration(
      iteration: number,
      stopReason: string | null,
      context?: Partial<AgentLogContext>
    ): void {
      logger.debug(`Iteration ${iteration}`, {
        iteration,
        stopReason,
        event: 'iteration',
        ...context,
      })
    },

    /**
     * Log agent task start
     */
    taskStart(
      taskType: string,
      agentContext: AgentContext
    ): void {
      logger.info(`Task started: ${taskType}`, {
        taskType,
        taskId: agentContext.taskId,
        websiteId: agentContext.websiteId,
        contentId: agentContext.contentId,
        event: 'task_start',
      })
    },

    /**
     * Log agent task completion
     */
    taskComplete(
      taskType: string,
      success: boolean,
      iterations?: number,
      metrics?: APICallMetrics
    ): void {
      logger.info(`Task ${success ? 'completed' : 'failed'}: ${taskType}`, {
        taskType,
        success,
        iterations,
        inputTokens: metrics?.inputTokens,
        outputTokens: metrics?.outputTokens,
        estimatedCost: metrics?.estimatedCost,
        event: 'task_complete',
      })
    },

    /**
     * Raw logger access for custom logging
     */
    raw: logger,
  }
}
