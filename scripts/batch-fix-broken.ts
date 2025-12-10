#!/usr/bin/env tsx
/**
 * Fix Broken Collection Extractions
 *
 * Regenerates specific village+collection combinations that failed extraction.
 *
 * Broken files:
 * - accommodations/monterosso.json (354B) - contains amenities array
 * - accommodations/vernazza.json (244B) - contains amenities array
 * - restaurants/corniglia.json (204B) - contains cuisine types array
 *
 * Usage:
 *   npx tsx scripts/batch-fix-broken.ts --submit    # Submit batch
 *   npx tsx scripts/batch-fix-broken.ts --status    # Check status
 *   npx tsx scripts/batch-fix-broken.ts --process   # Process results
 *   npx tsx scripts/batch-fix-broken.ts --dry-run   # Show what would be submitted
 */

import dotenv from 'dotenv'
import { resolve } from 'path'
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs'
dotenv.config({ path: resolve(__dirname, '../.env') })

import Anthropic from '@anthropic-ai/sdk'
import { websiteCollectionRepository } from '../packages/backend/src/db/repositories'

const BATCH_OUTPUT_DIR = resolve(__dirname, '../.batch-output/fixes')
const BATCH_ID_FILE = resolve(BATCH_OUTPUT_DIR, 'batch-id.txt')
const CINQUE_TERRE_WEBSITE_ID = '42b7e20d-7f6c-48aa-9e16-f610a84b79a6'

// Items to fix
const ITEMS_TO_FIX = [
  { collectionType: 'cinqueterre_accommodations', village: 'monterosso' },
  { collectionType: 'cinqueterre_accommodations', village: 'vernazza' },
  { collectionType: 'cinqueterre_restaurants', village: 'corniglia' },
]

async function createBatchRequests(): Promise<any[]> {
  // Get collection schemas from database
  const collections = await websiteCollectionRepository.findByWebsite(CINQUE_TERRE_WEBSITE_ID, true)

  const requests: any[] = []

  for (const item of ITEMS_TO_FIX) {
    const collection = collections.find(c => c.collection_type === item.collectionType)
    if (!collection) {
      console.error(`Collection not found: ${item.collectionType}`)
      continue
    }

    const schema = collection.json_schema as any
    const itemCount = 20

    // Build the comprehensive prompt
    const prompt = buildPipelinePrompt(item.village, item.collectionType, schema, itemCount)

    // Create prefill to force JSON structure
    const prefill = `{
  "collection_type": "${item.collectionType}",
  "village": "${item.village}",
  "generated_at": "${new Date().toISOString()}",
  "item_count": ${itemCount},
  "items": [`

    requests.push({
      custom_id: `${item.collectionType}-${item.village}`,
      params: {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 16384,
        messages: [
          { role: 'user', content: prompt },
          { role: 'assistant', content: prefill }
        ]
      }
    })
  }

  return requests
}

function buildPipelinePrompt(village: string, collectionType: string, schema: any, itemCount: number): string {
  const villageCapitalized = village.charAt(0).toUpperCase() + village.slice(1)
  const baseType = collectionType.replace(/^cinqueterre_/, '')

  // Get the item schema properties
  const itemSchema = schema?.properties?.item_schema || schema
  const schemaStr = JSON.stringify(itemSchema, null, 2)

  return `You are a multi-agent content pipeline for CinqueTerre.Travel, generating comprehensive ${baseType} data for ${villageCapitalized}.

=== CRITICAL REQUIREMENTS ===
You MUST generate EXACTLY ${itemCount} actual ${baseType} items with REAL data.
Each item MUST have:
- A unique slug (lowercase, hyphenated)
- A real name of an actual ${baseType.slice(0, -1)} in ${villageCapitalized}
- Complete multilingual content (EN, DE, IT, FR)
- Accurate location data for ${villageCapitalized}, Cinque Terre, Italy

=== OUTPUT SCHEMA ===
Each item in the "items" array MUST follow this schema:
${schemaStr}

=== MULTI-AGENT PIPELINE ===

[PHASE 1: RESEARCH AGENT]
Research the top ${itemCount} ${baseType} in ${villageCapitalized}, Cinque Terre.
- Find real establishment names
- Verify addresses and contact info
- Identify key features and amenities
- Note price ranges and ratings

[PHASE 2: WRITER AGENT]
For each item, write compelling descriptions:
- Target audience: sophisticated travelers seeking authentic Italian experiences
- Tone: informative yet engaging, highlighting unique character
- Include practical details travelers need
- Mention atmosphere, specialties, standout features

[PHASE 3: TRANSLATOR AGENT]
Translate ALL text fields to 4 languages:
- en: English (original)
- de: German
- it: Italian
- fr: French

All translations must be natural, not literal.

[PHASE 4: SEO AGENT]
Optimize each item for search:
- Generate SEO title (50-60 chars)
- Meta description (150-160 chars)
- 5-8 relevant keywords
- Internal link suggestions

=== FINAL OUTPUT ===
Output a complete JSON object with exactly ${itemCount} items in the "items" array.
Each item must be a complete ${baseType.slice(0, -1)} with all required fields filled.

DO NOT output explanations, just the JSON data starting with the items array content.`
}

async function submitBatch(dryRun: boolean): Promise<void> {
  const requests = await createBatchRequests()

  console.log(`\n=== Fix Broken Extractions Batch ===\n`)
  console.log(`Items to fix: ${ITEMS_TO_FIX.length}`)
  ITEMS_TO_FIX.forEach(item => {
    console.log(`  - ${item.collectionType}/${item.village}`)
  })

  if (dryRun) {
    console.log('\n[DRY RUN] Sample request:')
    console.log(JSON.stringify(requests[0], null, 2).substring(0, 3000) + '\n...')
    return
  }

  // Ensure output directory exists
  if (!existsSync(BATCH_OUTPUT_DIR)) {
    mkdirSync(BATCH_OUTPUT_DIR, { recursive: true })
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  console.log('\nSubmitting batch...')
  const batch = await client.beta.messages.batches.create({ requests })

  console.log(`\nBatch submitted!`)
  console.log(`  ID: ${batch.id}`)
  console.log(`  Status: ${batch.processing_status}`)

  // Save batch ID for later
  writeFileSync(BATCH_ID_FILE, batch.id)
  console.log(`\nBatch ID saved to: ${BATCH_ID_FILE}`)
  console.log(`\nCheck status with:`)
  console.log(`  npx tsx scripts/batch-fix-broken.ts --status`)
}

async function checkStatus(): Promise<void> {
  if (!existsSync(BATCH_ID_FILE)) {
    console.log('No batch ID found. Run with --submit first.')
    return
  }

  const batchId = readFileSync(BATCH_ID_FILE, 'utf-8').trim()
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const batch = await client.beta.messages.batches.retrieve(batchId)

  console.log(`\n=== Batch Status ===`)
  console.log(`  ID: ${batch.id}`)
  console.log(`  Status: ${batch.processing_status}`)
  console.log(`  Created: ${batch.created_at}`)

  if (batch.request_counts) {
    console.log(`  Processing: ${batch.request_counts.processing}`)
    console.log(`  Succeeded: ${batch.request_counts.succeeded}`)
    console.log(`  Errored: ${batch.request_counts.errored}`)
  }

  if (batch.results_url) {
    console.log(`  Results URL: ${batch.results_url}`)
    console.log(`\nProcess results with:`)
    console.log(`  npx tsx scripts/batch-fix-broken.ts --process`)
  }
}

async function processResults(): Promise<void> {
  if (!existsSync(BATCH_ID_FILE)) {
    console.log('No batch ID found. Run with --submit first.')
    return
  }

  const batchId = readFileSync(BATCH_ID_FILE, 'utf-8').trim()
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const batch = await client.beta.messages.batches.retrieve(batchId)

  if (batch.processing_status !== 'ended') {
    console.log(`Batch not complete yet. Status: ${batch.processing_status}`)
    return
  }

  if (!batch.results_url) {
    console.log('No results URL available')
    return
  }

  console.log(`\n=== Processing Results ===\n`)

  const response = await fetch(batch.results_url, {
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY || '',
      'anthropic-version': '2023-06-01'
    }
  })

  const text = await response.text()
  const lines = text.split('\n').filter(Boolean)

  console.log(`Found ${lines.length} results`)

  let successCount = 0
  let errorCount = 0

  for (const line of lines) {
    const result = JSON.parse(line)
    const customId = result.custom_id // e.g., cinqueterre_accommodations-monterosso
    const [collectionType, village] = customId.split('-')
    const baseType = collectionType.replace(/^cinqueterre_/, '')

    if (result.result.type !== 'succeeded') {
      console.log(`  ✗ ${customId}: ${result.result.error?.message || 'Unknown error'}`)
      errorCount++
      continue
    }

    const message = result.result.message
    const textContent = message.content.find((c: any) => c.type === 'text')?.text || ''

    // Complete the prefill and parse
    const prefillStart = `{
  "collection_type": "${collectionType}",
  "village": "${village}",
  "generated_at": "${new Date().toISOString()}",
  "item_count": 20,
  "items": [`

    const fullJson = prefillStart + textContent

    try {
      const parsed = JSON.parse(fullJson)

      // Save to correct location
      const outputDir = resolve(__dirname, `../.batch-output/${baseType}`)
      if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true })
      }

      const filePath = resolve(outputDir, `${village}.json`)
      writeFileSync(filePath, JSON.stringify(parsed, null, 2))

      console.log(`  ✓ Saved: ${baseType}/${village}.json (${parsed.items?.length || 0} items)`)
      successCount++
    } catch (e) {
      console.log(`  ✗ ${customId}: JSON parse error`)

      // Save raw for debugging
      const rawPath = resolve(BATCH_OUTPUT_DIR, `${baseType}-${village}-raw.txt`)
      writeFileSync(rawPath, textContent)
      console.log(`    Raw saved to: ${rawPath}`)
      errorCount++
    }
  }

  console.log(`\n=== Summary ===`)
  console.log(`  Successful: ${successCount}`)
  console.log(`  Errors: ${errorCount}`)
}

async function main() {
  const args = process.argv.slice(2)

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Fix Broken Collection Extractions

Usage:
  npx tsx scripts/batch-fix-broken.ts --submit    Submit batch to Anthropic
  npx tsx scripts/batch-fix-broken.ts --status    Check batch status
  npx tsx scripts/batch-fix-broken.ts --process   Process completed results
  npx tsx scripts/batch-fix-broken.ts --dry-run   Show what would be submitted
`)
    process.exit(0)
  }

  if (args.includes('--submit')) {
    await submitBatch(false)
  } else if (args.includes('--dry-run')) {
    await submitBatch(true)
  } else if (args.includes('--status')) {
    await checkStatus()
  } else if (args.includes('--process')) {
    await processResults()
  } else {
    console.log('Specify --submit, --status, --process, or --dry-run')
    console.log('Use --help for more info')
  }
}

main().catch(console.error)
