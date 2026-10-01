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

    // Discover every public-schema table dynamically so we don't fall behind
    // when new tables are added to the master schema. Excludes anything in
    // the pg_* internal namespace.
    const { rows: tableRows } = await db.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables
       WHERE schemaname = 'public'
         AND tablename NOT LIKE 'pg_%'
       ORDER BY tablename`
    )

    if (tableRows.length === 0) {
      console.log('⚠️  No public-schema tables found - nothing to clear')
    } else {
      const tableList = tableRows.map((r) => `"${r.tablename}"`).join(', ')

      // Single TRUNCATE handles every table in one shot; CASCADE follows FKs
      // and RESTART IDENTITY resets sequences (item 27).
      await db.query(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`)

      for (const { tablename } of tableRows) {
        console.log(`✅ Truncated ${tablename}`)
      }
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
