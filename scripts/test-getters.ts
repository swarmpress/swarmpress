/**
 * Test Collection Getters
 * Verify the simplified ONE API call approach works
 */

import { config } from 'dotenv'
config()

// Direct source imports for development
import { db } from '../packages/backend/src'
import { getCollectionByType } from '../packages/agents/src/getters'

async function main() {
  const collectionType = process.argv[2] || 'cinqueterre_restaurants'
  const count = parseInt(process.argv[3] || '5')

  console.log('='.repeat(60))
  console.log(`Testing Collection Getter: ${collectionType}`)
  console.log(`Target count: ${count}`)
  console.log('='.repeat(60))

  // Get website ID for Cinque Terre
  const { rows: websites } = await db.query<{ id: string }>(
    `SELECT id FROM websites WHERE domain LIKE '%cinqueterre%' OR title ILIKE '%cinque%terre%' LIMIT 1`
  )

  if (websites.length === 0) {
    console.error('Cinque Terre website not found')
    process.exit(1)
  }

  const websiteId = websites[0].id
  console.log(`Website ID: ${websiteId}`)

  // Test agent persona
  const agentPersona = 'expert travel writer specializing in Italian coastal regions, with deep knowledge of Cinque Terre local culture, cuisine, and hidden gems'

  console.log(`\nAgent Persona: ${agentPersona.substring(0, 50)}...`)
  console.log('\nFetching data...\n')

  const startTime = Date.now()

  // Use the generic getter
  const result = await getCollectionByType(
    collectionType,
    websiteId,
    agentPersona,
    count
  )

  const duration = ((Date.now() - startTime) / 1000).toFixed(1)

  console.log('='.repeat(60))
  console.log('RESULTS')
  console.log('='.repeat(60))

  console.log(`Success: ${result.success}`)
  console.log(`Items returned: ${result.items.length}`)
  console.log(`Duration: ${duration}s`)

  if (result.usage) {
    console.log(`Input tokens: ${result.usage.inputTokens}`)
    console.log(`Output tokens: ${result.usage.outputTokens}`)
  }

  if (result.error) {
    console.log(`Error: ${result.error}`)
  }

  if (result.items.length > 0) {
    console.log('\nFirst item:')
    console.log(JSON.stringify(result.items[0], null, 2))

    if (result.items.length > 1) {
      console.log('\nItem names:')
      result.items.forEach((item: any, i) => {
        const name = item.name || item.title || item.basic_information?.name || `Item ${i + 1}`
        console.log(`  ${i + 1}. ${name}`)
      })
    }
  }

  await db.end()
  console.log('\nDone!')
}

main().catch(err => {
  console.error('Error:', err)
  process.exit(1)
})
