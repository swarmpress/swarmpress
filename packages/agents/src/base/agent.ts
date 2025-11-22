/**
 * Base Agent Infrastructure
 * Simplified implementation for swarm.press
 */

import Anthropic from '@anthropic-ai/sdk'
import { getEnv } from '@swarm-press/shared'

// ============================================================================
// Types
// ============================================================================

export interface AgentConfig {
  name: string
  role: string
  department: string
  capabilities: string[]
  systemPrompt: string
  model?: string
  maxTokens?: number
}

export interface AgentContext {
  agentId: string
  taskId?: string
  conversationHistory?: Anthropic.MessageParam[]
}

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
  protected client: Anthropic
  protected conversationHistory: Anthropic.MessageParam[] = []

  constructor(config: AgentConfig) {
    this.config = config

    // Initialize Anthropic client
    const apiKey = getEnv().ANTHROPIC_API_KEY
    this.client = new Anthropic({ apiKey })
  }

  /**
   * Execute a task
   */
  async execute(
    task: AgentTask,
    _context: AgentContext = { agentId: this.config.name }
  ): Promise<AgentResponse> {
    try {
      // Build the prompt
      const userMessage = this.buildPrompt(task)

      // Add to conversation history
      this.conversationHistory.push({
        role: 'user',
        content: userMessage,
      })

      // Call Claude
      const response = await this.client.messages.create({
        model: this.config.model || 'claude-3-5-sonnet-20241022',
        max_tokens: this.config.maxTokens || 4096,
        system: this.config.systemPrompt,
        messages: this.conversationHistory,
      })

      // Extract response content
      const content = response.content
        .filter((block) => block.type === 'text')
        .map((block) => ('text' in block ? block.text : ''))
        .join('\n')

      // Add response to history
      this.conversationHistory.push({
        role: 'assistant',
        content: response.content,
      })

      return {
        success: true,
        content,
        data: { response },
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
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
