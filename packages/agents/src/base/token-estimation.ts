/**
 * Token Estimation Utilities
 *
 * Provides rough token estimation for pre-flight checks before API calls.
 * This helps prevent API failures due to token limits.
 *
 * Note: These are estimates based on ~4 characters per token for English text.
 * Actual tokenization may vary slightly.
 */

import Anthropic from '@anthropic-ai/sdk'

// ============================================================================
// Constants
// ============================================================================

/**
 * Claude model context window sizes (as of 2024)
 */
export const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  // Claude 3.5 Sonnet
  'claude-sonnet-4-5-20250929': 200000,
  'claude-3-5-sonnet-20241022': 200000,
  'claude-3-5-sonnet-20240620': 200000,
  // Claude 3 Opus
  'claude-3-opus-20240229': 200000,
  // Claude 3 Haiku
  'claude-3-haiku-20240307': 200000,
  // Claude 3 Sonnet
  'claude-3-sonnet-20240229': 200000,
  // Default
  default: 200000,
}

/**
 * Characters per token ratio (approximate for English)
 */
const CHARS_PER_TOKEN = 4

// ============================================================================
// Token Estimation Functions
// ============================================================================

/**
 * Estimate token count for a text string
 * Uses ~4 characters per token as a rough estimate
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

/**
 * Estimate tokens for a message array
 */
export function estimateMessagesTokens(
  messages: Anthropic.MessageParam[]
): number {
  let total = 0

  for (const message of messages) {
    if (typeof message.content === 'string') {
      total += estimateTokens(message.content)
    } else if (Array.isArray(message.content)) {
      for (const block of message.content) {
        if (block.type === 'text') {
          total += estimateTokens(block.text)
        } else if (block.type === 'tool_result') {
          total += estimateTokens(
            typeof block.content === 'string'
              ? block.content
              : JSON.stringify(block.content)
          )
        } else if (block.type === 'tool_use') {
          total += estimateTokens(JSON.stringify((block as Anthropic.ToolUseBlockParam).input))
        }
      }
    }
    // Add overhead for message structure
    total += 10 // Approximate overhead per message
  }

  return total
}

/**
 * Estimate tokens for tool definitions
 */
export function estimateToolsTokens(tools: Anthropic.Tool[]): number {
  if (!tools || tools.length === 0) return 0

  let total = 0
  for (const tool of tools) {
    total += estimateTokens(tool.name)
    total += estimateTokens(tool.description || '')
    total += estimateTokens(JSON.stringify(tool.input_schema))
    total += 20 // Overhead per tool
  }

  return total
}

/**
 * Estimate total tokens for an API call
 */
export function estimateTotalTokens(
  systemPrompt: string,
  messages: Anthropic.MessageParam[],
  tools: Anthropic.Tool[],
  maxOutputTokens: number
): number {
  const systemTokens = estimateTokens(systemPrompt)
  const messageTokens = estimateMessagesTokens(messages)
  const toolTokens = estimateToolsTokens(tools)

  return systemTokens + messageTokens + toolTokens + maxOutputTokens
}

// ============================================================================
// Token Budget Validation
// ============================================================================

export interface TokenBudgetResult {
  isOverBudget: boolean
  totalEstimated: number
  contextLimit: number
  remaining: number
  breakdown: {
    system: number
    messages: number
    tools: number
    maxOutput: number
  }
  warning?: string
}

/**
 * Calculate token budget and check if within limits
 */
const DEFAULT_CONTEXT_LIMIT = 200000

export function validateTokenBudget(
  systemPrompt: string,
  messages: Anthropic.MessageParam[],
  tools: Anthropic.Tool[],
  maxOutputTokens: number,
  model: string
): TokenBudgetResult {
  const contextLimit = MODEL_CONTEXT_LIMITS[model] ?? DEFAULT_CONTEXT_LIMIT

  const breakdown = {
    system: estimateTokens(systemPrompt),
    messages: estimateMessagesTokens(messages),
    tools: estimateToolsTokens(tools),
    maxOutput: maxOutputTokens,
  }

  const totalEstimated =
    breakdown.system + breakdown.messages + breakdown.tools + breakdown.maxOutput

  const remaining = contextLimit - totalEstimated
  const isOverBudget = remaining < 0

  let warning: string | undefined
  if (isOverBudget) {
    warning = `Estimated tokens (${totalEstimated}) exceed context limit (${contextLimit})`
  } else if (remaining < contextLimit * 0.1) {
    // Less than 10% remaining
    warning = `Token budget is tight. Only ${remaining} tokens remaining of ${contextLimit}`
  }

  return {
    isOverBudget,
    totalEstimated,
    contextLimit,
    remaining,
    breakdown,
    warning,
  }
}

/**
 * Get recommended max output tokens based on remaining budget
 */
export function getRecommendedMaxTokens(
  systemPrompt: string,
  messages: Anthropic.MessageParam[],
  tools: Anthropic.Tool[],
  model: string,
  desiredMaxTokens: number
): number {
  const contextLimit = MODEL_CONTEXT_LIMITS[model] ?? DEFAULT_CONTEXT_LIMIT

  const inputTokens =
    estimateTokens(systemPrompt) +
    estimateMessagesTokens(messages) +
    estimateToolsTokens(tools)

  // Leave some buffer (10% of context) for safety
  const buffer = Math.ceil(contextLimit * 0.1)
  const availableForOutput = contextLimit - inputTokens - buffer

  // Return minimum of desired and available
  return Math.min(desiredMaxTokens, Math.max(availableForOutput, 1024))
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Get context limit for a model
 */
export function getContextLimit(model: string): number {
  return MODEL_CONTEXT_LIMITS[model] ?? DEFAULT_CONTEXT_LIMIT
}

/**
 * Check if a model is known
 */
export function isKnownModel(model: string): boolean {
  return model in MODEL_CONTEXT_LIMITS
}

/**
 * Format token count for display
 */
export function formatTokenCount(tokens: number): string {
  if (tokens >= 1000000) {
    return `${(tokens / 1000000).toFixed(1)}M`
  }
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}K`
  }
  return tokens.toString()
}

/**
 * Create a summary of token usage
 */
export function createTokenSummary(budget: TokenBudgetResult): string {
  const lines = [
    `Token Budget Summary:`,
    `  System: ${formatTokenCount(budget.breakdown.system)}`,
    `  Messages: ${formatTokenCount(budget.breakdown.messages)}`,
    `  Tools: ${formatTokenCount(budget.breakdown.tools)}`,
    `  Max Output: ${formatTokenCount(budget.breakdown.maxOutput)}`,
    `  Total: ${formatTokenCount(budget.totalEstimated)} / ${formatTokenCount(budget.contextLimit)}`,
    `  Remaining: ${formatTokenCount(budget.remaining)}`,
  ]

  if (budget.warning) {
    lines.push(`  ⚠️ ${budget.warning}`)
  }

  return lines.join('\n')
}
