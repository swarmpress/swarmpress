#!/usr/bin/env tsx
/**
 * Clear Script
 * Removes all data from the database (useful for testing)
 */

import { db } from '../packages/backend/src/db/connection'
import * as readline from 'readline'

/**
 * Ask for confirmation
 */
function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  return new Promise((resolve) => {
    rl.question(`${question} (yes/no): `, (answer) => {
      rl.close()
      resolve(answer.toLowerCase() === 'yes')
    })
  })
}

/**
 * Clear all tables
 */
async function clearDatabase() {
  console.log('🗑️  Clearing database...\n')

  try {
    // Connect
    await db.query('SELECT 1')
    console.log('✅ Database connected\n')

    // Ask for confirmation
    const confirmed = await confirm('⚠️  This will DELETE ALL DATA. Continue?')
    if (!confirmed) {
      console.log('Cancelled.')
      await db.end()
      process.exit(0)
    }

    console.log('\nDeleting data...\n')

    // Delete in reverse order of dependencies
    const tables = [
      'state_audit_log',
      'question_tickets',
      'tasks',
      'content_items',
      'pages',
      'websites',
      'agents',
    ]

    for (const table of tables) {
      const result = await db.query(`DELETE FROM ${table}`)
      console.log(`✅ Cleared ${table} (${result.rowCount} rows)`)
    }

    console.log('\n✨ Database cleared successfully!\n')
    await db.end()
  } catch (error) {
    console.error('❌ Clear failed:', error)
    await db.end()
    process.exit(1)
  }
}

// Run clear
clearDatabase()
