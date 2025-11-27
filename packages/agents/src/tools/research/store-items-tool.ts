/**
 * Store Items Tool
 * Composable tool for storing extracted data in collections
 */

import { db } from '@swarm-press/backend'
import type { ResearchToolContext, StoreItemsResult, WebsiteCollectionInfo, ResearchConfigInfo } from './types'

// ============================================================================
// Tool Definition
// ============================================================================

export const storeItemsTool = {
  name: 'research_store_items',
  description: 'Store extracted items in a collection. Use after research_extract_data.',
  input_schema: {
    type: 'object' as const,
    properties: {
      items: {
        type: 'array',
        items: { type: 'object' },
        description: 'Validated items to store from research_extract_data'
      },
      collection_type: {
        type: 'string',
        description: 'Collection type to store items in'
      },
      publish: {
        type: 'boolean',
        description: 'Whether to publish items immediately (default: false)'
      }
    },
    required: ['items', 'collection_type']
  }
}

// ============================================================================
// Tool Input Type
// ============================================================================

interface StoreItemsInput {
  items: Record<string, unknown>[]
  collection_type: string
  publish?: boolean
}

// ============================================================================
// Tool Handler
// ============================================================================

/**
 * Store extracted items in a collection
 */
export async function storeItemsHandler(
  input: StoreItemsInput,
  context: ResearchToolContext
): Promise<StoreItemsResult> {
  const { items, collection_type, publish } = input
  const { websiteId, agentId, userId } = context

  if (!items || items.length === 0) {
    return {
      success: true,
      created: 0,
      skipped: 0,
      errors: []
    }
  }

  try {
    // 1. Get collection and research config from database
    const collection = await getCollectionInfo(websiteId, collection_type)
    if (!collection) {
      return {
        success: false,
        error: `Collection '${collection_type}' not found for website`,
        created: 0,
        skipped: 0,
        errors: [{ name: '_collection', error: 'Collection not found' }]
      }
    }

    const config = await getResearchConfig(collection.id)

    // 2. Apply dedup strategy
    const deduped = await deduplicateItems(items, collection, config)

    // 3. Store each item
    const results: StoreItemsResult = {
      success: true,
      created: 0,
      skipped: 0,
      errors: []
    }

    for (const item of deduped.toStore) {
      const name = extractItemName(item, collection.title_field)
      const slug = generateSlug(name)

      try {
        // Check if item with this slug already exists
        const existing = await checkExistingItem(collection.id, slug)
        if (existing) {
          results.skipped++
          continue
        }

        // Insert the item
        await db.query(
          `INSERT INTO collection_items (
            website_collection_id, slug, data, published,
            created_by_agent_id, created_by_user_id
          ) VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            collection.id,
            slug,
            JSON.stringify(item),
            publish ?? config?.auto_publish ?? false,
            agentId || null,
            userId || null
          ]
        )

        results.created++
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        results.errors.push({ name, error: errorMessage })
      }
    }

    results.skipped += deduped.skipped.length

    return results

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error('[StoreItemsTool] Error:', errorMessage)
    return {
      success: false,
      error: `Storage failed: ${errorMessage}`,
      created: 0,
      skipped: 0,
      errors: []
    }
  }
}

// ============================================================================
// Deduplication
// ============================================================================

interface DedupResult {
  toStore: Record<string, unknown>[]
  skipped: Record<string, unknown>[]
}

/**
 * Deduplicate items based on strategy
 */
async function deduplicateItems(
  items: Record<string, unknown>[],
  collection: WebsiteCollectionInfo,
  config?: ResearchConfigInfo | null
): Promise<DedupResult> {
  const strategy = config?.dedup_strategy || 'name'
  const seen = new Set<string>()
  const toStore: Record<string, unknown>[] = []
  const skipped: Record<string, unknown>[] = []

  for (const item of items) {
    const key = getDedupKey(item, strategy, collection)

    if (seen.has(key)) {
      skipped.push(item)
    } else {
      seen.add(key)
      toStore.push(item)
    }
  }

  return { toStore, skipped }
}

/**
 * Get dedup key based on strategy
 */
function getDedupKey(
  item: Record<string, unknown>,
  strategy: string,
  collection: WebsiteCollectionInfo
): string {
  switch (strategy) {
    case 'name':
      return extractItemName(item, collection.title_field).toLowerCase()

    case 'location':
      // Combine name with location fields
      const name = extractItemName(item, collection.title_field).toLowerCase()
      const location = extractLocationString(item)
      return `${name}|${location}`

    case 'composite':
      // Use multiple identifying fields
      return JSON.stringify({
        name: extractItemName(item, collection.title_field).toLowerCase(),
        location: extractLocationString(item),
        type: item.type || item.category || ''
      })

    default:
      return extractItemName(item, collection.title_field).toLowerCase()
  }
}

/**
 * Extract location string from item
 */
function extractLocationString(item: Record<string, unknown>): string {
  // Try various location field names
  const locationFields = ['location', 'address', 'village', 'city', 'coordinates']

  for (const field of locationFields) {
    const value = item[field]
    if (typeof value === 'string') {
      return value.toLowerCase()
    }
    if (value && typeof value === 'object') {
      // Handle nested location objects
      const loc = value as Record<string, unknown>
      return [loc.village, loc.city, loc.address, loc.name]
        .filter(Boolean)
        .join('|')
        .toLowerCase()
    }
  }

  return ''
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Extract item name using title_field from collection
 */
function extractItemName(item: Record<string, unknown>, titleField: string): string {
  // Handle nested paths like "basic_information.name"
  const parts = titleField.split('.')
  let value: unknown = item

  for (const part of parts) {
    if (value && typeof value === 'object') {
      value = (value as Record<string, unknown>)[part]
    } else {
      value = undefined
      break
    }
  }

  if (typeof value === 'string' && value) {
    return value
  }

  // Fallback to common name fields
  return (
    (item.name as string) ||
    (item.title as string) ||
    (item.label as string) ||
    'unknown-item'
  )
}

/**
 * Generate URL-safe slug from name
 */
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[àáâãäå]/g, 'a')
    .replace(/[èéêë]/g, 'e')
    .replace(/[ìíîï]/g, 'i')
    .replace(/[òóôõö]/g, 'o')
    .replace(/[ùúûü]/g, 'u')
    .replace(/[ñ]/g, 'n')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 100)
}

// ============================================================================
// Database Queries
// ============================================================================

async function getCollectionInfo(
  websiteId: string,
  collectionType: string
): Promise<WebsiteCollectionInfo | null> {
  const { rows } = await db.query<WebsiteCollectionInfo>(
    `SELECT id, website_id, collection_type, display_name, singular_name,
            json_schema, field_metadata, title_field, summary_field
     FROM website_collections
     WHERE website_id = $1 AND collection_type = $2 AND enabled = true`,
    [websiteId, collectionType]
  )
  return rows[0] || null
}

async function getResearchConfig(
  collectionId: string
): Promise<ResearchConfigInfo | null> {
  const { rows } = await db.query<ResearchConfigInfo>(
    `SELECT * FROM collection_research_config
     WHERE collection_id = $1 AND enabled = true`,
    [collectionId]
  )
  return rows[0] || null
}

async function checkExistingItem(
  collectionId: string,
  slug: string
): Promise<boolean> {
  const { rows } = await db.query<{ exists: boolean }>(
    `SELECT EXISTS(
      SELECT 1 FROM collection_items
      WHERE website_collection_id = $1 AND slug = $2
    ) as exists`,
    [collectionId, slug]
  )
  return rows[0]?.exists ?? false
}
