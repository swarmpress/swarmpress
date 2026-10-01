import type { Page, CreatePageInput, UpdatePageInput } from '@swarm-press/shared'
import { BaseRepository } from '../base-repository'
import { db } from '../connection'

/**
 * Repository for Page entities (sitemap pages)
 */
export class PageRepository extends BaseRepository<Page> {
  constructor() {
    super('pages')
  }

  /**
   * Find all pages for a website
   */
  async findByWebsite(websiteId: string): Promise<Page[]> {
    return this.findBy('website_id', websiteId)
  }

  /**
   * Find page by slug within a website
   */
  async findBySlug(websiteId: string, slug: string): Promise<Page | null> {
    const result = await db.query<Page>(
      `SELECT * FROM ${this.tableName} WHERE website_id = $1 AND slug = $2`,
      [websiteId, slug]
    )
    return result.rows[0] || null
  }

  /**
   * Find pages by status
   */
  async findByStatus(websiteId: string, status: string): Promise<Page[]> {
    const result = await db.query<Page>(
      `SELECT * FROM ${this.tableName} WHERE website_id = $1 AND status = $2 ORDER BY created_at DESC`,
      [websiteId, status]
    )
    return result.rows
  }

  /**
   * Find pages by page type
   */
  async findByPageType(websiteId: string, pageType: string): Promise<Page[]> {
    const result = await db.query<Page>(
      `SELECT * FROM ${this.tableName} WHERE website_id = $1 AND page_type = $2 ORDER BY created_at DESC`,
      [websiteId, pageType]
    )
    return result.rows
  }

  /**
   * Find pages by parent (children of a page)
   */
  async findChildren(parentId: string): Promise<Page[]> {
    const result = await db.query<Page>(
      `SELECT * FROM ${this.tableName} WHERE parent_id = $1 ORDER BY order_index ASC`,
      [parentId]
    )
    return result.rows
  }

  /**
   * Find orphan pages (no incoming links and no parent)
   */
  async findOrphanPages(websiteId: string): Promise<Page[]> {
    const result = await db.query<Page>(
      `SELECT * FROM ${this.tableName}
       WHERE website_id = $1
       AND parent_id IS NULL
       AND jsonb_array_length(internal_links->'incoming') = 0`,
      [websiteId]
    )
    return result.rows
  }

  /**
   * Find pages needing updates (low freshness score)
   */
  async findPagesNeedingUpdate(websiteId: string, threshold: number = 70): Promise<Page[]> {
    const result = await db.query<Page>(
      `SELECT * FROM ${this.tableName}
       WHERE website_id = $1
       AND (seo_profile->>'freshness_score')::numeric < $2`,
      [websiteId, threshold]
    )
    return result.rows
  }

  /**
   * Update internal links for a page
   */
  async updateLinks(pageId: string, links: { outgoing: any[]; incoming: any[] }): Promise<Page | null> {
    const result = await db.query<Page>(
      `UPDATE ${this.tableName}
       SET internal_links = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [JSON.stringify(links), pageId]
    )
    return result.rows[0] || null
  }

  /**
   * Add a suggestion to a page
   */
  async addSuggestion(pageId: string, suggestion: any): Promise<Page | null> {
    const result = await db.query<Page>(
      `UPDATE ${this.tableName}
       SET suggestions = suggestions || $1::jsonb,
           updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [JSON.stringify([suggestion]), pageId]
    )
    return result.rows[0] || null
  }

  /**
   * Add a task to a page
   */
  async addTask(pageId: string, task: any): Promise<Page | null> {
    const result = await db.query<Page>(
      `UPDATE ${this.tableName}
       SET tasks = tasks || $1::jsonb,
           updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [JSON.stringify([task]), pageId]
    )
    return result.rows[0] || null
  }

  /**
   * Update freshness score
   */
  async updateFreshnessScore(pageId: string, score: number): Promise<Page | null> {
    const result = await db.query<Page>(
      `UPDATE ${this.tableName}
       SET seo_profile = jsonb_set(seo_profile, '{freshness_score}', $1::text::jsonb),
           updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [score, pageId]
    )
    return result.rows[0] || null
  }

  /**
   * Get page tree (hierarchical structure)
   */
  async getPageTree(websiteId: string): Promise<any[]> {
    const result = await db.query<Page>(
      `WITH RECURSIVE page_tree AS (
        -- Base case: root pages (no parent)
        SELECT p.*, 0 as depth
        FROM ${this.tableName} p
        WHERE p.website_id = $1 AND p.parent_id IS NULL

        UNION ALL

        -- Recursive case: children
        SELECT p.*, pt.depth + 1
        FROM ${this.tableName} p
        INNER JOIN page_tree pt ON p.parent_id = pt.id
        WHERE p.website_id = $1
      )
      SELECT * FROM page_tree ORDER BY depth, order_index`,
      [websiteId]
    )
    return result.rows
  }

  /**
   * Create page with validation
   */
  async createPage(input: CreatePageInput): Promise<Page> {
    // Check for duplicate slug
    const existing = await this.findBySlug(input.website_id, input.slug)
    if (existing) {
      throw new Error(`Page with slug "${input.slug}" already exists`)
    }

    return this.create(input as any)
  }

  /**
   * Update page with validation
   */
  async updatePage(id: string, input: UpdatePageInput): Promise<Page | null> {
    // If slug is being changed, check for duplicates
    if (input.slug) {
      const page = await this.findById(id)
      if (page) {
        const existing = await this.findBySlug(page.website_id, input.slug)
        if (existing && existing.id !== id) {
          throw new Error(`Page with slug "${input.slug}" already exists`)
        }
      }
    }

    return this.update(id, input as any)
  }
}

export const pageRepository = new PageRepository()
