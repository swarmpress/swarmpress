/**
 * API Call Builder
 *
 * Utilities for building and tracking Anthropic API calls with
 * metadata, sampling controls, and observability.
 */

import Anthropic from '@anthropic-ai/sdk'
import type { AgentRuntimeConfig } from '@swarm-press/backend'
import type { APICallMetrics } from '@swarm-press/shared'
import type { AgentContext } from './agent'

// Re-export the type for backward compatibility
export type { APICallMetrics }

// ============================================================================
// Types
// ============================================================================

export interface APICallOptions {
  config: AgentRuntimeConfig
  context: AgentContext
  systemPrompt: string
  messages: Anthropic.MessageParam[]
  tools?: Anthropic.Tool[]
  stream?: boolean
}

// ============================================================================
// API Call Builder
// ============================================================================

/**
 * Build Anthropic API call parameters with full SDK utilization
 */
export function buildAPICallParams(
  options: APICallOptions
): Anthropic.MessageCreateParamsNonStreaming {
  const { config, context, systemPrompt, messages, tools } = options

  // Build metadata for tracking (user_id is the only supported field)
  const metadata: Anthropic.Metadata = {
    user_id: buildUserIdHash(context, config),
  }

  // Build base params
  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model: config.modelConfig.model,
    max_tokens: config.modelConfig.maxTokens,
    system: systemPrompt,
    messages,
    metadata,
  }

  // Add sampling controls from model config
  if (config.modelConfig.temperature !== undefined) {
    params.temperature = config.modelConfig.temperature
  }

  if (config.modelConfig.topP !== undefined) {
    params.top_p = config.modelConfig.topP
  }

  // Add tools if provided
  if (tools && tools.length > 0) {
    params.tools = tools
  }

  return params
}

/**
 * Build streaming API call parameters
 */
export function buildStreamingAPICallParams(
  options: APICallOptions
): Anthropic.MessageCreateParamsStreaming {
  const nonStreamingParams = buildAPICallParams(options)
  return {
    ...nonStreamingParams,
    stream: true,
  }
}

// ============================================================================
// Metadata & Tracking
// ============================================================================

/**
 * Build a hashed user ID for Anthropic metadata
 * Encodes: agent_id:website_id:task_id for tracking
 */
export function buildUserIdHash(
  context: AgentContext,
  _config?: AgentRuntimeConfig
): string {
  const components = [
    context.agentId,
    context.websiteId || 'global',
    context.taskId || 'adhoc',
  ].join(':')

  // Base64 encode and truncate to max 256 chars (Anthropic limit)
  return Buffer.from(components).toString('base64').slice(0, 64)
}

/**
 * Create a new metrics tracking object
 */
export function createMetrics(
  config: AgentRuntimeConfig,
  _context: AgentContext,
  capability?: string
): APICallMetrics {
  return {
    requestId: generateRequestId(),
    agentId: config.agentId,
    agentName: config.name,
    capability,
    model: config.modelConfig.model,
    startTime: Date.now(),
    toolsUsed: [],
  }
}

/**
 * Finalize metrics after API call completion
 */
export function finalizeMetrics(
  metrics: APICallMetrics,
  response: Anthropic.Message
): APICallMetrics {
  metrics.endTime = Date.now()
  metrics.inputTokens = response.usage.input_tokens
  metrics.outputTokens = response.usage.output_tokens
  metrics.stopReason = response.stop_reason || undefined
  metrics.estimatedCost = estimateCost(
    metrics.model,
    metrics.inputTokens,
    metrics.outputTokens
  )
  return metrics
}

/**
 * Record error in metrics
 */
export function recordMetricsError(
  metrics: APICallMetrics,
  error: Error | string
): APICallMetrics {
  metrics.endTime = Date.now()
  metrics.error = typeof error === 'string' ? error : error.message
  return metrics
}

// ============================================================================
// Cost Estimation
// ============================================================================

/**
 * Model pricing per million tokens (as of 2024)
 */
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // Claude 3.5 Sonnet
  'claude-sonnet-4-5-20250929': { input: 3.0, output: 15.0 },
  'claude-3-5-sonnet-20241022': { input: 3.0, output: 15.0 },
  'claude-3-5-sonnet-20240620': { input: 3.0, output: 15.0 },
  // Claude 3 Opus
  'claude-3-opus-20240229': { input: 15.0, output: 75.0 },
  // Claude 3 Haiku
  'claude-3-haiku-20240307': { input: 0.25, output: 1.25 },
  // Claude 3 Sonnet
  'claude-3-sonnet-20240229': { input: 3.0, output: 15.0 },
}

const DEFAULT_PRICING = { input: 3.0, output: 15.0 }

/**
 * Estimate cost for an API call in USD
 */
export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = MODEL_PRICING[model] ?? DEFAULT_PRICING
  const inputCost = (inputTokens / 1_000_000) * pricing.input
  const outputCost = (outputTokens / 1_000_000) * pricing.output
  return inputCost + outputCost
}

/**
 * Get pricing info for a model
 */
export function getModelPricing(model: string): { input: number; output: number } {
  return MODEL_PRICING[model] ?? DEFAULT_PRICING
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Generate a unique request ID
 */
function generateRequestId(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 8)
  return `req_${timestamp}_${random}`
}

/**
 * Extract text content from Claude response blocks
 */
export function extractTextContent(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
}

/**
 * Extract tool use blocks from Claude response
 */
export function extractToolUseBlocks(
  content: Anthropic.ContentBlock[]
): Anthropic.ToolUseBlock[] {
  return content.filter(
    (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
  )
}

/**
 * Format tool results for conversation history
 */
export function formatToolResults(
  toolUseBlocks: Anthropic.ToolUseBlock[],
  results: Array<{ success: boolean; data?: unknown; error?: string }>
): Anthropic.ToolResultBlockParam[] {
  return toolUseBlocks.map((toolUse, index) => {
    const result = results[index]
    if (!result) {
      return {
        type: 'tool_result' as const,
        tool_use_id: toolUse.id,
        content: JSON.stringify({ success: false, error: 'No result' }),
        is_error: true,
      }
    }
    return {
      type: 'tool_result' as const,
      tool_use_id: toolUse.id,
      content: JSON.stringify(result),
      is_error: !result.success,
    }
  })
}
