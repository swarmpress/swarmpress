#!/usr/bin/env tsx
/**
 * Cleanup Script
 * Terminates all running workflows and optionally resets content status
 */

import dotenv from 'dotenv'
import { resolve } from 'path'
dotenv.config({ path: resolve(__dirname, '../.env') })

import { db } from '../packages/backend/src/db/connection'
import { temporalClient } from '../packages/workflows/src/temporal/client'

const WEBSITE_ID = '42b7e20d-7f6c-48aa-9e16-f610a84b79a6'

async function main() {
  console.log('🧹 Cleanup Script')
  console.log('==================')
  console.log('')

  const resetContent = process.argv.includes('--reset-content')
  const terminateAll = process.argv.includes('--terminate-workflows')

  try {
    // Connect to database
    await db.query('SELECT 1')
    console.log('✅ Database connected')

    // Connect to Temporal
    await temporalClient.connect()
    console.log('✅ Temporal connected')

    // Terminate workflows
    if (terminateAll) {
      console.log('')
      console.log('Terminating running workflows...')

      const client = temporalClient.getClient()

      // List all running workflows
      const workflowsToTerminate: string[] = []

      // Get websiteGeneration workflows
      for await (const workflow of client.list({
        query: `WorkflowType = 'websiteGenerationWorkflow' AND ExecutionStatus = 'Running'`
      })) {
        workflowsToTerminate.push(workflow.workflowId)
      }

      // Get contentProduction workflows
      for await (const workflow of client.list({
        query: `WorkflowType = 'contentProductionWorkflow' AND ExecutionStatus = 'Running'`
      })) {
        workflowsToTerminate.push(workflow.workflowId)
      }

      // Get collectionResearch workflows
      for await (const workflow of client.list({
        query: `WorkflowType = 'collectionResearchWorkflow' AND ExecutionStatus = 'Running'`
      })) {
        workflowsToTerminate.push(workflow.workflowId)
      }

      console.log(`Found ${workflowsToTerminate.length} running workflows`)

      for (const workflowId of workflowsToTerminate) {
        try {
          const handle = client.getHandle(workflowId)
          await handle.terminate('Cleanup: terminating old workflows')
          console.log(`  ✓ Terminated: ${workflowId}`)
        } catch (err) {
          console.log(`  ✗ Failed to terminate ${workflowId}: ${err}`)
        }
      }

      console.log(`✅ Terminated ${workflowsToTerminate.length} workflows`)
    }

    // Reset content
    if (resetContent) {
      console.log('')
      console.log('Resetting content status...')

      // Reset all content items to brief_created and clear body
      const result = await db.query(
        `UPDATE content_items
         SET status = 'brief_created', body = '[]'::jsonb
         WHERE website_id = $1
         RETURNING id`,
        [WEBSITE_ID]
      )

      console.log(`✅ Reset ${result.rowCount} content items to brief_created`)
    }

    // Show current status
    console.log('')
    console.log('Current content status:')
    const { rows } = await db.query(
      `SELECT status, COUNT(*) as count
       FROM content_items
       WHERE website_id = $1
       GROUP BY status
       ORDER BY status`,
      [WEBSITE_ID]
    )
    for (const row of rows) {
      console.log(`  - ${row.status}: ${row.count}`)
    }

    console.log('')
    console.log('✅ Cleanup complete')
    console.log('')
    console.log('Usage:')
    console.log('  --terminate-workflows  Terminate all running workflows')
    console.log('  --reset-content        Reset content items to brief_created')

  } catch (error) {
    console.error('❌ Error:', error)
  } finally {
    await temporalClient.close().catch(() => {})
    await db.end().catch(() => {})
  }
}

main()
