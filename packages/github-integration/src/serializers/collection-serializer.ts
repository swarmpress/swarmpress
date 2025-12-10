/**
 * Collection Serializer
 * Converts between database WebsiteCollection/CollectionItem entities and GitHub file format
 */

import type { CollectionSchemaFile, CollectionItemFile } from '../content-service'

/**
 * Database website collection entity (simplified for serialization)
 */
export interface DbWebsiteCollection {
  id: string
  collection_type: string
  display_name: string
  singular_name?: string | null
  description?: string | null
  icon?: string | null
  color?: string | null
  json_schema: Record<string, unknown>
  field_metadata?: Record<string, unknown> | null
  title_field?: string | null
  summary_field?: string | null
  image_field?: string | null
  date_field?: string | null
  created_at: Date | string
  updated_at: Date | string
}

/**
 * Database collection item entity (simplified for serialization)
 */
export interface DbCollectionItem {
  id: string
  slug: string
  data: Record<string, unknown>
  published: boolean
  featured?: boolean
  created_at: Date | string
  updated_at: Date | string
}

/**
 * Serialize a database WebsiteCollection to GitHub schema file format
 */
export function serializeCollectionSchema(
  collection: DbWebsiteCollection
): CollectionSchemaFile {
  return {
    type: collection.collection_type,
    display_name: collection.display_name,
    singular_name: collection.singular_name || undefined,
    description: collection.description || undefined,
    icon: collection.icon || undefined,
    color: collection.color || undefined,
    json_schema: collection.json_schema,
    field_metadata: collection.field_metadata || undefined,
    title_field: collection.title_field || undefined,
    summary_field: collection.summary_field || undefined,
    image_field: collection.image_field || undefined,
    date_field: collection.date_field || undefined,
  }
}

/**
 * Deserialize a GitHub schema file to database entity
 */
export function deserializeCollectionSchema(
  file: CollectionSchemaFile
): Partial<DbWebsiteCollection> {
  return {
    collection_type: file.type,
    display_name: file.display_name,
    singular_name: file.singular_name,
    description: file.description,
    icon: file.icon,
    color: file.color,
    json_schema: file.json_schema,
    field_metadata: file.field_metadata,
    title_field: file.title_field,
    summary_field: file.summary_field,
    image_field: file.image_field,
    date_field: file.date_field,
  }
}

/**
 * Serialize a database CollectionItem to GitHub file format
 */
export function serializeCollectionItem(
  item: DbCollectionItem
): CollectionItemFile {
  return {
    id: item.id,
    slug: item.slug,
    data: item.data,
    published: item.published,
    featured: item.featured,
    created_at: toISOString(item.created_at),
    updated_at: toISOString(item.updated_at),
  }
}

/**
 * Deserialize a GitHub file to database entity
 */
export function deserializeCollectionItem(
  file: CollectionItemFile
): Partial<DbCollectionItem> {
  return {
    id: file.id,
    slug: file.slug,
    data: file.data,
    published: file.published,
    featured: file.featured,
    created_at: file.created_at,
    updated_at: file.updated_at,
  }
}

/**
 * Convert Date or string to ISO string
 */
function toISOString(date: Date | string): string {
  if (typeof date === 'string') return date
  return date.toISOString()
}

/**
 * Generate a slug from a name/title field
 */
export function generateItemSlug(data: Record<string, unknown>, titleField = 'name'): string {
  const title = data[titleField]
  if (typeof title !== 'string') {
    throw new Error(`Cannot generate slug: ${titleField} field is not a string`)
  }

  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '') // Remove special chars
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with single
    .replace(/^-|-$/g, '') // Remove leading/trailing hyphens
}

/**
 * Create a new collection item file with defaults
 */
export function createCollectionItemFile(params: {
  data: Record<string, unknown>
  slug?: string
  titleField?: string
  published?: boolean
}): CollectionItemFile {
  const now = new Date().toISOString()
  const slug = params.slug || generateItemSlug(params.data, params.titleField || 'name')

  return {
    id: crypto.randomUUID(),
    slug,
    data: params.data,
    published: params.published ?? false,
    created_at: now,
    updated_at: now,
  }
}

/**
 * Create a new collection schema file with defaults
 */
export function createCollectionSchemaFile(params: {
  type: string
  displayName: string
  singularName?: string
  jsonSchema: Record<string, unknown>
  titleField?: string
}): CollectionSchemaFile {
  return {
    type: params.type,
    display_name: params.displayName,
    singular_name: params.singularName,
    json_schema: params.jsonSchema,
    title_field: params.titleField || 'name',
  }
}

/**
 * Extract title from collection item data using title_field
 */
export function extractItemTitle(
  item: CollectionItemFile,
  titleField = 'name'
): string {
  const title = item.data[titleField]
  if (typeof title === 'string') return title
  return item.slug
}

/**
 * Extract summary from collection item data using summary_field
 */
export function extractItemSummary(
  item: CollectionItemFile,
  summaryField?: string
): string | undefined {
  if (!summaryField) return undefined
  const summary = item.data[summaryField]
  if (typeof summary === 'string') return summary
  return undefined
}
