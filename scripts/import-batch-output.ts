#!/usr/bin/env tsx
/**
 * Import Batch Output to Database
 *
 * Imports all collection data from .batch-output/ files into the PostgreSQL database.
 * This prepares the data for export to GitHub.
 *
 * Usage:
 *   npx tsx scripts/import-batch-output.ts [--dry-run]
 */

import dotenv from 'dotenv'
import { resolve } from 'path'
import * as fs from 'fs'
import * as path from 'path'

dotenv.config({ path: resolve(__dirname, '../.env') })

import {
  websiteCollectionRepository,
  collectionItemRepository,
} from '../packages/backend/src/db/repositories'

// =============================================================================
// CONFIGURATION
// =============================================================================

const BATCH_OUTPUT_DIR = '.batch-output'
const WEBSITE_ID = '42b7e20d-7f6c-48aa-9e16-f610a84b79a6' // CinqueTerre.Travel

// Village-level collections (organized by subfolder)
const VILLAGE_COLLECTIONS = {
  'accommodations': 'cinqueterre_accommodations',
  'restaurants': 'cinqueterre_restaurants',
  'pois': 'cinqueterre_pois',
  'events': 'cinqueterre_events',
  'hikes': 'cinqueterre_hikes',
}

// Region-level collections (single files)
const REGION_COLLECTIONS = {
  'villages': 'cinqueterre_villages',
  'transportation': 'cinqueterre_transportation',
  'region': 'cinqueterre_region',
  'weather': 'cinqueterre_weather',
}

// =============================================================================
// TYPES
// =============================================================================

interface ImportResult {
  collection: string
  village?: string
  itemsImported: number
  itemsUpdated: number
  errors: string[]
}

interface CollectionFile {
  collection_type: string
  village?: string
  items?: Array<Record<string, unknown>>
  // For region-level files that may have different structure
  [key: string]: unknown
}

// =============================================================================
// MAIN IMPORT FUNCTION
// =============================================================================

async function importBatchOutput(dryRun: boolean = false): Promise<ImportResult[]> {
  const results: ImportResult[] = []

  console.log(`\n[Import] Starting batch output import`)
  if (dryRun) {
    console.log('[Import] DRY RUN - no changes will be made')
  }

  // ==========================================================================
  // 1. Import Village-Level Collections
  // ==========================================================================

  console.log('\n[Import] Step 1: Importing village-level collections...')

  for (const [folder, collectionType] of Object.entries(VILLAGE_COLLECTIONS)) {
    const folderPath = path.join(BATCH_OUTPUT_DIR, folder)

    if (!fs.existsSync(folderPath)) {
      console.log(`[Import] Skipping ${folder} - folder not found`)
      continue
    }

    // Get all JSON files in the folder
    const files = fs.readdirSync(folderPath).filter(f => f.endsWith('.json'))
    console.log(`\n[Import] Processing ${folder}/ (${files.length} files)`)

    // Get collection ID
    const collections = await websiteCollectionRepository.findByWebsite(WEBSITE_ID, true)
    const collection = collections.find(c => c.collection_type === collectionType)

    if (!collection) {
      console.log(`[Import] ⚠ Collection not found: ${collectionType}`)
      continue
    }

    for (const file of files) {
      const filePath = path.join(folderPath, file)
      const village = file.replace('.json', '')

      try {
        const content = fs.readFileSync(filePath, 'utf-8')
        const data = JSON.parse(content) as CollectionFile

        const items = data.items || []
        const result: ImportResult = {
          collection: collectionType,
          village,
          itemsImported: 0,
          itemsUpdated: 0,
          errors: [],
        }

        for (const item of items) {
          const slug = item.slug as string
          if (!slug) {
            result.errors.push(`Item missing slug`)
            continue
          }

          if (dryRun) {
            result.itemsImported++
            continue
          }

          try {
            // Check if item exists
            const existing = await collectionItemRepository.findBySlug(collection.id, slug)

            if (existing) {
              // Update existing item
              await collectionItemRepository.update(existing.id, {
                data: item,
                published: true,
                featured: (item.featured as boolean) || (item.rank as number) === 1,
              })
              result.itemsUpdated++
            } else {
              // Create new item
              await collectionItemRepository.create({
                website_collection_id: collection.id,
                slug,
                data: item,
                published: true,
                featured: (item.featured as boolean) || (item.rank as number) === 1,
              })
              result.itemsImported++
            }
          } catch (err) {
            result.errors.push(`${slug}: ${err instanceof Error ? err.message : 'Unknown error'}`)
          }
        }

        console.log(`[Import] ${folder}/${village}: ${result.itemsImported} imported, ${result.itemsUpdated} updated${result.errors.length > 0 ? `, ${result.errors.length} errors` : ''}`)
        results.push(result)

      } catch (err) {
        console.log(`[Import] ⚠ Error processing ${filePath}: ${err instanceof Error ? err.message : 'Unknown error'}`)
      }
    }
  }

  // ==========================================================================
  // 2. Import Region-Level Collections
  // ==========================================================================

  console.log('\n[Import] Step 2: Importing region-level collections...')

  for (const [folder, collectionType] of Object.entries(REGION_COLLECTIONS)) {
    const folderPath = path.join(BATCH_OUTPUT_DIR, folder)

    if (!fs.existsSync(folderPath)) {
      console.log(`[Import] Skipping ${folder} - folder not found`)
      continue
    }

    // Get all JSON files in the folder
    const files = fs.readdirSync(folderPath).filter(f => f.endsWith('.json'))
    console.log(`\n[Import] Processing ${folder}/ (${files.length} files)`)

    // Get collection ID
    const collections = await websiteCollectionRepository.findByWebsite(WEBSITE_ID, true)
    const collection = collections.find(c => c.collection_type === collectionType)

    if (!collection) {
      console.log(`[Import] ⚠ Collection not found: ${collectionType}`)
      continue
    }

    for (const file of files) {
      const filePath = path.join(folderPath, file)
      const slug = file.replace('.json', '')

      try {
        const content = fs.readFileSync(filePath, 'utf-8')
        const data = JSON.parse(content)

        const result: ImportResult = {
          collection: collectionType,
          itemsImported: 0,
          itemsUpdated: 0,
          errors: [],
        }

        // For region-level collections, check if there are items or if the file IS the item
        if (data.items && Array.isArray(data.items)) {
          // File contains array of items
          for (const item of data.items) {
            const itemSlug = item.slug as string
            if (!itemSlug) {
              result.errors.push(`Item missing slug`)
              continue
            }

            if (dryRun) {
              result.itemsImported++
              continue
            }

            try {
              const existing = await collectionItemRepository.findBySlug(collection.id, itemSlug)

              if (existing) {
                await collectionItemRepository.update(existing.id, {
                  data: item,
                  published: true,
                  featured: (item.featured as boolean) || false,
                })
                result.itemsUpdated++
              } else {
                await collectionItemRepository.create({
                  website_collection_id: collection.id,
                  slug: itemSlug,
                  data: item,
                  published: true,
                  featured: (item.featured as boolean) || false,
                })
                result.itemsImported++
              }
            } catch (err) {
              result.errors.push(`${itemSlug}: ${err instanceof Error ? err.message : 'Unknown error'}`)
            }
          }
        } else {
          // File is a single item (use filename as slug)
          if (dryRun) {
            result.itemsImported = 1
          } else {
            try {
              const existing = await collectionItemRepository.findBySlug(collection.id, slug)

              if (existing) {
                await collectionItemRepository.update(existing.id, {
                  data: data,
                  published: true,
                  featured: (data.featured as boolean) || false,
                })
                result.itemsUpdated = 1
              } else {
                await collectionItemRepository.create({
                  website_collection_id: collection.id,
                  slug,
                  data: data,
                  published: true,
                  featured: (data.featured as boolean) || false,
                })
                result.itemsImported = 1
              }
            } catch (err) {
              result.errors.push(`${slug}: ${err instanceof Error ? err.message : 'Unknown error'}`)
            }
          }
        }

        console.log(`[Import] ${folder}/${slug}: ${result.itemsImported} imported, ${result.itemsUpdated} updated${result.errors.length > 0 ? `, ${result.errors.length} errors` : ''}`)
        results.push(result)

      } catch (err) {
        console.log(`[Import] ⚠ Error processing ${filePath}: ${err instanceof Error ? err.message : 'Unknown error'}`)
      }
    }
  }

  // ==========================================================================
  // 3. Import Daily Weather (special handling)
  // ==========================================================================

  const dailyWeatherPath = path.join(BATCH_OUTPUT_DIR, 'daily-weather')
  if (fs.existsSync(dailyWeatherPath)) {
    console.log('\n[Import] Step 3: Importing daily weather data...')

    const collections = await websiteCollectionRepository.findByWebsite(WEBSITE_ID, true)
    const weatherCollection = collections.find(c => c.collection_type === 'cinqueterre_weather')

    if (weatherCollection) {
      const files = fs.readdirSync(dailyWeatherPath).filter(f => f.endsWith('.json'))
      console.log(`[Import] Found ${files.length} monthly weather files`)

      for (const file of files) {
        const filePath = path.join(dailyWeatherPath, file)
        const month = file.replace('.json', '')

        try {
          const content = fs.readFileSync(filePath, 'utf-8')
          const data = JSON.parse(content)

          const slug = `daily-${month}`

          if (!dryRun) {
            const existing = await collectionItemRepository.findBySlug(weatherCollection.id, slug)

            if (existing) {
              await collectionItemRepository.update(existing.id, {
                data: data,
                published: true,
              })
              console.log(`[Import] daily-weather/${month}: updated`)
            } else {
              await collectionItemRepository.create({
                website_collection_id: weatherCollection.id,
                slug,
                data: data,
                published: true,
              })
              console.log(`[Import] daily-weather/${month}: imported`)
            }
          } else {
            console.log(`[Import] Would import daily-weather/${month}`)
          }

        } catch (err) {
          console.log(`[Import] ⚠ Error processing ${filePath}: ${err instanceof Error ? err.message : 'Unknown error'}`)
        }
      }
    }
  }

  // ==========================================================================
  // 4. Summary
  // ==========================================================================

  console.log('\n[Import] Summary:')

  let totalImported = 0
  let totalUpdated = 0
  let totalErrors = 0

  for (const result of results) {
    totalImported += result.itemsImported
    totalUpdated += result.itemsUpdated
    totalErrors += result.errors.length
  }

  console.log(`  Total items imported: ${totalImported}`)
  console.log(`  Total items updated: ${totalUpdated}`)
  console.log(`  Total errors: ${totalErrors}`)

  if (dryRun) {
    console.log('\n[Import] DRY RUN complete - no changes were made')
  } else {
    console.log('\n[Import] Import complete!')
  }

  return results
}

// =============================================================================
// CLI
// =============================================================================

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')

  await importBatchOutput(dryRun)
  process.exit(0)
}

main().catch(console.error)
