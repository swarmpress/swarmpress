/**
 * Tool Registry System
 * Provides Claude tool-use capabilities for swarm.press agents
 * Supports both built-in tools and external tools (REST, GraphQL, MCP)
 */

import Anthropic from '@anthropic-ai/sdk'
import type { ToolConfig } from '@swarm-press/shared'
import { createAdapter, type ExternalToolAdapter } from '../adapters'

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

  // ==========================================================================
  // External Tool Support
  // ==========================================================================

  private externalTools = new Map<string, {
    config: ToolConfig
    adapter: ExternalToolAdapter
    customConfig?: Record<string, unknown>
  }>()

  private externalToolsLoaded = false

  /**
   * Load external tools for a specific website context
   * Fetches tool configurations from database and initializes adapters
   */
  async loadExternalTools(websiteId: string): Promise<void> {
    // Lazy import to avoid circular dependencies
    const { websiteToolRepository, toolSecretRepository } = await import('@swarm-press/backend')

    console.log(`[ToolRegistry] Loading external tools for website ${websiteId}`)

    // Get all tools for this website (including global tools)
    const websiteTools = await websiteToolRepository.findForWebsite(websiteId)

    for (const wt of websiteTools) {
      // Skip builtin tools (they use regular registration)
      if (wt.tool_config.type === 'builtin') continue

      // Skip already loaded tools
      if (this.externalTools.has(wt.tool_config.name)) continue

      try {
        // Get secrets for this tool
        const secrets = await toolSecretRepository.getSecretsForTool(
          websiteId,
          wt.tool_config.id
        )

        // Create and initialize the adapter
        const adapter = createAdapter(wt.tool_config.type)
        await adapter.initialize(wt.tool_config, secrets)

        // Store the tool
        this.externalTools.set(wt.tool_config.name, {
          config: wt.tool_config,
          adapter,
          customConfig: wt.custom_config,
        })

        console.log(`[ToolRegistry] Loaded external tool: ${wt.tool_config.name} (${wt.tool_config.type})`)
      } catch (error) {
        console.error(
          `[ToolRegistry] Failed to load external tool ${wt.tool_config.name}:`,
          error instanceof Error ? error.message : error
        )
      }
    }

    this.externalToolsLoaded = true
    console.log(`[ToolRegistry] Loaded ${this.externalTools.size} external tools`)
  }

  /**
   * Get all tool definitions including external tools
   */
  getDefinitionsWithExternal(): Anthropic.Tool[] {
    const builtinDefs = this.getDefinitions()

    const externalDefs: Anthropic.Tool[] = Array.from(this.externalTools.values()).map(({ config }) => ({
      name: config.name,
      description: config.description || `External ${config.type} tool: ${config.display_name || config.name}`,
      input_schema: (config.input_schema || {
        type: 'object',
        properties: {},
        required: [],
      }) as Anthropic.Tool.InputSchema,
    }))

    return [...builtinDefs, ...externalDefs]
  }

  /**
   * Execute a tool (built-in or external)
   */
  async executeWithExternal(name: string, input: any, context: ToolContext): Promise<ToolResult> {
    // Try built-in first
    if (this.tools.has(name)) {
      return this.execute(name, input, context)
    }

    // Try external
    const external = this.externalTools.get(name)
    if (external) {
      try {
        console.log(`[ToolRegistry] Executing external tool: ${name}`, { input, agentId: context.agentId })
        const result = await external.adapter.execute(input)
        console.log(`[ToolRegistry] External tool ${name} result:`, result.success ? 'success' : result.error)

        return {
          success: result.success,
          data: result.data,
          error: result.error,
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        console.error(`[ToolRegistry] External tool ${name} failed:`, errorMessage)
        return {
          success: false,
          error: `External tool execution failed: ${errorMessage}`,
        }
      }
    }

    return {
      success: false,
      error: `Tool not found: ${name}`,
    }
  }

  /**
   * Check if external tools have been loaded
   */
  hasExternalToolsLoaded(): boolean {
    return this.externalToolsLoaded
  }

  /**
   * Get list of all tool names (built-in and external)
   */
  getAllToolNames(): string[] {
    const builtinNames = this.getToolNames()
    const externalNames = Array.from(this.externalTools.keys())
    return [...builtinNames, ...externalNames]
  }

  /**
   * Check if a tool exists (built-in or external)
   */
  hasAny(name: string): boolean {
    return this.tools.has(name) || this.externalTools.has(name)
  }

  /**
   * Dispose and cleanup all external tool connections
   */
  async dispose(): Promise<void> {
    for (const [name, { adapter }] of this.externalTools) {
      try {
        await adapter.dispose()
        console.log(`[ToolRegistry] Disposed external tool: ${name}`)
      } catch (error) {
        console.error(`[ToolRegistry] Failed to dispose ${name}:`, error)
      }
    }
    this.externalTools.clear()
    this.externalToolsLoaded = false
  }

  /**
   * Clear all tools including external
   */
  async clearAll(): Promise<void> {
    await this.dispose()
    this.clear()
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
