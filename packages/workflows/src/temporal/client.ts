/**
 * Temporal Client
 * Manages connection to Temporal server and workflow execution
 */

import { Connection, WorkflowClient } from '@temporalio/client'
import { getEnv } from '@swarm-press/shared'

/**
 * Temporal Client Manager (Singleton)
 */
class TemporalClientManager {
  private static instance: TemporalClientManager
  private connection: Connection | null = null
  private client: WorkflowClient | null = null

  private constructor() {}

  public static getInstance(): TemporalClientManager {
    if (!TemporalClientManager.instance) {
      TemporalClientManager.instance = new TemporalClientManager()
    }
    return TemporalClientManager.instance
  }

  /**
   * Connect to Temporal server
   */
  async connect(): Promise<void> {
    if (this.connection) {
      console.log('Temporal already connected')
      return
    }

    try {
      const env = getEnv()

      // Create connection to Temporal server
      this.connection = await Connection.connect({
        address: env.TEMPORAL_URL,
      })

      console.log(`✅ Connected to Temporal at ${env.TEMPORAL_URL}`)

      // Create workflow client
      this.client = new WorkflowClient({
        connection: this.connection,
        namespace: 'default',
      })

      console.log('✅ Temporal client initialized')
    } catch (error) {
      console.error('Failed to connect to Temporal:', error)
      throw error
    }
  }

  /**
   * Get the workflow client
   */
  getClient(): WorkflowClient {
    if (!this.client) {
      throw new Error('Temporal not connected. Call connect() first.')
    }
    return this.client
  }

  /**
   * Get the connection
   */
  getConnection(): Connection {
    if (!this.connection) {
      throw new Error('Temporal not connected. Call connect() first.')
    }
    return this.connection
  }

  /**
   * Close the connection
   */
  async close(): Promise<void> {
    if (this.connection) {
      await this.connection.close()
      this.connection = null
      this.client = null
      console.log('Temporal connection closed')
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connection !== null
  }
}

export const temporalClient = TemporalClientManager.getInstance()

/**
 * Helper function to start a workflow
 */
export async function startWorkflow(
  workflowType: string,
  args: any[],
  options?: {
    workflowId?: string
    taskQueue?: string
  }
): Promise<{ workflowId: string; runId: string }> {
  const client = temporalClient.getClient()

  const handle = await client.start(workflowType, {
    args,
    taskQueue: options?.taskQueue || 'swarmpress-default',
    workflowId: options?.workflowId || `${workflowType}-${Date.now()}`,
  })

  return {
    workflowId: handle.workflowId,
    runId: handle.firstExecutionRunId,
  }
}

/**
 * Helper function to query a workflow
 */
export async function queryWorkflow<T = any>(
  workflowId: string,
  queryType: string,
  args?: any[]
): Promise<T> {
  const client = temporalClient.getClient()
  const handle = client.getHandle(workflowId)
  const queryArgs = args || []
  return await handle.query<T>(queryType, ...queryArgs as [])
}

/**
 * Helper function to signal a workflow
 */
export async function signalWorkflow(
  workflowId: string,
  signalName: string,
  args?: any[]
): Promise<void> {
  const client = temporalClient.getClient()
  const handle = client.getHandle(workflowId)
  await handle.signal(signalName, ...(args || []))
}

/**
 * Helper function to cancel a workflow
 */
export async function cancelWorkflow(workflowId: string): Promise<void> {
  const client = temporalClient.getClient()
  const handle = client.getHandle(workflowId)
  await handle.cancel()
}

/**
 * Helper function to get workflow execution result
 */
export async function getWorkflowResult<T = any>(workflowId: string): Promise<T> {
  const client = temporalClient.getClient()
  const handle = client.getHandle(workflowId)
  return await handle.result()
}
