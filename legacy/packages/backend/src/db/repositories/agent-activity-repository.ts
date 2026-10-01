/**
 * Agent Activity Repository
 * Tracks real-time agent activities on the sitemap
 */

import { db } from '../connection'

export interface AgentActivity {
  id: string
  agent_id: string
  agent_name?: string
  activity_type: 'viewing' | 'editing' | 'suggesting' | 'reviewing' | 'analyzing'
  page_id?: string
  page_slug?: string
  description: string
  metadata?: Record<string, any>
  created_at: string
  expires_at: string
}

export interface CreateActivityInput {
  agent_id: string
  activity_type: 'viewing' | 'editing' | 'suggesting' | 'reviewing' | 'analyzing'
  page_id?: string
  description: string
  metadata?: Record<string, any>
  duration_seconds?: number // How long the activity should be visible (default: 300s = 5min)
}

class AgentActivityRepository {
  /**
   * Create a new activity record
   */
  async create(input: CreateActivityInput): Promise<AgentActivity> {
    const durationSeconds = input.duration_seconds || 300 // Default 5 minutes

    const result = await db.query(
      `INSERT INTO agent_activities (
        agent_id, activity_type, page_id, description, metadata, expires_at
      ) VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '1 second' * $6)
      RETURNING *`,
      [
        input.agent_id,
        input.activity_type,
        input.page_id || null,
        input.description,
        JSON.stringify(input.metadata || {}),
        durationSeconds,
      ]
    )

    return this.mapRow(result.rows[0])
  }

  /**
   * Get all active activities for a website
   */
  async findActiveByWebsite(websiteId: string): Promise<AgentActivity[]> {
    const result = await db.query(
      `SELECT
         a.*,
         ag.name as agent_name,
         p.slug as page_slug
       FROM agent_activities a
       JOIN agents ag ON ag.id = a.agent_id
       LEFT JOIN pages p ON p.id = a.page_id
       WHERE a.expires_at > NOW()
         AND (a.page_id IS NULL OR p.website_id = $1)
       ORDER BY a.created_at DESC`,
      [websiteId]
    )

    return result.rows.map((row) => this.mapRow(row))
  }

  /**
   * Get active activities for a specific page
   */
  async findActiveByPage(pageId: string): Promise<AgentActivity[]> {
    const result = await db.query(
      `SELECT
         a.*,
         ag.name as agent_name,
         p.slug as page_slug
       FROM agent_activities a
       JOIN agents ag ON ag.id = a.agent_id
       LEFT JOIN pages p ON p.id = a.page_id
       WHERE a.page_id = $1 AND a.expires_at > NOW()
       ORDER BY a.created_at DESC`,
      [pageId]
    )

    return result.rows.map((row) => this.mapRow(row))
  }

  /**
   * Get recent activities by agent
   */
  async findByAgent(
    agentId: string,
    limit: number = 50
  ): Promise<AgentActivity[]> {
    const result = await db.query(
      `SELECT
         a.*,
         ag.name as agent_name,
         p.slug as page_slug
       FROM agent_activities a
       JOIN agents ag ON ag.id = a.agent_id
       LEFT JOIN pages p ON p.id = a.page_id
       WHERE a.agent_id = $1
       ORDER BY a.created_at DESC
       LIMIT $2`,
      [agentId, limit]
    )

    return result.rows.map((row) => this.mapRow(row))
  }

  /**
   * Get activity feed for a website (recent history)
   */
  async getActivityFeed(
    websiteId: string,
    limit: number = 100
  ): Promise<AgentActivity[]> {
    const result = await db.query(
      `SELECT
         a.*,
         ag.name as agent_name,
         p.slug as page_slug
       FROM agent_activities a
       JOIN agents ag ON ag.id = a.agent_id
       LEFT JOIN pages p ON p.id = a.page_id
       WHERE a.page_id IS NULL OR p.website_id = $1
       ORDER BY a.created_at DESC
       LIMIT $2`,
      [websiteId, limit]
    )

    return result.rows.map((row) => this.mapRow(row))
  }

  /**
   * Delete expired activities (cleanup)
   */
  async deleteExpired(): Promise<number> {
    const result = await db.query(
      `DELETE FROM agent_activities WHERE expires_at <= NOW()`
    )

    return result.rowCount || 0
  }

  /**
   * Update activity expiration (extend duration)
   */
  async extendActivity(id: string, additionalSeconds: number): Promise<AgentActivity> {
    const result = await db.query(
      `UPDATE agent_activities
       SET expires_at = expires_at + INTERVAL '1 second' * $1
       WHERE id = $2
       RETURNING *`,
      [additionalSeconds, id]
    )

    if (result.rows.length === 0) {
      throw new Error(`Activity ${id} not found`)
    }

    return this.mapRow(result.rows[0])
  }

  /**
   * Delete activity
   */
  async delete(id: string): Promise<void> {
    await db.query('DELETE FROM agent_activities WHERE id = $1', [id])
  }

  /**
   * Map database row to activity object
   */
  private mapRow(row: any): AgentActivity {
    return {
      id: row.id,
      agent_id: row.agent_id,
      agent_name: row.agent_name,
      activity_type: row.activity_type,
      page_id: row.page_id,
      page_slug: row.page_slug,
      description: row.description,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      created_at: row.created_at,
      expires_at: row.expires_at,
    }
  }
}

export const agentActivityRepository = new AgentActivityRepository()
