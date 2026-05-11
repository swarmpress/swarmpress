/**
 * Temporal Worker
 * Executes workflows and activities
 */

// Load environment variables FIRST
import dotenv from 'dotenv'
import { resolve } from 'path'
dotenv.config({ path: resolve(__dirname, '../../../../.env') })

import { Worker, NativeConnection } from '@temporalio/worker'
import { getEnv } from '@swarm-press/shared'
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
      bundlerOptions: {
        // @swarm-press/shared exports validators that import fs/promises/path
        // for filesystem audits. Workflow code only touches the type surface
        // (via `import type * as activities`), but webpack still surfaces these
        // as transitive deps. Ignore them at the bundler level — they are
        // never invoked from workflow code at runtime.
        ignoreModules: ['fs', 'fs/promises', 'path'],
        // webpack 5 defaults assume a browser context: `output.publicPath: 'auto'`
        // reads `document.currentScript`, and chunk loading reads `self`. Both
        // throw inside Temporal's bare VM. Pin publicPath to '' and route global
        // refs through `globalThis` so the bundle init survives.
        webpackConfigHook: (config) => {
          config.output = {
            ...(config.output || {}),
            publicPath: '',
            globalObject: 'globalThis',
          }
          return config
        },
      },
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
 * Initialize default workers for swarm.press
 */
export async function initializeWorkers(): Promise<void> {
  console.log('🚀 Initializing Temporal workers...')

  // Import activities (will be implemented in Phase 4)
  const activities = await import('../activities')

  // Create workers for different task queues
  await workerManager.createWorker({
    taskQueue: 'swarmpress-default',
    activities,
  })

  await workerManager.createWorker({
    taskQueue: 'swarmpress-content-production',
    activities,
  })

  await workerManager.createWorker({
    taskQueue: 'swarmpress-editorial-review',
    activities,
  })

  await workerManager.createWorker({
    taskQueue: 'swarmpress-publishing',
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

// Auto-start workers when this file is run directly
startWorkers().catch(console.error)
