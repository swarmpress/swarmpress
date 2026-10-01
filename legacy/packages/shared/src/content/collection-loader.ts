/**
 * Collection Loader Service
 * Loads and filters collection items from GitHub for embedding in pages
 *
 * Note: This module defines types that mirror github-integration types to avoid
 * circular dependencies. The actual GitHubContentService is passed in at runtime.
 */

// =============================================================================
// TYPES (mirrored from github-integration to avoid circular deps)
// =============================================================================

/** Schema file for a collection */
export interface CollectionSchemaFile {
  type: string
  display_name: string
  singular_name?: string
  description?: string
  icon?: string
  color?: string
  json_schema: Record<string, unknown>
  field_metadata?: Record<string, unknown>
  title_field?: string
  summary_field?: string
  image_field?: string
  date_field?: string
}

/** Individual collection item file */
export interface CollectionItemFile {
  id: string
  slug: string
  data: Record<string, unknown>
  published: boolean
  featured?: boolean
  created_at: string
  updated_at: string
}

/** Content service interface (subset of GitHubContentService) */
export interface ContentServiceInterface {
  getCollectionSchema(collectionType: string): Promise<{ content: CollectionSchemaFile } | null>
  listCollectionItems(collectionType: string): Promise<Array<{ path: string; content: CollectionItemFile }>>
}

// =============================================================================
// FILTER TYPES
// =============================================================================

export interface CollectionLoaderFilter {
  /** Filter by village (e.g., 'manarola', 'vernazza') */
  village?: string
  /** Filter by language */
  language?: string
  /** Limit number of items */
  limit?: number
  /** Only return featured items */
  featured?: boolean
  /** Only return published items (default: true) */
  published?: boolean
  /** Sort field */
  sortBy?: string
  /** Sort direction */
  sortOrder?: 'asc' | 'desc'
}


export interface LoadedCollectionItem {
  /** Item slug for URL generation */
  slug: string
  /** Display title */
  title: string
  /** Short summary/description */
  summary?: string
  /** Featured image URL */
  image?: string
  /** Date (for events, news) */
  date?: string
  /** URL to the item detail page */
  url?: string
  /** Full item data for rendering */
  data: Record<string, unknown>
}

export interface LoadedCollection {
  /** Collection type (e.g., 'restaurants') */
  type: string
  /** Display name (e.g., 'Restaurants') */
  displayName: string
  /** Singular name (e.g., 'Restaurant') */
  singularName?: string
  /** Schema for field metadata */
  schema: CollectionSchemaFile
  /** Loaded and filtered items */
  items: LoadedCollectionItem[]
}

// =============================================================================
// COLLECTION LOADER
// =============================================================================

/**
 * Load collection items from GitHub with filtering
 */
export async function loadCollectionItems(
  contentService: ContentServiceInterface,
  collectionType: string,
  filter: CollectionLoaderFilter = {}
): Promise<LoadedCollectionItem[]> {
  // Get schema for field extraction
  const schemaFile = await contentService.getCollectionSchema(collectionType)
  if (!schemaFile) {
    console.warn(`[CollectionLoader] Schema not found for collection: ${collectionType}`)
    return []
  }

  const schema = schemaFile.content

  // Load all items for this collection
  const rawItems = await contentService.listCollectionItems(collectionType)

  // Process and filter items
  let items: LoadedCollectionItem[] = []

  for (const rawItem of rawItems) {
    const content = rawItem.content as unknown

    // Handle grouped item files (village-based)
    if (isGroupedItemsFile(content)) {
      const grouped = content as GroupedItemsFile

      // Filter by village if specified
      if (filter.village && grouped.village && grouped.village !== filter.village) {
        continue
      }

      for (const itemData of grouped.items) {
        const item = extractLoadedItem(itemData, schema, collectionType)
        if (item && matchesFilter(item, itemData, filter)) {
          items.push(item)
        }
      }
    }
    // Handle individual item files
    else if (isIndividualItemFile(content)) {
      const individual = rawItem.content
      if (filter.published !== false && !individual.published) {
        continue
      }

      const item = extractLoadedItem(individual.data, schema, collectionType, individual.slug)
      if (item && matchesFilter(item, individual.data, filter)) {
        items.push(item)
      }
    }
    // Handle raw data files
    else {
      const slug = rawItem.path.split('/').pop()?.replace('.json', '') || 'unknown'
      const item = extractLoadedItem(content as Record<string, unknown>, schema, collectionType, slug)
      if (item && matchesFilter(item, content as Record<string, unknown>, filter)) {
        items.push(item)
      }
    }
  }

  // Sort items
  if (filter.sortBy) {
    items.sort((a, b) => {
      const aVal = getNestedValue(a.data, filter.sortBy!) ?? ''
      const bVal = getNestedValue(b.data, filter.sortBy!) ?? ''
      const comparison = String(aVal).localeCompare(String(bVal))
      return filter.sortOrder === 'desc' ? -comparison : comparison
    })
  }

  // Featured items first
  if (filter.featured) {
    items = items.filter((item) => item.data.featured === true)
  }

  // Apply limit
  if (filter.limit && filter.limit > 0) {
    items = items.slice(0, filter.limit)
  }

  return items
}

/**
 * Load a full collection with schema and items
 */
export async function loadCollection(
  contentService: ContentServiceInterface,
  collectionType: string,
  filter: CollectionLoaderFilter = {}
): Promise<LoadedCollection | null> {
  const schemaFile = await contentService.getCollectionSchema(collectionType)
  if (!schemaFile) {
    return null
  }

  const items = await loadCollectionItems(contentService, collectionType, filter)

  return {
    type: collectionType,
    displayName: schemaFile.content.display_name,
    singularName: schemaFile.content.singular_name,
    schema: schemaFile.content,
    items,
  }
}

/**
 * Load multiple collections for a page
 */
export async function loadCollectionsForPage(
  contentService: ContentServiceInterface,
  collectionTypes: string[],
  filter: CollectionLoaderFilter = {}
): Promise<Map<string, LoadedCollection>> {
  const collections = new Map<string, LoadedCollection>()

  for (const type of collectionTypes) {
    const collection = await loadCollection(contentService, type, filter)
    if (collection) {
      collections.set(type, collection)
    }
  }

  return collections
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

interface GroupedItemsFile {
  collection_type: string
  village?: string
  items: Array<Record<string, unknown>>
}

function isGroupedItemsFile(content: unknown): content is GroupedItemsFile {
  if (!content || typeof content !== 'object') return false
  const obj = content as Record<string, unknown>
  return Array.isArray(obj.items) && (typeof obj.collection_type === 'string' || typeof obj.village === 'string')
}

function isIndividualItemFile(content: unknown): content is CollectionItemFile {
  if (!content || typeof content !== 'object') return false
  const obj = content as Record<string, unknown>
  return typeof obj.slug === 'string' && typeof obj.data === 'object' && typeof obj.published === 'boolean'
}

/**
 * Extract a LoadedCollectionItem from raw data
 */
function extractLoadedItem(
  data: Record<string, unknown>,
  schema: CollectionSchemaFile,
  collectionType: string,
  slug?: string
): LoadedCollectionItem | null {
  // Generate slug
  const itemSlug = slug || (data.slug as string) || generateSlug(data, schema.title_field)
  if (!itemSlug) return null

  // Extract title
  const title = extractStringValue(data, schema.title_field || 'name') || 'Untitled'

  // Extract summary
  const summary = schema.summary_field
    ? extractStringValue(data, schema.summary_field)
    : extractStringValue(data, 'description') || extractStringValue(data, 'summary')

  // Extract image
  const image = schema.image_field
    ? extractStringValue(data, schema.image_field)
    : extractStringValue(data, 'image') ||
      extractStringValue(data, 'featured_image') ||
      extractStringValue(data, 'photo')

  // Extract date
  const date = schema.date_field
    ? extractStringValue(data, schema.date_field)
    : extractStringValue(data, 'date') ||
      extractStringValue(data, 'event_date') ||
      extractStringValue(data, 'start_date')

  return {
    slug: itemSlug,
    title,
    summary: summary?.slice(0, 200), // Truncate summary
    image,
    date,
    url: `/${collectionType}/${itemSlug}/`,
    data,
  }
}

/**
 * Check if an item matches the filter criteria
 */
function matchesFilter(
  _item: LoadedCollectionItem,
  data: Record<string, unknown>,
  filter: CollectionLoaderFilter
): boolean {
  // Filter by village
  if (filter.village) {
    const itemVillage = extractStringValue(data, 'village') || extractStringValue(data, 'location.village')
    if (itemVillage && itemVillage.toLowerCase() !== filter.village.toLowerCase()) {
      return false
    }
  }

  // Filter by language (for multilingual name fields)
  if (filter.language && data.name && typeof data.name === 'object') {
    const nameObj = data.name as Record<string, unknown>
    if (!(filter.language in nameObj)) {
      return false
    }
  }

  return true
}

/**
 * Extract a string value from data, handling multilingual fields
 */
function extractStringValue(data: Record<string, unknown>, fieldPath: string): string | undefined {
  const value = getNestedValue(data, fieldPath)

  if (typeof value === 'string') return value

  // Handle multilingual fields { en: '...', de: '...' }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const langObj = value as Record<string, unknown>
    return (langObj.en || langObj.de || langObj.fr || langObj.it || Object.values(langObj)[0]) as string | undefined
  }

  return undefined
}

/**
 * Get nested value from object using dot notation
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const keys = path.split('.')
  let current: unknown = obj

  for (const key of keys) {
    if (current === null || current === undefined) return undefined
    if (typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[key]
  }

  return current
}

/**
 * Generate a slug from item data
 */
function generateSlug(item: Record<string, unknown>, titleField?: string): string {
  if (item.slug) return String(item.slug)

  // Try to get name
  let name: string | undefined
  if (item.name) {
    if (typeof item.name === 'string') {
      name = item.name
    } else if (typeof item.name === 'object') {
      const nameObj = item.name as Record<string, unknown>
      name = (nameObj.en || Object.values(nameObj)[0]) as string
    }
  }

  if (name) return slugify(name)

  // Try title field
  if (titleField && item[titleField]) {
    const titleVal = item[titleField]
    if (typeof titleVal === 'string') return slugify(titleVal)
  }

  return `item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

/**
 * Convert string to URL-friendly slug
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
}

// =============================================================================
// EXPORT FOR AGENT USE
// =============================================================================

/**
 * Format collection items for agent context
 * Provides a condensed view of items for the agent to reference
 */
export function formatCollectionForAgent(
  collection: LoadedCollection,
  maxItems: number = 20
): string {
  const items = collection.items.slice(0, maxItems)

  let output = `## ${collection.displayName} (${collection.items.length} total items)\n\n`

  for (const item of items) {
    output += `- **${item.title}**`
    if (item.summary) {
      output += `: ${item.summary.slice(0, 100)}${item.summary.length > 100 ? '...' : ''}`
    }
    output += ` [slug: ${item.slug}]`
    if (item.image) {
      output += ` [has image]`
    }
    output += '\n'
  }

  if (collection.items.length > maxItems) {
    output += `\n... and ${collection.items.length - maxItems} more items\n`
  }

  return output
}

/**
 * Create a collection-embed block from loaded items
 */
export function createCollectionEmbedBlock(
  collection: LoadedCollection,
  options: {
    heading?: string
    layout?: 'grid' | 'list' | 'carousel' | 'compact'
    columns?: number
    showViewAll?: boolean
    limit?: number
  } = {}
): Record<string, unknown> {
  const items = options.limit ? collection.items.slice(0, options.limit) : collection.items

  return {
    type: 'collection-embed',
    collectionType: collection.type,
    displayName: collection.displayName,
    singularName: collection.singularName,
    heading: options.heading || collection.displayName,
    items: items.map((item) => ({
      slug: item.slug,
      title: item.title,
      summary: item.summary,
      image: item.image,
      date: item.date,
      url: item.url,
      data: item.data,
    })),
    display: {
      layout: options.layout || 'grid',
      columns: options.columns || 3,
      showImage: true,
      showSummary: true,
    },
    showViewAll: options.showViewAll ?? true,
    viewAllUrl: `/${collection.type}/`,
  }
}
