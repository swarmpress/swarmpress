/**
 * MCP (Model Context Protocol) Tool Adapter
 * Connects to MCP servers and exposes their tools
 */

import type { ToolType, MCPToolParams, MCPToolConfig } from '@swarm-press/shared'
import { BaseToolAdapter, type AdapterResult } from './base-adapter'
import { spawn, type ChildProcess } from 'child_process'

/**
 * MCP JSON-RPC message types
 */
interface MCPRequest {
  jsonrpc: '2.0'
  id: number
  method: string
  params?: Record<string, unknown>
}

interface MCPResponse {
  jsonrpc: '2.0'
  id: number
  result?: unknown
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

interface MCPNotification {
  jsonrpc: '2.0'
  method: string
  params?: Record<string, unknown>
}

/**
 * Adapter for MCP (Model Context Protocol) servers
 */
export class MCPToolAdapter extends BaseToolAdapter {
  readonly type: ToolType = 'mcp'

  private process: ChildProcess | null = null
  private requestId = 0
  private pendingRequests = new Map<number, {
    resolve: (value: MCPResponse) => void
    reject: (error: Error) => void
  }>()
  private buffer = ''
  private availableTools: string[] = []

  protected async doInitialize(): Promise<void> {
    if (!this.config) {
      throw new Error('MCPToolAdapter: No configuration provided')
    }

    const mcpConfig = this.config.config as MCPToolConfig | undefined
    if (!mcpConfig || !mcpConfig.command) {
      throw new Error('MCPToolAdapter: command is required in config')
    }

    // Prepare environment with secrets
    const env = {
      ...process.env,
      ...mcpConfig.env,
      ...this.secrets,
    }

    // Spawn the MCP server process
    console.log(`[MCPToolAdapter] Starting MCP server: ${mcpConfig.command}`)

    this.process = spawn(mcpConfig.command, mcpConfig.args || [], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    // Set up message handling
    this.process.stdout?.on('data', (data: Buffer) => {
      this.handleData(data.toString())
    })

    this.process.stderr?.on('data', (data: Buffer) => {
      console.error(`[MCPToolAdapter] stderr: ${data.toString()}`)
    })

    this.process.on('close', (code) => {
      console.log(`[MCPToolAdapter] Process exited with code ${code}`)
      this.process = null
    })

    this.process.on('error', (error) => {
      console.error(`[MCPToolAdapter] Process error:`, error)
      this.process = null
    })

    // Initialize the MCP connection
    await this.initializeMCP()

    // List available tools
    await this.discoverTools(mcpConfig.tools)
  }

  private handleData(data: string): void {
    this.buffer += data

    // Try to parse complete JSON-RPC messages
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() || '' // Keep incomplete line in buffer

    for (const line of lines) {
      if (!line.trim()) continue

      try {
        const message = JSON.parse(line) as MCPResponse | MCPNotification
        if ('id' in message && message.id !== undefined) {
          // Response to a request
          const pending = this.pendingRequests.get(message.id)
          if (pending) {
            this.pendingRequests.delete(message.id)
            pending.resolve(message as MCPResponse)
          }
        } else {
          // Notification (not awaited)
          console.log(`[MCPToolAdapter] Notification: ${(message as MCPNotification).method}`)
        }
      } catch (e) {
        console.error(`[MCPToolAdapter] Failed to parse message: ${line}`)
      }
    }
  }

  private async sendRequest(method: string, params?: Record<string, unknown>): Promise<MCPResponse> {
    if (!this.process?.stdin) {
      throw new Error('MCP process not running')
    }

    const id = ++this.requestId
    const request: MCPRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    }

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject })

      const message = JSON.stringify(request) + '\n'
      this.process!.stdin!.write(message, (error) => {
        if (error) {
          this.pendingRequests.delete(id)
          reject(error)
        }
      })

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id)
          reject(new Error(`Request ${method} timed out`))
        }
      }, 30000)
    })
  }

  private async initializeMCP(): Promise<void> {
    const response = await this.sendRequest('initialize', {
      protocolVersion: '1.0',
      capabilities: {
        tools: {},
      },
      clientInfo: {
        name: 'swarmpress',
        version: '1.0.0',
      },
    })

    if (response.error) {
      throw new Error(`MCP initialization failed: ${response.error.message}`)
    }

    console.log(`[MCPToolAdapter] MCP initialized successfully`)
  }

  private async discoverTools(filterTools?: string[]): Promise<void> {
    const response = await this.sendRequest('tools/list')

    if (response.error) {
      throw new Error(`Failed to list tools: ${response.error.message}`)
    }

    const tools = response.result as { tools: Array<{ name: string }> }
    this.availableTools = tools.tools.map((t) => t.name)

    // Filter tools if specified
    if (filterTools && filterTools.length > 0) {
      this.availableTools = this.availableTools.filter((t) => filterTools.includes(t))
    }

    console.log(`[MCPToolAdapter] Available tools: ${this.availableTools.join(', ')}`)
  }

  async execute(params: unknown): Promise<AdapterResult> {
    if (!this.isReady() || !this.process) {
      return { success: false, error: 'Adapter not initialized or process not running' }
    }

    try {
      const mcpParams = params as MCPToolParams

      if (!mcpParams.tool) {
        return { success: false, error: 'MCP tool name is required' }
      }

      if (!this.availableTools.includes(mcpParams.tool)) {
        return {
          success: false,
          error: `Tool "${mcpParams.tool}" not available. Available tools: ${this.availableTools.join(', ')}`,
        }
      }

      console.log(`[MCPToolAdapter] Calling tool: ${mcpParams.tool}`)

      const response = await this.sendRequest('tools/call', {
        name: mcpParams.tool,
        arguments: mcpParams.arguments || {},
      })

      if (response.error) {
        return {
          success: false,
          error: `MCP tool error: ${response.error.message}`,
        }
      }

      // MCP tools return content array
      const result = response.result as {
        content: Array<{ type: string; text?: string; data?: unknown }>
        isError?: boolean
      }

      if (result.isError) {
        const errorText = result.content
          .filter((c) => c.type === 'text')
          .map((c) => c.text)
          .join('\n')
        return { success: false, error: errorText || 'Unknown MCP error' }
      }

      // Extract text content
      const textContent = result.content
        .filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join('\n')

      return { success: true, data: textContent || result.content }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      console.error(`[MCPToolAdapter] Tool call failed:`, errorMessage)
      return { success: false, error: errorMessage }
    }
  }

  async dispose(): Promise<void> {
    if (this.process) {
      // Send shutdown request
      try {
        await this.sendRequest('shutdown')
      } catch (e) {
        // Ignore shutdown errors
      }

      // Kill the process
      this.process.kill()
      this.process = null
    }

    this.pendingRequests.clear()
    this.buffer = ''
    this.availableTools = []

    await super.dispose()
  }

  /**
   * Get list of available tools from this MCP server
   */
  getAvailableTools(): string[] {
    return [...this.availableTools]
  }
}
