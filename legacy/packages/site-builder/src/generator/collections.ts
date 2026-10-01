/**
 * Collection Data Fetcher for Site Builder
 * Fetches collection definitions and items from the database for static site generation
 */

import {
  websiteCollectionRepository,
  collectionItemRepository,
} from '@swarm-press/backend'

import type {
  WebsiteCollectionRow,
  CollectionItemRow,
  CollectionForBuild,
  FieldExtractionOptions,
} from '../types/collection-types'
import { extractItemFields } from '../types/collection-types'

// =============================================================================
// FETCH COLLECTIONS
// =============================================================================

/**
 * Fetch all enabled collections for a website
 */
export async function fetchEnabledCollections(
  websiteId: string
): Promise<WebsiteCollectionRow[]> {
  const collections = await websiteCollectionRepository.findByWebsite(
    websiteId,
    true // enabledOnly
  )

  console.log(`[Collections] Found ${collections.length} enabled collections for website ${websiteId}`)

  return collections as WebsiteCollectionRow[]
}

/**
 * Fetch all collections for a website (including disabled)
 */
export async function fetchAllCollections(
  websiteId: string
): Promise<WebsiteCollectionRow[]> {
  const collections = await websiteCollectionRepository.findByWebsite(
    websiteId,
    false // include disabled
  )

  return collections as WebsiteCollectionRow[]
}

/**
 * Fetch a specific collection type
 */
export async function fetchCollectionByType(
  websiteId: string,
  collectionType: string
): Promise<WebsiteCollectionRow | null> {
  const collection = await websiteCollectionRepository.findByType(
    websiteId,
    collectionType
  )

  return collection as WebsiteCollectionRow | null
}

// =============================================================================
// FETCH COLLECTION ITEMS
// =============================================================================

/**
 * Fetch items for a collection
 */
export async function fetchCollectionItems(
  collectionId: string,
  options?: {
    publishedOnly?: boolean
    limit?: number
    offset?: number
    search?: string
  }
): Promise<CollectionItemRow[]> {
  const items = await collectionItemRepository.findByCollection(
    collectionId,
    {
      publishedOnly: options?.publishedOnly ?? true,
      limit: options?.limit,
      offset: options?.offset,
      search: options?.search,
    }
  )

  console.log(`[Collections] Found ${items.length} items for collection ${collectionId}`)

  return items as CollectionItemRow[]
}

/**
 * Fetch item count for a collection
 */
export async function fetchCollectionItemCount(
  collectionId: string,
  publishedOnly: boolean = true
): Promise<number> {
  return collectionItemRepository.countByCollection(collectionId, publishedOnly)
}

/**
 * Fetch items by website and collection type
 */
export async function fetchItemsByWebsiteAndType(
  websiteId: string,
  collectionType: string,
  options?: {
    publishedOnly?: boolean
    limit?: number
    offset?: number
  }
): Promise<CollectionItemRow[]> {
  const items = await collectionItemRepository.findByWebsiteAndType(
    websiteId,
    collectionType,
    options
  )

  return items as CollectionItemRow[]
}

// =============================================================================
// FETCH COLLECTIONS WITH ITEMS
// =============================================================================

/**
 * Fetch all enabled collections with their items for build
 */
export async function fetchCollectionsForBuild(
  websiteId: string,
  options?: {
    publishedOnly?: boolean
  }
): Promise<CollectionForBuild[]> {
  const collections = await fetchEnabledCollections(websiteId)

  const collectionsWithItems: CollectionForBuild[] = []

  for (const collection of collections) {
    const items = await fetchCollectionItems(collection.id, {
      publishedOnly: options?.publishedOnly ?? true,
    })

    collectionsWithItems.push({
      collection,
      items,
    })
  }

  console.log(`[Collections] Loaded ${collectionsWithItems.length} collections with items`)

  return collectionsWithItems
}

// =============================================================================
// ITEM TRANSFORMATION
// =============================================================================

/**
 * Transform collection items for template rendering
 */
export function transformItemsForTemplate(
  items: CollectionItemRow[],
  collection: WebsiteCollectionRow,
  baseUrl: string
): Array<{
  id: string
  slug: string
  title: string
  summary?: string
  image?: string
  date?: string
  url: string
  data: Record<string, unknown>
  featured: boolean
}> {
  const fieldOptions: FieldExtractionOptions = {
    titleField: collection.title_field,
    summaryField: collection.summary_field,
    imageField: collection.image_field,
    dateField: collection.date_field,
  }

  return items.map((item) => {
    const fields = extractItemFields(item.data, fieldOptions)

    return {
      id: item.id,
      slug: item.slug,
      title: fields.title,
      summary: fields.summary,
      image: fields.image,
      date: fields.date,
      url: `${baseUrl}/${collection.collection_type}/${item.slug}`,
      data: item.data,
      featured: item.featured,
    }
  })
}

/**
 * Transform a single item for detail template
 */
export function transformItemForDetail(
  item: CollectionItemRow,
  collection: WebsiteCollectionRow
): {
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
} {
  const fieldOptions: FieldExtractionOptions = {
    titleField: collection.title_field,
    summaryField: collection.summary_field,
    imageField: collection.image_field,
    dateField: collection.date_field,
  }

  const fields = extractItemFields(item.data, fieldOptions)

  return {
    id: item.id,
    slug: item.slug,
    title: fields.title,
    summary: fields.summary,
    image: fields.image,
    date: fields.date,
    data: item.data,
    featured: item.featured,
    createdAt: item.created_at.toISOString(),
    updatedAt: item.updated_at.toISOString(),
  }
}

// =============================================================================
// PAGINATION HELPERS
// =============================================================================

/**
 * Calculate pagination info
 */
export function calculatePagination(
  totalItems: number,
  currentPage: number,
  itemsPerPage: number
): {
  totalPages: number
  hasNextPage: boolean
  hasPrevPage: boolean
  startIndex: number
  endIndex: number
} {
  const totalPages = Math.ceil(totalItems / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const endIndex = Math.min(startIndex + itemsPerPage, totalItems)

  return {
    totalPages,
    hasNextPage: currentPage < totalPages,
    hasPrevPage: currentPage > 1,
    startIndex,
    endIndex,
  }
}

/**
 * Get items for a specific page
 */
export async function fetchItemsForPage(
  collectionId: string,
  page: number,
  itemsPerPage: number,
  publishedOnly: boolean = true
): Promise<{
  items: CollectionItemRow[]
  pagination: {
    currentPage: number
    totalPages: number
    totalItems: number
    itemsPerPage: number
    hasNextPage: boolean
    hasPrevPage: boolean
  }
}> {
  const totalItems = await fetchCollectionItemCount(collectionId, publishedOnly)
  const paginationInfo = calculatePagination(totalItems, page, itemsPerPage)

  const items = await fetchCollectionItems(collectionId, {
    publishedOnly,
    limit: itemsPerPage,
    offset: paginationInfo.startIndex,
  })

  return {
    items,
    pagination: {
      currentPage: page,
      totalPages: paginationInfo.totalPages,
      totalItems,
      itemsPerPage,
      hasNextPage: paginationInfo.hasNextPage,
      hasPrevPage: paginationInfo.hasPrevPage,
    },
  }
}

// =============================================================================
// RELATED ITEMS
// =============================================================================

/**
 * Fetch related items for a collection item
 * Returns items from the same collection, excluding the current item
 */
export async function fetchRelatedItems(
  collectionId: string,
  currentItemId: string,
  limit: number = 4
): Promise<CollectionItemRow[]> {
  const allItems = await fetchCollectionItems(collectionId, {
    publishedOnly: true,
    limit: limit + 1, // Fetch one extra in case current item is in results
  })

  // Filter out current item and limit
  return allItems
    .filter((item) => item.id !== currentItemId)
    .slice(0, limit)
}

/**
 * Get prev/next items for navigation
 */
export async function fetchNavigationItems(
  collectionId: string,
  currentItem: CollectionItemRow
): Promise<{
  prevItem?: CollectionItemRow
  nextItem?: CollectionItemRow
}> {
  const allItems = await fetchCollectionItems(collectionId, {
    publishedOnly: true,
  })

  const currentIndex = allItems.findIndex((item) => item.id === currentItem.id)

  if (currentIndex === -1) {
    return {}
  }

  return {
    prevItem: currentIndex > 0 ? allItems[currentIndex - 1] : undefined,
    nextItem: currentIndex < allItems.length - 1 ? allItems[currentIndex + 1] : undefined,
  }
}
