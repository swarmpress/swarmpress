/**
 * Collection Research Configuration Repository
 * Manages research settings for collections (search prompts, extraction hints, etc.)
 */

import { db } from '../connection'
import type { QueryResultRow } from 'pg'

// ============================================================================
// Types
// ============================================================================

export interface CollectionResearchConfig extends QueryResultRow {
  id: string
  collection_id: string
  enabled: boolean
  search_prompt?: string
  default_queries: string[]
  search_domains?: string[]
  extraction_prompt?: string
  extraction_hints?: Record<string, unknown>
  validation_rules?: Record<string, unknown>
  require_source_urls: boolean
  min_confidence_score: number
  auto_publish: boolean
  dedup_strategy: 'name' | 'location' | 'composite'
  created_at: Date
  updated_at: Date
}

export interface CollectionResearchConfigWithCollection extends CollectionResearchConfig {
  collection_type: string
  website_id: string
  display_name: string
  singular_name?: string
  json_schema: Record<string, unknown>
  field_metadata: Record<string, unknown>
  title_field: string
}

// ============================================================================
// Repository
// ============================================================================

export const collectionResearchRepository = {
  /**
   * Find research config by collection ID
   */
  async findByCollectionId(collectionId: string): Promise<CollectionResearchConfig | null> {
    const { rows } = await db.query<CollectionResearchConfig>(
      `SELECT * FROM collection_research_config WHERE collection_id = $1`,
      [collectionId]
    )
    return rows[0] || null
  },

  /**
   * Find research config by website ID and collection type
   */
  async findByWebsiteAndType(
    websiteId: string,
    collectionType: string
  ): Promise<CollectionResearchConfigWithCollection | null> {
    const { rows } = await db.query<CollectionResearchConfigWithCollection>(
      `SELECT
        crc.*,
        wc.collection_type,
        wc.website_id,
        wc.display_name,
        wc.singular_name,
        wc.json_schema,
        wc.field_metadata,
        wc.title_field
      FROM collection_research_config crc
      JOIN website_collections wc ON wc.id = crc.collection_id
      WHERE wc.website_id = $1 AND wc.collection_type = $2`,
      [websiteId, collectionType]
    )
    return rows[0] || null
  },

  /**
   * Find all research-enabled collections for a website
   */
  async findEnabledByWebsite(websiteId: string): Promise<CollectionResearchConfigWithCollection[]> {
    const { rows } = await db.query<CollectionResearchConfigWithCollection>(
      `SELECT
        crc.*,
        wc.collection_type,
        wc.website_id,
        wc.display_name,
        wc.singular_name,
        wc.json_schema,
        wc.field_metadata,
        wc.title_field
      FROM collection_research_config crc
      JOIN website_collections wc ON wc.id = crc.collection_id
      WHERE wc.website_id = $1 AND crc.enabled = true
      ORDER BY wc.display_name`,
      [websiteId]
    )
    return rows
  },

  /**
   * Create research config for a collection
   */
  async create(
    collectionId: string,
    config: Partial<Omit<CollectionResearchConfig, 'id' | 'collection_id' | 'created_at' | 'updated_at'>>
  ): Promise<CollectionResearchConfig> {
    const { rows } = await db.query<CollectionResearchConfig>(
      `INSERT INTO collection_research_config (
        collection_id,
        enabled,
        search_prompt,
        default_queries,
        search_domains,
        extraction_prompt,
        extraction_hints,
        validation_rules,
        require_source_urls,
        min_confidence_score,
        auto_publish,
        dedup_strategy
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *`,
      [
        collectionId,
        config.enabled ?? true,
        config.search_prompt ?? null,
        JSON.stringify(config.default_queries ?? []),
        config.search_domains ?? null,
        config.extraction_prompt ?? null,
        config.extraction_hints ? JSON.stringify(config.extraction_hints) : null,
        config.validation_rules ? JSON.stringify(config.validation_rules) : null,
        config.require_source_urls ?? true,
        config.min_confidence_score ?? 0.7,
        config.auto_publish ?? false,
        config.dedup_strategy ?? 'name',
      ]
    )
    return rows[0]
  },

  /**
   * Update research config
   */
  async update(
    id: string,
    updates: Partial<Omit<CollectionResearchConfig, 'id' | 'collection_id' | 'created_at' | 'updated_at'>>
  ): Promise<CollectionResearchConfig | null> {
    const fields: string[] = []
    const values: unknown[] = []
    let paramIndex = 1

    if (updates.enabled !== undefined) {
      fields.push(`enabled = $${paramIndex++}`)
      values.push(updates.enabled)
    }
    if (updates.search_prompt !== undefined) {
      fields.push(`search_prompt = $${paramIndex++}`)
      values.push(updates.search_prompt)
    }
    if (updates.default_queries !== undefined) {
      fields.push(`default_queries = $${paramIndex++}`)
      values.push(JSON.stringify(updates.default_queries))
    }
    if (updates.search_domains !== undefined) {
      fields.push(`search_domains = $${paramIndex++}`)
      values.push(updates.search_domains)
    }
    if (updates.extraction_prompt !== undefined) {
      fields.push(`extraction_prompt = $${paramIndex++}`)
      values.push(updates.extraction_prompt)
    }
    if (updates.extraction_hints !== undefined) {
      fields.push(`extraction_hints = $${paramIndex++}`)
      values.push(JSON.stringify(updates.extraction_hints))
    }
    if (updates.validation_rules !== undefined) {
      fields.push(`validation_rules = $${paramIndex++}`)
      values.push(JSON.stringify(updates.validation_rules))
    }
    if (updates.require_source_urls !== undefined) {
      fields.push(`require_source_urls = $${paramIndex++}`)
      values.push(updates.require_source_urls)
    }
    if (updates.min_confidence_score !== undefined) {
      fields.push(`min_confidence_score = $${paramIndex++}`)
      values.push(updates.min_confidence_score)
    }
    if (updates.auto_publish !== undefined) {
      fields.push(`auto_publish = $${paramIndex++}`)
      values.push(updates.auto_publish)
    }
    if (updates.dedup_strategy !== undefined) {
      fields.push(`dedup_strategy = $${paramIndex++}`)
      values.push(updates.dedup_strategy)
    }

    if (fields.length === 0) {
      return this.findByCollectionId(id)
    }

    values.push(id)

    const { rows } = await db.query<CollectionResearchConfig>(
      `UPDATE collection_research_config SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    )
    return rows[0] || null
  },

  /**
   * Upsert research config (create or update)
   */
  async upsert(
    collectionId: string,
    config: Partial<Omit<CollectionResearchConfig, 'id' | 'collection_id' | 'created_at' | 'updated_at'>>
  ): Promise<CollectionResearchConfig> {
    const { rows } = await db.query<CollectionResearchConfig>(
      `INSERT INTO collection_research_config (
        collection_id,
        enabled,
        search_prompt,
        default_queries,
        search_domains,
        extraction_prompt,
        extraction_hints,
        validation_rules,
        require_source_urls,
        min_confidence_score,
        auto_publish,
        dedup_strategy
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (collection_id) DO UPDATE SET
        enabled = EXCLUDED.enabled,
        search_prompt = EXCLUDED.search_prompt,
        default_queries = EXCLUDED.default_queries,
        search_domains = EXCLUDED.search_domains,
        extraction_prompt = EXCLUDED.extraction_prompt,
        extraction_hints = EXCLUDED.extraction_hints,
        validation_rules = EXCLUDED.validation_rules,
        require_source_urls = EXCLUDED.require_source_urls,
        min_confidence_score = EXCLUDED.min_confidence_score,
        auto_publish = EXCLUDED.auto_publish,
        dedup_strategy = EXCLUDED.dedup_strategy,
        updated_at = NOW()
      RETURNING *`,
      [
        collectionId,
        config.enabled ?? true,
        config.search_prompt ?? null,
        JSON.stringify(config.default_queries ?? []),
        config.search_domains ?? null,
        config.extraction_prompt ?? null,
        config.extraction_hints ? JSON.stringify(config.extraction_hints) : null,
        config.validation_rules ? JSON.stringify(config.validation_rules) : null,
        config.require_source_urls ?? true,
        config.min_confidence_score ?? 0.7,
        config.auto_publish ?? false,
        config.dedup_strategy ?? 'name',
      ]
    )
    return rows[0]
  },

  /**
   * Enable/disable research for a collection
   */
  async setEnabled(collectionId: string, enabled: boolean): Promise<void> {
    await db.query(
      `UPDATE collection_research_config SET enabled = $1 WHERE collection_id = $2`,
      [enabled, collectionId]
    )
  },

  /**
   * Delete research config for a collection
   */
  async delete(collectionId: string): Promise<void> {
    await db.query(
      `DELETE FROM collection_research_config WHERE collection_id = $1`,
      [collectionId]
    )
  },
}
