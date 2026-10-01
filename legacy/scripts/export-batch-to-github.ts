#!/usr/bin/env tsx
/**
 * Export batch-processed collection data to GitHub
 *
 * Usage:
 *   npx tsx scripts/export-batch-to-github.ts
 *   npx tsx scripts/export-batch-to-github.ts --collection=events
 *   npx tsx scripts/export-batch-to-github.ts --dry-run
 */

import dotenv from 'dotenv'
import { resolve } from 'path'
import { readFileSync, existsSync, readdirSync } from 'fs'
dotenv.config({ path: resolve(__dirname, '../.env') })

import { GitHubContentService } from '../packages/github-integration/src/content-service'
import { websiteRepository } from '../packages/backend/src/db/repositories'

const CINQUE_TERRE_WEBSITE_ID = '42b7e20d-7f6c-48aa-9e16-f610a84b79a6'
const BATCH_OUTPUT_DIR = resolve(__dirname, '../.batch-output')
const COLLECTIONS = ['events', 'accommodations', 'restaurants', 'pois', 'hikes']

interface ExportResult {
  collection: string
  village: string
  success: boolean
  itemCount: number
  error?: string
}

async function exportToGitHub(dryRun: boolean, filterCollection?: string): Promise<void> {
  console.log('\n=== Export Batch Results to GitHub ===\n')

  if (dryRun) {
    console.log('[DRY RUN] No files will be uploaded\n')
  }

  // Get website GitHub config
  const website = await websiteRepository.findById(CINQUE_TERRE_WEBSITE_ID)
  if (!website) {
    throw new Error('Website not found')
  }

  if (!website.github_owner || !website.github_repo) {
    throw new Error('Website not connected to GitHub')
  }

  const token = website.github_access_token || process.env.GITHUB_TOKEN
  if (!token) {
    throw new Error('No GitHub token available')
  }

  console.log(`Target: ${website.github_owner}/${website.github_repo}`)
  console.log(`Branch: main`)
  console.log(`Path: content/collections/\n`)

  const contentService = new GitHubContentService({
    owner: website.github_owner,
    repo: website.github_repo,
    token,
    branch: 'main',
    contentPath: 'content',
  })

  const results: ExportResult[] = []
  const collectionsToProcess = filterCollection ? [filterCollection] : COLLECTIONS

  for (const collection of collectionsToProcess) {
    const collectionDir = resolve(BATCH_OUTPUT_DIR, collection)

    if (!existsSync(collectionDir)) {
      console.log(`[${collection}] Directory not found, skipping`)
      continue
    }

    const files = readdirSync(collectionDir).filter(f => f.endsWith('.json') && !f.includes('-raw'))

    console.log(`\n[${collection}] Found ${files.length} village files`)

    for (const file of files) {
      const village = file.replace('.json', '')
      const filePath = resolve(collectionDir, file)

      try {
        const content = readFileSync(filePath, 'utf-8')
        const data = JSON.parse(content)
        const itemCount = data.items?.length || 0

        console.log(`  ${village}: ${itemCount} items`)

        if (!dryRun) {
          // Upload to GitHub: content/collections/{collection}/{village}.json
          const githubPath = `content/collections/${collection}/${village}.json`

          // Get existing file SHA if it exists (required for updates)
          const existing = await contentService.getClient().getFileContent(githubPath, 'main')

          await contentService.getClient().createOrUpdateFile({
            path: githubPath,
            content: content,
            message: `Update ${collection} for ${village} (${itemCount} items) via batch export`,
            branch: 'main',
            sha: existing?.sha,
          })

          console.log(`    ✓ Uploaded to ${githubPath}`)
        }

        results.push({
          collection,
          village,
          success: true,
          itemCount,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        console.log(`    ✗ Error: ${message}`)
        results.push({
          collection,
          village,
          success: false,
          itemCount: 0,
          error: message,
        })
      }
    }
  }

  // Summary
  console.log('\n=== Export Summary ===\n')

  const successful = results.filter(r => r.success)
  const failed = results.filter(r => !r.success)
  const totalItems = successful.reduce((sum, r) => sum + r.itemCount, 0)

  console.log(`Files processed: ${results.length}`)
  console.log(`Successful: ${successful.length}`)
  console.log(`Failed: ${failed.length}`)
  console.log(`Total items: ${totalItems}`)

  if (failed.length > 0) {
    console.log('\nFailed exports:')
    for (const f of failed) {
      console.log(`  - ${f.collection}/${f.village}: ${f.error}`)
    }
  }

  if (dryRun) {
    console.log('\n[DRY RUN] No files were uploaded. Run without --dry-run to upload.')
  } else {
    console.log('\n✓ Export complete!')
  }
}

async function main() {
  const args = process.argv.slice(2)

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Export Batch Results to GitHub

Usage:
  npx tsx scripts/export-batch-to-github.ts
  npx tsx scripts/export-batch-to-github.ts --collection=events
  npx tsx scripts/export-batch-to-github.ts --dry-run

Options:
  --dry-run           Show what would be uploaded without actually uploading
  --collection=NAME   Only export specific collection (events, accommodations, restaurants, pois, hikes)
`)
    process.exit(0)
  }

  const dryRun = args.includes('--dry-run')
  const collectionArg = args.find(a => a.startsWith('--collection='))
  const filterCollection = collectionArg?.replace('--collection=', '')

  if (filterCollection && !COLLECTIONS.includes(filterCollection)) {
    console.error(`Unknown collection: ${filterCollection}`)
    console.error(`Valid: ${COLLECTIONS.join(', ')}`)
    process.exit(1)
  }

  await exportToGitHub(dryRun, filterCollection)
}

main().catch(console.error)
