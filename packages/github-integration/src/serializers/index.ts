/**
 * Serializers Index
 * Export all serialization utilities for converting between DB and GitHub formats
 */

export {
  serializePageToFile,
  deserializeFileToPage,
  generateSlug,
  createPageFile,
  type DbPage,
  type DbContentItem,
} from './page-serializer'

export {
  serializeCollectionSchema,
  deserializeCollectionSchema,
  serializeCollectionItem,
  deserializeCollectionItem,
  generateItemSlug,
  createCollectionItemFile,
  createCollectionSchemaFile,
  extractItemTitle,
  extractItemSummary,
  type DbWebsiteCollection,
  type DbCollectionItem,
} from './collection-serializer'
