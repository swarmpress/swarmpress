/**
 * Bootstrap script - loads environment variables before any other modules
 */

// Load environment variables FIRST
import dotenv from 'dotenv'
import { resolve } from 'path'

// Load .env from project root
dotenv.config({ path: resolve(__dirname, '../../../.env') })

console.log('✅ Environment variables loaded')

// Now load and start the main application
import('./index.js').catch((error) => {
  console.error('Fatal error during bootstrap:', error)
  process.exit(1)
})
