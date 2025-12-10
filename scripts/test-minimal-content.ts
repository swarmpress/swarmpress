#!/usr/bin/env tsx
/**
 * Minimal Content Test
 * Test content production with just 3 pages
 */

import dotenv from 'dotenv'
import { resolve } from 'path'
dotenv.config({ path: resolve(__dirname, '../.env') })

import { db } from '../packages/backend/src/db/connection'
import { temporalClient } from '../packages/workflows/src/temporal/client'
import { contentProductionWorkflow } from '../packages/workflows/src/workflows/content-production.workflow'

// Test with 3 English pages
const TEST_CONTENT_IDS = [
  '1c0b73d5-a2c9-4b58-aef8-41b13ec5b3f8', // /en (homepage)
  'f821ba1a-a271-4271-8704-99ad8fbc7746', // /en/cinque-terre
  'f1306648-23f7-4b75-a93e-d4f089ccab2e', // /en/cinque-terre/beaches
]

// Writer Agent ID (Isabella)
const WRITER_AGENT_ID = '77103f89-c685-4f49-89d5-146de3a49ef3'

async function main() {
  console.log('🧪 Minimal Content Test')
  console.log('======================')
  console.log('')
  console.log(`Testing with ${TEST_CONTENT_IDS.length} pages`)
  console.log('')

  try {
    // Connect to database
    await db.query('SELECT 1')
    console.log('✅ Database connected')

    // Connect to Temporal
    await temporalClient.connect()
    console.log('✅ Temporal connected')

    // Get the content items to process with their briefs
    const { rows: contentItems } = await db.query(
      `SELECT c.id, c.title, c.status, c.metadata, p.slug
       FROM content_items c
       JOIN pages p ON p.id = c.page_id
       WHERE c.id = ANY($1)`,
      [TEST_CONTENT_IDS]
    )

    console.log('')
    console.log('Content items to process:')
    for (const item of contentItems) {
      console.log(`  - ${item.title} (${item.slug}) - ${item.status}`)
    }

    // Start workflows for each content item sequentially
    const client = temporalClient.getClient()

    for (const item of contentItems) {
      console.log('')
      console.log(`🚀 Starting workflow for: ${item.title}`)

      const workflowId = `test-content-${item.id}-${Date.now()}`

      // Get brief from metadata
      const brief = item.metadata?.content_brief || `Create content for ${item.title}`

      try {
        const handle = await client.start(contentProductionWorkflow, {
          taskQueue: 'content-production',
          workflowId,
          args: [{
            contentId: item.id,
            writerAgentId: WRITER_AGENT_ID,
            brief: brief,
            maxRevisions: 1,
          }],
        })

        console.log(`   Started: ${workflowId}`)
        console.log(`   View at: http://localhost:8233/namespaces/default/workflows/${workflowId}`)

        // Wait for completion (with timeout)
        console.log('   Waiting for completion...')
        const result = await handle.result()
        console.log(`   ✅ Completed: ${JSON.stringify(result)}`)
      } catch (error: any) {
        console.error(`   ❌ Failed: ${error.message}`)
      }
    }

    // Show final status
    console.log('')
    console.log('Final content status:')
    const { rows: finalStatus } = await db.query(
      `SELECT c.id, c.title, c.status, p.slug
       FROM content_items c
       JOIN pages p ON p.id = c.page_id
       WHERE c.id = ANY($1)`,
      [TEST_CONTENT_IDS]
    )
    for (const item of finalStatus) {
      console.log(`  - ${item.title}: ${item.status}`)
    }

    console.log('')
    console.log('✅ Test complete')

  } catch (error) {
    console.error('❌ Error:', error)
  } finally {
    await temporalClient.close().catch(() => {})
    await db.end().catch(() => {})
  }
}

main()
