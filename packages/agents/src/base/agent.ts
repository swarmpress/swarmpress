/**
 * Base Agent Infrastructure
 * Enhanced implementation with Anthropic SDK best practices
 */

import Anthropic from '@anthropic-ai/sdk'
import { getEnv, type AgentCapability } from '@swarm-press/shared'
import type { AgentRuntimeConfig } from '@swarm-press/backend'
import { ToolRegistry, ToolContext, ToolResult } from './tools'
import {
  createMetrics,
  finalizeMetrics,
  recordMetricsError,
  type APICallMetrics,
} from './api-call'

// ============================================================================
// Types
// ============================================================================

/**
 * Legacy agent config for backward compatibility
 * New code should use AgentRuntimeConfig from backend
 */
export interface AgentConfig {
  name: string
  role: string
  department: string
  capabilities: (string | AgentCapability)[]
  systemPrompt: string
  model?: string
  maxTokens?: number
  temperature?: number
  topP?: number
  maxToolIterations?: number // Maximum tool-use loop iterations (default: 10)
}

export interface AgentContext {
  agentId: string
  taskId?: string
  websiteId?: string
  contentId?: string
  conversationHistory?: Anthropic.MessageParam[]
}

// Re-export AgentRuntimeConfig for convenience
export type { AgentRuntimeConfig }

export interface AgentResponse {
  success: boolean
  content?: string
  data?: any
  error?: string
}

export interface AgentTask {
  taskType: string
  description: string
  context?: Record<string, any>
}

// ============================================================================
// Base Agent Class
// ============================================================================

export class BaseAgent {
  protected config: AgentConfig
  protected runtimeConfig?: AgentRuntimeConfig
  protected client: Anthropic
  protected conversationHistory: Anthropic.MessageParam[] = []
  protected toolRegistry: ToolRegistry
  protected lastMetrics?: APICallMetrics

  constructor(config: AgentConfig, runtimeConfig?: AgentRuntimeConfig) {
    this.config = config
    this.runtimeConfig = runtimeConfig
    this.toolRegistry = new ToolRegistry()

    // Initialize Anthropic client
    const apiKey = getEnv().ANTHROPIC_API_KEY
    this.client = new Anthropic({ apiKey })
  }

  /**
   * Get the tool registry for registering tools
   */
  getToolRegistry(): ToolRegistry {
    return this.toolRegistry
  }

  /**
   * Get the last API call metrics
   */
  getLastMetrics(): APICallMetrics | undefined {
    return this.lastMetrics
  }

  /**
   * Get effective model configuration
   * Prioritizes: runtimeConfig > config > defaults
   */
  protected getModelConfig() {
    if (this.runtimeConfig) {
      return {
        model: this.runtimeConfig.modelConfig.model,
        maxTokens: this.runtimeConfig.modelConfig.maxTokens,
        temperature: this.runtimeConfig.modelConfig.temperature,
        topP: this.runtimeConfig.modelConfig.topP,
      }
    }
    return {
      model: this.config.model || 'claude-sonnet-4-5-20250929',
      maxTokens: this.config.maxTokens || 8192,
      temperature: this.config.temperature,
      topP: this.config.topP,
    }
  }

  /**
   * Get effective system prompt
   * Uses runtimeConfig if available, otherwise falls back to config
   */
  protected getSystemPrompt(taskType?: string): string {
    if (this.runtimeConfig && taskType) {
      const prompt = this.runtimeConfig.systemPrompts.get(taskType)
        || this.runtimeConfig.systemPrompts.get('system')
      if (prompt) return prompt
    }
    return this.config.systemPrompt
  }

  /**
   * Execute a task with tool-use support
   * Implements a loop that continues until Claude finishes (end_turn)
   * Supports both built-in tools and external tools (REST, GraphQL, MCP)
   */
  async execute(
    task: AgentTask,
    context: AgentContext = { agentId: this.config.name }
  ): Promise<AgentResponse> {
    const maxIterations = this.config.maxToolIterations || 10
    let iteration = 0
    const toolResults: ToolResult[] = []

    // Initialize metrics tracking if we have runtime config
    let metrics: APICallMetrics | undefined
    if (this.runtimeConfig) {
      metrics = createMetrics(this.runtimeConfig, context, task.taskType)
    }

    try {
      // Build the prompt
      const userMessage = this.buildPrompt(task)

      // Add to conversation history
      this.conversationHistory.push({
        role: 'user',
        content: userMessage,
      })

      // Build tool context (prefer values from AgentContext, fallback to task.context)
      const toolContext: ToolContext = {
        agentId: context.agentId,
        agentName: this.config.name,
        taskId: context.taskId,
        contentId: context.contentId || task.context?.contentId,
        websiteId: context.websiteId || task.context?.websiteId,
      }

      // Load external tools if websiteId is available
      const websiteId = toolContext.websiteId
      if (websiteId && !this.toolRegistry.hasExternalToolsLoaded()) {
        try {
          await this.toolRegistry.loadExternalTools(websiteId)
        } catch (error) {
          console.warn(
            `[${this.config.name}] Failed to load external tools:`,
            error instanceof Error ? error.message : error
          )
          // Continue without external tools
        }
      }

      // Get tool definitions (built-in + external)
      const tools = this.toolRegistry.getDefinitionsWithExternal()
      const hasTools = tools.length > 0

      // Get effective model config and system prompt
      const modelConfig = this.getModelConfig()
      const systemPrompt = this.getSystemPrompt(task.taskType)

      console.log(
        `[${this.config.name}] Executing task: ${task.taskType} ` +
        `(model: ${modelConfig.model}, temp: ${modelConfig.temperature ?? 'default'}, ` +
        `${hasTools ? tools.length + ' tools' : 'no tools'})`
      )

      // Tool-use loop
      while (iteration < maxIterations) {
        iteration++

        // Build API call params with full SDK utilization
        const apiParams: Anthropic.MessageCreateParamsNonStreaming = {
          model: modelConfig.model,
          max_tokens: modelConfig.maxTokens,
          system: systemPrompt,
          messages: this.conversationHistory,
        }

        // Add sampling controls if specified
        if (modelConfig.temperature !== undefined) {
          apiParams.temperature = modelConfig.temperature
        }
        if (modelConfig.topP !== undefined) {
          apiParams.top_p = modelConfig.topP
        }

        // Add tools if available
        if (hasTools) {
          apiParams.tools = tools
        }

        // Add metadata if we have runtime config
        if (this.runtimeConfig) {
          apiParams.metadata = {
            user_id: Buffer.from(
              `${context.agentId}:${context.websiteId || 'global'}:${context.taskId || 'adhoc'}`
            ).toString('base64').slice(0, 64),
          }
        }

        // Call Claude
        const response = await this.client.messages.create(apiParams)

        console.log(
          `[${this.config.name}] Iteration ${iteration}: stop_reason=${response.stop_reason}, ` +
          `tokens: ${response.usage.input_tokens}/${response.usage.output_tokens}`
        )

        // Track tool usage in metrics
        if (metrics) {
          const toolUseBlocks = response.content.filter(
            (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
          )
          for (const toolUse of toolUseBlocks) {
            if (!metrics.toolsUsed) metrics.toolsUsed = []
            if (!metrics.toolsUsed.includes(toolUse.name)) {
              metrics.toolsUsed.push(toolUse.name)
            }
          }
        }

        // Add assistant response to history
        this.conversationHistory.push({
          role: 'assistant',
          content: response.content,
        })

        // Check stop reason
        if (response.stop_reason === 'end_turn') {
          // Done - extract final text response
          const content = this.extractTextContent(response.content)

          // Finalize metrics
          if (metrics) {
            this.lastMetrics = finalizeMetrics(metrics, response)
          }

          // Clean up external tool connections
          await this.toolRegistry.dispose()

          return {
            success: true,
            content,
            data: {
              iterations: iteration,
              toolResults,
              response,
              metrics: this.lastMetrics,
            },
          }
        }

        if (response.stop_reason === 'tool_use') {
          // Execute tool calls
          const toolUseBlocks = response.content.filter(
            (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
          )

          if (toolUseBlocks.length === 0) {
            console.warn(`[${this.config.name}] tool_use stop reason but no tool_use blocks`)
            break
          }

          // Execute all tool calls (supports both built-in and external)
          const toolResultBlocks: Anthropic.ToolResultBlockParam[] = []

          for (const toolUse of toolUseBlocks) {
            console.log(`[${this.config.name}] Calling tool: ${toolUse.name}`)

            // Use executeWithExternal to handle both built-in and external tools
            const result = await this.toolRegistry.executeWithExternal(
              toolUse.name,
              toolUse.input,
              toolContext
            )

            toolResults.push(result)

            toolResultBlocks.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: JSON.stringify(result),
              is_error: !result.success,
            })
          }

          // Add tool results to conversation
          this.conversationHistory.push({
            role: 'user',
            content: toolResultBlocks,
          })

          // Continue loop - Claude will process tool results
          continue
        }

        // Handle other stop reasons
        if (response.stop_reason === 'max_tokens') {
          console.warn(`[${this.config.name}] Hit max tokens limit`)
          const content = this.extractTextContent(response.content)

          // Finalize metrics
          if (metrics) {
            this.lastMetrics = finalizeMetrics(metrics, response)
          }

          // Clean up external tool connections
          await this.toolRegistry.dispose()

          return {
            success: true,
            content,
            data: {
              iterations: iteration,
              toolResults,
              truncated: true,
              metrics: this.lastMetrics,
            },
          }
        }

        // Unknown stop reason - break to avoid infinite loop
        console.warn(`[${this.config.name}] Unexpected stop reason: ${response.stop_reason}`)
        break
      }

      // Exceeded max iterations - clean up
      if (metrics) {
        recordMetricsError(metrics, `Exceeded max iterations (${maxIterations})`)
        this.lastMetrics = metrics
      }
      await this.toolRegistry.dispose()

      console.error(`[${this.config.name}] Exceeded max iterations (${maxIterations})`)
      return {
        success: false,
        error: `Agent exceeded maximum tool iterations (${maxIterations})`,
        data: { iterations: iteration, toolResults, metrics: this.lastMetrics },
      }
    } catch (error) {
      // Record error in metrics
      if (metrics) {
        recordMetricsError(metrics, error instanceof Error ? error : String(error))
        this.lastMetrics = metrics
      }

      // Clean up on error
      await this.toolRegistry.dispose()

      console.error(`[${this.config.name}] Execution error:`, error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        data: { iterations: iteration, toolResults, metrics: this.lastMetrics },
      }
    }
  }

  /**
   * Extract text content from Claude response blocks
   */
  private extractTextContent(content: Anthropic.ContentBlock[]): string {
    return content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
  }

  /**
   * Build prompt from task
   */
  protected buildPrompt(task: AgentTask): string {
    let prompt = `Task: ${task.taskType}\n\n`
    prompt += `Description: ${task.description}\n\n`

    if (task.context) {
      prompt += `Context:\n${JSON.stringify(task.context, null, 2)}\n\n`
    }

    return prompt
  }

  /**
   * Clear conversation history
   */
  clearHistory(): void {
    this.conversationHistory = []
  }

  /**
   * Get agent info
   */
  getInfo() {
    return {
      name: this.config.name,
      role: this.config.role,
      department: this.config.department,
      capabilities: this.config.capabilities,
    }
  }

  /**
   * Delegate to another agent (simplified)
   */
  async delegateToAgent(
    targetAgentName: string,
    task: AgentTask,
    _context?: Record<string, any>
  ): Promise<AgentResponse> {
    // Simplified delegation - just add a note about delegation
    return {
      success: true,
      content: `Delegated task "${task.taskType}" to ${targetAgentName}`,
      data: { delegated: true, targetAgent: targetAgentName },
    }
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Create a simple agent response
 */
export function createResponse(
  success: boolean,
  content?: string,
  data?: any
): AgentResponse {
  return { success, content, data }
}

/**
 * Create an error response
 */
export function createErrorResponse(error: string | Error): AgentResponse {
  return {
    success: false,
    error: typeof error === 'string' ? error : error.message,
  }
}
