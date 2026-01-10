#!/usr/bin/env npx tsx
/**
 * Migration Script: Editorial Content to Collections
 *
 * This script extracts editorial fields (giuliaComment, signature, intro, practicalInfo)
 * from inline page data and migrates them to collection files.
 *
 * Usage:
 *   npx tsx scripts/migrate-editorial-content.ts --dry-run     # Analyze only
 *   npx tsx scripts/migrate-editorial-content.ts --execute     # Perform migration
 */

import * as fs from 'fs'
import * as path from 'path'

// Configuration
const CONTENT_DIR = path.join(__dirname, '..', 'cinqueterre.travel', 'content')
const PAGES_DIR = path.join(CONTENT_DIR, 'pages')
const COLLECTIONS_DIR = path.join(CONTENT_DIR, 'collections')

// Editorial fields to migrate
const EDITORIAL_FIELDS = ['giuliaComment', 'signature', 'intro', 'practicalInfo']

// Map itemType to collectionType
const ITEM_TYPE_TO_COLLECTION: Record<string, string> = {
  'restaurant': 'restaurants',
  'accommodation': 'accommodations',
  'hike': 'hikes',
  'event': 'events',
  'poi': 'pois',
  'sight': 'pois',
  'attraction': 'pois',
  'experience': 'events',
  'generic': 'pois',
}

interface LocalizedString {
  en?: string
  de?: string
  fr?: string
  it?: string
}

interface InlineItem {
  id?: number
  name: string | LocalizedString
  village?: string
  giuliaComment?: LocalizedString
  signature?: LocalizedString
  intro?: LocalizedString
  practicalInfo?: LocalizedString
  description?: LocalizedString
  category?: LocalizedString
  [key: string]: unknown
}

interface CollectionItem {
  slug: string
  name: string | LocalizedString
  village?: string
  editorial?: {
    giuliaComment?: LocalizedString
    signature?: LocalizedString
    intro?: LocalizedString
    practicalInfo?: LocalizedString
  }
  [key: string]: unknown
}

interface MigrationResult {
  pageFile: string
  itemType: string
  collectionType: string
  inlineName: string
  matchedSlug: string | null
  matchedVillage: string | null
  editorialFields: string[]
  status: 'matched' | 'unmatched' | 'no-editorial'
}

interface PageBlock {
  type: string
  itemType?: string
  items?: InlineItem[]
  interludes?: unknown[]
  [key: string]: unknown
}

// Normalize name to slug format
function normalizeToSlug(name: string | LocalizedString): string {
  const str = typeof name === 'string' ? name : (name.en || name.de || name.fr || name.it || '')
  return str
    .toLowerCase()
    .replace(/[''`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

// Get string value from potentially localized string
function getStringValue(value: string | LocalizedString | undefined): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  return value.en || value.de || value.fr || value.it || ''
}

// Load all collection items for a type
function loadCollectionItems(collectionType: string): Map<string, { item: CollectionItem; file: string; village: string }> {
  const items = new Map<string, { item: CollectionItem; file: string; village: string }>()
  const collectionDir = path.join(COLLECTIONS_DIR, collectionType)

  if (!fs.existsSync(collectionDir)) {
    console.warn(`Collection directory not found: ${collectionDir}`)
    return items
  }

  const files = fs.readdirSync(collectionDir).filter(f => f.endsWith('.json') && !f.startsWith('_'))

  for (const file of files) {
    const filePath = path.join(collectionDir, file)
    const village = file.replace('.json', '')

    try {
      const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
      const itemsArray = Array.isArray(content) ? content : (content.items || [content])

      for (const item of itemsArray) {
        if (item.slug) {
          items.set(item.slug, { item, file: filePath, village })
        }
        // Also index by normalized name for fuzzy matching
        const nameSlug = normalizeToSlug(item.name || '')
        if (nameSlug && !items.has(nameSlug)) {
          items.set(nameSlug, { item, file: filePath, village })
        }
      }
    } catch (e) {
      console.error(`Error loading ${filePath}:`, e)
    }
  }

  return items
}

// Find all pages with collection-with-interludes blocks
function findPagesWithCollections(): string[] {
  const pages: string[] = []

  function scanDir(dir: string) {
    if (!fs.existsSync(dir)) return

    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        scanDir(fullPath)
      } else if (entry.name.endsWith('.json')) {
        try {
          const content = fs.readFileSync(fullPath, 'utf-8')
          if (content.includes('collection-with-interludes')) {
            pages.push(fullPath)
          }
        } catch (e) {
          // Skip unreadable files
        }
      }
    }
  }

  scanDir(PAGES_DIR)
  return pages
}

// Analyze a page and extract migration info
function analyzePage(pagePath: string): MigrationResult[] {
  const results: MigrationResult[] = []

  try {
    const content = JSON.parse(fs.readFileSync(pagePath, 'utf-8'))
    const body = content.body || []

    for (const block of body as PageBlock[]) {
      if (block.type !== 'collection-with-interludes') continue
      if (!block.items || !Array.isArray(block.items)) continue

      const itemType = block.itemType || 'generic'
      const collectionType = ITEM_TYPE_TO_COLLECTION[itemType] || 'pois'

      // Load collection items for matching
      const collectionItems = loadCollectionItems(collectionType)

      for (const item of block.items) {
        const inlineName = getStringValue(item.name)
        const inlineVillage = getStringValue(item.village)?.toLowerCase()

        // Check which editorial fields exist
        const editorialFields = EDITORIAL_FIELDS.filter(field => item[field as keyof InlineItem])

        if (editorialFields.length === 0) {
          results.push({
            pageFile: pagePath,
            itemType,
            collectionType,
            inlineName,
            matchedSlug: null,
            matchedVillage: inlineVillage || null,
            editorialFields: [],
            status: 'no-editorial',
          })
          continue
        }

        // Try to match by slug
        const slug = normalizeToSlug(item.name)
        let matched = collectionItems.get(slug)

        // Try with village prefix
        if (!matched && inlineVillage) {
          matched = collectionItems.get(`${inlineVillage}-${slug}`)
        }

        results.push({
          pageFile: pagePath,
          itemType,
          collectionType,
          inlineName,
          matchedSlug: matched?.item.slug || null,
          matchedVillage: matched?.village || inlineVillage || null,
          editorialFields,
          status: matched ? 'matched' : 'unmatched',
        })
      }
    }
  } catch (e) {
    console.error(`Error analyzing ${pagePath}:`, e)
  }

  return results
}

// Perform the actual migration
function migrateEditorialContent(results: MigrationResult[]): void {
  // Group by collection file
  const updatesByFile = new Map<string, Map<string, Partial<CollectionItem>>>()

  for (const result of results) {
    if (result.status !== 'matched') continue
    if (result.editorialFields.length === 0) continue

    const collectionDir = path.join(COLLECTIONS_DIR, result.collectionType)
    const filePath = path.join(collectionDir, `${result.matchedVillage}.json`)

    if (!updatesByFile.has(filePath)) {
      updatesByFile.set(filePath, new Map())
    }

    // Load the inline item data to get editorial fields
    try {
      const pageContent = JSON.parse(fs.readFileSync(result.pageFile, 'utf-8'))
      const body = pageContent.body || []

      for (const block of body as PageBlock[]) {
        if (block.type !== 'collection-with-interludes') continue
        if (!block.items) continue

        for (const item of block.items) {
          const itemName = getStringValue(item.name)
          if (itemName !== result.inlineName) continue

          // Extract editorial fields
          const editorial: Record<string, LocalizedString> = {}
          for (const field of EDITORIAL_FIELDS) {
            if (item[field as keyof InlineItem]) {
              editorial[field] = item[field as keyof InlineItem] as LocalizedString
            }
          }

          if (Object.keys(editorial).length > 0) {
            updatesByFile.get(filePath)!.set(result.matchedSlug!, { editorial } as Partial<CollectionItem>)
          }
        }
      }
    } catch (e) {
      console.error(`Error extracting editorial from ${result.pageFile}:`, e)
    }
  }

  // Apply updates to collection files
  for (const [filePath, updates] of updatesByFile) {
    if (!fs.existsSync(filePath)) {
      console.warn(`Collection file not found: ${filePath}`)
      continue
    }

    try {
      const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
      const items = Array.isArray(content) ? content : (content.items || [content])
      let modified = false

      for (const item of items) {
        const update = updates.get(item.slug)
        if (update?.editorial) {
          item.editorial = { ...item.editorial, ...update.editorial }
          modified = true
          console.log(`  Updated ${item.slug} with editorial fields`)
        }
      }

      if (modified) {
        const output = Array.isArray(content) ? items : { ...content, items }
        fs.writeFileSync(filePath, JSON.stringify(output, null, 2) + '\n')
        console.log(`Wrote updates to ${filePath}`)
      }
    } catch (e) {
      console.error(`Error updating ${filePath}:`, e)
    }
  }
}

// Update page files to use slug references
function updatePageFiles(results: MigrationResult[]): void {
  // Group results by page file
  const pageUpdates = new Map<string, MigrationResult[]>()

  for (const result of results) {
    if (!pageUpdates.has(result.pageFile)) {
      pageUpdates.set(result.pageFile, [])
    }
    pageUpdates.get(result.pageFile)!.push(result)
  }

  for (const [pagePath, pageResults] of pageUpdates) {
    try {
      const content = JSON.parse(fs.readFileSync(pagePath, 'utf-8'))
      const body = content.body || []
      let modified = false

      for (let i = 0; i < body.length; i++) {
        const block = body[i] as PageBlock
        if (block.type !== 'collection-with-interludes') continue
        if (!block.items || !Array.isArray(block.items)) continue

        const itemType = block.itemType || 'generic'
        const collectionType = ITEM_TYPE_TO_COLLECTION[itemType] || 'pois'

        // Build slugs array from matched items
        const slugs: string[] = []
        const unmatchedItems: InlineItem[] = []

        for (const item of block.items) {
          const inlineName = getStringValue(item.name)
          const result = pageResults.find(r => r.inlineName === inlineName && r.collectionType === collectionType)

          if (result?.matchedSlug) {
            slugs.push(result.matchedSlug)
          } else {
            unmatchedItems.push(item)
          }
        }

        // Only update if we have all matches
        if (unmatchedItems.length === 0 && slugs.length > 0) {
          // Get village from first item if consistent
          const villages = new Set(block.items.map(item => item.village?.toLowerCase()))
          const village = villages.size === 1 ? [...villages][0] : undefined

          // Create new block format
          const newBlock: PageBlock = {
            type: 'collection-with-interludes',
            collectionType,
            slugs,
            interludes: block.interludes,
          }

          if (village) {
            newBlock.village = village
          }

          body[i] = newBlock
          modified = true
          console.log(`  Updated block in ${pagePath} with ${slugs.length} slug references`)
        } else if (unmatchedItems.length > 0) {
          console.warn(`  Skipping ${pagePath} - ${unmatchedItems.length} unmatched items`)
        }
      }

      if (modified) {
        fs.writeFileSync(pagePath, JSON.stringify(content, null, 2) + '\n')
        console.log(`Wrote updates to ${pagePath}`)
      }
    } catch (e) {
      console.error(`Error updating page ${pagePath}:`, e)
    }
  }
}

// Main function
async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run') || !args.includes('--execute')

  console.log('='.repeat(60))
  console.log('Editorial Content Migration Script')
  console.log('='.repeat(60))
  console.log(`Mode: ${dryRun ? 'DRY RUN (analysis only)' : 'EXECUTE (will modify files)'}`)
  console.log('')

  // Find all pages with collection-with-interludes
  console.log('Scanning for pages with collection-with-interludes blocks...')
  const pages = findPagesWithCollections()
  console.log(`Found ${pages.length} pages with collection blocks`)
  console.log('')

  // Analyze all pages
  console.log('Analyzing pages...')
  const allResults: MigrationResult[] = []

  for (const page of pages) {
    const results = analyzePage(page)
    allResults.push(...results)
  }

  // Summarize results
  const matched = allResults.filter(r => r.status === 'matched')
  const unmatched = allResults.filter(r => r.status === 'unmatched')
  const noEditorial = allResults.filter(r => r.status === 'no-editorial')

  console.log('')
  console.log('='.repeat(60))
  console.log('ANALYSIS SUMMARY')
  console.log('='.repeat(60))
  console.log(`Total inline items found: ${allResults.length}`)
  console.log(`  - Matched to collection: ${matched.length}`)
  console.log(`  - Unmatched (need manual review): ${unmatched.length}`)
  console.log(`  - No editorial fields: ${noEditorial.length}`)
  console.log('')

  // Show editorial fields to migrate
  const fieldsCount: Record<string, number> = {}
  for (const r of matched) {
    for (const f of r.editorialFields) {
      fieldsCount[f] = (fieldsCount[f] || 0) + 1
    }
  }

  console.log('Editorial fields to migrate:')
  for (const [field, count] of Object.entries(fieldsCount)) {
    console.log(`  - ${field}: ${count} items`)
  }
  console.log('')

  // Show unmatched items
  if (unmatched.length > 0) {
    console.log('UNMATCHED ITEMS (need manual review):')
    for (const r of unmatched) {
      console.log(`  - "${r.inlineName}" (${r.collectionType}) in ${path.relative(PAGES_DIR, r.pageFile)}`)
    }
    console.log('')
  }

  // Show by collection type
  console.log('By collection type:')
  const byType: Record<string, { matched: number; unmatched: number }> = {}
  for (const r of allResults) {
    if (!byType[r.collectionType]) {
      byType[r.collectionType] = { matched: 0, unmatched: 0 }
    }
    if (r.status === 'matched') {
      byType[r.collectionType].matched++
    } else if (r.status === 'unmatched') {
      byType[r.collectionType].unmatched++
    }
  }
  for (const [type, counts] of Object.entries(byType)) {
    console.log(`  - ${type}: ${counts.matched} matched, ${counts.unmatched} unmatched`)
  }
  console.log('')

  if (dryRun) {
    console.log('='.repeat(60))
    console.log('DRY RUN COMPLETE - No files modified')
    console.log('Run with --execute to perform migration')
    console.log('='.repeat(60))
  } else {
    console.log('='.repeat(60))
    console.log('EXECUTING MIGRATION')
    console.log('='.repeat(60))

    // Step 1: Migrate editorial content to collections
    console.log('')
    console.log('Step 1: Migrating editorial content to collection files...')
    migrateEditorialContent(matched)

    // Step 2: Update page files to use slug references
    console.log('')
    console.log('Step 2: Updating page files to use slug references...')
    updatePageFiles(matched)

    console.log('')
    console.log('='.repeat(60))
    console.log('MIGRATION COMPLETE')
    console.log('='.repeat(60))
  }
}

main().catch(console.error)
