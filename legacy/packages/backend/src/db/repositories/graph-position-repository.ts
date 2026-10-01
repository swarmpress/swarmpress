import type { GraphPosition, BulkUpdatePositionsInput } from '@swarm-press/shared'
import { BaseRepository } from '../base-repository'
import { db } from '../connection'

/**
 * Repository for GraphPosition entities
 */
export class GraphPositionRepository extends BaseRepository<GraphPosition> {
  constructor() {
    super('graph_positions')
  }

  /**
   * Find all positions for a website
   */
  async findByWebsite(websiteId: string): Promise<GraphPosition[]> {
    return this.findBy('website_id', websiteId)
  }

  /**
   * Find position for a specific node
   */
  async findByNode(websiteId: string, nodeId: string, nodeType: string = 'page'): Promise<GraphPosition | null> {
    const result = await db.query<GraphPosition>(
      `SELECT * FROM ${this.tableName}
       WHERE website_id = $1 AND node_id = $2 AND node_type = $3`,
      [websiteId, nodeId, nodeType]
    )
    return result.rows[0] || null
  }

  /**
   * Bulk update positions (for drag-and-drop)
   */
  async bulkUpdate(input: BulkUpdatePositionsInput): Promise<void> {
    // Use upsert for efficiency
    for (const pos of input.positions) {
      await db.query(
        `INSERT INTO ${this.tableName} (website_id, node_id, node_type, position_x, position_y, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (website_id, node_id, node_type)
         DO UPDATE SET
           position_x = EXCLUDED.position_x,
           position_y = EXCLUDED.position_y,
           updated_at = NOW()`,
        [input.website_id, pos.node_id, pos.node_type, pos.position_x, pos.position_y]
      )
    }
  }

  /**
   * Update single position
   */
  async updatePosition(
    websiteId: string,
    nodeId: string,
    nodeType: string,
    x: number,
    y: number
  ): Promise<GraphPosition> {
    const result = await db.query<GraphPosition>(
      `INSERT INTO ${this.tableName} (website_id, node_id, node_type, position_x, position_y, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (website_id, node_id, node_type)
       DO UPDATE SET
         position_x = EXCLUDED.position_x,
         position_y = EXCLUDED.position_y,
         updated_at = NOW()
       RETURNING *`,
      [websiteId, nodeId, nodeType, x, y]
    )

    if (!result.rows[0]) {
      throw new Error('Failed to update graph position')
    }

    return result.rows[0]
  }

  /**
   * Toggle node collapsed state
   */
  async toggleCollapsed(websiteId: string, nodeId: string, nodeType: string): Promise<GraphPosition | null> {
    const result = await db.query<GraphPosition>(
      `UPDATE ${this.tableName}
       SET collapsed = NOT collapsed, updated_at = NOW()
       WHERE website_id = $1 AND node_id = $2 AND node_type = $3
       RETURNING *`,
      [websiteId, nodeId, nodeType]
    )
    return result.rows[0] || null
  }

  /**
   * Toggle node hidden state
   */
  async toggleHidden(websiteId: string, nodeId: string, nodeType: string): Promise<GraphPosition | null> {
    const result = await db.query<GraphPosition>(
      `UPDATE ${this.tableName}
       SET hidden = NOT hidden, updated_at = NOW()
       WHERE website_id = $1 AND node_id = $2 AND node_type = $3
       RETURNING *`,
      [websiteId, nodeId, nodeType]
    )
    return result.rows[0] || null
  }

  /**
   * Reset all positions for a website (for auto-layout)
   */
  async resetPositions(websiteId: string): Promise<void> {
    await db.query(
      `DELETE FROM ${this.tableName} WHERE website_id = $1`,
      [websiteId]
    )
  }
}

export const graphPositionRepository = new GraphPositionRepository()
