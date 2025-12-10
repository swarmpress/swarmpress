#!/usr/bin/env tsx
/**
 * Process batch results - extract full JSON with all items
 *
 * Usage:
 *   npx tsx scripts/process-batch-results.ts <batchId>
 *   npx tsx scripts/process-batch-results.ts --all  # Process all 5 collections
 */

import dotenv from 'dotenv'
import { resolve } from 'path'
import { writeFileSync, mkdirSync, existsSync } from 'fs'
dotenv.config({ path: resolve(__dirname, '../.env') })

import Anthropic from '@anthropic-ai/sdk'

// All batch IDs from the latest submissions
const BATCH_IDS = {
  // Village-level collections (5 villages each)
  events: 'msgbatch_01K1SN3m3vT8Lk6FrRszQz7y',
  accommodations: 'msgbatch_01T8G8Y12UUhjCChmAuNWibH',
  restaurants: 'msgbatch_01Y5tBZrejzrxKL5KvLJXXiB',
  pois: 'msgbatch_01Hu91nrZ5duiX1f1YpL3mZF',
  hikes: 'msgbatch_01MSrZo3y5Qaa6w5THLqCf9z',
  // Region-level collections (single batch each)
  villages: 'msgbatch_01AQ418YBS8fJtpj6HhEro88',
  weather: 'msgbatch_011Up6xicggpQ6WHK9eKzRL1',
  transportation: 'msgbatch_019sc1iFSMBbXmdiduDMj3yy',
  region: 'msgbatch_01Qx4HyTamogEUZmTadXAoFM',
}

/**
 * Extract the wrapper JSON object containing all items
 * Handles various output formats:
 * 1. Wrapper: { "collection_type": ..., "items": [...] }
 * 2. Array directly: [ {...}, {...} ]
 * 3. Single items that need to be collected
 */
function extractWrapperJson(text: string, customId: string): { json: string | null; items: any[] | null } {
  // First, try to find and parse the wrapper with "items" array
  const wrapperPatterns = [
    /\{\s*"collection_type"\s*:/,
    /\{\s*\n\s*"collection_type"\s*:/,
  ]

  let jsonStart = -1
  for (const pattern of wrapperPatterns) {
    const match = text.match(pattern)
    if (match && match.index !== undefined) {
      jsonStart = match.index
      break
    }
  }

  if (jsonStart !== -1) {
    const result = extractCompleteJson(text, jsonStart)
    if (result) {
      return { json: result, items: null }
    }
  }

  // Try to find an array of items directly: [...items...]
  // BUT only use it if items are objects with 'slug' or 'name' fields
  const arrayStart = text.indexOf('[')
  if (arrayStart !== -1) {
    const result = extractCompleteArray(text, arrayStart)
    if (result) {
      try {
        const items = JSON.parse(result)
        // Verify items are objects (not strings) and have expected structure
        if (Array.isArray(items) && items.length >= 5 &&
            typeof items[0] === 'object' && items[0] !== null &&
            ('slug' in items[0] || 'name' in items[0])) {
          return { json: null, items }
        }
      } catch (e) {
        // Continue to other methods
      }
    }
  }

  // Try to extract individual items by finding all { "slug": ... } objects
  const items = extractIndividualItems(text)
  if (items.length > 0) {
    return { json: null, items }
  }

  // Fallback: find first { as potential wrapper
  jsonStart = text.indexOf('{')
  if (jsonStart !== -1) {
    const result = extractCompleteJson(text, jsonStart)
    if (result) {
      return { json: result, items: null }
    }
  }

  return { json: null, items: null }
}

/**
 * Extract a complete JSON object starting at a given position
 */
function extractCompleteJson(text: string, startPos: number): string | null {
  let depth = 0
  let jsonEnd = -1
  let inString = false
  let escape = false

  for (let i = startPos; i < text.length; i++) {
    const char = text[i]

    if (escape) {
      escape = false
      continue
    }

    if (char === '\\' && inString) {
      escape = true
      continue
    }

    if (char === '"' && !escape) {
      inString = !inString
      continue
    }

    if (!inString) {
      if (char === '{') {
        depth++
      } else if (char === '}') {
        depth--
        if (depth === 0) {
          jsonEnd = i + 1
          break
        }
      }
    }
  }

  if (jsonEnd === -1) return null
  return text.substring(startPos, jsonEnd)
}

/**
 * Extract a complete JSON array starting at a given position
 */
function extractCompleteArray(text: string, startPos: number): string | null {
  let depth = 0
  let jsonEnd = -1
  let inString = false
  let escape = false

  for (let i = startPos; i < text.length; i++) {
    const char = text[i]

    if (escape) {
      escape = false
      continue
    }

    if (char === '\\' && inString) {
      escape = true
      continue
    }

    if (char === '"' && !escape) {
      inString = !inString
      continue
    }

    if (!inString) {
      if (char === '[') {
        depth++
      } else if (char === ']') {
        depth--
        if (depth === 0) {
          jsonEnd = i + 1
          break
        }
      }
    }
  }

  if (jsonEnd === -1) return null
  return text.substring(startPos, jsonEnd)
}

/**
 * Extract individual item objects from text
 * Looks for patterns like: { "slug": "...", ... }
 */
function extractIndividualItems(text: string): any[] {
  const items: any[] = []
  const slugPattern = /\{\s*"slug"\s*:\s*"/g
  let match

  while ((match = slugPattern.exec(text)) !== null) {
    const startPos = match.index
    const jsonStr = extractCompleteJson(text, startPos)
    if (jsonStr) {
      try {
        const item = JSON.parse(jsonStr)
        if (item.slug) {
          items.push(item)
        }
      } catch (e) {
        // Skip malformed items
      }
    }
  }

  return items
}

/**
 * Reconstruct prefill and combine with response
 */
function reconstructWithPrefill(customId: string, responseText: string): string {
  const lastHyphen = customId.lastIndexOf('-')
  const collectionType = customId.substring(0, lastHyphen)
  const village = customId.substring(lastHyphen + 1)

  // Our prefill started with this:
  const prefill = `{
  "collection_type": "${collectionType}",
  "village": "${village}",
  "generated_at": "${new Date().toISOString()}",
  "item_count": 20,
  "items": [`

  // The response continues from the prefill
  // It should start with the first item or whitespace
  return prefill + responseText
}

async function processBatch(batchId: string, collectionName: string): Promise<void> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  console.log(`\n[${collectionName}] Processing batch: ${batchId}`)

  const batch = await client.beta.messages.batches.retrieve(batchId)

  if (batch.processing_status !== 'ended') {
    console.log(`  Status: ${batch.processing_status} - not ready`)
    return
  }

  if (!batch.results_url) {
    console.log(`  No results URL available`)
    return
  }

  const response = await fetch(batch.results_url, {
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY || '',
      'anthropic-version': '2023-06-01',
    },
  })

  const text = await response.text()
  const lines = text.split('\n').filter(Boolean)

  console.log(`  Found ${lines.length} results`)

  // Ensure output dir exists
  const outputDir = resolve(__dirname, '../.batch-output', collectionName)
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true })
  }

  let totalItems = 0
  let successCount = 0

  for (const line of lines) {
    const result = JSON.parse(line)
    const customId = result.custom_id

    // Extract village from custom_id: "cinqueterre_events-vernazza" -> "vernazza"
    const lastHyphen = customId.lastIndexOf('-')
    const village = customId.substring(lastHyphen + 1)

    console.log(`\n  Processing: ${village}`)

    if (result.result.type !== 'succeeded') {
      console.log(`    ✗ Failed: ${result.result.error?.message || 'Unknown error'}`)
      continue
    }

    const message = result.result.message
    if (!message?.content) {
      console.log(`    ✗ No content in message`)
      continue
    }

    // Get all text blocks
    const textBlocks = message.content.filter((b: any) => b.type === 'text')
    const fullText = textBlocks.map((b: any) => b.text).join('')

    console.log(`    Text length: ${fullText.length} chars`)

    // Try to extract items using multiple methods
    const extraction = extractWrapperJson(fullText, customId)
    let parsed: any = null
    let items: any[] = []

    if (extraction.json) {
      try {
        parsed = JSON.parse(extraction.json)
        items = parsed.items || []
        console.log(`    ✓ Wrapper extraction: ${items.length} items`)
      } catch (e) {
        console.log(`    Wrapper JSON parse failed: ${e}`)
      }
    }

    if (items.length === 0 && extraction.items) {
      items = extraction.items
      console.log(`    ✓ Individual items extraction: ${items.length} items`)
    }

    // If still no items, try alternative extractions
    if (items.length === 0) {
      // Try extracting from prefill-reconstructed text
      console.log(`    Trying alternative extraction methods...`)

      // Method: Extract all slug-based items directly from text
      const directItems = extractIndividualItems(fullText)
      if (directItems.length > 0) {
        items = directItems
        console.log(`    ✓ Direct item extraction: ${items.length} items`)
      }
    }

    // If STILL no items, save raw for debugging
    if (items.length === 0) {
      console.log(`    ✗ Could not extract items`)

      // Check if there's a single item (without wrapper)
      const singleItem = extractCompleteJson(fullText, fullText.indexOf('{'))
      if (singleItem) {
        try {
          const item = JSON.parse(singleItem)
          if (item.slug) {
            items = [item]
            console.log(`    ✓ Single item extraction: 1 item`)
          }
        } catch (e) {
          // Save raw for debugging
          const rawPath = resolve(outputDir, `${village}-raw.txt`)
          writeFileSync(rawPath, fullText)
          console.log(`    Saved raw output to: ${rawPath}`)
          continue
        }
      }
    }

    // Calculate item count
    const itemCount = items.length
    if (itemCount === 0) {
      console.log(`    ⚠ No items found`)
      const rawPath = resolve(outputDir, `${village}-raw.txt`)
      writeFileSync(rawPath, fullText)
      console.log(`    Saved raw output to: ${rawPath}`)
      continue
    }

    // Create wrapper structure if needed
    if (!parsed || !parsed.items) {
      const lastHyphen = customId.lastIndexOf('-')
      const collectionType = customId.substring(0, lastHyphen)
      parsed = {
        collection_type: collectionType,
        village: village,
        generated_at: new Date().toISOString(),
        item_count: itemCount,
        items: items
      }
    }

    console.log(`    ✓ Valid collection with ${itemCount} items`)
    totalItems += itemCount
    successCount++

    // Save to file
    const filename = `${village}.json`
    const filePath = resolve(outputDir, filename)
    writeFileSync(filePath, JSON.stringify(parsed, null, 2))
    console.log(`    Saved: ${collectionName}/${filename}`)
  }

  console.log(`\n[${collectionName}] Summary:`)
  console.log(`  Villages processed: ${successCount}/${lines.length}`)
  console.log(`  Total items: ${totalItems}`)
}

async function main() {
  const args = process.argv.slice(2)

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Process Batch Results

Usage:
  npx tsx scripts/process-batch-results.ts <batchId>
  npx tsx scripts/process-batch-results.ts --all
  npx tsx scripts/process-batch-results.ts --collection=events

Options:
  --all              Process all 5 collections
  --collection=NAME  Process specific collection (events, accommodations, restaurants, pois, hikes)
  <batchId>          Process specific batch ID
`)
    process.exit(0)
  }

  if (args.includes('--all')) {
    console.log('Processing all 5 collections...\n')

    for (const [name, batchId] of Object.entries(BATCH_IDS)) {
      await processBatch(batchId, name)
    }

    console.log('\n=== All batches processed ===')
    return
  }

  const collectionArg = args.find(a => a.startsWith('--collection='))
  if (collectionArg) {
    const collection = collectionArg.replace('--collection=', '') as keyof typeof BATCH_IDS
    if (!BATCH_IDS[collection]) {
      console.error(`Unknown collection: ${collection}`)
      console.error(`Valid: ${Object.keys(BATCH_IDS).join(', ')}`)
      process.exit(1)
    }
    await processBatch(BATCH_IDS[collection], collection)
    return
  }

  // Single batch ID
  const batchId = args[0]
  if (!batchId) {
    console.error('Usage: npx tsx scripts/process-batch-results.ts <batchId>')
    console.error('       npx tsx scripts/process-batch-results.ts --all')
    process.exit(1)
  }

  // Try to determine collection name from batch ID
  const collectionName = Object.entries(BATCH_IDS).find(([_, id]) => id === batchId)?.[0] || 'unknown'
  await processBatch(batchId, collectionName)
}

main().catch(console.error)
