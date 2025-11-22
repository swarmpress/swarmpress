/**
 * Base Agent Infrastructure
 * Using Claude Agent SDK patterns for agent.press
 */

import Anthropic from '@anthropic-ai/sdk'
import { getEnv } from '@agent-press/shared'

// ============================================================================
// Types
// ============================================================================

export interface Tool {
  name: string
  description: string
  input_schema: {
    type: 'object'
    properties: Record<string, any>
    required?: string[]
  }
}

export interface ToolResult {
  tool_use_id: string
  content: string | object
  is_error?: boolean
}

export interface AgentConfig {
  name: string
  role: string
  department: string
  capabilities: string[]
  systemPrompt: string
  tools: Tool[]
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
  toolCalls?: ToolCall[]
  error?: string
  stopReason?: string
}

export interface ToolCall {
  id: string
  name: string
  input: any
}

// ============================================================================
// Base Agent Class
// ============================================================================

export abstract class BaseAgent {
  protected client: Anthropic
  protected config: AgentConfig

  constructor(config: AgentConfig) {
    this.config = config
    const env = getEnv()
    this.client = new Anthropic({
      apiKey: env.ANTHROPIC_API_KEY,
    })
  }

  /**
   * Execute agent with a prompt
   */
  async execute(
    prompt: string,
    context: AgentContext
  ): Promise<AgentResponse> {
    try {
      const messages: Anthropic.MessageParam[] = [
        ...(context.conversationHistory || []),
        {
          role: 'user',
          content: prompt,
        },
      ]

      let response = await this.client.messages.create({
        model: this.config.model || 'claude-3-5-sonnet-20241022',
        max_tokens: this.config.maxTokens || 4096,
        system: this.config.systemPrompt,
        tools: this.config.tools as any,
        messages,
      })

      // Handle tool use loop
      const toolCalls: ToolCall[] = []
      let finalResponse: AgentResponse | null = null

      while (response.stop_reason === 'tool_use') {
        // Extract tool calls
        const toolUses = response.content.filter(
          (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
        )

        // Execute tools
        const toolResults: ToolResult[] = []
        for (const toolUse of toolUses) {
          toolCalls.push({
            id: toolUse.id,
            name: toolUse.name,
            input: toolUse.input,
          })

          const result = await this.executeTool(toolUse.name, toolUse.input, context)
          toolResults.push({
            tool_use_id: toolUse.id,
            content: result.content,
            is_error: result.is_error,
          })
        }

        // Continue conversation with tool results
        messages.push({
          role: 'assistant',
          content: response.content,
        })

        messages.push({
          role: 'user',
          content: toolResults.map((tr) => ({
            type: 'tool_result' as const,
            tool_use_id: tr.tool_use_id,
            content: typeof tr.content === 'string' ? tr.content : JSON.stringify(tr.content),
            is_error: tr.is_error,
          })),
        })

        // Get next response
        response = await this.client.messages.create({
          model: this.config.model || 'claude-3-5-sonnet-20241022',
          max_tokens: this.config.maxTokens || 4096,
          system: this.config.systemPrompt,
          tools: this.config.tools as any,
          messages,
        })
      }

      // Extract final text response
      const textContent = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('\n')

      return {
        success: true,
        content: textContent,
        toolCalls,
        stopReason: response.stop_reason,
      }
    } catch (error) {
      console.error(`Agent ${this.config.name} execution failed:`, error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Execute a tool
   * Must be implemented by subclasses
   */
  protected abstract executeTool(
    toolName: string,
    toolInput: any,
    context: AgentContext
  ): Promise<{ content: string | object; is_error?: boolean }>

  /**
   * Delegate to another agent
   */
  protected async delegateToAgent(
    targetAgentRole: string,
    task: string,
    context: AgentContext
  ): Promise<AgentResponse> {
    try {
      // Dynamically import to avoid circular dependencies
      const { agentFactory } = await import('./factory')

      console.log(`${this.config.name} delegating to ${targetAgentRole}: ${task}`)

      // Get the target agent
      const targetAgent = await agentFactory.getAgentByRole(targetAgentRole)
      if (!targetAgent) {
        return {
          success: false,
          error: `No agent found with role: ${targetAgentRole}`,
        }
      }

      // Execute the task with the target agent
      const result = await targetAgent.execute(task, {
        agentId: context.agentId, // Pass through for audit trail
        taskId: context.taskId,
      })

      console.log(`Delegation to ${targetAgentRole} completed: ${result.success}`)

      return result
    } catch (error) {
      console.error(`Delegation to ${targetAgentRole} failed:`, error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Delegation failed',
      }
    }
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
}
