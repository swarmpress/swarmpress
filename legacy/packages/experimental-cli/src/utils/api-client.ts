/**
 * tRPC API Client for CLI
 * Connects to the backend API server via HTTP
 */

const API_BASE_URL = process.env.API_URL || 'http://localhost:3000'

/**
 * Simple HTTP client for tRPC endpoints
 * Uses fetch instead of @trpc/client for simplicity
 */
class TRPCHttpClient {
  private baseUrl: string
  private authToken?: string

  constructor(baseUrl: string, authToken?: string) {
    this.baseUrl = baseUrl
    this.authToken = authToken
  }

  private async request<T>(
    path: string,
    type: 'query' | 'mutation',
    input?: unknown
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}/api/trpc/${path}`)

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`
    }

    let response: Response

    if (type === 'query') {
      if (input !== undefined) {
        url.searchParams.set('input', JSON.stringify({ json: input }))
      }
      response = await fetch(url.toString(), { headers })
    } else {
      response = await fetch(url.toString(), {
        method: 'POST',
        headers,
        body: JSON.stringify({ json: input }),
      })
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: response.statusText })) as Record<string, unknown>
      const errorObj = errorData as { error?: { message?: string }; message?: string }
      throw new Error(errorObj.error?.message || errorObj.message || 'Request failed')
    }

    const data = await response.json() as Record<string, unknown>

    // Handle tRPC response format
    const result = data.result as { data?: { json?: unknown } } | undefined
    if (result?.data?.json !== undefined) {
      return result.data.json as T
    }
    if (result?.data !== undefined) {
      return result.data as T
    }
    return data as T
  }

  // Company endpoints
  company = {
    list: {
      query: () => this.request<{ items: any[]; total: number }>('company.list', 'query'),
    },
    create: {
      mutate: (input: { name: string; description?: string }) =>
        this.request<any>('company.create', 'mutation', input),
    },
  }

  // Department endpoints
  department = {
    list: {
      query: (input?: { companyId?: string }) =>
        this.request<{ items: any[]; total: number }>('department.list', 'query', input),
    },
    create: {
      mutate: (input: { name: string; companyId: string; description?: string }) =>
        this.request<any>('department.create', 'mutation', input),
    },
  }

  // Role endpoints
  role = {
    list: {
      query: (input?: { departmentId?: string }) =>
        this.request<{ items: any[]; total: number }>('role.list', 'query', input),
    },
    create: {
      mutate: (input: { name: string; departmentId: string; description?: string }) =>
        this.request<any>('role.create', 'mutation', input),
    },
  }

  // Agent endpoints
  agent = {
    list: {
      query: (input?: { roleId?: string; departmentId?: string }) =>
        this.request<{ items: any[]; total: number }>('agent.list', 'query', input),
    },
    create: {
      mutate: (input: {
        name: string
        roleId: string
        departmentId: string
        persona: string
        virtualEmail: string
        capabilities?: string[]
      }) => this.request<any>('agent.create', 'mutation', input),
    },
  }

  // Website endpoints
  website = {
    list: {
      query: (input?: { limit?: number; offset?: number }) =>
        this.request<{ items: any[]; total: number }>('website.list', 'query', input),
    },
    create: {
      mutate: (input: { title: string; domain: string; description?: string }) =>
        this.request<any>('website.create', 'mutation', input),
    },
  }

  // Content endpoints
  content = {
    list: {
      query: (input?: { status?: string; websiteId?: string; limit?: number }) =>
        this.request<{ items: any[]; total: number }>('content.list', 'query', input),
    },
    create: {
      mutate: (input: {
        type: string
        websiteId: string
        authorAgentId: string
        metadata?: Record<string, unknown>
      }) => this.request<any>('content.create', 'mutation', input),
    },
  }

  // Workflow endpoints
  workflow = {
    status: {
      query: () => this.request<{ connected: boolean; message: string }>('workflow.status', 'query'),
    },
    startContentProduction: {
      mutate: (input: {
        contentId: string
        writerAgentId: string
        brief: string
        maxRevisions?: number
      }) =>
        this.request<{ success: boolean; workflowId: string; runId: string }>(
          'workflow.startContentProduction',
          'mutation',
          input
        ),
    },
    startEditorialReview: {
      mutate: (input: { contentId: string; editorAgentId: string }) =>
        this.request<{ success: boolean; workflowId: string; runId: string }>(
          'workflow.startEditorialReview',
          'mutation',
          input
        ),
    },
    startPublishing: {
      mutate: (input: {
        contentId: string
        websiteId: string
        seoAgentId: string
        engineeringAgentId: string
      }) =>
        this.request<{ success: boolean; workflowId: string; runId: string }>(
          'workflow.startPublishing',
          'mutation',
          input
        ),
    },
    startFullPipeline: {
      mutate: (input: {
        contentId: string
        websiteId: string
        writerAgentId: string
        editorAgentId: string
        seoAgentId: string
        engineeringAgentId: string
        brief: string
      }) =>
        this.request<{ success: boolean; pipelineId: string; contentProductionWorkflowId: string }>(
          'workflow.startFullPipeline',
          'mutation',
          input
        ),
    },
  }
}

/**
 * Create API client instance
 */
export function createApiClient(authToken?: string) {
  return new TRPCHttpClient(API_BASE_URL, authToken)
}

/**
 * Default client with development CEO auth
 * In development mode, backend auto-assigns CEO role
 */
export const api = createApiClient()

/**
 * Create system client for internal operations
 */
export const systemApi = createApiClient('system')

/**
 * Create CEO client for administrative operations
 */
export function createCeoClient(email: string) {
  return createApiClient(`ceo:${email}`)
}

/**
 * Check if API server is reachable
 */
export async function checkApiConnection(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/health`)
    return response.ok
  } catch {
    return false
  }
}
