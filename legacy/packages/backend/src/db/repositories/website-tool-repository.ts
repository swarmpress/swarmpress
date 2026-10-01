import type { WebsiteTool, WebsiteToolWithConfig, AddWebsiteToolInput } from '@swarm-press/shared'
import { db } from '../connection'

/**
 * Database row type for website_tools
 */
interface WebsiteToolRow {
  id: string
  website_id: string | null
  tool_config_id: string
  enabled: boolean
  priority: number
  custom_config: Record<string, unknown>
  created_at: Date
}

/**
 * Database row type for website_tools with joined tool_config
 */
interface WebsiteToolWithConfigRow extends WebsiteToolRow {
  tc_id: string
  tc_name: string
  tc_display_name: string | null
  tc_description: string | null
  tc_type: 'rest' | 'graphql' | 'mcp' | 'builtin'
  tc_endpoint_url: string | null
  tc_config: Record<string, unknown>
  tc_input_schema: Record<string, unknown> | null
  tc_created_at: Date
  tc_updated_at: Date
}

/**
 * Convert database row to WebsiteTool
 */
function rowToWebsiteTool(row: WebsiteToolRow): WebsiteTool {
  return {
    id: row.id,
    website_id: row.website_id,
    tool_config_id: row.tool_config_id,
    enabled: row.enabled,
    priority: row.priority,
    custom_config: row.custom_config || {},
    created_at: row.created_at.toISOString(),
  }
}

/**
 * Convert database row with joined config to WebsiteToolWithConfig
 */
function rowToWebsiteToolWithConfig(row: WebsiteToolWithConfigRow): WebsiteToolWithConfig {
  return {
    id: row.id,
    website_id: row.website_id,
    tool_config_id: row.tool_config_id,
    enabled: row.enabled,
    priority: row.priority,
    custom_config: row.custom_config || {},
    created_at: row.created_at.toISOString(),
    tool_config: {
      id: row.tc_id,
      name: row.tc_name,
      display_name: row.tc_display_name,
      description: row.tc_description,
      type: row.tc_type,
      endpoint_url: row.tc_endpoint_url,
      config: row.tc_config || {},
      input_schema: row.tc_input_schema,
      created_at: row.tc_created_at.toISOString(),
      updated_at: row.tc_updated_at.toISOString(),
    },
  }
}

/**
 * Repository for website_tools table
 */
export class WebsiteToolRepository {
  /**
   * Find all tools for a website (including global tools)
   */
  async findForWebsite(websiteId: string): Promise<WebsiteToolWithConfig[]> {
    const result = await db.query<WebsiteToolWithConfigRow>(
      `SELECT
        wt.id, wt.website_id, wt.tool_config_id, wt.enabled, wt.priority, wt.custom_config, wt.created_at,
        tc.id as tc_id, tc.name as tc_name, tc.display_name as tc_display_name,
        tc.description as tc_description, tc.type as tc_type, tc.endpoint_url as tc_endpoint_url,
        tc.config as tc_config, tc.input_schema as tc_input_schema,
        tc.created_at as tc_created_at, tc.updated_at as tc_updated_at
      FROM website_tools wt
      JOIN tool_configs tc ON wt.tool_config_id = tc.id
      WHERE (wt.website_id = $1 OR wt.website_id IS NULL)
        AND wt.enabled = true
      ORDER BY wt.priority DESC, tc.name ASC`,
      [websiteId]
    )
    return result.rows.map(rowToWebsiteToolWithConfig)
  }

  /**
   * Find global tools only (website_id IS NULL)
   */
  async findGlobal(): Promise<WebsiteToolWithConfig[]> {
    const result = await db.query<WebsiteToolWithConfigRow>(
      `SELECT
        wt.id, wt.website_id, wt.tool_config_id, wt.enabled, wt.priority, wt.custom_config, wt.created_at,
        tc.id as tc_id, tc.name as tc_name, tc.display_name as tc_display_name,
        tc.description as tc_description, tc.type as tc_type, tc.endpoint_url as tc_endpoint_url,
        tc.config as tc_config, tc.input_schema as tc_input_schema,
        tc.created_at as tc_created_at, tc.updated_at as tc_updated_at
      FROM website_tools wt
      JOIN tool_configs tc ON wt.tool_config_id = tc.id
      WHERE wt.website_id IS NULL
      ORDER BY wt.priority DESC, tc.name ASC`
    )
    return result.rows.map(rowToWebsiteToolWithConfig)
  }

  /**
   * Find tools specifically assigned to a website (not including global)
   */
  async findForWebsiteOnly(websiteId: string): Promise<WebsiteToolWithConfig[]> {
    const result = await db.query<WebsiteToolWithConfigRow>(
      `SELECT
        wt.id, wt.website_id, wt.tool_config_id, wt.enabled, wt.priority, wt.custom_config, wt.created_at,
        tc.id as tc_id, tc.name as tc_name, tc.display_name as tc_display_name,
        tc.description as tc_description, tc.type as tc_type, tc.endpoint_url as tc_endpoint_url,
        tc.config as tc_config, tc.input_schema as tc_input_schema,
        tc.created_at as tc_created_at, tc.updated_at as tc_updated_at
      FROM website_tools wt
      JOIN tool_configs tc ON wt.tool_config_id = tc.id
      WHERE wt.website_id = $1
      ORDER BY wt.priority DESC, tc.name ASC`,
      [websiteId]
    )
    return result.rows.map(rowToWebsiteToolWithConfig)
  }

  /**
   * Add a tool to a website (or make it global with null website_id)
   */
  async addToWebsite(input: AddWebsiteToolInput): Promise<WebsiteTool> {
    const result = await db.query<WebsiteToolRow>(
      `INSERT INTO website_tools (website_id, tool_config_id, enabled, priority, custom_config)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (website_id, tool_config_id)
       DO UPDATE SET enabled = $3, priority = $4, custom_config = $5
       RETURNING *`,
      [
        input.website_id,
        input.tool_config_id,
        input.enabled ?? true,
        input.priority ?? 0,
        input.custom_config || {},
      ]
    )
    return rowToWebsiteTool(result.rows[0]!)
  }

  /**
   * Remove a tool from a website
   */
  async removeFromWebsite(websiteId: string | null, toolConfigId: string): Promise<boolean> {
    const result = websiteId
      ? await db.query(
          `DELETE FROM website_tools WHERE website_id = $1 AND tool_config_id = $2`,
          [websiteId, toolConfigId]
        )
      : await db.query(
          `DELETE FROM website_tools WHERE website_id IS NULL AND tool_config_id = $1`,
          [toolConfigId]
        )
    return (result.rowCount ?? 0) > 0
  }

  /**
   * Enable or disable a tool for a website
   */
  async setEnabled(websiteId: string | null, toolConfigId: string, enabled: boolean): Promise<boolean> {
    const result = websiteId
      ? await db.query(
          `UPDATE website_tools SET enabled = $3 WHERE website_id = $1 AND tool_config_id = $2`,
          [websiteId, toolConfigId, enabled]
        )
      : await db.query(
          `UPDATE website_tools SET enabled = $2 WHERE website_id IS NULL AND tool_config_id = $1`,
          [toolConfigId, enabled]
        )
    return (result.rowCount ?? 0) > 0
  }

  /**
   * Update priority for a website tool
   */
  async setPriority(websiteId: string | null, toolConfigId: string, priority: number): Promise<boolean> {
    const result = websiteId
      ? await db.query(
          `UPDATE website_tools SET priority = $3 WHERE website_id = $1 AND tool_config_id = $2`,
          [websiteId, toolConfigId, priority]
        )
      : await db.query(
          `UPDATE website_tools SET priority = $2 WHERE website_id IS NULL AND tool_config_id = $1`,
          [toolConfigId, priority]
        )
    return (result.rowCount ?? 0) > 0
  }

  /**
   * Update custom config for a website tool
   */
  async setCustomConfig(
    websiteId: string | null,
    toolConfigId: string,
    customConfig: Record<string, unknown>
  ): Promise<boolean> {
    const result = websiteId
      ? await db.query(
          `UPDATE website_tools SET custom_config = $3 WHERE website_id = $1 AND tool_config_id = $2`,
          [websiteId, toolConfigId, customConfig]
        )
      : await db.query(
          `UPDATE website_tools SET custom_config = $2 WHERE website_id IS NULL AND tool_config_id = $1`,
          [toolConfigId, customConfig]
        )
    return (result.rowCount ?? 0) > 0
  }

  /**
   * Check if a tool is assigned to a website
   */
  async isAssigned(websiteId: string | null, toolConfigId: string): Promise<boolean> {
    const result = websiteId
      ? await db.query<{ exists: boolean }>(
          `SELECT EXISTS(SELECT 1 FROM website_tools WHERE website_id = $1 AND tool_config_id = $2) as exists`,
          [websiteId, toolConfigId]
        )
      : await db.query<{ exists: boolean }>(
          `SELECT EXISTS(SELECT 1 FROM website_tools WHERE website_id IS NULL AND tool_config_id = $1) as exists`,
          [toolConfigId]
        )
    return result.rows[0]!.exists
  }

  /**
   * Find all website assignments for a specific tool
   */
  async findForTool(toolConfigId: string): Promise<WebsiteTool[]> {
    const result = await db.query<WebsiteToolRow>(
      `SELECT id, website_id, tool_config_id, enabled, priority, custom_config, created_at
       FROM website_tools
       WHERE tool_config_id = $1
       ORDER BY website_id NULLS FIRST`,
      [toolConfigId]
    )
    return result.rows.map(rowToWebsiteTool)
  }
}

/**
 * Singleton instance
 */
export const websiteToolRepository = new WebsiteToolRepository()
