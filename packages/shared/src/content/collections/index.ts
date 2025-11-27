/**
 * Collection Schemas Index
 * Exports base collection types and schemas
 *
 * Note: Website-specific collection schemas are stored in the database
 * and loaded dynamically. This file only exports generic base collections.
 */

// =============================================================================
// BASE COLLECTIONS (Generic, reusable collections)
// =============================================================================

// Event Collection
export * from './event'
export { EVENT_COLLECTION_TYPE } from './event'

// POI Collection
export * from './poi'
export { POI_COLLECTION_TYPE } from './poi'

// FAQ Collection
export * from './faq'
export { FAQ_COLLECTION_TYPE } from './faq'

// News Collection
export * from './news'
export { NEWS_COLLECTION_TYPE } from './news'

// =============================================================================
// COLLECTION TYPES REGISTRY (Base collections only)
// =============================================================================

import { EVENT_COLLECTION_TYPE } from './event'
import { POI_COLLECTION_TYPE } from './poi'
import { FAQ_COLLECTION_TYPE } from './faq'
import { NEWS_COLLECTION_TYPE } from './news'

import { z } from 'zod'

/**
 * Interface for collection type definitions
 */
export interface CollectionTypeDefinition {
  type: string
  displayName: string
  singularName: string
  icon: string
  color: string
  description: string
  schema: z.ZodType<unknown>
  createSchema: z.ZodType<unknown>
  fieldMetadata: Record<string, unknown>
}

/**
 * Type for base collection type keys
 */
export type BaseCollectionType = 'events' | 'pois' | 'faqs' | 'news'

/**
 * Base collection types (generic swarm.press collections)
 * Website-specific collections are stored in the database
 */
export const BASE_COLLECTION_TYPES: Record<BaseCollectionType, CollectionTypeDefinition> = {
  events: EVENT_COLLECTION_TYPE,
  pois: POI_COLLECTION_TYPE,
  faqs: FAQ_COLLECTION_TYPE,
  news: NEWS_COLLECTION_TYPE,
}

/**
 * Array of base collection types
 */
export const BASE_COLLECTION_TYPE_LIST: CollectionTypeDefinition[] = Object.values(BASE_COLLECTION_TYPES)

/**
 * Get base collection definition by type
 */
export function getBaseCollectionType(type: BaseCollectionType): CollectionTypeDefinition {
  return BASE_COLLECTION_TYPES[type]
}

/**
 * Check if a collection type is a base collection
 */
export function isBaseCollectionType(type: string): type is BaseCollectionType {
  return type in BASE_COLLECTION_TYPES
}
