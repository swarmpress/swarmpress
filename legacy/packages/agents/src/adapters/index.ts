/**
 * External Tool Adapters
 * Provides adapters for REST, GraphQL, MCP, and JavaScript tools
 */

export * from './base-adapter'
export * from './rest-adapter'
export * from './graphql-adapter'
export * from './mcp-adapter'
export * from './javascript-adapter'
export * from './sandbox-api'

import type { ToolType } from '@swarm-press/shared'
import type { ExternalToolAdapter } from './base-adapter'
import { RestToolAdapter } from './rest-adapter'
import { GraphQLToolAdapter } from './graphql-adapter'
import { MCPToolAdapter } from './mcp-adapter'
import { JavaScriptToolAdapter } from './javascript-adapter'

/**
 * Factory function to create the appropriate adapter for a tool type
 */
export function createAdapter(type: ToolType): ExternalToolAdapter {
  switch (type) {
    case 'rest':
      return new RestToolAdapter()
    case 'graphql':
      return new GraphQLToolAdapter()
    case 'mcp':
      return new MCPToolAdapter()
    case 'javascript':
      return new JavaScriptToolAdapter()
    case 'builtin':
      throw new Error('Builtin tools do not use external adapters')
    default:
      throw new Error(`Unknown adapter type: ${type}`)
  }
}

/**
 * Check if a tool type requires an external adapter
 */
export function requiresAdapter(type: ToolType): boolean {
  return type !== 'builtin'
}
