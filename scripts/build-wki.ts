#!/usr/bin/env tsx
/**
 * Build Website Knowledge Index (WKI)
 *
 * Scans content repository and builds/updates:
 * - media-index.json (images with village/category tags)
 * - entity-index.json (villages, trails, POIs)
 * - sitemap-index.json (pages with canonical URLs)
 *
 * Usage:
 *   tsx scripts/build-wki.ts [content-repo-path]
 *
 * Examples:
 *   tsx scripts/build-wki.ts                           # Uses default cinqueterre.travel
 *   tsx scripts/build-wki.ts ./cinqueterre.travel      # Explicit path
 */

import * as path from 'path'
import { buildWKI } from '../packages/backend/src/services/wki-builder.service'

async function main() {
  const contentRepoPath = process.argv[2] || path.join(process.cwd(), 'cinqueterre.travel')

  console.log('🔍 Building Website Knowledge Index (WKI)')
  console.log(`   Content repo: ${contentRepoPath}`)
  console.log('')

  const startTime = Date.now()
  const result = await buildWKI(contentRepoPath)
  const duration = Date.now() - startTime

  if (result.success) {
    console.log('✅ WKI Build Complete')
    console.log('')
    console.log('📷 Media Index:')
    console.log(`   Total images: ${result.mediaIndex.totalImages}`)
    console.log(`   New images: ${result.mediaIndex.newImages}`)
    console.log(`   Updated images: ${result.mediaIndex.updatedImages}`)
    console.log('')
    console.log('🏘️ Entity Index:')
    console.log(`   Villages: ${result.entityIndex.villages}`)
    console.log(`   Trails: ${result.entityIndex.trails}`)
    console.log('')
    console.log('🗺️ Sitemap Index:')
    console.log(`   Total pages: ${result.sitemapIndex.totalPages}`)
    console.log('')
    console.log(`⏱️ Duration: ${duration}ms`)
  } else {
    console.log('❌ WKI Build Failed')
    console.log('')
    for (const error of result.errors) {
      console.log(`   Error: ${error}`)
    }
  }

  if (result.warnings.length > 0) {
    console.log('')
    console.log('⚠️ Warnings:')
    for (const warning of result.warnings) {
      console.log(`   ${warning}`)
    }
  }
}

main().catch(console.error)
