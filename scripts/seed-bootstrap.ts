/**
 * Bootstrap for seed script - loads env before modules
 */

import dotenv from 'dotenv'
import { resolve } from 'path'

// Load .env from project root
dotenv.config({ path: resolve(__dirname, '../.env') })

console.log('✅ Environment variables loaded')

// Now load and run the seed script
import('./seed.js').catch((error) => {
  console.error('Fatal error during seeding:', error)
  process.exit(1)
})
