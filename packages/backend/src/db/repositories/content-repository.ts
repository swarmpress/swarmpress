import { ContentItem, ContentItemStatus } from '@swarm-press/shared'
import { BaseRepository } from '../base-repository'
import { db } from '../connection'

/**
 * Repository for ContentItem entities
 */
export class ContentRepository extends BaseRepository<ContentItem> {
  constructor() {
    super('content_items')
  }

  /**
   * Find content items by status
   */
  async findByStatus(status: ContentItemStatus): Promise<ContentItem[]> {
    return this.findBy('status', status)
  }

  /**
   * Find content items by website
   */
  async findByWebsite(websiteId: string): Promise<ContentItem[]> {
    return this.findBy('website_id', websiteId)
  }

  /**
   * Find content items by author
   */
  async findByAuthor(authorAgentId: string): Promise<ContentItem[]> {
    return this.findBy('author_agent_id', authorAgentId)
  }

  /**
   * Find content items by page
   */
  async findByPage(pageId: string): Promise<ContentItem[]> {
    return this.findBy('page_id', pageId)
  }

  /**
   * Transition content item to a new status using state machine
   */
  async transition(
    id: string,
    event: string,
    actor: string,
    actorId: string,
    metadata?: Record<string, unknown>
  ): Promise<{ success: boolean; item?: ContentItem; error?: string }> {
    // First get current item to check current state
    const currentItem = await this.findById(id)
    if (!currentItem) {
      return { success: false, error: 'Content item not found' }
    }

    const { executeTransition } = await import('../../state-machine/engine')
    const { contentItemStateMachine } = await import('@swarm-press/shared')

    const result = await executeTransition(contentItemStateMachine, {
      entityId: id,
      entityType: 'content_item',
      currentState: currentItem.status,
      event: event as any,
      actor,
      actorId,
      metadata,
    })

    if (!result.success) {
      return { success: false, error: result.error }
    }

    // Fetch updated item
    const updatedItem = await this.findById(id)
    return { success: true, item: updatedItem! }
  }

  /**
   * Find content in review
   */
  async findInReview(): Promise<ContentItem[]> {
    return this.findByStatus('in_editorial_review')
  }

  /**
   * Find published content
   */
  async findPublished(): Promise<ContentItem[]> {
    return this.findByStatus('published')
  }

  /**
   * Search content by text (simple full-text search)
   */
  async search(query: string): Promise<ContentItem[]> {
    const result = await db.query<ContentItem>(
      `SELECT * FROM ${this.tableName}
       WHERE body::text ILIKE $1
       OR metadata::text ILIKE $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [`%${query}%`]
    )
    return result.rows
  }

  /**
   * Find all content items with optional filters
   */
  async findAll(options?: {
    status?: ContentItemStatus
    website_id?: string
    limit?: number
    offset?: number
  }): Promise<ContentItem[]> {
    const filters: string[] = []
    const params: any[] = []
    let paramIndex = 1

    if (options?.status) {
      filters.push(`status = $${paramIndex++}`)
      params.push(options.status)
    }

    if (options?.website_id) {
      filters.push(`website_id = $${paramIndex++}`)
      params.push(options.website_id)
    }

    let query = `SELECT * FROM ${this.tableName}`
    if (filters.length > 0) {
      query += ` WHERE ${filters.join(' AND ')}`
    }
    query += ` ORDER BY created_at DESC`

    if (options?.limit) {
      query += ` LIMIT $${paramIndex++}`
      params.push(options.limit)
    }

    if (options?.offset) {
      query += ` OFFSET $${paramIndex++}`
      params.push(options.offset)
    }

    const result = await db.query<ContentItem>(query, params)
    return result.rows
  }

  /**
   * Get state history for a content item
   */
  async getStateHistory(id: string): Promise<any[]> {
    const result = await db.query(
      `SELECT * FROM state_audit_log
       WHERE entity_id = $1 AND entity_type = 'content_item'
       ORDER BY created_at DESC`,
      [id]
    )
    return result.rows
  }
}

export const contentRepository = new ContentRepository()
