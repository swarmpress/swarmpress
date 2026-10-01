/**
 * Direct Agent Test - bypasses Temporal
 * Tests the WriterAgent directly to debug write_draft
 */

import { agentFactory, initializeAgents } from '../packages/agents/src'
import { db } from '../packages/backend/src/db/connection'

async function main() {
  console.log('🧪 Direct Agent Test')
  console.log('====================\n')

  // Initialize agents
  initializeAgents()
  console.log('✅ Agents initialized')

  // Content ID for Beaches page
  const contentId = 'f1306648-23f7-4b75-a93e-d4f089ccab2e'
  const writerAgentId = '77103f89-c685-4f49-89d5-146de3a49ef3' // Isabella

  // Get the agent
  const agent = await agentFactory.getAgent(writerAgentId)
  if (!agent) {
    console.error('❌ Agent not found')
    process.exit(1)
  }

  console.log(`✅ Got agent: ${agent.getInfo().name}`)

  // Simple task - just write a brief draft
  const task = {
    taskType: 'write_content',
    description: `Create a brief content draft for content ID ${contentId}.

Use GET_CONTENT first to see the brief, then write a SIMPLE 2-block draft:
1. A heading block
2. A paragraph block

Use write_draft tool with this structure:
{
  "content_id": "${contentId}",
  "title": "Beaches in Cinque Terre",
  "body": [
    { "type": "heading", "level": 1, "text": "Beaches in Cinque Terre" },
    { "type": "paragraph", "text": "Brief intro paragraph here." }
  ]
}

Keep it SIMPLE - just 2 blocks.`,
    context: { contentId },
  }

  console.log('\n🚀 Executing agent task...\n')
  const startTime = Date.now()

  try {
    const response = await agent.execute(task, {
      agentId: writerAgentId,
      contentId,
    })

    const elapsed = (Date.now() - startTime) / 1000
    console.log(`\n⏱️  Completed in ${elapsed.toFixed(1)}s`)
    console.log('\n📋 Response:', JSON.stringify(response, null, 2))

    if (response.success) {
      // Check the database
      const result = await db.query('SELECT title, status, body FROM content_items WHERE id = $1', [contentId])
      const content = result.rows[0]
      console.log('\n📝 Database state:')
      console.log(`  Title: ${content?.title}`)
      console.log(`  Status: ${content?.status}`)
      console.log(`  Body blocks: ${Array.isArray(content?.body) ? content.body.length : 0}`)
    }
  } catch (error) {
    console.error('\n❌ Error:', error)
  }

  await db.end()
  process.exit(0)
}

main()
