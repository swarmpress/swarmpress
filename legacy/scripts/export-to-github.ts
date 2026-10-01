#!/usr/bin/env tsx
/**
 * Export to GitHub Script
 * Exports database content to a GitHub repository
 *
 * Usage:
 *   npx tsx scripts/export-to-github.ts <websiteId> [--dry-run]
 *
 * The GitHub token is read from the website's github_access_token field in the database.
 *
 * This script:
 * 1. Reads website, pages, content items, and collections from PostgreSQL
 * 2. Converts to GitHub file formats
 * 3. Pushes to the connected GitHub repository
 */

import dotenv from 'dotenv'
import { resolve } from 'path'
dotenv.config({ path: resolve(__dirname, '../.env') })

// Use relative imports for direct TypeScript execution
import {
  websiteRepository,
  pageRepository,
  contentRepository,
  websiteCollectionRepository,
  collectionItemRepository,
} from '../packages/backend/src/db/repositories'
// Database initializes automatically when repositories are used

import { GitHubContentService } from '../packages/github-integration/src/content-service'
import type { WebsiteConfigFile } from '../packages/github-integration/src/content-service'
import { serializePageToFile } from '../packages/github-integration/src/serializers/page-serializer'
import { serializeCollectionSchema, serializeCollectionItem } from '../packages/github-integration/src/serializers/collection-serializer'

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Normalize a slug for use as a file path
 * - Remove leading slashes
 * - Replace empty slugs with 'index'
 */
function normalizeSlug(slug: string): string {
  // Remove leading slashes
  let normalized = slug.replace(/^\/+/, '')
  // Handle empty slug (root page)
  if (!normalized) {
    normalized = 'index'
  }
  return normalized
}

/**
 * Normalize village name to slug format
 * - "Monterosso al Mare" → "monterosso"
 * - "Monterosso" → "monterosso"
 * - "Riomaggiore" → "riomaggiore"
 */
function normalizeVillage(village: string | undefined): string {
  if (!village) return 'unknown'

  // Normalize known variants
  const villageLower = village.toLowerCase().trim()

  // Handle "Monterosso al Mare" variant
  if (villageLower.startsWith('monterosso')) {
    return 'monterosso'
  }

  // Standard normalization: lowercase, replace spaces with hyphens
  return villageLower.replace(/\s+/g, '-')
}

// The 5 Cinque Terre villages
const CINQUE_TERRE_VILLAGES = ['monterosso', 'vernazza', 'corniglia', 'manarola', 'riomaggiore']

// Collections that should be organized by village
const VILLAGE_COLLECTIONS = ['accommodations', 'restaurants', 'pois', 'events', 'hikes']

// Max items per village per collection
const MAX_ITEMS_PER_VILLAGE = 20

// =============================================================================
// TYPES
// =============================================================================

interface ExportOptions {
  websiteId: string
  dryRun: boolean
}

interface ExportResult {
  success: boolean
  pagesExported: number
  collectionsExported: number
  itemsExported: number
  errors: string[]
}

// =============================================================================
// MAIN FUNCTION
// =============================================================================

async function exportToGitHub(options: ExportOptions): Promise<ExportResult> {
  const result: ExportResult = {
    success: true,
    pagesExported: 0,
    collectionsExported: 0,
    itemsExported: 0,
    errors: [],
  }

  try {
    console.log(`\n[Export] Starting export for website: ${options.websiteId}`)
    if (options.dryRun) {
      console.log('[Export] DRY RUN - no changes will be made to GitHub')
    }

    // Fetch website
    const website = await websiteRepository.findById(options.websiteId)
    if (!website) {
      throw new Error(`Website not found: ${options.websiteId}`)
    }

    console.log(`[Export] Website: ${website.title}`)

    // Check GitHub connection
    if (!website.github_owner || !website.github_repo) {
      throw new Error('Website is not connected to a GitHub repository')
    }

    // Use token from database (or fallback to env var for testing)
    const token = website.github_access_token || process.env.GITHUB_TOKEN
    if (!token) {
      throw new Error('No GitHub access token found. Set github_access_token on the website or GITHUB_TOKEN env var.')
    }

    console.log(`[Export] GitHub repo: ${website.github_owner}/${website.github_repo}`)

    // Initialize GitHub content service
    const contentService = new GitHubContentService({
      owner: website.github_owner,
      repo: website.github_repo,
      token,
      branch: 'main',
      contentPath: 'content',
    })

    // ==========================================================================
    // 1. Create/Update Website Config
    // ==========================================================================

    console.log('\n[Export] Step 1: Creating website config...')

    // Fetch collections for config
    const collections = await websiteCollectionRepository.findByWebsite(options.websiteId, true)

    const config: WebsiteConfigFile = {
      id: website.id,
      domain: website.domain || `${website.github_repo}.github.io`,
      title: website.title,
      description: website.description || undefined,
      collections: collections.map(c => ({
        type: c.collection_type,
        displayName: c.display_name,
      })),
      settings: {
        theme: website.theme || 'default',
        // Add any other website settings here
      },
    }

    if (options.dryRun) {
      console.log('[Export] Would save config.json:')
      console.log(JSON.stringify(config, null, 2))
    } else {
      await contentService.saveConfig(config, 'Initialize website configuration')
      console.log('[Export] Saved config.json')
    }

    // ==========================================================================
    // 2. Export Pages
    // ==========================================================================

    console.log('\n[Export] Step 2: Exporting pages...')

    const pages = await pageRepository.findByWebsite(options.websiteId)
    console.log(`[Export] Found ${pages.length} pages`)

    for (const page of pages) {
      // Fetch associated content item if exists
      const contentItems = await contentRepository.findAll({
        website_id: options.websiteId,
        // Note: We'd need to link pages to content items - for now, find by slug
      })

      const content = contentItems.find(c => c.slug === page.slug)

      const pageFile = serializePageToFile(
        {
          id: page.id,
          slug: page.slug,
          title: page.title,
          description: page.description,
          page_type: page.page_type,
          template: page.template,
          seo_title: page.seo_title,
          seo_description: page.seo_description,
          seo_keywords: page.seo_keywords,
          metadata: page.metadata as Record<string, unknown> | null,
          created_at: page.created_at,
          updated_at: page.updated_at,
        },
        content ? {
          id: content.id,
          title: content.title,
          slug: content.slug,
          body: content.body as Array<Record<string, unknown>>,
          status: content.status,
          metadata: content.metadata as Record<string, unknown> | null,
          created_at: content.created_at,
          updated_at: content.updated_at,
          published_at: content.published_at,
        } : undefined
      )

      const pageSlug = normalizeSlug(page.slug)

      if (options.dryRun) {
        console.log(`[Export] Would save pages/${pageSlug}.json`)
      } else {
        await contentService.savePage(pageSlug, pageFile, `Export page: ${page.title}`)
        console.log(`[Export] Saved pages/${pageSlug}.json`)
      }

      result.pagesExported++
    }

    // ==========================================================================
    // 3. Export Collections (organized by village)
    // ==========================================================================

    console.log('\n[Export] Step 3: Exporting collections (organized by village)...')
    console.log(`[Export] Found ${collections.length} collections`)

    for (const collection of collections) {
      // Extract base collection type from prefixed name (e.g., "cinqueterre_accommodations" → "accommodations")
      const baseType = collection.collection_type.replace(/^[a-z]+_/, '')
      const isVillageCollection = VILLAGE_COLLECTIONS.includes(baseType)

      // Export collection schema to collections/ folder
      const schemaFile = serializeCollectionSchema({
        id: collection.id,
        collection_type: collection.collection_type,
        display_name: collection.display_name,
        singular_name: collection.singular_name,
        description: collection.description,
        icon: collection.icon,
        color: collection.color,
        json_schema: collection.json_schema as Record<string, unknown>,
        field_metadata: collection.field_metadata as Record<string, unknown> | null,
        title_field: collection.title_field,
        summary_field: collection.summary_field,
        image_field: collection.image_field,
        date_field: collection.date_field,
        created_at: collection.created_at,
        updated_at: collection.updated_at,
      })

      if (options.dryRun) {
        console.log(`[Export] Would save collections/${baseType}/_schema.json`)
      } else {
        await contentService.saveCollectionSchemaByVillage(
          baseType,
          schemaFile,
          `Export ${collection.display_name} schema`
        )
        console.log(`[Export] Saved collections/${baseType}/_schema.json`)
      }

      result.collectionsExported++

      // Export collection items
      const items = await collectionItemRepository.findByCollection(collection.id, {
        publishedOnly: false, // Export all items, not just published
      })

      console.log(`[Export] Found ${items.length} items in ${collection.collection_type}`)

      if (isVillageCollection) {
        // Group items by village
        const itemsByVillage = new Map<string, typeof items>()

        for (const item of items) {
          const data = item.data as Record<string, unknown>
          const village = normalizeVillage(data.village as string | undefined)

          if (!itemsByVillage.has(village)) {
            itemsByVillage.set(village, [])
          }
          itemsByVillage.get(village)!.push(item)
        }

        // Export items organized by village (max 20 per village)
        for (const [village, villageItems] of itemsByVillage) {
          // Sort by featured first, then by name/title
          const sortedItems = villageItems.sort((a, b) => {
            // Featured items first
            if (a.featured && !b.featured) return -1
            if (!a.featured && b.featured) return 1
            // Then by slug alphabetically
            return a.slug.localeCompare(b.slug)
          })

          // Limit to MAX_ITEMS_PER_VILLAGE
          const limitedItems = sortedItems.slice(0, MAX_ITEMS_PER_VILLAGE)

          console.log(`[Export] Exporting ${limitedItems.length}/${villageItems.length} items for ${village}`)

          for (const item of limitedItems) {
            const itemFile = serializeCollectionItem({
              id: item.id,
              slug: item.slug,
              data: item.data as Record<string, unknown>,
              published: item.published,
              featured: item.featured,
              created_at: item.created_at,
              updated_at: item.updated_at,
            })

            if (options.dryRun) {
              console.log(`[Export] Would save collections/${baseType}/${village}/${item.slug}.json`)
            } else {
              await contentService.saveCollectionItemByVillage(
                baseType,
                village,
                item.slug,
                itemFile,
                `Export ${baseType}/${village}: ${item.slug}`
              )
              console.log(`[Export] Saved collections/${baseType}/${village}/${item.slug}.json`)
            }

            result.itemsExported++
          }
        }
      } else {
        // Non-village collections: export flat (for villages, transportation, region, weather)
        for (const item of items) {
          const itemFile = serializeCollectionItem({
            id: item.id,
            slug: item.slug,
            data: item.data as Record<string, unknown>,
            published: item.published,
            featured: item.featured,
            created_at: item.created_at,
            updated_at: item.updated_at,
          })

          if (options.dryRun) {
            console.log(`[Export] Would save collections/${baseType}/${item.slug}.json`)
          } else {
            await contentService.saveCollectionItem(
              `collections/${baseType}`,
              item.slug,
              itemFile,
              `Export ${collection.singular_name || collection.display_name}: ${item.slug}`
            )
            console.log(`[Export] Saved collections/${baseType}/${item.slug}.json`)
          }

          result.itemsExported++
        }
      }
    }

    // ==========================================================================
    // 4. Summary
    // ==========================================================================

    console.log('\n[Export] Summary:')
    console.log(`  Pages exported: ${result.pagesExported}`)
    console.log(`  Collections exported: ${result.collectionsExported}`)
    console.log(`  Items exported: ${result.itemsExported}`)

    if (options.dryRun) {
      console.log('\n[Export] DRY RUN complete - no changes were made')
    } else {
      console.log('\n[Export] Export complete!')
      console.log(`  Repository: https://github.com/${website.github_owner}/${website.github_repo}`)
    }

  } catch (error) {
    result.success = false
    const message = error instanceof Error ? error.message : 'Unknown error'
    result.errors.push(message)
    console.error(`\n[Export] Error: ${message}`)
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
Export to GitHub Script

Usage:
  npx tsx scripts/export-to-github.ts <websiteId> [--dry-run]

Arguments:
  websiteId    The UUID of the website to export

Options:
  --dry-run    Show what would be exported without making changes
  --help, -h   Show this help message

The GitHub token is read from the website's github_access_token field in the database.
Fallback: GITHUB_TOKEN environment variable (for testing).

Examples:
  # Export a website to GitHub
  npx tsx scripts/export-to-github.ts 123e4567-e89b-12d3-a456-426614174000

  # Preview what would be exported
  npx tsx scripts/export-to-github.ts 123e4567-e89b-12d3-a456-426614174000 --dry-run
`)
    process.exit(0)
  }

  const websiteId = args[0]
  if (!websiteId) {
    console.error('Error: websiteId is required')
    process.exit(1)
  }

  const dryRun = args.includes('--dry-run')

  const result = await exportToGitHub({ websiteId, dryRun })

  process.exit(result.success ? 0 : 1)
}

main().catch(console.error)
