/**
 * Tool Registry System
 * Provides Claude tool-use capabilities for swarm.press agents
 */

import Anthropic from '@anthropic-ai/sdk'

// ============================================================================
// Types
// ============================================================================

/**
 * Tool definition matching Claude API format
 */
export interface ToolDefinition {
  name: string
  description: string
  input_schema: {
    type: 'object'
    properties: Record<string, ToolProperty>
    required: string[]
  }
}

export interface ToolProperty {
  type: string
  description: string
  enum?: string[]
  items?: ToolProperty
}

/**
 * Context passed to tool handlers
 */
export interface ToolContext {
  agentId: string
  agentName: string
  taskId?: string
  contentId?: string
  websiteId?: string
}

/**
 * Result from tool execution
 */
export interface ToolResult {
  success: boolean
  data?: any
  error?: string
}

/**
 * Tool handler function type
 */
export type ToolHandler<TInput = any> = (
  input: TInput,
  context: ToolContext
) => Promise<ToolResult>

/**
 * Tool registration entry
 */
interface ToolEntry {
  definition: ToolDefinition
  handler: ToolHandler
}

// ============================================================================
// Tool Registry Class
// ============================================================================

/**
 * Registry for agent tools
 * Manages tool definitions and handlers for Claude tool-use
 */
export class ToolRegistry {
  private tools = new Map<string, ToolEntry>()

  /**
   * Register a tool with its definition and handler
   */
  register(definition: ToolDefinition, handler: ToolHandler): void {
    if (this.tools.has(definition.name)) {
      console.warn(`[ToolRegistry] Overwriting existing tool: ${definition.name}`)
    }
    this.tools.set(definition.name, { definition, handler })
  }

  /**
   * Register multiple tools at once
   */
  registerAll(tools: Array<{ definition: ToolDefinition; handler: ToolHandler }>): void {
    for (const tool of tools) {
      this.register(tool.definition, tool.handler)
    }
  }

  /**
   * Get all tool definitions for Claude API
   */
  getDefinitions(): Anthropic.Tool[] {
    return Array.from(this.tools.values()).map((entry) => ({
      name: entry.definition.name,
      description: entry.definition.description,
      input_schema: entry.definition.input_schema as Anthropic.Tool.InputSchema,
    }))
  }

  /**
   * Check if a tool exists
   */
  has(name: string): boolean {
    return this.tools.has(name)
  }

  /**
   * Get a specific tool definition
   */
  getDefinition(name: string): ToolDefinition | undefined {
    return this.tools.get(name)?.definition
  }

  /**
   * Execute a tool by name
   */
  async execute(name: string, input: any, context: ToolContext): Promise<ToolResult> {
    const entry = this.tools.get(name)
    if (!entry) {
      return {
        success: false,
        error: `Tool not found: ${name}`,
      }
    }

    try {
      console.log(`[ToolRegistry] Executing tool: ${name}`, { input, agentId: context.agentId })
      const result = await entry.handler(input, context)
      console.log(`[ToolRegistry] Tool ${name} result:`, result.success ? 'success' : result.error)
      return result
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      console.error(`[ToolRegistry] Tool ${name} failed:`, errorMessage)
      return {
        success: false,
        error: `Tool execution failed: ${errorMessage}`,
      }
    }
  }

  /**
   * Get list of registered tool names
   */
  getToolNames(): string[] {
    return Array.from(this.tools.keys())
  }

  /**
   * Clear all registered tools
   */
  clear(): void {
    this.tools.clear()
  }
}

// ============================================================================
// Helper Functions for Creating Tool Definitions
// ============================================================================

/**
 * Create a tool definition with type safety
 */
export function defineTool<TInput>(
  name: string,
  description: string,
  properties: Record<string, ToolProperty>,
  required: string[],
  handler: ToolHandler<TInput>
): { definition: ToolDefinition; handler: ToolHandler<TInput> } {
  return {
    definition: {
      name,
      description,
      input_schema: {
        type: 'object',
        properties,
        required,
      },
    },
    handler,
  }
}

/**
 * Create a simple string property
 */
export function stringProp(description: string, enumValues?: string[]): ToolProperty {
  const prop: ToolProperty = { type: 'string', description }
  if (enumValues) {
    prop.enum = enumValues
  }
  return prop
}

/**
 * Create a number property
 */
export function numberProp(description: string): ToolProperty {
  return { type: 'number', description }
}

/**
 * Create a boolean property
 */
export function booleanProp(description: string): ToolProperty {
  return { type: 'boolean', description }
}

/**
 * Create an array property
 */
export function arrayProp(description: string, items: ToolProperty): ToolProperty {
  return { type: 'array', description, items }
}

/**
 * Create an object property
 */
export function objectProp(description: string): ToolProperty {
  return { type: 'object', description }
}

// ============================================================================
// Tool Result Helpers
// ============================================================================

/**
 * Create a success result
 */
export function toolSuccess(data?: any): ToolResult {
  return { success: true, data }
}

/**
 * Create an error result
 */
export function toolError(error: string): ToolResult {
  return { success: false, error }
}

// ============================================================================
// Default Export
// ============================================================================

export default ToolRegistry
