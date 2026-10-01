#!/usr/bin/env tsx
/**
 * Batch Collection Pipeline Script
 * Uses Claude Message Batches API for 50% cost savings
 *
 * Multi-Agent Pipeline per batch item:
 * 1. Research Agent: Generate top 20 items for a village using web_search
 * 2. Writer Agent: Optimize content with editorial persona
 * 3. Translator Agent: Translate to EN/DE/IT/FR
 * 4. SEO Agent: Generate SEO metadata, keywords, internal links
 *
 * Usage:
 *   npx tsx scripts/batch-collection-pipeline.ts <collectionType> [options]
 *
 * Options:
 *   --dry-run         Show what would be submitted without actually submitting
 *   --village=NAME    Only process specific village (default: all 5)
 *   --items=N         Number of items per village (default: 20)
 *   --poll            Wait for completion and process results
 *   --status=ID       Check status of existing batch
 *   --results=ID      Process results of completed batch
 *
 * Examples:
 *   npx tsx scripts/batch-collection-pipeline.ts cinqueterre_pois --dry-run
 *   npx tsx scripts/batch-collection-pipeline.ts cinqueterre_accommodations --poll
 *   npx tsx scripts/batch-collection-pipeline.ts cinqueterre_events --village=vernazza
 *   npx tsx scripts/batch-collection-pipeline.ts --status=msgbatch_...
 */

import dotenv from 'dotenv'
import { resolve } from 'path'
import { writeFileSync, mkdirSync, existsSync } from 'fs'

dotenv.config({ path: resolve(__dirname, '../.env') })

import {
  BatchProcessingService,
  type BatchRequest,
  type PipelineConfig,
  type CollectionSchema,
} from '../packages/backend/src/services/batch-processing.service'
import { websiteCollectionRepository } from '../packages/backend/src/db/repositories'
import { GitHubContentService } from '../packages/github-integration/src/content-service'

// =============================================================================
// CONSTANTS
// =============================================================================

const CINQUE_TERRE_WEBSITE_ID = '42b7e20d-7f6c-48aa-9e16-f610a84b79a6'
const CINQUE_TERRE_VILLAGES = ['monterosso', 'vernazza', 'corniglia', 'manarola', 'riomaggiore']
const DEFAULT_ITEMS_PER_VILLAGE = 20

// Collection types that should be organized by village
const VILLAGE_COLLECTIONS = [
  'cinqueterre_accommodations',
  'cinqueterre_restaurants',
  'cinqueterre_pois',
  'cinqueterre_events',
  'cinqueterre_hikes',
]

// Region-level collections (not per-village)
const REGION_COLLECTIONS: Record<string, { itemCount: number; description: string }> = {
  cinqueterre_villages: {
    itemCount: 5,
    description: 'Detailed profile for each of the 5 Cinque Terre villages',
  },
  cinqueterre_weather: {
    itemCount: 12,
    description: 'Monthly weather and climate information for Cinque Terre',
  },
  cinqueterre_transportation: {
    itemCount: 10,
    description: 'Transportation options: trains, ferries, buses, car rental, parking',
  },
  cinqueterre_region: {
    itemCount: 1,
    description: 'Comprehensive overview of the Cinque Terre region',
  },
}

const ALL_COLLECTIONS = [...VILLAGE_COLLECTIONS, ...Object.keys(REGION_COLLECTIONS)]

// =============================================================================
// TYPES
// =============================================================================

interface PipelineOptions {
  collectionType: string
  dryRun: boolean
  villages: string[]
  itemsPerVillage: number
  poll: boolean
  statusBatchId?: string
  resultsBatchId?: string
}

interface PipelineResult {
  success: boolean
  batchId?: string
  status?: string
  itemsGenerated?: number
  errors: string[]
}

// =============================================================================
// HELPERS
// =============================================================================

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// =============================================================================
// MAIN PIPELINE FUNCTIONS
// =============================================================================

async function submitBatch(options: PipelineOptions): Promise<PipelineResult> {
  const result: PipelineResult = {
    success: true,
    errors: [],
  }

  try {
    const isRegionCollection = options.collectionType in REGION_COLLECTIONS

    console.log(`\n[Batch] Starting pipeline for: ${options.collectionType}`)
    if (isRegionCollection) {
      const regionConfig = REGION_COLLECTIONS[options.collectionType]
      console.log(`[Batch] Type: Region-level collection`)
      console.log(`[Batch] Items: ${regionConfig.itemCount}`)
      console.log(`[Batch] Description: ${regionConfig.description}`)
    } else {
      console.log(`[Batch] Villages: ${options.villages.join(', ')}`)
      console.log(`[Batch] Items per village: ${options.itemsPerVillage}`)
    }

    if (options.dryRun) {
      console.log('[Batch] DRY RUN - no actual API calls will be made')
    }

    // Get collection schema from database
    const collections = await websiteCollectionRepository.findByWebsite(CINQUE_TERRE_WEBSITE_ID, true)
    const collection = collections.find((c) => c.collection_type === options.collectionType)

    if (!collection) {
      throw new Error(`Collection not found: ${options.collectionType}`)
    }

    console.log(`[Batch] Collection: ${collection.display_name}`)

    const schema = collection.json_schema as CollectionSchema
    if (!schema) {
      throw new Error('Collection has no schema')
    }

    // Create batch service
    const batchService = new BatchProcessingService()

    // Create batch requests
    const requests: BatchRequest[] = []

    if (isRegionCollection) {
      // Region-level collection: single request for entire region
      const regionConfig = REGION_COLLECTIONS[options.collectionType]
      console.log(`[Batch] Creating region-level request`)

      const config: PipelineConfig = {
        village: 'region', // Use 'region' as identifier
        collectionType: options.collectionType,
        schema,
        itemCount: regionConfig.itemCount,
        languages: ['en', 'de', 'it', 'fr'],
      }

      const request = batchService.createPipelineBatchRequest(config)
      requests.push(request)
    } else {
      // Village-level collection: one request per village
      for (const village of options.villages) {
        console.log(`[Batch] Creating request for: ${village}`)

        const config: PipelineConfig = {
          village,
          collectionType: options.collectionType,
          schema,
          itemCount: options.itemsPerVillage,
          languages: ['en', 'de', 'it', 'fr'],
        }

        const request = batchService.createPipelineBatchRequest(config)
        requests.push(request)
      }
    }

    console.log(`\n[Batch] Created ${requests.length} batch requests`)

    if (options.dryRun) {
      // Save dry run output to file for inspection
      const outputDir = resolve(__dirname, '../.batch-output')
      if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true })
      }

      const outputPath = resolve(outputDir, `${options.collectionType}-dry-run.json`)
      writeFileSync(outputPath, JSON.stringify(requests, null, 2))
      console.log(`[Batch] Dry run output saved to: ${outputPath}`)

      // Show sample request
      console.log('\n[Batch] Sample request (first village):')
      console.log(JSON.stringify(requests[0], null, 2).substring(0, 2000) + '\n...')

      return result
    }

    // Submit batch
    console.log('\n[Batch] Submitting batch to Anthropic...')
    const batchResponse = await batchService.submitBatch(requests)

    result.batchId = batchResponse.batch_id
    result.status = batchResponse.status

    console.log(`[Batch] Batch submitted!`)
    console.log(`  Batch ID: ${batchResponse.batch_id}`)
    console.log(`  Status: ${batchResponse.status}`)
    console.log(`  Total requests: ${batchResponse.request_counts.total}`)

    // If polling, wait for completion
    if (options.poll) {
      console.log('\n[Batch] Polling for completion (this may take up to 24 hours)...')

      const resultsUrl = await batchService.waitForCompletion(batchResponse.batch_id, {
        pollIntervalMs: 30_000, // Check every 30 seconds
        onProgress: (progress) => {
          console.log(`[Batch] Progress: ${progress.succeeded}/${progress.total} completed`)
        },
      })

      console.log(`\n[Batch] Batch complete! Processing results...`)
      await processResults(batchService, resultsUrl, options)
    } else {
      console.log(`\n[Batch] Batch submitted. Check status with:`)
      console.log(`  npx tsx scripts/batch-collection-pipeline.ts --status=${batchResponse.batch_id}`)
    }
  } catch (error) {
    result.success = false
    const message = error instanceof Error ? error.message : 'Unknown error'
    result.errors.push(message)
    console.error(`\n[Batch] Error: ${message}`)
  }

  return result
}

async function checkStatus(batchId: string): Promise<void> {
  const batchService = new BatchProcessingService()

  console.log(`\n[Batch] Checking status of batch: ${batchId}`)

  const status = await batchService.getBatchStatus(batchId)

  console.log(`  Status: ${status.status}`)
  console.log(`  Total: ${status.request_counts.total}`)
  console.log(`  Succeeded: ${status.request_counts.succeeded}`)
  console.log(`  Errored: ${status.request_counts.errored}`)
  console.log(`  Canceled: ${status.request_counts.canceled}`)
  console.log(`  Expired: ${status.request_counts.expired}`)

  if (status.results_url) {
    console.log(`\n[Batch] Results available! Process with:`)
    console.log(`  npx tsx scripts/batch-collection-pipeline.ts --results=${batchId}`)
  }
}

async function processResults(
  batchService: BatchProcessingService,
  resultsUrl: string,
  options: PipelineOptions
): Promise<void> {
  console.log(`\n[Batch] Fetching results from: ${resultsUrl}`)

  const results = await batchService.fetchResults(resultsUrl)

  console.log(`[Batch] Processing ${results.length} results...`)

  let successCount = 0
  let errorCount = 0

  for (const result of results) {
    const extracted = batchService.extractContent(result)

    if (extracted.success && extracted.data) {
      console.log(`[Batch] ✓ ${extracted.customId}: ${(extracted.data.item_count as number) || 0} items`)
      successCount++

      // Save to GitHub
      await saveToGitHub(extracted.customId, extracted.data)
    } else {
      console.error(`[Batch] ✗ ${extracted.customId}: ${extracted.error}`)
      errorCount++
    }
  }

  console.log(`\n[Batch] Results processed:`)
  console.log(`  Succeeded: ${successCount}`)
  console.log(`  Failed: ${errorCount}`)
}

async function processResultsById(batchId: string): Promise<void> {
  const batchService = new BatchProcessingService()

  console.log(`\n[Batch] Retrieving results for batch: ${batchId}`)

  const status = await batchService.getBatchStatus(batchId)

  if (status.status !== 'ended') {
    console.log(`[Batch] Batch is still ${status.status}. Wait for it to complete.`)
    return
  }

  if (!status.results_url) {
    console.error('[Batch] No results URL available')
    return
  }

  await processResults(batchService, status.results_url, {} as PipelineOptions)
}

async function saveToGitHub(customId: string, data: Record<string, unknown>): Promise<void> {
  // customId format: cinqueterre_events-vernazza (split on last hyphen)
  const lastHyphen = customId.lastIndexOf('-')
  const collectionType = customId.substring(0, lastHyphen)
  const village = customId.substring(lastHyphen + 1)
  const baseType = collectionType.replace(/^cinqueterre_/, '')

  console.log(`[Batch] Saving ${baseType}/${village} to GitHub...`)

  // Get website info
  const { websiteRepository } = await import('../packages/backend/src/db/repositories')
  const website = await websiteRepository.findById(CINQUE_TERRE_WEBSITE_ID)

  if (!website?.github_owner || !website?.github_repo) {
    console.error('[Batch] Website not connected to GitHub')
    return
  }

  const token = website.github_access_token || process.env.GITHUB_TOKEN
  if (!token) {
    console.error('[Batch] No GitHub token available')
    return
  }

  const contentService = new GitHubContentService({
    owner: website.github_owner,
    repo: website.github_repo,
    token,
    branch: 'main',
    contentPath: 'content',
  })

  // Save the full collection JSON file
  // Format: content/collections/{collectionType}/{village}.json
  const filePath = `collections/${baseType}/${village}.json`

  try {
    await contentService.getClient().createOrUpdateFile({
      path: `content/${filePath}`,
      content: JSON.stringify(data, null, 2),
      message: `Generate ${baseType} for ${village} via batch pipeline`,
      branch: 'main',
    })

    console.log(`[Batch] ✓ Saved: ${filePath}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error(`[Batch] ✗ Failed to save ${filePath}: ${message}`)
  }
}

async function listBatches(): Promise<void> {
  const batchService = new BatchProcessingService()

  console.log('\n[Batch] Recent batches:')

  const batches = await batchService.listBatches(10)

  if (batches.length === 0) {
    console.log('  No batches found')
    return
  }

  for (const batch of batches) {
    console.log(`  ${batch.id}`)
    console.log(`    Status: ${batch.status}`)
    console.log(`    Created: ${batch.created_at}`)
    console.log(`    Requests: ${batch.request_counts.total} total, ${batch.request_counts.succeeded} succeeded`)
    console.log('')
  }
}

// =============================================================================
// CLI ENTRY POINT
// =============================================================================

async function main() {
  const args = process.argv.slice(2)

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Batch Collection Pipeline Script
Uses Claude Message Batches API for 50% cost savings

Usage:
  npx tsx scripts/batch-collection-pipeline.ts <collectionType> [options]

Arguments:
  collectionType   The collection type (e.g., cinqueterre_pois)

Options:
  --dry-run         Show what would be submitted without actually submitting
  --village=NAME    Only process specific village (default: all 5)
  --items=N         Number of items per village (default: 20)
  --poll            Wait for completion and process results
  --status=ID       Check status of existing batch
  --results=ID      Process results of completed batch
  --list            List recent batches

Collections:
  cinqueterre_accommodations
  cinqueterre_restaurants
  cinqueterre_pois
  cinqueterre_events
  cinqueterre_hikes

Examples:
  # Dry run for POIs (shows batch request without submitting)
  npx tsx scripts/batch-collection-pipeline.ts cinqueterre_pois --dry-run

  # Submit batch for accommodations (5 villages × 20 items = 100 items)
  npx tsx scripts/batch-collection-pipeline.ts cinqueterre_accommodations

  # Submit and wait for completion
  npx tsx scripts/batch-collection-pipeline.ts cinqueterre_events --poll

  # Only process Vernazza
  npx tsx scripts/batch-collection-pipeline.ts cinqueterre_restaurants --village=vernazza

  # Check status of running batch
  npx tsx scripts/batch-collection-pipeline.ts --status=msgbatch_...

  # Process results of completed batch
  npx tsx scripts/batch-collection-pipeline.ts --results=msgbatch_...

  # List recent batches
  npx tsx scripts/batch-collection-pipeline.ts --list
`)
    process.exit(0)
  }

  // Handle --list
  if (args.includes('--list')) {
    await listBatches()
    process.exit(0)
  }

  // Handle --status
  const statusArg = args.find((a) => a.startsWith('--status='))
  if (statusArg) {
    const batchId = statusArg.replace('--status=', '')
    await checkStatus(batchId)
    process.exit(0)
  }

  // Handle --results
  const resultsArg = args.find((a) => a.startsWith('--results='))
  if (resultsArg) {
    const batchId = resultsArg.replace('--results=', '')
    await processResultsById(batchId)
    process.exit(0)
  }

  // Parse collection type
  const collectionType = args[0]
  if (!collectionType) {
    console.error('Error: collectionType is required')
    console.error('Run with --help for usage information')
    process.exit(1)
  }

  // Validate collection type
  if (!ALL_COLLECTIONS.includes(collectionType)) {
    console.error(`Error: Unknown collection type: ${collectionType}`)
    console.error(`Valid types: ${ALL_COLLECTIONS.join(', ')}`)
    process.exit(1)
  }

  // Parse options
  const dryRun = args.includes('--dry-run')
  const poll = args.includes('--poll')

  let villages = [...CINQUE_TERRE_VILLAGES]
  const villageArg = args.find((a) => a.startsWith('--village='))
  if (villageArg) {
    const village = villageArg.replace('--village=', '').toLowerCase()
    if (!CINQUE_TERRE_VILLAGES.includes(village)) {
      console.error(`Error: Unknown village: ${village}`)
      console.error(`Valid villages: ${CINQUE_TERRE_VILLAGES.join(', ')}`)
      process.exit(1)
    }
    villages = [village]
  }

  let itemsPerVillage = DEFAULT_ITEMS_PER_VILLAGE
  const itemsArg = args.find((a) => a.startsWith('--items='))
  if (itemsArg) {
    itemsPerVillage = parseInt(itemsArg.replace('--items=', ''), 10)
    if (isNaN(itemsPerVillage) || itemsPerVillage < 1 || itemsPerVillage > 50) {
      console.error('Error: --items must be between 1 and 50')
      process.exit(1)
    }
  }

  // Run pipeline
  const result = await submitBatch({
    collectionType,
    dryRun,
    villages,
    itemsPerVillage,
    poll,
  })

  process.exit(result.success ? 0 : 1)
}

main().catch(console.error)
