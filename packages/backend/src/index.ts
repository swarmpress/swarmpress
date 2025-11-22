/**
 * @agent-press/backend
 * API and database layer for agent.press
 */

import { getEnv } from '@agent-press/shared'
import { db } from './db'

async function main() {
  console.log('🚀 Starting agent.press backend...')

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

  // TODO: Start Express server (Phase 5)
  console.log('⏸️  API server not yet implemented (Phase 5)')

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
