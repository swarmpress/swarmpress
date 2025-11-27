/**
 * @swarm-press/backend
 * API and database layer for swarm.press
 */

import { getEnv } from '@swarm-press/shared'
import { db } from './db'

async function main() {
  console.log('🚀 Starting swarm.press backend...')

  // Validate environment
  const env = getEnv()
  console.log(`Environment: ${env.NODE_ENV}`)
  console.log(`Database: ${env.DATABASE_URL.split('@')[1]}`) // Don't log credentials

  // Test database connection
  const isConnected = await db.ping()
  if (!isConnected) {
    console.error('❌ Failed to connect to database')
    process.exit(1)
  }

  console.log('✅ Database connected')

  // Start Express + tRPC API server
  const { startServer } = await import('./api/server.js')
  await startServer(3000)

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down gracefully...')
    await db.close()
    process.exit(0)
  })
}

// Start the application
main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})

// Export database for use in other packages
export * from './db'

// Export state machine engine
export * from './state-machine'

// Export API router types for tRPC client
export type { AppRouter } from './api/routers'

// Export agent configuration service
export {
  loadAgentConfig,
  getSystemPromptForCapability,
  invalidateAgentConfig,
  invalidateAllConfigs,
  agentConfigService,
  DEFAULT_MODEL_CONFIGS,
  type AgentRuntimeConfig,
} from './services/agent-config.service'

// Export collection schema service
export { collectionSchemaService } from './services/collection-schema.service'
export type {
  CollectionSchemaDefinition,
  ValidationResult,
  CollectionItemWithMeta,
} from './services/collection-schema.service'

// Export collection repositories
export {
  websiteCollectionRepository,
  collectionItemRepository,
  collectionItemVersionRepository,
  type WebsiteCollection,
  type CollectionItem,
  type CollectionItemVersion,
} from './db/repositories'
