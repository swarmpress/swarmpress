/**
 * Suggestion Repository
 * Manages AI agent suggestions for sitemap improvements
 */

import { db } from '../connection'

export interface SuggestionWithMetadata {
  id: string
  page_id: string
  agent_id: string
  suggestion_type: 'new_page' | 'improve_content' | 'add_links' | 'update_blueprint'
  reason: string
  estimated_value: 'low' | 'medium' | 'high'
  proposed_slug?: string
  keywords?: string[]
  metadata?: Record<string, any>
  created_at: string
  status: 'pending' | 'accepted' | 'rejected' | 'implemented'
  implemented_at?: string
  implemented_by?: string
  notes?: string
}

export interface CreateSuggestionInput {
  page_id: string
  agent_id: string
  suggestion_type: 'new_page' | 'improve_content' | 'add_links' | 'update_blueprint'
  reason: string
  estimated_value: 'low' | 'medium' | 'high'
  proposed_slug?: string
  keywords?: string[]
  metadata?: Record<string, any>
}

class SuggestionRepository {
  /**
   * Create a new suggestion
   */
  async create(input: CreateSuggestionInput): Promise<SuggestionWithMetadata> {
    const result = await db.query(
      `INSERT INTO sitemap_suggestions (
        page_id, agent_id, suggestion_type, reason, estimated_value,
        proposed_slug, keywords, metadata, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
      RETURNING *`,
      [
        input.page_id,
        input.agent_id,
        input.suggestion_type,
        input.reason,
        input.estimated_value,
        input.proposed_slug || null,
        JSON.stringify(input.keywords || []),
        JSON.stringify(input.metadata || {}),
      ]
    )

    return this.mapRow(result.rows[0])
  }

  /**
   * Find all suggestions for a page
   */
  async findByPage(pageId: string): Promise<SuggestionWithMetadata[]> {
    const result = await db.query(
      `SELECT * FROM sitemap_suggestions
       WHERE page_id = $1
       ORDER BY created_at DESC`,
      [pageId]
    )

    return result.rows.map((row) => this.mapRow(row))
  }

  /**
   * Find all suggestions for a website
   */
  async findByWebsite(websiteId: string): Promise<SuggestionWithMetadata[]> {
    const result = await db.query(
      `SELECT s.*
       FROM sitemap_suggestions s
       JOIN pages p ON p.id = s.page_id
       WHERE p.website_id = $1
       ORDER BY s.created_at DESC`,
      [websiteId]
    )

    return result.rows.map((row) => this.mapRow(row))
  }

  /**
   * Find pending suggestions for a website
   */
  async findPendingByWebsite(websiteId: string): Promise<SuggestionWithMetadata[]> {
    const result = await db.query(
      `SELECT s.*
       FROM sitemap_suggestions s
       JOIN pages p ON p.id = s.page_id
       WHERE p.website_id = $1 AND s.status = 'pending'
       ORDER BY
         CASE s.estimated_value
           WHEN 'high' THEN 1
           WHEN 'medium' THEN 2
           WHEN 'low' THEN 3
         END,
         s.created_at DESC`,
      [websiteId]
    )

    return result.rows.map((row) => this.mapRow(row))
  }

  /**
   * Find suggestions by agent
   */
  async findByAgent(agentId: string): Promise<SuggestionWithMetadata[]> {
    const result = await db.query(
      `SELECT * FROM sitemap_suggestions
       WHERE agent_id = $1
       ORDER BY created_at DESC`,
      [agentId]
    )

    return result.rows.map((row) => this.mapRow(row))
  }

  /**
   * Update suggestion status
   */
  async updateStatus(
    id: string,
    status: 'pending' | 'accepted' | 'rejected' | 'implemented',
    notes?: string,
    implementedBy?: string
  ): Promise<SuggestionWithMetadata> {
    const result = await db.query(
      `UPDATE sitemap_suggestions
       SET status = $1,
           notes = COALESCE($2, notes),
           implemented_by = $3,
           implemented_at = CASE WHEN $1 = 'implemented' THEN NOW() ELSE implemented_at END
       WHERE id = $4
       RETURNING *`,
      [status, notes || null, implementedBy || null, id]
    )

    if (result.rows.length === 0) {
      throw new Error(`Suggestion ${id} not found`)
    }

    return this.mapRow(result.rows[0])
  }

  /**
   * Delete a suggestion
   */
  async delete(id: string): Promise<void> {
    await db.query('DELETE FROM sitemap_suggestions WHERE id = $1', [id])
  }

  /**
   * Get suggestion statistics for a website
   */
  async getStatistics(websiteId: string): Promise<{
    total: number
    by_status: Record<string, number>
    by_type: Record<string, number>
    by_value: Record<string, number>
    by_agent: Array<{ agent_id: string; count: number }>
  }> {
    const result = await db.query(
      `SELECT
         COUNT(*) as total,
         jsonb_object_agg(status, status_count) as by_status,
         jsonb_object_agg(suggestion_type, type_count) as by_type,
         jsonb_object_agg(estimated_value, value_count) as by_value
       FROM (
         SELECT
           s.status,
           s.suggestion_type,
           s.estimated_value,
           COUNT(*) OVER (PARTITION BY s.status) as status_count,
           COUNT(*) OVER (PARTITION BY s.suggestion_type) as type_count,
           COUNT(*) OVER (PARTITION BY s.estimated_value) as value_count
         FROM sitemap_suggestions s
         JOIN pages p ON p.id = s.page_id
         WHERE p.website_id = $1
       ) subquery`,
      [websiteId]
    )

    const agentStats = await db.query(
      `SELECT s.agent_id, COUNT(*) as count
       FROM sitemap_suggestions s
       JOIN pages p ON p.id = s.page_id
       WHERE p.website_id = $1
       GROUP BY s.agent_id
       ORDER BY count DESC`,
      [websiteId]
    )

    const row = result.rows[0]
    return {
      total: parseInt(row.total) || 0,
      by_status: row.by_status || {},
      by_type: row.by_type || {},
      by_value: row.by_value || {},
      by_agent: agentStats.rows.map((r) => ({
        agent_id: r.agent_id,
        count: parseInt(r.count),
      })),
    }
  }

  /**
   * Map database row to suggestion object
   */
  private mapRow(row: any): SuggestionWithMetadata {
    return {
      id: row.id,
      page_id: row.page_id,
      agent_id: row.agent_id,
      suggestion_type: row.suggestion_type,
      reason: row.reason,
      estimated_value: row.estimated_value,
      proposed_slug: row.proposed_slug,
      keywords: row.keywords ? JSON.parse(row.keywords) : undefined,
      metadata: row.metadata || undefined,
      created_at: row.created_at,
      status: row.status,
      implemented_at: row.implemented_at,
      implemented_by: row.implemented_by,
      notes: row.notes,
    }
  }
}

export const suggestionRepository = new SuggestionRepository()
