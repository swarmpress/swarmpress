/**
 * Sandbox API for JavaScript Tools
 * Provides a whitelisted API surface for user-defined JavaScript tools
 *
 * These are the ONLY functions available to user code in the vm2 sandbox.
 * All other Node.js APIs (fs, process, child_process, etc.) are blocked.
 */

/**
 * Configuration for creating a sandbox API instance
 */
export interface SandboxAPIConfig {
  secrets: Record<string, string>
  toolName: string
  logs: string[]
}

/**
 * Interpolate secrets into a template string
 * Replaces {{SECRET_KEY}} with the actual secret value
 */
function interpolateSecrets(value: string, secrets: Record<string, string>): string {
  return value.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return secrets[key] || match
  })
}

/**
 * Interpolate secrets in an object (recursively)
 */
function interpolateSecretsInObject<T extends Record<string, unknown>>(
  obj: T,
  secrets: Record<string, string>
): T {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      result[key] = interpolateSecrets(value, secrets)
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      result[key] = interpolateSecretsInObject(value as Record<string, unknown>, secrets)
    } else {
      result[key] = value
    }
  }
  return result as T
}

/**
 * Create the whitelisted API surface for the sandbox
 * This is the only interface user code can access
 */
export function createSandboxAPI(config: SandboxAPIConfig) {
  return {
    /**
     * Make an HTTP REST request
     * Supports GET, POST, PUT, DELETE, PATCH methods
     */
    async rest(params: {
      url: string
      method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
      headers?: Record<string, string>
      body?: unknown
    }): Promise<unknown> {
      // Interpolate secrets in URL and headers
      const url = interpolateSecrets(params.url, config.secrets)
      const headers = params.headers
        ? interpolateSecretsInObject(params.headers, config.secrets)
        : {}

      const response = await fetch(url, {
        method: params.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: params.body ? JSON.stringify(params.body) : undefined,
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      // Try to parse as JSON, fall back to text
      const contentType = response.headers.get('content-type')
      if (contentType?.includes('application/json')) {
        return response.json()
      }
      return response.text()
    },

    /**
     * Make a GraphQL request
     */
    async graphql(params: {
      url: string
      query: string
      variables?: Record<string, unknown>
      headers?: Record<string, string>
    }): Promise<unknown> {
      const url = interpolateSecrets(params.url, config.secrets)
      const headers = params.headers
        ? interpolateSecretsInObject(params.headers, config.secrets)
        : {}

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: JSON.stringify({
          query: params.query,
          variables: params.variables,
        }),
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const result = (await response.json()) as { data?: unknown; errors?: unknown[] }
      if (result.errors && Array.isArray(result.errors) && result.errors.length > 0) {
        throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`)
      }
      return result.data
    },

    /**
     * Log messages (captured, not sent to console)
     * Logs are returned with the tool result
     */
    log(...args: unknown[]): void {
      config.logs.push(
        args
          .map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a)))
          .join(' ')
      )
    },

    /**
     * Get current timestamp as ISO string
     */
    date(): string {
      return new Date().toISOString()
    },

    /**
     * Get a secret value by key (read-only)
     * Secrets are encrypted in the database and decrypted at runtime
     */
    secret(key: string): string | undefined {
      return config.secrets[key]
    },

    /**
     * Create a delay (for rate limiting, etc.)
     * Maximum delay is 10 seconds to prevent blocking
     */
    async sleep(ms: number): Promise<void> {
      const maxDelay = 10000 // 10 seconds max
      const actualDelay = Math.min(Math.max(0, ms), maxDelay)
      return new Promise((resolve) => setTimeout(resolve, actualDelay))
    },

    /**
     * Generate a random UUID
     */
    uuid(): string {
      return crypto.randomUUID()
    },
  }
}

/**
 * Type for the sandbox API
 */
export type SandboxAPI = ReturnType<typeof createSandboxAPI>
