/**
 * Collection Schema Service
 * Handles loading, validating, and managing database-driven collection schemas
 */

import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import {
  websiteCollectionRepository,
  collectionItemRepository,
  type WebsiteCollection,
  type CollectionItem,
} from '../db/repositories'

// ============================================================================
// Types
// ============================================================================

export interface CollectionSchemaDefinition {
  type: string
  displayName: string
  singularName?: string
  description?: string
  icon?: string
  color?: string
  jsonSchema: Record<string, unknown>
  createSchema?: Record<string, unknown>
  fieldMetadata?: Record<string, unknown>
  titleField?: string
  summaryField?: string
  imageField?: string
  dateField?: string
}

export interface ValidationResult {
  valid: boolean
  errors?: string[]
}

export interface CollectionItemWithMeta extends CollectionItem {
  collectionType: string
  displayName: string
}

// ============================================================================
// Collection Schema Service
// ============================================================================

class CollectionSchemaService {
  private ajv: Ajv
  private schemaCache: Map<string, Record<string, unknown>> = new Map()

  constructor() {
    // Initialize Ajv with format validation
    this.ajv = new Ajv({
      allErrors: true,
      coerceTypes: true,
      useDefaults: true,
    })
    addFormats(this.ajv)
  }

  /**
   * Convert a Zod schema to JSON Schema format
   */
  zodToJsonSchema(schema: z.ZodType<unknown>, name?: string): Record<string, unknown> {
    return zodToJsonSchema(schema, {
      name,
      $refStrategy: 'none',
    }) as Record<string, unknown>
  }

  /**
   * Get the JSON Schema for a collection type
   */
  async getSchema(websiteId: string, collectionType: string): Promise<Record<string, unknown> | null> {
    // Check cache first
    const cacheKey = `${websiteId}:${collectionType}`
    if (this.schemaCache.has(cacheKey)) {
      return this.schemaCache.get(cacheKey)!
    }

    // Load from database
    const collection = await websiteCollectionRepository.findByType(websiteId, collectionType)
    if (!collection) {
      return null
    }

    // Cache and return
    this.schemaCache.set(cacheKey, collection.json_schema)
    return collection.json_schema
  }

  /**
   * Get all collection definitions for a website
   */
  async getCollections(websiteId: string, enabledOnly = true): Promise<WebsiteCollection[]> {
    return websiteCollectionRepository.findByWebsite(websiteId, enabledOnly)
  }

  /**
   * Create a new collection type for a website
   */
  async createCollection(
    websiteId: string,
    definition: CollectionSchemaDefinition
  ): Promise<WebsiteCollection> {
    // Clear cache for this website
    this.clearCache(websiteId)

    return websiteCollectionRepository.create({
      website_id: websiteId,
      collection_type: definition.type,
      json_schema: definition.jsonSchema,
      create_schema: definition.createSchema,
      display_name: definition.displayName,
      singular_name: definition.singularName,
      description: definition.description,
      icon: definition.icon,
      color: definition.color,
      field_metadata: definition.fieldMetadata || {},
      title_field: definition.titleField || 'name',
      summary_field: definition.summaryField,
      image_field: definition.imageField,
      date_field: definition.dateField,
      enabled: true,
    } as Partial<WebsiteCollection>)
  }

  /**
   * Update a collection schema
   */
  async updateCollectionSchema(
    collectionId: string,
    jsonSchema: Record<string, unknown>
  ): Promise<WebsiteCollection | null> {
    const collection = await websiteCollectionRepository.findById(collectionId)
    if (!collection) return null

    // Clear cache
    this.clearCache(collection.website_id, collection.collection_type)

    return websiteCollectionRepository.updateSchema(collectionId, jsonSchema)
  }

  /**
   * Validate data against a collection's JSON Schema
   */
  async validateData(
    websiteId: string,
    collectionType: string,
    data: Record<string, unknown>
  ): Promise<ValidationResult> {
    const schema = await this.getSchema(websiteId, collectionType)
    if (!schema) {
      return {
        valid: false,
        errors: [`Collection type '${collectionType}' not found for website`],
      }
    }

    // Compile schema if not already compiled
    const cacheKey = `${websiteId}:${collectionType}`
    let validate = this.ajv.getSchema(cacheKey)
    if (!validate) {
      this.ajv.addSchema(schema, cacheKey)
      validate = this.ajv.getSchema(cacheKey)
    }

    if (!validate) {
      return {
        valid: false,
        errors: ['Failed to compile schema'],
      }
    }

    const valid = validate(data)
    if (!valid) {
      return {
        valid: false,
        errors: validate.errors?.map((e) => {
          return `${e.instancePath || '/'}: ${e.message}`
        }),
      }
    }

    return { valid: true }
  }

  /**
   * Create a collection item with validation
   */
  async createItem(
    websiteId: string,
    collectionType: string,
    slug: string,
    data: Record<string, unknown>,
    options?: {
      published?: boolean
      userId?: string
      agentId?: string
    }
  ): Promise<{ item?: CollectionItem; errors?: string[] }> {
    // Validate data
    const validation = await this.validateData(websiteId, collectionType, data)
    if (!validation.valid) {
      return { errors: validation.errors }
    }

    // Get collection ID
    const collection = await websiteCollectionRepository.findByType(websiteId, collectionType)
    if (!collection) {
      return { errors: [`Collection type '${collectionType}' not found`] }
    }

    // Create item
    const item = await collectionItemRepository.create({
      website_collection_id: collection.id,
      slug,
      data,
      published: options?.published ?? false,
      created_by_user_id: options?.userId,
      created_by_agent_id: options?.agentId,
    } as Partial<CollectionItem>)

    return { item }
  }

  /**
   * Update a collection item with validation
   */
  async updateItem(
    itemId: string,
    data: Record<string, unknown>,
    options?: {
      userId?: string
      agentId?: string
    }
  ): Promise<{ item?: CollectionItem; errors?: string[] }> {
    // Get existing item
    const existingItem = await collectionItemRepository.findById(itemId)
    if (!existingItem) {
      return { errors: ['Item not found'] }
    }

    // Get collection for validation
    const collection = await websiteCollectionRepository.findById(existingItem.website_collection_id)
    if (!collection) {
      return { errors: ['Collection not found'] }
    }

    // Validate data
    const validation = await this.validateData(
      collection.website_id,
      collection.collection_type,
      data
    )
    if (!validation.valid) {
      return { errors: validation.errors }
    }

    // Update item
    const item = await collectionItemRepository.updateData(
      itemId,
      data,
      options?.userId,
      options?.agentId
    )

    return { item: item || undefined }
  }

  /**
   * Get items for a collection
   */
  async getItems(
    websiteId: string,
    collectionType: string,
    options?: {
      publishedOnly?: boolean
      limit?: number
      offset?: number
      search?: string
    }
  ): Promise<CollectionItem[]> {
    return collectionItemRepository.findByWebsiteAndType(websiteId, collectionType, options)
  }

  /**
   * Get a single item by slug
   */
  async getItemBySlug(
    websiteId: string,
    collectionType: string,
    slug: string
  ): Promise<CollectionItem | null> {
    const collection = await websiteCollectionRepository.findByType(websiteId, collectionType)
    if (!collection) return null

    return collectionItemRepository.findBySlug(collection.id, slug)
  }

  /**
   * Clear schema cache
   */
  clearCache(websiteId?: string, collectionType?: string): void {
    if (websiteId && collectionType) {
      const cacheKey = `${websiteId}:${collectionType}`
      this.schemaCache.delete(cacheKey)
      this.ajv.removeSchema(cacheKey)
    } else if (websiteId) {
      // Clear all schemas for a website
      for (const key of this.schemaCache.keys()) {
        if (key.startsWith(`${websiteId}:`)) {
          this.schemaCache.delete(key)
          this.ajv.removeSchema(key)
        }
      }
    } else {
      // Clear all
      this.schemaCache.clear()
      this.ajv.removeSchema()
    }
  }

  /**
   * Batch create collection items
   */
  async batchCreateItems(
    websiteId: string,
    collectionType: string,
    items: Array<{ slug: string; data: Record<string, unknown> }>,
    options?: {
      published?: boolean
      userId?: string
      agentId?: string
    }
  ): Promise<{ created: CollectionItem[]; errors: Array<{ slug: string; errors: string[] }> }> {
    const created: CollectionItem[] = []
    const errors: Array<{ slug: string; errors: string[] }> = []

    for (const item of items) {
      const result = await this.createItem(
        websiteId,
        collectionType,
        item.slug,
        item.data,
        options
      )

      if (result.item) {
        created.push(result.item)
      } else {
        errors.push({ slug: item.slug, errors: result.errors || ['Unknown error'] })
      }
    }

    return { created, errors }
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const collectionSchemaService = new CollectionSchemaService()
