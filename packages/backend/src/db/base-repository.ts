import { db } from './connection'
import type { QueryResultRow } from 'pg'

/**
 * Base repository class with common CRUD operations
 */
export abstract class BaseRepository<T extends QueryResultRow> {
  constructor(protected tableName: string) {}

  /**
   * Find a record by ID
   */
  async findById(id: string): Promise<T | null> {
    const result = await db.query<T>(
      `SELECT * FROM ${this.tableName} WHERE id = $1`,
      [id]
    )
    return result.rows[0] || null
  }

  /**
   * Find all records
   */
  async findAll(options?: { limit?: number; offset?: number } | number, offset?: number): Promise<T[]> {
    let query = `SELECT * FROM ${this.tableName} ORDER BY created_at DESC`

    // Support both old (limit, offset) and new (options) signatures
    const limit = typeof options === 'number' ? options : options?.limit
    const off = typeof options === 'number' ? offset : options?.offset

    if (limit) {
      query += ` LIMIT ${limit}`
    }
    if (off) {
      query += ` OFFSET ${off}`
    }

    const result = await db.query<T>(query)
    return result.rows
  }

  /**
   * Find records by field value
   */
  async findBy(field: string, value: any): Promise<T[]> {
    const result = await db.query<T>(
      `SELECT * FROM ${this.tableName} WHERE ${field} = $1`,
      [value]
    )
    return result.rows
  }

  /**
   * Find one record by field value
   */
  async findOneBy(field: string, value: any): Promise<T | null> {
    const result = await db.query<T>(
      `SELECT * FROM ${this.tableName} WHERE ${field} = $1 LIMIT 1`,
      [value]
    )
    return result.rows[0] || null
  }

  /**
   * Create a new record
   */
  async create(data: Partial<T>): Promise<T> {
    const fields = Object.keys(data)
    const values = Object.values(data)
    const placeholders = fields.map((_, i) => `$${i + 1}`).join(', ')

    const result = await db.query<T>(
      `INSERT INTO ${this.tableName} (${fields.join(', ')})
       VALUES (${placeholders})
       RETURNING *`,
      values
    )

    return result.rows[0]!
  }

  /**
   * Update a record by ID
   */
  async update(id: string, data: Partial<T>): Promise<T | null> {
    const fields = Object.keys(data)
    const values = Object.values(data)
    const setClause = fields.map((field, i) => `${field} = $${i + 2}`).join(', ')

    const result = await db.query<T>(
      `UPDATE ${this.tableName}
       SET ${setClause}
       WHERE id = $1
       RETURNING *`,
      [id, ...values]
    )

    return result.rows[0] || null
  }

  /**
   * Delete a record by ID
   */
  async delete(id: string): Promise<boolean> {
    const result = await db.query(
      `DELETE FROM ${this.tableName} WHERE id = $1`,
      [id]
    )
    return (result.rowCount ?? 0) > 0
  }

  /**
   * Count records
   */
  async count(): Promise<number> {
    const result = await db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM ${this.tableName}`
    )
    return parseInt(result.rows[0]!.count, 10)
  }

  /**
   * Check if a record exists
   */
  async exists(id: string): Promise<boolean> {
    const result = await db.query<{ exists: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM ${this.tableName} WHERE id = $1) as exists`,
      [id]
    )
    return result.rows[0]!.exists
  }
}
