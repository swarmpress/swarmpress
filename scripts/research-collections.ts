#!/usr/bin/env tsx
/**
 * Research Collections Script
 * Runs collection research workflows for specified collection types
 */
import dotenv from 'dotenv'
import { resolve } from 'path'
dotenv.config({ path: resolve(__dirname, '../.env') })

import pg from 'pg'
import { Client, Connection } from '@temporalio/client'

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://swarmpress:swarmpress@localhost:5432/swarmpress'
const TEMPORAL_URL = process.env.TEMPORAL_URL || 'localhost:7233'
const WEBSITE_ID = '42b7e20d-7f6c-48aa-9e16-f610a84b79a6'

// Collections to research (pass as CLI args or use defaults)
const DEFAULT_COLLECTIONS = ['cinqueterre_restaurants', 'cinqueterre_accommodations']

async function main() {
  const collectionsToResearch = process.argv.slice(2).length > 0
    ? process.argv.slice(2)
    : DEFAULT_COLLECTIONS

  console.log('')
  console.log('=========================================')
  console.log('🔬 Collection Research Runner')
  console.log('=========================================')
  console.log('')

  const db = new pg.Client({ connectionString: DATABASE_URL })
  await db.connect()
  console.log('✅ Database connected')

  // Get writer agent (used for research)
  const { rows: agents } = await db.query<{ id: string; name: string }>(
    `SELECT a.id, a.name FROM agents a
     JOIN roles r ON a.role_id = r.id
     WHERE r.name LIKE '%Writer%' LIMIT 1`
  )

  if (!agents[0]) {
    console.error('❌ No writer agent found')
    await db.end()
    return
  }

  const writerAgent = agents[0]
  console.log(`✅ Research Agent: ${writerAgent.name} (${writerAgent.id})`)

  // Connect to Temporal
  console.log('\nConnecting to Temporal...')
  const connection = await Connection.connect({ address: TEMPORAL_URL })
  const temporal = new Client({ connection })
  console.log('✅ Temporal connected')

  // Get collection configs
  const { rows: collections } = await db.query(
    `SELECT wc.id, wc.collection_type, wc.display_name, crc.enabled as research_enabled,
            crc.search_prompt, crc.default_queries
     FROM website_collections wc
     LEFT JOIN collection_research_config crc ON wc.id = crc.collection_id
     WHERE wc.website_id = $1 AND wc.collection_type = ANY($2)`,
    [WEBSITE_ID, collectionsToResearch]
  )

  console.log(`\nFound ${collections.length} collections to research:`)
  for (const c of collections) {
    console.log(`  - ${c.display_name} (${c.collection_type}) - research: ${c.research_enabled ? '✅' : '❌'}`)
  }

  // Check current item counts
  console.log('\nCurrent collection item counts:')
  for (const c of collections) {
    const { rows: counts } = await db.query(
      `SELECT COUNT(*) as total FROM collection_items WHERE website_collection_id = $1`,
      [c.id]
    )
    console.log(`  - ${c.display_name}: ${counts[0]?.total || 0} items`)
  }

  console.log('\n=========================================')
  console.log('Starting Collection Research...')
  console.log('=========================================\n')

  let researched = 0
  let failed = 0

  for (const collection of collections) {
    if (!collection.research_enabled) {
      console.log(`\n⏭️ Skipping ${collection.display_name} (research not enabled)`)
      continue
    }

    console.log(`\n🔬 Researching: ${collection.display_name}`)
    console.log(`   Type: ${collection.collection_type}`)
    console.log(`   Prompt: ${(collection.search_prompt || '').substring(0, 80)}...`)

    try {
      const workflowId = `research-${collection.collection_type}-${Date.now()}`
      const handle = await temporal.workflow.start('collectionResearchWorkflow', {
        args: [{
          websiteId: WEBSITE_ID,
          collectionType: collection.collection_type,
          agentId: writerAgent.id,
          maxResults: 20, // Start small for testing
        }],
        taskQueue: 'swarmpress-default',
        workflowId,
      })

      console.log(`   🚀 Workflow started: ${workflowId}`)
      console.log(`   ⏳ Waiting for completion (this may take a few minutes)...`)

      // Wait for workflow with longer timeout (research takes time)
      const result = await Promise.race([
        handle.result(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Timeout after 10 minutes')), 10 * 60 * 1000)
        )
      ]) as any

      if (result.success) {
        console.log(`   ✅ Research completed!`)
        console.log(`      - Items created: ${result.itemsCreated}`)
        console.log(`      - Items skipped: ${result.itemsSkipped}`)
        console.log(`      - Before: ${result.itemsBefore} → After: ${result.itemsAfter}`)
        researched++
      } else {
        console.log(`   ❌ Research failed: ${result.errors?.join(', ')}`)
        failed++
      }

    } catch (error: any) {
      console.log(`   ❌ Error: ${error.message}`)
      failed++
    }
  }

  // Final summary
  console.log('\n=========================================')
  console.log('Research Complete!')
  console.log('=========================================')
  console.log(`\nSummary:`)
  console.log(`  - Collections processed: ${collections.length}`)
  console.log(`  - Successfully researched: ${researched}`)
  console.log(`  - Failed: ${failed}`)

  // Show final item counts
  console.log('\nFinal collection item counts:')
  for (const c of collections) {
    const { rows: counts } = await db.query(
      `SELECT COUNT(*) as total FROM collection_items WHERE website_collection_id = $1`,
      [c.id]
    )
    console.log(`  - ${c.display_name}: ${counts[0]?.total || 0} items`)
  }

  await db.end()
  console.log('\n✅ Done!')
}

main().catch(error => {
  console.error('❌ Fatal error:', error)
  process.exit(1)
})
