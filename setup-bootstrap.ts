/**
 * Bootstrap for setup script
 */

import dotenv from 'dotenv'
import { resolve } from 'path'

// Load .env FIRST
dotenv.config({ path: resolve(__dirname, '.env') })

console.log('✅ Environment variables loaded\n')

// Now load and run the setup script
import('./setup-complete.js').catch((error) => {
  console.error('Fatal error during setup:', error)
  process.exit(1)
})
