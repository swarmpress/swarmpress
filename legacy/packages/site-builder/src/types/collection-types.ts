/**
 * Collection Types for Site Builder
 * Types specific to collection page generation and rendering
 */

// Re-export shared types for convenience
export type {
  CollectionEmbedConfig,
  CollectionDisplayConfig,
  CollectionDisplayLayout,
  CollectionFilter,
  CollectionSort,
  CollectionItemTemplate,
  ResolvedCollectionItem,
  ResolvedCollection,
  CollectionEmbedProps,
  CollectionListingProps,
  CollectionDetailProps,
} from '@swarm-press/shared'

// =============================================================================
// WEBSITE COLLECTION (from database)
// =============================================================================

/**
 * Website collection definition as returned from database
 */
export interface WebsiteCollectionRow {
  id: string
  website_id: string
  collection_type: string
  json_schema: Record<string, unknown>
  create_schema?: Record<string, unknown>
  display_name: string
  singular_name?: string
  description?: string
  icon?: string
  color?: string
  field_metadata: Record<string, unknown>
  title_field: string
  summary_field?: string
  image_field?: string
  date_field?: string
  enable_search: boolean
  enable_filtering: boolean
  enable_versioning: boolean
  enable_github_sync: boolean
  custom_fields: unknown[]
  field_overrides: Record<string, unknown>
  enabled: boolean
  github_path?: string
  created_at: Date
  updated_at: Date
}

/**
 * Collection item as returned from database
 */
export interface CollectionItemRow {
  id: string
  website_collection_id: string
  slug: string
  data: Record<string, unknown>
  published: boolean
  published_at?: Date
  featured: boolean
  github_path?: string
  github_sha?: string
  synced_at?: Date
  created_by_agent_id?: string
  created_by_user_id?: string
  updated_by_agent_id?: string
  updated_by_user_id?: string
  created_at: Date
  updated_at: Date
}

// =============================================================================
// BUILD-TIME TYPES
// =============================================================================

/**
 * Collection with items for build time
 */
export interface CollectionForBuild {
  collection: WebsiteCollectionRow
  items: CollectionItemRow[]
}

/**
 * Options for generating collection pages
 */
export interface CollectionGenerationOptions {
  websiteId: string
  buildDir: string
  baseUrl: string
  itemsPerPage?: number
  generateDetailPages?: boolean
  generateListingPages?: boolean
}

/**
 * Result of collection page generation
 */
export interface CollectionGenerationResult {
  success: boolean
  pagesGenerated: number
  errors: string[]
  collections: Array<{
    type: string
    listingPages: number
    detailPages: number
  }>
}

// =============================================================================
// TEMPLATE CONTEXT
// =============================================================================

/**
 * Context passed to listing templates
 */
export interface ListingTemplateContext {
  collection: {
    type: string
    displayName: string
    singularName?: string
    description?: string
    icon?: string
    color?: string
  }
  items: Array<{
    id: string
    slug: string
    title: string
    summary?: string
    image?: string
    date?: string
    url: string
    data: Record<string, unknown>
    featured: boolean
  }>
  pagination: {
    currentPage: number
    totalPages: number
    totalItems: number
    itemsPerPage: number
    hasNextPage: boolean
    hasPrevPage: boolean
    nextPageUrl?: string
    prevPageUrl?: string
    pages: Array<{ number: number; url: string; current: boolean }>
  }
  website: {
    name: string
    domain?: string
    description?: string
  }
  baseUrl: string
}

/**
 * Context passed to detail templates
 */
export interface DetailTemplateContext {
  collection: {
    type: string
    displayName: string
    singularName?: string
    description?: string
    icon?: string
    color?: string
    schema: Record<string, unknown>
    fieldMetadata: Record<string, unknown>
  }
  item: {
    id: string
    slug: string
    title: string
    summary?: string
    image?: string
    date?: string
    data: Record<string, unknown>
    featured: boolean
    createdAt: string
    updatedAt: string
  }
  navigation: {
    prevItem?: { slug: string; title: string; url: string }
    nextItem?: { slug: string; title: string; url: string }
    listingUrl: string
  }
  relatedItems: Array<{
    slug: string
    title: string
    summary?: string
    image?: string
    url: string
  }>
  website: {
    name: string
    domain?: string
  }
}

// =============================================================================
// TEMPLATE RESOLUTION
// =============================================================================

/**
 * Template resolution result
 */
export interface TemplateResolution {
  templatePath: string
  templateType: 'custom' | 'default'
  exists: boolean
}

/**
 * Available templates for a collection type
 */
export interface CollectionTemplates {
  listing: TemplateResolution
  detail: TemplateResolution
  card?: TemplateResolution
}

// =============================================================================
// FIELD EXTRACTION
// =============================================================================

/**
 * Options for extracting field values from collection item data
 */
export interface FieldExtractionOptions {
  titleField: string
  summaryField?: string
  imageField?: string
  dateField?: string
}

/**
 * Extract standard fields from collection item data
 */
export function extractItemFields(
  data: Record<string, unknown>,
  options: FieldExtractionOptions
): {
  title: string
  summary?: string
  image?: string
  date?: string
} {
  return {
    title: getNestedValue(data, options.titleField) as string || 'Untitled',
    summary: options.summaryField ? getNestedValue(data, options.summaryField) as string : undefined,
    image: options.imageField ? getNestedValue(data, options.imageField) as string : undefined,
    date: options.dateField ? formatDate(getNestedValue(data, options.dateField)) : undefined,
  }
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
 * Format date value to string
 */
function formatDate(value: unknown): string | undefined {
  if (!value) return undefined

  if (value instanceof Date) {
    return value.toISOString().split('T')[0]
  }

  if (typeof value === 'string') {
    const date = new Date(value)
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0]
    }
    return value
  }

  return undefined
}

// =============================================================================
// URL GENERATION
// =============================================================================

/**
 * Generate URL for collection listing page
 */
export function getCollectionListingUrl(
  collectionType: string,
  page: number = 1
): string {
  if (page === 1) {
    return `/${collectionType}`
  }
  return `/${collectionType}/page/${page}`
}

/**
 * Generate URL for collection detail page
 */
export function getCollectionDetailUrl(
  collectionType: string,
  slug: string
): string {
  return `/${collectionType}/${slug}`
}

/**
 * Generate pagination URLs
 */
export function generatePaginationUrls(
  collectionType: string,
  currentPage: number,
  totalPages: number
): {
  prevUrl?: string
  nextUrl?: string
  pages: Array<{ number: number; url: string; current: boolean }>
} {
  const pages: Array<{ number: number; url: string; current: boolean }> = []

  // Generate page numbers (show max 5 pages around current)
  const startPage = Math.max(1, currentPage - 2)
  const endPage = Math.min(totalPages, currentPage + 2)

  for (let i = startPage; i <= endPage; i++) {
    pages.push({
      number: i,
      url: getCollectionListingUrl(collectionType, i),
      current: i === currentPage,
    })
  }

  return {
    prevUrl: currentPage > 1 ? getCollectionListingUrl(collectionType, currentPage - 1) : undefined,
    nextUrl: currentPage < totalPages ? getCollectionListingUrl(collectionType, currentPage + 1) : undefined,
    pages,
  }
}
