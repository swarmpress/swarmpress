#!/usr/bin/env tsx
/**
 * Export Collections to GitHub (Grouped by Village)
 *
 * Exports collection data grouped by village, matching the batch output structure.
 *
 * Structure:
 *   content/collections/accommodations/monterosso.json  (all 20 items)
 *   content/collections/restaurants/vernazza.json       (all 20 items)
 *   content/collections/villages/monterosso.json        (1 item)
 *   content/collections/region/cinque-terre.json        (1 item)
 *
 * Usage:
 *   npx tsx scripts/export-collections-grouped.ts [--dry-run]
 */

import dotenv from 'dotenv'
import { resolve } from 'path'
import { Octokit } from '@octokit/rest'

dotenv.config({ path: resolve(__dirname, '../.env') })

import {
  websiteRepository,
  websiteCollectionRepository,
  collectionItemRepository,
} from '../packages/backend/src/db/repositories'

// =============================================================================
// CONFIGURATION
// =============================================================================

const WEBSITE_ID = '42b7e20d-7f6c-48aa-9e16-f610a84b79a6'
const CONTENT_PATH = 'content/collections'

// Village-level collections (grouped by village)
const VILLAGE_COLLECTIONS = ['accommodations', 'restaurants', 'pois', 'events', 'hikes']

// Region-level collections (flat)
const REGION_COLLECTIONS = ['villages', 'transportation', 'region', 'weather']

// Cinque Terre villages
const VILLAGES = ['monterosso', 'vernazza', 'corniglia', 'manarola', 'riomaggiore']

// =============================================================================
// TYPES
// =============================================================================

interface CollectionFile {
  collection_type: string
  village?: string
  generated_at: string
  item_count: number
  items: Array<Record<string, unknown>>
}

interface ExportResult {
  filesCreated: number
  filesUpdated: number
  errors: string[]
}

// =============================================================================
// MAIN EXPORT FUNCTION
// =============================================================================

async function exportCollectionsGrouped(dryRun: boolean = false): Promise<ExportResult> {
  const result: ExportResult = {
    filesCreated: 0,
    filesUpdated: 0,
    errors: [],
  }

  console.log(`\n[Export] Starting grouped collection export`)
  if (dryRun) {
    console.log('[Export] DRY RUN - no changes will be made to GitHub')
  }

  // Get website info
  const website = await websiteRepository.findById(WEBSITE_ID)
  if (!website) {
    throw new Error(`Website not found: ${WEBSITE_ID}`)
  }

  if (!website.github_owner || !website.github_repo) {
    throw new Error('Website is not connected to a GitHub repository')
  }

  const token = website.github_access_token || process.env.GITHUB_TOKEN
  if (!token) {
    throw new Error('No GitHub access token found')
  }

  console.log(`[Export] GitHub repo: ${website.github_owner}/${website.github_repo}`)

  // Initialize Octokit
  const octokit = new Octokit({ auth: token })

  // Get all collections
  const collections = await websiteCollectionRepository.findByWebsite(WEBSITE_ID, true)

  // ==========================================================================
  // 1. Export Village-Level Collections (grouped by village)
  // ==========================================================================

  console.log('\n[Export] Step 1: Exporting village-level collections...')

  for (const collectionType of VILLAGE_COLLECTIONS) {
    const fullType = `cinqueterre_${collectionType}`
    const collection = collections.find(c => c.collection_type === fullType)

    if (!collection) {
      console.log(`[Export] Skipping ${collectionType} - collection not found`)
      continue
    }

    // Get all items for this collection
    const allItems = await collectionItemRepository.findByCollection(collection.id, {
      publishedOnly: false,
    })

    console.log(`\n[Export] Processing ${collectionType} (${allItems.length} items)`)

    // Group items by village
    const itemsByVillage = new Map<string, typeof allItems>()

    for (const item of allItems) {
      const data = item.data as Record<string, unknown>
      let village = (data.village as string)?.toLowerCase() || 'unknown'

      // Normalize village names
      if (village.startsWith('monterosso')) village = 'monterosso'

      if (!itemsByVillage.has(village)) {
        itemsByVillage.set(village, [])
      }
      itemsByVillage.get(village)!.push(item)
    }

    // Export each village as a single file
    for (const village of VILLAGES) {
      const villageItems = itemsByVillage.get(village) || []

      if (villageItems.length === 0) {
        console.log(`[Export] ${collectionType}/${village}: no items`)
        continue
      }

      // Sort by featured first, then by rank/name
      villageItems.sort((a, b) => {
        const aData = a.data as Record<string, unknown>
        const bData = b.data as Record<string, unknown>

        // Featured first
        if (a.featured && !b.featured) return -1
        if (!a.featured && b.featured) return 1

        // Then by rank
        const aRank = (aData.rank as number) || 999
        const bRank = (bData.rank as number) || 999
        if (aRank !== bRank) return aRank - bRank

        // Then by slug
        return a.slug.localeCompare(b.slug)
      })

      // Create the grouped file content
      const fileContent: CollectionFile = {
        collection_type: fullType,
        village,
        generated_at: new Date().toISOString(),
        item_count: villageItems.length,
        items: villageItems.map(item => ({
          slug: item.slug,
          ...(item.data as Record<string, unknown>),
        })),
      }

      const filePath = `${CONTENT_PATH}/${collectionType}/${village}.json`
      const content = JSON.stringify(fileContent, null, 2)

      if (dryRun) {
        console.log(`[Export] Would save ${filePath} (${villageItems.length} items)`)
        result.filesCreated++
      } else {
        try {
          await saveToGitHub(octokit, website.github_owner, website.github_repo, filePath, content)
          console.log(`[Export] Saved ${filePath} (${villageItems.length} items)`)
          result.filesCreated++
        } catch (err) {
          const msg = `${filePath}: ${err instanceof Error ? err.message : 'Unknown error'}`
          result.errors.push(msg)
          console.log(`[Export] Error: ${msg}`)
        }
      }
    }
  }

  // ==========================================================================
  // 2. Export Region-Level Collections (flat)
  // ==========================================================================

  console.log('\n[Export] Step 2: Exporting region-level collections...')

  for (const collectionType of REGION_COLLECTIONS) {
    const fullType = `cinqueterre_${collectionType}`
    const collection = collections.find(c => c.collection_type === fullType)

    if (!collection) {
      console.log(`[Export] Skipping ${collectionType} - collection not found`)
      continue
    }

    const items = await collectionItemRepository.findByCollection(collection.id, {
      publishedOnly: false,
    })

    console.log(`\n[Export] Processing ${collectionType} (${items.length} items)`)

    for (const item of items) {
      const fileContent: CollectionFile = {
        collection_type: fullType,
        generated_at: new Date().toISOString(),
        item_count: 1,
        items: [{
          slug: item.slug,
          ...(item.data as Record<string, unknown>),
        }],
      }

      const filePath = `${CONTENT_PATH}/${collectionType}/${item.slug}.json`
      const content = JSON.stringify(fileContent, null, 2)

      if (dryRun) {
        console.log(`[Export] Would save ${filePath}`)
        result.filesCreated++
      } else {
        try {
          await saveToGitHub(octokit, website.github_owner, website.github_repo, filePath, content)
          console.log(`[Export] Saved ${filePath}`)
          result.filesCreated++
        } catch (err) {
          const msg = `${filePath}: ${err instanceof Error ? err.message : 'Unknown error'}`
          result.errors.push(msg)
          console.log(`[Export] Error: ${msg}`)
        }
      }
    }
  }

  // ==========================================================================
  // 3. Summary
  // ==========================================================================

  console.log('\n[Export] Summary:')
  console.log(`  Files created/updated: ${result.filesCreated}`)
  console.log(`  Errors: ${result.errors.length}`)

  if (dryRun) {
    console.log('\n[Export] DRY RUN complete - no changes were made')
  } else {
    console.log('\n[Export] Export complete!')
    console.log(`  Repository: https://github.com/${website.github_owner}/${website.github_repo}`)
  }

  return result
}

// =============================================================================
// GITHUB HELPER
// =============================================================================

async function saveToGitHub(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  content: string
): Promise<void> {
  // Check if file exists
  let sha: string | undefined

  try {
    const { data } = await octokit.repos.getContent({
      owner,
      repo,
      path,
    })

    if ('sha' in data) {
      sha = data.sha
    }
  } catch (err: unknown) {
    // File doesn't exist, that's fine
    if ((err as { status?: number }).status !== 404) {
      throw err
    }
  }

  // Create or update file
  await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    path,
    message: sha
      ? `Update ${path.split('/').pop()}`
      : `Add ${path.split('/').pop()}`,
    content: Buffer.from(content).toString('base64'),
    sha,
  })
}

// =============================================================================
// CLI
// =============================================================================

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')

  await exportCollectionsGrouped(dryRun)
  process.exit(0)
}

main().catch(console.error)
