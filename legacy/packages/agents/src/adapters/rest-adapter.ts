/**
 * REST Tool Adapter
 * Executes REST API calls based on tool configuration
 */

import type { ToolType, RestToolParams, RestToolConfig } from '@swarm-press/shared'
import { BaseToolAdapter, type AdapterResult } from './base-adapter'

/**
 * Adapter for REST API tools
 */
export class RestToolAdapter extends BaseToolAdapter {
  readonly type: ToolType = 'rest'

  private baseUrl: string = ''
  private defaultHeaders: Record<string, string> = {}
  private defaultMethod: string = 'GET'
  private timeoutMs: number = 30000

  protected async doInitialize(): Promise<void> {
    if (!this.config) {
      throw new Error('RestToolAdapter: No configuration provided')
    }

    if (!this.config.endpoint_url) {
      throw new Error('RestToolAdapter: endpoint_url is required')
    }

    this.baseUrl = this.config.endpoint_url

    // Parse REST-specific config
    const restConfig = this.config.config as RestToolConfig | undefined

    if (restConfig) {
      // Set default headers with secret interpolation
      if (restConfig.headers) {
        this.defaultHeaders = this.interpolateSecretsInObject(restConfig.headers)
      }

      // Set up authentication
      if (restConfig.auth_type && restConfig.auth_type !== 'none') {
        const authHeader = restConfig.auth_header || 'Authorization'
        switch (restConfig.auth_type) {
          case 'bearer':
            if (this.secrets['API_KEY'] || this.secrets['TOKEN']) {
              this.defaultHeaders[authHeader] = `Bearer ${this.secrets['API_KEY'] || this.secrets['TOKEN']}`
            }
            break
          case 'api_key':
            if (this.secrets['API_KEY']) {
              this.defaultHeaders[authHeader] = this.secrets['API_KEY']
            }
            break
          case 'basic':
            if (this.secrets['USERNAME'] && this.secrets['PASSWORD']) {
              const credentials = Buffer.from(
                `${this.secrets['USERNAME']}:${this.secrets['PASSWORD']}`
              ).toString('base64')
              this.defaultHeaders[authHeader] = `Basic ${credentials}`
            }
            break
        }
      }

      // Set default method and timeout
      if (restConfig.default_method) {
        this.defaultMethod = restConfig.default_method
      }
      if (restConfig.timeout_ms) {
        this.timeoutMs = restConfig.timeout_ms
      }
    }

    // Always add Content-Type if not present
    if (!this.defaultHeaders['Content-Type']) {
      this.defaultHeaders['Content-Type'] = 'application/json'
    }
  }

  async execute(params: unknown): Promise<AdapterResult> {
    if (!this.isReady()) {
      return { success: false, error: 'Adapter not initialized' }
    }

    try {
      const restParams = params as RestToolParams
      const method = restParams.method || this.defaultMethod
      const path = restParams.path || ''

      // Build URL with query parameters
      let url = `${this.baseUrl}${path}`
      if (restParams.query) {
        const queryString = new URLSearchParams(restParams.query).toString()
        url += `?${queryString}`
      }

      // Merge headers
      const headers = {
        ...this.defaultHeaders,
        ...restParams.headers,
      }

      // Build fetch options
      const fetchOptions: RequestInit = {
        method,
        headers,
        signal: AbortSignal.timeout(this.timeoutMs),
      }

      // Add body for non-GET requests
      if (restParams.body && method !== 'GET') {
        fetchOptions.body = typeof restParams.body === 'string'
          ? restParams.body
          : JSON.stringify(restParams.body)
      }

      console.log(`[RestToolAdapter] ${method} ${url}`)

      const response = await fetch(url, fetchOptions)

      // Parse response
      const contentType = response.headers.get('content-type') || ''
      let data: unknown

      if (contentType.includes('application/json')) {
        data = await response.json()
      } else {
        data = await response.text()
      }

      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
          data,
        }
      }

      return { success: true, data }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      console.error(`[RestToolAdapter] Request failed:`, errorMessage)
      return { success: false, error: errorMessage }
    }
  }

  async dispose(): Promise<void> {
    this.baseUrl = ''
    this.defaultHeaders = {}
    this.defaultMethod = 'GET'
    this.timeoutMs = 30000
    await super.dispose()
  }
}
