/**
 * Batch Repository
 * Database access for batch_jobs table
 * Tracks Claude Message Batches API jobs for content generation
 */

import { BaseRepository } from '../base-repository'
import { db } from '../connection'

/**
 * Batch job status enum
 */
export type BatchJobStatus = 'pending' | 'processing' | 'ended' | 'completed' | 'failed'

/**
 * Batch job type enum
 */
export type BatchJobType = 'content_generation' | 'enrichment' | 'research' | 'translation'

/**
 * Batch job entity
 */
export interface BatchJob {
  id: string
  batch_id: string
  job_type: BatchJobType
  collection_type?: string
  website_id?: string
  status: BatchJobStatus
  items_count: number
  items_processed: number
  results_url?: string
  results_processed: boolean
  error_message?: string
  created_at: Date
  completed_at?: Date
  metadata?: Record<string, unknown>
}

/**
 * Repository for Batch Job entities
 */
export class BatchRepository extends BaseRepository<BatchJob> {
  constructor() {
    super('batch_jobs')
  }

  /**
   * Find batch job by Anthropic batch ID
   */
  async findByBatchId(batchId: string): Promise<BatchJob | null> {
    return this.findOneBy('batch_id', batchId)
  }

  /**
   * Find batch jobs by website
   */
  async findByWebsite(websiteId: string): Promise<BatchJob[]> {
    const result = await db.query<BatchJob>(
      `SELECT * FROM ${this.tableName}
       WHERE website_id = $1
       ORDER BY created_at DESC`,
      [websiteId]
    )
    return result.rows
  }

  /**
   * Find batch jobs by status
   */
  async findByStatus(status: BatchJobStatus): Promise<BatchJob[]> {
    const result = await db.query<BatchJob>(
      `SELECT * FROM ${this.tableName}
       WHERE status = $1
       ORDER BY created_at DESC`,
      [status]
    )
    return result.rows
  }

  /**
   * Find batch jobs by collection type
   */
  async findByCollectionType(collectionType: string): Promise<BatchJob[]> {
    const result = await db.query<BatchJob>(
      `SELECT * FROM ${this.tableName}
       WHERE collection_type = $1
       ORDER BY created_at DESC`,
      [collectionType]
    )
    return result.rows
  }

  /**
   * Find active (processing) batch jobs
   */
  async findActive(): Promise<BatchJob[]> {
    const result = await db.query<BatchJob>(
      `SELECT * FROM ${this.tableName}
       WHERE status IN ('pending', 'processing')
       ORDER BY created_at ASC`,
      []
    )
    return result.rows
  }

  /**
   * List recent batch jobs with pagination
   */
  async listRecent(options: {
    limit?: number
    offset?: number
    websiteId?: string
    status?: BatchJobStatus
    collectionType?: string
  } = {}): Promise<{ items: BatchJob[]; total: number }> {
    const { limit = 20, offset = 0, websiteId, status, collectionType } = options

    const conditions: string[] = []
    const params: unknown[] = []
    let paramIndex = 1

    if (websiteId) {
      conditions.push(`website_id = $${paramIndex++}`)
      params.push(websiteId)
    }
    if (status) {
      conditions.push(`status = $${paramIndex++}`)
      params.push(status)
    }
    if (collectionType) {
      conditions.push(`collection_type = $${paramIndex++}`)
      params.push(collectionType)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    // Get total count
    const countResult = await db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM ${this.tableName} ${whereClause}`,
      params
    )
    const total = parseInt(countResult.rows[0]!.count, 10)

    // Get items with pagination
    const result = await db.query<BatchJob>(
      `SELECT * FROM ${this.tableName}
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      [...params, limit, offset]
    )

    return { items: result.rows, total }
  }

  /**
   * Update batch job status with optional metadata
   */
  async updateStatus(
    id: string,
    status: BatchJobStatus,
    updates?: {
      items_processed?: number
      results_url?: string
      results_processed?: boolean
      error_message?: string
      completed_at?: Date
      metadata?: Record<string, unknown>
    }
  ): Promise<BatchJob | null> {
    const fields: string[] = ['status = $2']
    const values: unknown[] = [id, status]
    let paramIndex = 3

    if (updates?.items_processed !== undefined) {
      fields.push(`items_processed = $${paramIndex++}`)
      values.push(updates.items_processed)
    }
    if (updates?.results_url !== undefined) {
      fields.push(`results_url = $${paramIndex++}`)
      values.push(updates.results_url)
    }
    if (updates?.results_processed !== undefined) {
      fields.push(`results_processed = $${paramIndex++}`)
      values.push(updates.results_processed)
    }
    if (updates?.error_message !== undefined) {
      fields.push(`error_message = $${paramIndex++}`)
      values.push(updates.error_message)
    }
    if (updates?.completed_at !== undefined) {
      fields.push(`completed_at = $${paramIndex++}`)
      values.push(updates.completed_at)
    }
    if (updates?.metadata !== undefined) {
      fields.push(`metadata = $${paramIndex++}`)
      values.push(JSON.stringify(updates.metadata))
    }

    const result = await db.query<BatchJob>(
      `UPDATE ${this.tableName}
       SET ${fields.join(', ')}
       WHERE id = $1
       RETURNING *`,
      values
    )

    return result.rows[0] || null
  }

  /**
   * Mark batch job as completed
   */
  async markCompleted(
    id: string,
    itemsProcessed: number,
    resultsUrl?: string
  ): Promise<BatchJob | null> {
    return this.updateStatus(id, 'completed', {
      items_processed: itemsProcessed,
      results_url: resultsUrl,
      results_processed: true,
      completed_at: new Date(),
    })
  }

  /**
   * Mark batch job as failed
   */
  async markFailed(id: string, errorMessage: string): Promise<BatchJob | null> {
    return this.updateStatus(id, 'failed', {
      error_message: errorMessage,
      completed_at: new Date(),
    })
  }

  /**
   * Get batch job statistics for a website
   */
  async getStatistics(websiteId?: string): Promise<{
    total: number
    pending: number
    processing: number
    completed: number
    failed: number
    totalItemsProcessed: number
  }> {
    const whereClause = websiteId ? 'WHERE website_id = $1' : ''
    const params = websiteId ? [websiteId] : []

    const result = await db.query<{
      total: string
      pending: string
      processing: string
      completed: string
      failed: string
      total_items: string
    }>(
      `SELECT
         COUNT(*) as total,
         COUNT(*) FILTER (WHERE status = 'pending') as pending,
         COUNT(*) FILTER (WHERE status = 'processing') as processing,
         COUNT(*) FILTER (WHERE status = 'completed') as completed,
         COUNT(*) FILTER (WHERE status = 'failed') as failed,
         COALESCE(SUM(items_processed), 0) as total_items
       FROM ${this.tableName}
       ${whereClause}`,
      params
    )

    const row = result.rows[0]!
    return {
      total: parseInt(row.total, 10),
      pending: parseInt(row.pending, 10),
      processing: parseInt(row.processing, 10),
      completed: parseInt(row.completed, 10),
      failed: parseInt(row.failed, 10),
      totalItemsProcessed: parseInt(row.total_items, 10),
    }
  }
}

/**
 * Singleton instance
 */
export const batchRepository = new BatchRepository()
