#!/usr/bin/env tsx
/**
 * Single Page Content Test
 * Test content production with just 1 page (no rate limits)
 */

import dotenv from 'dotenv'
import { resolve } from 'path'
dotenv.config({ path: resolve(__dirname, '../.env') })

import { db } from '../packages/backend/src/db/connection'
import { temporalClient } from '../packages/workflows/src/temporal/client'
import { contentProductionWorkflow } from '../packages/workflows/src/workflows/content-production.workflow'

// Test with just 1 page - Beaches in English
const TEST_CONTENT_ID = 'f1306648-23f7-4b75-a93e-d4f089ccab2e'

// Writer Agent ID (Isabella)
const WRITER_AGENT_ID = '77103f89-c685-4f49-89d5-146de3a49ef3'

async function main() {
  console.log('🧪 Single Page Content Test')
  console.log('===========================')
  console.log('')

  try {
    // Connect to database
    await db.query('SELECT 1')
    console.log('✅ Database connected')

    // Connect to Temporal
    await temporalClient.connect()
    console.log('✅ Temporal connected')

    // Get the content item
    const { rows: contentItems } = await db.query(
      `SELECT c.id, c.title, c.status, c.metadata, p.slug
       FROM content_items c
       JOIN pages p ON p.id = c.page_id
       WHERE c.id = $1`,
      [TEST_CONTENT_ID]
    )

    if (contentItems.length === 0) {
      console.error('Content item not found!')
      return
    }

    const item = contentItems[0]
    console.log('')
    console.log(`Testing: ${item.title} (${item.slug})`)
    console.log(`Current status: ${item.status}`)

    // Get brief from metadata
    const brief = item.metadata?.content_brief || `Create content for ${item.title}`
    console.log(`Brief length: ${brief.length} chars`)

    // Start workflow
    const workflowId = `single-test-${Date.now()}`
    const client = temporalClient.getClient()

    console.log('')
    console.log('🚀 Starting workflow...')

    const handle = await client.start(contentProductionWorkflow, {
      taskQueue: 'swarmpress-content-production',
      workflowId,
      args: [{
        contentId: item.id,
        writerAgentId: WRITER_AGENT_ID,
        brief: brief,
        maxRevisions: 1,
      }],
    })

    console.log(`   Workflow ID: ${workflowId}`)
    console.log(`   View at: http://localhost:8233/namespaces/default/workflows/${workflowId}`)
    console.log('')
    console.log('⏳ Waiting for completion (this may take 1-2 minutes)...')

    // Wait for result
    const result = await handle.result()
    console.log('')
    console.log('📋 Result:', JSON.stringify(result, null, 2))

    // Check final content status
    const { rows: finalContent } = await db.query(
      `SELECT c.title, c.status, length(c.body::text) as body_len
       FROM content_items c
       WHERE c.id = $1`,
      [TEST_CONTENT_ID]
    )

    if (finalContent[0]) {
      console.log('')
      console.log('Final status:')
      console.log(`  - Title: ${finalContent[0].title}`)
      console.log(`  - Status: ${finalContent[0].status}`)
      console.log(`  - Body length: ${finalContent[0].body_len} chars`)
    }

    console.log('')
    console.log('✅ Test complete')

  } catch (error: any) {
    console.error('❌ Error:', error.message)
    if (error.cause) {
      console.error('   Cause:', error.cause.message || error.cause)
    }
  } finally {
    await temporalClient.close().catch(() => {})
    await db.end().catch(() => {})
  }
}

main()
