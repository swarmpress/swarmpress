/**
 * GraphQL Tool Adapter
 * Executes GraphQL queries based on tool configuration
 */

import type { ToolType, GraphQLToolParams, GraphQLToolConfig } from '@swarm-press/shared'
import { BaseToolAdapter, type AdapterResult } from './base-adapter'

/**
 * Adapter for GraphQL API tools
 */
export class GraphQLToolAdapter extends BaseToolAdapter {
  readonly type: ToolType = 'graphql'

  private endpoint: string = ''
  private headers: Record<string, string> = {}
  private timeoutMs: number = 30000

  protected async doInitialize(): Promise<void> {
    if (!this.config) {
      throw new Error('GraphQLToolAdapter: No configuration provided')
    }

    if (!this.config.endpoint_url) {
      throw new Error('GraphQLToolAdapter: endpoint_url is required')
    }

    this.endpoint = this.config.endpoint_url

    // Parse GraphQL-specific config
    const gqlConfig = this.config.config as GraphQLToolConfig | undefined

    if (gqlConfig) {
      // Set headers with secret interpolation
      if (gqlConfig.headers) {
        this.headers = this.interpolateSecretsInObject(gqlConfig.headers)
      }

      // Set up authentication
      if (gqlConfig.auth_type && gqlConfig.auth_type !== 'none') {
        const authHeader = gqlConfig.auth_header || 'Authorization'
        switch (gqlConfig.auth_type) {
          case 'bearer':
            if (this.secrets['API_KEY'] || this.secrets['TOKEN']) {
              this.headers[authHeader] = `Bearer ${this.secrets['API_KEY'] || this.secrets['TOKEN']}`
            }
            break
          case 'api_key':
            if (this.secrets['API_KEY']) {
              this.headers[authHeader] = this.secrets['API_KEY']
            }
            break
        }
      }

      // Set timeout
      if (gqlConfig.timeout_ms) {
        this.timeoutMs = gqlConfig.timeout_ms
      }
    }

    // Always set Content-Type for GraphQL
    this.headers['Content-Type'] = 'application/json'
  }

  async execute(params: unknown): Promise<AdapterResult> {
    if (!this.isReady()) {
      return { success: false, error: 'Adapter not initialized' }
    }

    try {
      const gqlParams = params as GraphQLToolParams

      if (!gqlParams.query) {
        return { success: false, error: 'GraphQL query is required' }
      }

      // Build GraphQL request body
      const body: Record<string, unknown> = {
        query: gqlParams.query,
      }

      if (gqlParams.variables) {
        body.variables = gqlParams.variables
      }

      if (gqlParams.operation_name) {
        body.operationName = gqlParams.operation_name
      }

      console.log(`[GraphQLToolAdapter] Executing query at ${this.endpoint}`)

      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      })

      const result = await response.json() as {
        data?: unknown
        errors?: Array<{ message: string; locations?: unknown[]; path?: string[] }>
      }

      // Check for GraphQL errors
      if (result.errors && result.errors.length > 0) {
        const errorMessages = result.errors.map((e) => e.message).join('; ')
        return {
          success: false,
          error: `GraphQL errors: ${errorMessages}`,
          data: result,
        }
      }

      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
          data: result,
        }
      }

      return { success: true, data: result.data }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      console.error(`[GraphQLToolAdapter] Query failed:`, errorMessage)
      return { success: false, error: errorMessage }
    }
  }

  async dispose(): Promise<void> {
    this.endpoint = ''
    this.headers = {}
    this.timeoutMs = 30000
    await super.dispose()
  }
}
