/**
 * Temporal Worker
 * Executes workflows and activities
 */

import { Worker, NativeConnection } from '@temporalio/worker'
import { getEnv } from '@agent-press/shared'
import path from 'path'

/**
 * Temporal Worker Manager
 */
class TemporalWorkerManager {
  private workers: Worker[] = []

  /**
   * Create and start a worker
   */
  async createWorker(options: {
    taskQueue: string
    workflowsPath?: string
    activities?: object
  }): Promise<Worker> {
    const env = getEnv()

    const connection = await NativeConnection.connect({
      address: env.TEMPORAL_URL,
    })

    const worker = await Worker.create({
      connection,
      namespace: 'default',
      taskQueue: options.taskQueue,
      workflowsPath: options.workflowsPath || path.join(__dirname, '../workflows'),
      activities: options.activities || {},
    })

    this.workers.push(worker)
    console.log(`✅ Temporal worker created for task queue: ${options.taskQueue}`)

    return worker
  }

  /**
   * Start all workers
   */
  async startAll(): Promise<void> {
    await Promise.all(this.workers.map((worker) => worker.run()))
  }

  /**
   * Shutdown all workers
   */
  async shutdownAll(): Promise<void> {
    await Promise.all(this.workers.map((worker) => worker.shutdown()))
    this.workers = []
    console.log('All Temporal workers shut down')
  }
}

export const workerManager = new TemporalWorkerManager()

/**
 * Initialize default workers for agent.press
 */
export async function initializeWorkers(): Promise<void> {
  console.log('🚀 Initializing Temporal workers...')

  // Import activities (will be implemented in Phase 4)
  const activities = await import('../activities')

  // Create workers for different task queues
  await workerManager.createWorker({
    taskQueue: 'agentpress-default',
    activities,
  })

  await workerManager.createWorker({
    taskQueue: 'agentpress-content-production',
    activities,
  })

  await workerManager.createWorker({
    taskQueue: 'agentpress-editorial-review',
    activities,
  })

  await workerManager.createWorker({
    taskQueue: 'agentpress-publishing',
    activities,
  })

  console.log('✅ All Temporal workers initialized')
}

/**
 * Start worker process
 */
export async function startWorkers(): Promise<void> {
  try {
    await initializeWorkers()
    await workerManager.startAll()
    console.log('✅ All Temporal workers started')
  } catch (error) {
    console.error('Failed to start Temporal workers:', error)
    throw error
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down Temporal workers...')
  await workerManager.shutdownAll()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  console.log('\n🛑 Shutting down Temporal workers...')
  await workerManager.shutdownAll()
  process.exit(0)
})
