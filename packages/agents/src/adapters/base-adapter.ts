/**
 * External Tool Adapter Interface
 * Base interface for all external tool adapters (REST, GraphQL, MCP)
 */

import type { ToolConfig, ToolType } from '@swarm-press/shared'

/**
 * Result from adapter execution
 */
export interface AdapterResult {
  success: boolean
  data?: unknown
  error?: string
}

/**
 * Base interface for external tool adapters
 */
export interface ExternalToolAdapter {
  /**
   * The type of tool this adapter handles
   */
  readonly type: ToolType

  /**
   * Initialize the adapter with configuration and secrets
   * @param config Tool configuration from database
   * @param secrets Decrypted secrets for this tool
   */
  initialize(config: ToolConfig, secrets: Record<string, string>): Promise<void>

  /**
   * Execute the tool with given parameters
   * @param params Tool-specific parameters
   */
  execute(params: unknown): Promise<AdapterResult>

  /**
   * Clean up resources (connections, processes, etc.)
   */
  dispose(): Promise<void>

  /**
   * Check if the adapter is initialized and ready
   */
  isReady(): boolean
}

/**
 * Base class with common functionality for adapters
 */
export abstract class BaseToolAdapter implements ExternalToolAdapter {
  abstract readonly type: ToolType
  protected config: ToolConfig | null = null
  protected secrets: Record<string, string> = {}
  protected initialized = false

  async initialize(config: ToolConfig, secrets: Record<string, string>): Promise<void> {
    this.config = config
    this.secrets = secrets
    await this.doInitialize()
    this.initialized = true
  }

  /**
   * Subclasses implement this for adapter-specific initialization
   */
  protected abstract doInitialize(): Promise<void>

  abstract execute(params: unknown): Promise<AdapterResult>

  async dispose(): Promise<void> {
    this.initialized = false
    this.config = null
    this.secrets = {}
  }

  isReady(): boolean {
    return this.initialized && this.config !== null
  }

  /**
   * Interpolate secrets into a template string
   * Replaces {{SECRET_KEY}} with the actual secret value
   */
  protected interpolateSecrets(template: string): string {
    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      return this.secrets[key] || match
    })
  }

  /**
   * Interpolate secrets in an object (recursively)
   */
  protected interpolateSecretsInObject<T extends Record<string, unknown>>(obj: T): T {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        result[key] = this.interpolateSecrets(value)
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        result[key] = this.interpolateSecretsInObject(value as Record<string, unknown>)
      } else {
        result[key] = value
      }
    }
    return result as T
  }
}
