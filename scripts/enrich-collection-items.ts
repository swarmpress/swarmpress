#!/usr/bin/env tsx
/**
 * Enrich Collection Items Script
 * Uses Claude to research and fill ALL schema fields for collection items
 *
 * Usage:
 *   npx tsx scripts/enrich-collection-items.ts <collectionType> [--dry-run] [--limit=N] [--village=NAME]
 *
 * Examples:
 *   npx tsx scripts/enrich-collection-items.ts cinqueterre_accommodations --dry-run
 *   npx tsx scripts/enrich-collection-items.ts cinqueterre_restaurants --village=vernazza --limit=5
 */

import dotenv from 'dotenv'
import { resolve } from 'path'
import Anthropic from '@anthropic-ai/sdk'

dotenv.config({ path: resolve(__dirname, '../.env') })

import {
  websiteCollectionRepository,
  collectionItemRepository,
} from '../packages/backend/src/db/repositories'

// =============================================================================
// TYPES
// =============================================================================

interface EnrichOptions {
  collectionType: string
  dryRun: boolean
  limit: number
  village?: string
}

interface EnrichResult {
  success: boolean
  itemsProcessed: number
  itemsEnriched: number
  errors: string[]
}

// =============================================================================
// CLAUDE CLIENT
// =============================================================================

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

// =============================================================================
// ENRICHMENT PROMPTS
// =============================================================================

function getEnrichmentPrompt(
  collectionType: string,
  currentData: Record<string, unknown>,
  schema: Record<string, unknown>
): string {
  const baseType = collectionType.replace(/^[a-z]+_/, '')

  const contextByType: Record<string, string> = {
    accommodations: `You are enriching hotel/accommodation data for Cinque Terre, Italy.
Research this property thoroughly and provide complete, accurate information.
Focus on: exact location, pricing details, ratings from major platforms, room types, amenities, contact info.`,

    restaurants: `You are enriching restaurant data for Cinque Terre, Italy.
Research this restaurant thoroughly and provide complete, accurate information.
Focus on: cuisine type, price range, opening hours, specialties, reviews, location, contact info.`,

    pois: `You are enriching point of interest data for Cinque Terre, Italy.
Research this attraction/landmark thoroughly and provide complete, accurate information.
Focus on: type of attraction, opening hours, entrance fees, best time to visit, nearby attractions.`,

    hikes: `You are enriching hiking trail data for Cinque Terre, Italy.
Research this trail thoroughly and provide complete, accurate information.
Focus on: difficulty, distance, duration, elevation, start/end points, current status, tips.`,

    events: `You are enriching event data for Cinque Terre, Italy.
Research this event thoroughly and provide complete, accurate information.
Focus on: dates, location, tickets, program, history, practical tips.`,

    villages: `You are enriching village data for Cinque Terre, Italy.
Research this village thoroughly and provide complete, accurate information.
Focus on: population, history, key attractions, transportation, best viewpoints.`,

    transportation: `You are enriching transportation data for Cinque Terre, Italy.
Research this transportation option thoroughly and provide complete, accurate information.
Focus on: schedules, prices, routes, tips, accessibility.`,

    region: `You are enriching regional information for Cinque Terre/Liguria, Italy.
Research this topic thoroughly and provide complete, accurate information.`,
  }

  const context = contextByType[baseType] || `You are enriching ${baseType} data for Cinque Terre, Italy.`

  return `${context}

## Current Data (partial/incomplete)
${JSON.stringify(currentData, null, 2)}

## Target Schema (ALL fields must be filled)
${JSON.stringify(schema, null, 2)}

## Instructions
1. Use the current data as a starting point
2. Research this item to find accurate, complete information
3. Fill in ALL fields in the schema - not just required fields
4. For nested objects, fill all their properties
5. For arrays, provide realistic content (e.g., 3-5 images, 3-5 tips)
6. Use realistic pricing in EUR for Italian establishments
7. Use accurate coordinates for Cinque Terre locations (approximate lat: 44.1, lon: 9.7)
8. For ratings, use realistic scores between 3.5 and 4.9
9. For URLs, use realistic patterns (booking.com, tripadvisor.it, etc.)
10. If information is truly unavailable, use null for optional fields

## Response Format
Return ONLY valid JSON matching the schema structure.
Do not include any explanation or markdown code blocks.
Just return the raw JSON object.`
}

// =============================================================================
// RETRY WITH EXPONENTIAL BACKOFF
// =============================================================================

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number
    initialDelayMs?: number
    maxDelayMs?: number
    itemName?: string
  } = {}
): Promise<T> {
  const { maxRetries = 5, initialDelayMs = 5000, maxDelayMs = 120000, itemName = 'item' } = options
  let lastError: Error | null = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error: any) {
      lastError = error

      // Check if it's a rate limit error (429)
      const isRateLimit =
        error?.status === 429 ||
        error?.error?.type === 'rate_limit_error' ||
        error?.message?.includes('rate limit') ||
        error?.message?.includes('concurrent connections')

      if (!isRateLimit || attempt === maxRetries) {
        throw error
      }

      // Calculate delay with exponential backoff + jitter
      const baseDelay = Math.min(initialDelayMs * Math.pow(2, attempt), maxDelayMs)
      const jitter = Math.random() * 0.3 * baseDelay // 0-30% jitter
      const delay = baseDelay + jitter

      console.log(`[Enrich]   Rate limit hit for ${itemName}, waiting ${Math.round(delay / 1000)}s before retry ${attempt + 1}/${maxRetries}...`)
      await sleep(delay)
    }
  }

  throw lastError
}

// =============================================================================
// ENRICHMENT FUNCTION
// =============================================================================

async function enrichItem(
  collectionType: string,
  currentData: Record<string, unknown>,
  schema: Record<string, unknown>,
  itemName: string = 'item'
): Promise<Record<string, unknown>> {
  const prompt = getEnrichmentPrompt(collectionType, currentData, schema)

  const message = await withRetry(
    () =>
      anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8192,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
    { itemName }
  )

  const content = message.content[0]
  if (content.type !== 'text') {
    throw new Error('Unexpected response type')
  }

  // Parse the JSON response
  let enrichedData: Record<string, unknown>
  try {
    // Try to extract JSON from the response (in case it has markdown code blocks)
    let jsonText = content.text.trim()
    if (jsonText.startsWith('```json')) {
      jsonText = jsonText.replace(/^```json\n?/, '').replace(/\n?```$/, '')
    } else if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```\n?/, '').replace(/\n?```$/, '')
    }
    enrichedData = JSON.parse(jsonText)
  } catch (e) {
    console.error('Failed to parse Claude response:', content.text.substring(0, 500))
    throw new Error(`Failed to parse enriched data: ${e}`)
  }

  return enrichedData
}

// =============================================================================
// MAIN FUNCTION
// =============================================================================

async function enrichCollectionItems(options: EnrichOptions): Promise<EnrichResult> {
  const result: EnrichResult = {
    success: true,
    itemsProcessed: 0,
    itemsEnriched: 0,
    errors: [],
  }

  try {
    console.log(`\n[Enrich] Starting enrichment for: ${options.collectionType}`)
    if (options.dryRun) {
      console.log('[Enrich] DRY RUN - no database changes will be made')
    }
    if (options.village) {
      console.log(`[Enrich] Filtering by village: ${options.village}`)
    }
    console.log(`[Enrich] Limit: ${options.limit} items`)

    // Find the collection
    const collections = await websiteCollectionRepository.findByWebsite(
      '42b7e20d-7f6c-48aa-9e16-f610a84b79a6', // cinqueterre.travel
      true
    )

    const collection = collections.find(c => c.collection_type === options.collectionType)
    if (!collection) {
      throw new Error(`Collection not found: ${options.collectionType}`)
    }

    console.log(`[Enrich] Collection: ${collection.display_name}`)

    // Get the schema
    const schema = collection.json_schema as Record<string, unknown>
    if (!schema) {
      throw new Error('Collection has no schema')
    }

    // Get collection items
    let items = await collectionItemRepository.findByCollection(collection.id, {
      publishedOnly: false,
    })

    console.log(`[Enrich] Found ${items.length} items total`)

    // Filter by village if specified
    if (options.village) {
      items = items.filter(item => {
        const data = item.data as Record<string, unknown>
        const village = (data.village as string)?.toLowerCase()
        return village?.includes(options.village!.toLowerCase())
      })
      console.log(`[Enrich] Filtered to ${items.length} items for village ${options.village}`)
    }

    // Apply limit
    items = items.slice(0, options.limit)
    console.log(`[Enrich] Processing ${items.length} items`)

    // Process each item
    for (const item of items) {
      result.itemsProcessed++
      console.log(`\n[Enrich] Processing ${result.itemsProcessed}/${items.length}: ${item.slug}`)

      const currentData = item.data as Record<string, unknown>
      console.log(`[Enrich]   Current data keys: ${Object.keys(currentData).join(', ')}`)

      try {
        // Enrich the item using Claude
        const enrichedData = await enrichItem(options.collectionType, currentData, schema, item.slug)
        console.log(`[Enrich]   Enriched data keys: ${Object.keys(enrichedData).join(', ')}`)

        // Preserve essential fields
        enrichedData.slug = item.slug
        if (currentData.village) enrichedData.village = currentData.village
        if (currentData.name) enrichedData.name = currentData.name

        if (options.dryRun) {
          console.log(`[Enrich]   DRY RUN - would update item`)
          console.log(`[Enrich]   Sample enriched data:`)
          // Show a sample of the enriched data
          const sample = JSON.stringify(enrichedData, null, 2).split('\n').slice(0, 20).join('\n')
          console.log(sample + '\n    ...')
        } else {
          // Update the item in the database
          await collectionItemRepository.update(item.id, {
            data: enrichedData,
          })
          console.log(`[Enrich]   ✓ Updated in database`)
        }

        result.itemsEnriched++

        // Rate limiting - wait 5 seconds between API calls
        if (result.itemsProcessed < items.length) {
          console.log(`[Enrich]   Waiting 5 seconds...`)
          await sleep(5000)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        console.error(`[Enrich]   ✗ Failed: ${message}`)
        result.errors.push(`${item.slug}: ${message}`)
      }
    }

    // Summary
    console.log('\n[Enrich] Summary:')
    console.log(`  Items processed: ${result.itemsProcessed}`)
    console.log(`  Items enriched: ${result.itemsEnriched}`)
    console.log(`  Errors: ${result.errors.length}`)

    if (result.errors.length > 0) {
      console.log('\n[Enrich] Errors:')
      result.errors.forEach(e => console.log(`  - ${e}`))
    }

    if (options.dryRun) {
      console.log('\n[Enrich] DRY RUN complete - no changes were made')
    } else {
      console.log('\n[Enrich] Enrichment complete!')
    }
  } catch (error) {
    result.success = false
    const message = error instanceof Error ? error.message : 'Unknown error'
    result.errors.push(message)
    console.error(`\n[Enrich] Error: ${message}`)
  }

  return result
}

// =============================================================================
// CLI ENTRY POINT
// =============================================================================

async function main() {
  const args = process.argv.slice(2)

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
Enrich Collection Items Script

Usage:
  npx tsx scripts/enrich-collection-items.ts <collectionType> [options]

Arguments:
  collectionType   The collection type (e.g., cinqueterre_accommodations)

Options:
  --dry-run        Show what would be enriched without making changes
  --limit=N        Limit to N items (default: 5)
  --village=NAME   Only process items from this village
  --help, -h       Show this help message

Collections:
  cinqueterre_accommodations
  cinqueterre_restaurants
  cinqueterre_pois
  cinqueterre_hikes
  cinqueterre_events
  cinqueterre_villages
  cinqueterre_transportation
  cinqueterre_region

Examples:
  # Dry run on 3 accommodations from Vernazza
  npx tsx scripts/enrich-collection-items.ts cinqueterre_accommodations --dry-run --village=vernazza --limit=3

  # Enrich all restaurants (limit 20)
  npx tsx scripts/enrich-collection-items.ts cinqueterre_restaurants --limit=20
`)
    process.exit(0)
  }

  const collectionType = args[0]
  if (!collectionType) {
    console.error('Error: collectionType is required')
    process.exit(1)
  }

  const dryRun = args.includes('--dry-run')
  let limit = 5
  let village: string | undefined

  for (const arg of args) {
    if (arg.startsWith('--limit=')) {
      limit = parseInt(arg.replace('--limit=', ''), 10)
    }
    if (arg.startsWith('--village=')) {
      village = arg.replace('--village=', '')
    }
  }

  const result = await enrichCollectionItems({
    collectionType,
    dryRun,
    limit,
    village,
  })

  process.exit(result.success ? 0 : 1)
}

main().catch(console.error)
