import { BaseRepository } from '../base-repository'
import { db } from '../connection'
import type { QueryResultRow } from 'pg'

// ============================================================================
// Types
// ============================================================================

/**
 * Website Collection Definition (stored in database)
 */
export interface WebsiteCollection extends QueryResultRow {
  id: string
  website_id: string
  collection_type: string

  // Schema
  json_schema: Record<string, unknown>
  create_schema?: Record<string, unknown>

  // Display
  display_name: string
  singular_name?: string
  description?: string
  icon?: string
  color?: string

  // Field metadata
  field_metadata: Record<string, unknown>
  title_field: string
  summary_field?: string
  image_field?: string
  date_field?: string

  // Features
  enable_search: boolean
  enable_filtering: boolean
  enable_versioning: boolean
  enable_github_sync: boolean

  // Custom fields
  custom_fields: unknown[]
  field_overrides: Record<string, unknown>

  // Status
  enabled: boolean
  github_path?: string

  // Timestamps
  created_at: Date
  updated_at: Date
}

/**
 * Collection Item (actual content)
 */
export interface CollectionItem extends QueryResultRow {
  id: string
  website_collection_id: string
  slug: string
  data: Record<string, unknown>

  // Metadata
  published: boolean
  published_at?: Date
  featured: boolean

  // GitHub sync
  github_path?: string
  github_sha?: string
  synced_at?: Date

  // Authorship
  created_by_agent_id?: string
  created_by_user_id?: string
  updated_by_agent_id?: string
  updated_by_user_id?: string

  // Timestamps
  created_at: Date
  updated_at: Date
}

/**
 * Collection Item Version (history)
 */
export interface CollectionItemVersion extends QueryResultRow {
  id: string
  item_id: string
  version_number: number
  data: Record<string, unknown>

  // Metadata
  created_by_agent_id?: string
  created_by_user_id?: string
  change_summary?: string

  created_at: Date
}

// ============================================================================
// Website Collection Repository
// ============================================================================

export class WebsiteCollectionRepository extends BaseRepository<WebsiteCollection> {
  constructor() {
    super('website_collections')
  }

  /**
   * Find collections for a website
   */
  async findByWebsite(websiteId: string, enabledOnly = false): Promise<WebsiteCollection[]> {
    let query = `SELECT * FROM ${this.tableName} WHERE website_id = $1`
    if (enabledOnly) {
      query += ' AND enabled = TRUE'
    }
    query += ' ORDER BY display_name'

    const result = await db.query<WebsiteCollection>(query, [websiteId])
    return result.rows
  }

  /**
   * Find a specific collection type for a website
   */
  async findByType(websiteId: string, collectionType: string): Promise<WebsiteCollection | null> {
    const result = await db.query<WebsiteCollection>(
      `SELECT * FROM ${this.tableName} WHERE website_id = $1 AND collection_type = $2`,
      [websiteId, collectionType]
    )
    return result.rows[0] || null
  }

  /**
   * Get the JSON Schema for a collection type
   */
  async getSchema(websiteId: string, collectionType: string): Promise<Record<string, unknown> | null> {
    const collection = await this.findByType(websiteId, collectionType)
    return collection?.json_schema || null
  }

  /**
   * Enable/disable a collection
   */
  async setEnabled(id: string, enabled: boolean): Promise<WebsiteCollection | null> {
    return this.update(id, { enabled } as Partial<WebsiteCollection>)
  }

  /**
   * Update the JSON Schema for a collection
   */
  async updateSchema(id: string, jsonSchema: Record<string, unknown>): Promise<WebsiteCollection | null> {
    return this.update(id, { json_schema: jsonSchema } as unknown as Partial<WebsiteCollection>)
  }
}

// ============================================================================
// Collection Item Repository
// ============================================================================

export class CollectionItemRepository extends BaseRepository<CollectionItem> {
  constructor() {
    super('collection_items')
  }

  /**
   * Find items by collection ID
   */
  async findByCollection(
    websiteCollectionId: string,
    options?: {
      publishedOnly?: boolean
      limit?: number
      offset?: number
      search?: string
    }
  ): Promise<CollectionItem[]> {
    const params: unknown[] = [websiteCollectionId]
    let query = `SELECT * FROM ${this.tableName} WHERE website_collection_id = $1`

    if (options?.publishedOnly) {
      query += ' AND published = TRUE'
    }

    if (options?.search) {
      params.push(`%${options.search}%`)
      query += ` AND data::text ILIKE $${params.length}`
    }

    query += ' ORDER BY created_at DESC'

    if (options?.limit) {
      params.push(options.limit)
      query += ` LIMIT $${params.length}`
    }

    if (options?.offset) {
      params.push(options.offset)
      query += ` OFFSET $${params.length}`
    }

    const result = await db.query<CollectionItem>(query, params)
    return result.rows
  }

  /**
   * Find an item by slug within a collection
   */
  async findBySlug(websiteCollectionId: string, slug: string): Promise<CollectionItem | null> {
    const result = await db.query<CollectionItem>(
      `SELECT * FROM ${this.tableName} WHERE website_collection_id = $1 AND slug = $2`,
      [websiteCollectionId, slug]
    )
    return result.rows[0] || null
  }

  /**
   * Find items by website ID and collection type
   */
  async findByWebsiteAndType(
    websiteId: string,
    collectionType: string,
    options?: {
      publishedOnly?: boolean
      limit?: number
      offset?: number
    }
  ): Promise<CollectionItem[]> {
    const params: unknown[] = [websiteId, collectionType]
    let query = `
      SELECT ci.* FROM ${this.tableName} ci
      JOIN website_collections wc ON ci.website_collection_id = wc.id
      WHERE wc.website_id = $1 AND wc.collection_type = $2
    `

    if (options?.publishedOnly) {
      query += ' AND ci.published = TRUE'
    }

    query += ' ORDER BY ci.created_at DESC'

    if (options?.limit) {
      params.push(options.limit)
      query += ` LIMIT $${params.length}`
    }

    if (options?.offset) {
      params.push(options.offset)
      query += ` OFFSET $${params.length}`
    }

    const result = await db.query<CollectionItem>(query, params)
    return result.rows
  }

  /**
   * Publish/unpublish an item
   */
  async setPublished(id: string, published: boolean): Promise<CollectionItem | null> {
    const updates: Partial<CollectionItem> = { published }
    if (published) {
      updates.published_at = new Date()
    }
    return this.update(id, updates)
  }

  /**
   * Update item data
   */
  async updateData(id: string, data: Record<string, unknown>, userId?: string, agentId?: string): Promise<CollectionItem | null> {
    const updates: Partial<CollectionItem> = { data }
    if (userId) updates.updated_by_user_id = userId
    if (agentId) updates.updated_by_agent_id = agentId
    return this.update(id, updates)
  }

  /**
   * Count items in a collection
   */
  async countByCollection(websiteCollectionId: string, publishedOnly = false): Promise<number> {
    let query = `SELECT COUNT(*) as count FROM ${this.tableName} WHERE website_collection_id = $1`
    if (publishedOnly) {
      query += ' AND published = TRUE'
    }

    const result = await db.query<{ count: string }>(query, [websiteCollectionId])
    return parseInt(result.rows[0]!.count, 10)
  }
}

// ============================================================================
// Collection Item Version Repository
// ============================================================================

export class CollectionItemVersionRepository extends BaseRepository<CollectionItemVersion> {
  constructor() {
    super('collection_item_versions')
  }

  /**
   * Find versions for an item
   */
  async findByItem(itemId: string): Promise<CollectionItemVersion[]> {
    const result = await db.query<CollectionItemVersion>(
      `SELECT * FROM ${this.tableName} WHERE item_id = $1 ORDER BY version_number DESC`,
      [itemId]
    )
    return result.rows
  }

  /**
   * Get the latest version number for an item
   */
  async getLatestVersionNumber(itemId: string): Promise<number> {
    const result = await db.query<{ max: number | null }>(
      `SELECT MAX(version_number) as max FROM ${this.tableName} WHERE item_id = $1`,
      [itemId]
    )
    return result.rows[0]?.max || 0
  }

  /**
   * Create a new version
   */
  async createVersion(
    itemId: string,
    data: Record<string, unknown>,
    options?: {
      userId?: string
      agentId?: string
      changeSummary?: string
    }
  ): Promise<CollectionItemVersion> {
    const versionNumber = (await this.getLatestVersionNumber(itemId)) + 1

    return this.create({
      item_id: itemId,
      version_number: versionNumber,
      data,
      created_by_user_id: options?.userId,
      created_by_agent_id: options?.agentId,
      change_summary: options?.changeSummary,
    } as Partial<CollectionItemVersion>)
  }

  /**
   * Get a specific version
   */
  async getVersion(itemId: string, versionNumber: number): Promise<CollectionItemVersion | null> {
    const result = await db.query<CollectionItemVersion>(
      `SELECT * FROM ${this.tableName} WHERE item_id = $1 AND version_number = $2`,
      [itemId, versionNumber]
    )
    return result.rows[0] || null
  }
}

// ============================================================================
// Singleton Instances
// ============================================================================

export const websiteCollectionRepository = new WebsiteCollectionRepository()
export const collectionItemRepository = new CollectionItemRepository()
export const collectionItemVersionRepository = new CollectionItemVersionRepository()
