/**
 * Collection Page Generator
 * Generates static pages for collection listings and detail views
 */

import { mkdir, writeFile } from 'fs/promises'
import { dirname } from 'path'

import type { Website } from '@swarm-press/shared'
import {
  fetchCollectionsForBuild,
  transformItemsForTemplate,
  transformItemForDetail,
} from './collections'
import type {
  CollectionGenerationOptions,
  CollectionGenerationResult,
  WebsiteCollectionRow,
  CollectionItemRow,
} from '../types/collection-types'
import {
  getCollectionListingUrl,
  getCollectionDetailUrl,
  generatePaginationUrls,
} from '../types/collection-types'
import {
  generateListingPageContent,
  generateDetailPageContent,
  getCollectionPagePath,
} from '../templates/resolver'

// =============================================================================
// MAIN GENERATION FUNCTION
// =============================================================================

/**
 * Generate all collection pages for a website
 */
export async function generateCollectionPages(
  website: Website,
  options: Omit<CollectionGenerationOptions, 'websiteId'>
): Promise<CollectionGenerationResult> {
  const {
    buildDir,
    baseUrl,
    itemsPerPage = 12,
    generateDetailPages = true,
    generateListingPages = true,
  } = options

  const result: CollectionGenerationResult = {
    success: true,
    pagesGenerated: 0,
    errors: [],
    collections: [],
  }

  try {
    console.log(`[CollectionPages] Generating collection pages for website ${website.id}`)

    // Fetch all collections with items
    const collectionsWithItems = await fetchCollectionsForBuild(website.id, {
      publishedOnly: true,
    })

    if (collectionsWithItems.length === 0) {
      console.log('[CollectionPages] No collections found for this website')
      return result
    }

    console.log(`[CollectionPages] Found ${collectionsWithItems.length} collections`)

    // Generate pages for each collection
    for (const { collection, items } of collectionsWithItems) {
      const collectionResult = {
        type: collection.collection_type,
        listingPages: 0,
        detailPages: 0,
      }

      try {
        // Generate listing pages
        if (generateListingPages) {
          const listingCount = await generateListingPages_internal(
            collection,
            items,
            buildDir,
            baseUrl,
            itemsPerPage,
            website
          )
          collectionResult.listingPages = listingCount
          result.pagesGenerated += listingCount
        }

        // Generate detail pages
        if (generateDetailPages) {
          const detailCount = await generateDetailPages_internal(
            collection,
            items,
            buildDir,
            baseUrl,
            website
          )
          collectionResult.detailPages = detailCount
          result.pagesGenerated += detailCount
        }

        result.collections.push(collectionResult)
        console.log(
          `[CollectionPages] Generated ${collectionResult.listingPages} listing and ${collectionResult.detailPages} detail pages for ${collection.collection_type}`
        )
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        result.errors.push(`Collection ${collection.collection_type}: ${errorMessage}`)
        console.error(`[CollectionPages] Error generating pages for ${collection.collection_type}:`, error)
      }
    }

    console.log(`[CollectionPages] Total pages generated: ${result.pagesGenerated}`)
  } catch (error) {
    result.success = false
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    result.errors.push(`Failed to generate collection pages: ${errorMessage}`)
    console.error('[CollectionPages] Failed to generate collection pages:', error)
  }

  return result
}

// =============================================================================
// LISTING PAGE GENERATION
// =============================================================================

/**
 * Generate listing pages for a collection (with pagination)
 */
async function generateListingPages_internal(
  collection: WebsiteCollectionRow,
  items: CollectionItemRow[],
  buildDir: string,
  baseUrl: string,
  itemsPerPage: number,
  _website: Website
): Promise<number> {
  let pagesGenerated = 0
  const totalItems = items.length
  const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage))

  for (let page = 1; page <= totalPages; page++) {
    // Get items for this page
    const startIndex = (page - 1) * itemsPerPage
    const endIndex = Math.min(startIndex + itemsPerPage, totalItems)
    const pageItems = items.slice(startIndex, endIndex)

    // Transform items for template
    const transformedItems = transformItemsForTemplate(pageItems, collection, baseUrl)

    // Generate pagination info
    const paginationUrls = generatePaginationUrls(collection.collection_type, page, totalPages)

    const pagination = {
      currentPage: page,
      totalPages,
      totalItems,
      itemsPerPage,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
      nextPageUrl: paginationUrls.nextUrl,
      prevPageUrl: paginationUrls.prevUrl,
    }

    // Generate page content
    const pageContent = generateListingPageContent({
      collectionType: collection.collection_type,
      displayName: collection.display_name,
      singularName: collection.singular_name,
      description: collection.description,
      page,
      totalPages,
      itemsJson: JSON.stringify(transformedItems, null, 2),
      paginationJson: JSON.stringify(pagination, null, 2),
    })

    // Write page file
    const pagePath = getCollectionPagePath(buildDir, collection.collection_type, undefined, page)
    await mkdir(dirname(pagePath), { recursive: true })
    await writeFile(pagePath, pageContent)

    pagesGenerated++
  }

  return pagesGenerated
}

// =============================================================================
// DETAIL PAGE GENERATION
// =============================================================================

/**
 * Generate detail pages for all items in a collection
 */
async function generateDetailPages_internal(
  collection: WebsiteCollectionRow,
  items: CollectionItemRow[],
  buildDir: string,
  _baseUrl: string,
  _website: Website
): Promise<number> {
  let pagesGenerated = 0

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (!item) continue

    // Transform item for template
    const transformedItem = transformItemForDetail(item, collection)

    // Get navigation (prev/next items)
    const prevItem = i > 0 ? items[i - 1] : undefined
    const nextItem = i < items.length - 1 ? items[i + 1] : undefined

    const navigation = {
      prevItem: prevItem
        ? {
            slug: prevItem.slug,
            title: getItemTitle(prevItem, collection),
            url: getCollectionDetailUrl(collection.collection_type, prevItem.slug),
          }
        : undefined,
      nextItem: nextItem
        ? {
            slug: nextItem.slug,
            title: getItemTitle(nextItem, collection),
            url: getCollectionDetailUrl(collection.collection_type, nextItem.slug),
          }
        : undefined,
      listingUrl: getCollectionListingUrl(collection.collection_type),
    }

    // Get related items (exclude current item, limit to 4)
    const relatedItems = items
      .filter((r) => r.id !== item.id)
      .slice(0, 4)
      .map((r) => ({
        slug: r.slug,
        title: getItemTitle(r, collection),
        summary: getItemSummary(r, collection),
        image: getItemImage(r, collection),
        url: getCollectionDetailUrl(collection.collection_type, r.slug),
      }))

    // Generate page content
    const pageContent = generateDetailPageContent({
      collectionType: collection.collection_type,
      displayName: collection.display_name,
      singularName: collection.singular_name,
      itemJson: JSON.stringify(transformedItem, null, 2),
      navigationJson: JSON.stringify(navigation, null, 2),
      relatedItemsJson: JSON.stringify(relatedItems, null, 2),
    })

    // Write page file
    const pagePath = getCollectionPagePath(buildDir, collection.collection_type, item.slug)
    await mkdir(dirname(pagePath), { recursive: true })
    await writeFile(pagePath, pageContent)

    pagesGenerated++
  }

  return pagesGenerated
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get item title from data using title_field
 */
function getItemTitle(item: CollectionItemRow, collection: WebsiteCollectionRow): string {
  const value = getNestedValue(item.data, collection.title_field)
  return typeof value === 'string' ? value : 'Untitled'
}

/**
 * Get item summary from data using summary_field
 */
function getItemSummary(item: CollectionItemRow, collection: WebsiteCollectionRow): string | undefined {
  if (!collection.summary_field) return undefined
  const value = getNestedValue(item.data, collection.summary_field)
  return typeof value === 'string' ? value : undefined
}

/**
 * Get item image from data using image_field
 */
function getItemImage(item: CollectionItemRow, collection: WebsiteCollectionRow): string | undefined {
  if (!collection.image_field) return undefined
  const value = getNestedValue(item.data, collection.image_field)
  return typeof value === 'string' ? value : undefined
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
