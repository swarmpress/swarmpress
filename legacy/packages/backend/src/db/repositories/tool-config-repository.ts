import type { ToolConfig, CreateToolConfigInput, UpdateToolConfigInput } from '@swarm-press/shared'
import { db } from '../connection'

/**
 * Database row type for tool_configs
 */
interface ToolConfigRow {
  id: string
  name: string
  display_name: string | null
  description: string | null
  type: 'rest' | 'graphql' | 'mcp' | 'builtin'
  endpoint_url: string | null
  config: Record<string, unknown>
  input_schema: Record<string, unknown> | null
  created_at: Date
  updated_at: Date
}

/**
 * Convert database row to ToolConfig
 */
function rowToToolConfig(row: ToolConfigRow): ToolConfig {
  return {
    id: row.id,
    name: row.name,
    display_name: row.display_name,
    description: row.description,
    type: row.type,
    endpoint_url: row.endpoint_url,
    config: row.config || {},
    input_schema: row.input_schema,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  }
}

/**
 * Repository for tool_configs table
 * Note: Not extending BaseRepository to avoid type conflicts with transformed return types
 */
export class ToolConfigRepository {
  private tableName = 'tool_configs'

  /**
   * Find all tool configs
   */
  async findAll(options?: { limit?: number; offset?: number }): Promise<ToolConfig[]> {
    let query = `SELECT * FROM ${this.tableName} ORDER BY created_at DESC`

    if (options?.limit) {
      query += ` LIMIT ${options.limit}`
    }
    if (options?.offset) {
      query += ` OFFSET ${options.offset}`
    }

    const result = await db.query<ToolConfigRow>(query)
    return result.rows.map(rowToToolConfig)
  }

  /**
   * Find tool config by ID
   */
  async findById(id: string): Promise<ToolConfig | null> {
    const result = await db.query<ToolConfigRow>(
      `SELECT * FROM ${this.tableName} WHERE id = $1`,
      [id]
    )
    const row = result.rows[0]
    return row ? rowToToolConfig(row) : null
  }

  /**
   * Find tool config by name
   */
  async findByName(name: string): Promise<ToolConfig | null> {
    const result = await db.query<ToolConfigRow>(
      `SELECT * FROM ${this.tableName} WHERE name = $1 LIMIT 1`,
      [name]
    )
    const row = result.rows[0]
    return row ? rowToToolConfig(row) : null
  }

  /**
   * Find tool configs by type
   */
  async findByType(type: ToolConfig['type']): Promise<ToolConfig[]> {
    const result = await db.query<ToolConfigRow>(
      `SELECT * FROM ${this.tableName} WHERE type = $1 ORDER BY created_at DESC`,
      [type]
    )
    return result.rows.map(rowToToolConfig)
  }

  /**
   * Create a new tool config
   */
  async create(data: CreateToolConfigInput): Promise<ToolConfig> {
    const result = await db.query<ToolConfigRow>(
      `INSERT INTO ${this.tableName} (name, display_name, description, type, endpoint_url, config, input_schema)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        data.name,
        data.display_name || null,
        data.description || null,
        data.type,
        data.endpoint_url || null,
        data.config || {},
        data.input_schema || null,
      ]
    )
    return rowToToolConfig(result.rows[0]!)
  }

  /**
   * Update a tool config
   */
  async update(id: string, data: UpdateToolConfigInput): Promise<ToolConfig | null> {
    const updates: string[] = []
    const values: unknown[] = [id]
    let paramIndex = 2

    if (data.name !== undefined) {
      updates.push(`name = $${paramIndex++}`)
      values.push(data.name)
    }
    if (data.display_name !== undefined) {
      updates.push(`display_name = $${paramIndex++}`)
      values.push(data.display_name || null)
    }
    if (data.description !== undefined) {
      updates.push(`description = $${paramIndex++}`)
      values.push(data.description || null)
    }
    if (data.type !== undefined) {
      updates.push(`type = $${paramIndex++}`)
      values.push(data.type)
    }
    if (data.endpoint_url !== undefined) {
      updates.push(`endpoint_url = $${paramIndex++}`)
      values.push(data.endpoint_url || null)
    }
    if (data.config !== undefined) {
      updates.push(`config = $${paramIndex++}`)
      values.push(data.config || {})
    }
    if (data.input_schema !== undefined) {
      updates.push(`input_schema = $${paramIndex++}`)
      values.push(data.input_schema || null)
    }

    if (updates.length === 0) {
      return this.findById(id)
    }

    const result = await db.query<ToolConfigRow>(
      `UPDATE ${this.tableName}
       SET ${updates.join(', ')}
       WHERE id = $1
       RETURNING *`,
      values
    )

    const row = result.rows[0]
    return row ? rowToToolConfig(row) : null
  }

  /**
   * Delete a tool config
   */
  async delete(id: string): Promise<boolean> {
    const result = await db.query(
      `DELETE FROM ${this.tableName} WHERE id = $1`,
      [id]
    )
    return (result.rowCount ?? 0) > 0
  }

  /**
   * Check if a tool name already exists
   */
  async nameExists(name: string, excludeId?: string): Promise<boolean> {
    const query = excludeId
      ? `SELECT EXISTS(SELECT 1 FROM ${this.tableName} WHERE name = $1 AND id != $2) as exists`
      : `SELECT EXISTS(SELECT 1 FROM ${this.tableName} WHERE name = $1) as exists`
    const params = excludeId ? [name, excludeId] : [name]
    const result = await db.query<{ exists: boolean }>(query, params)
    return result.rows[0]!.exists
  }

  /**
   * Count all tool configs
   */
  async count(): Promise<number> {
    const result = await db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM ${this.tableName}`
    )
    return parseInt(result.rows[0]!.count, 10)
  }
}

/**
 * Singleton instance
 */
export const toolConfigRepository = new ToolConfigRepository()
