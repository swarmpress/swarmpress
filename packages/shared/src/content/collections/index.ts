/**
 * Collection Schemas Index
 * Exports all collection types and schemas
 */

// Event Collection
export * from './event';
export { EVENT_COLLECTION_TYPE } from './event';

// POI Collection
export * from './poi';
export { POI_COLLECTION_TYPE } from './poi';

// FAQ Collection
export * from './faq';
export { FAQ_COLLECTION_TYPE } from './faq';

// News Collection
export * from './news';
export { NEWS_COLLECTION_TYPE } from './news';

// Re-export for convenience
import { EVENT_COLLECTION_TYPE } from './event';
import { POI_COLLECTION_TYPE } from './poi';
import { FAQ_COLLECTION_TYPE } from './faq';
import { NEWS_COLLECTION_TYPE } from './news';

/**
 * All available collection types
 */
export const COLLECTION_TYPES = {
  events: EVENT_COLLECTION_TYPE,
  pois: POI_COLLECTION_TYPE,
  faqs: FAQ_COLLECTION_TYPE,
  news: NEWS_COLLECTION_TYPE,
} as const;

/**
 * Array of all collection types
 */
export const ALL_COLLECTION_TYPES = Object.values(COLLECTION_TYPES);

/**
 * Type for collection type keys
 */
export type CollectionType = keyof typeof COLLECTION_TYPES;

/**
 * Get collection definition by type
 */
export function getCollectionType(type: CollectionType) {
  return COLLECTION_TYPES[type];
}

/**
 * Check if a collection type exists
 */
export function isValidCollectionType(type: string): type is CollectionType {
  return type in COLLECTION_TYPES;
}
