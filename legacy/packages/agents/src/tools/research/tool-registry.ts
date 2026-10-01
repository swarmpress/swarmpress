/**
 * Research Tool Registry
 * Dynamic loading and management of research tools for websites
 */

import { db } from '@swarm-press/backend'
import { webSearchTool, webSearchHandler } from './web-search-tool'
import { storeItemsTool, storeItemsHandler } from './store-items-tool'
import type { ResearchToolContext, ToolResult, ListCollectionsResult } from './types'

// Note: extractDataTool was removed because:
// 1. It uses structured outputs which has a 24 optional parameter limit
// 2. The schema has 157 optional parameters, exceeding the limit
// 3. The agent should directly extract and store items using store_items

// ============================================================================
// Types
// ============================================================================

export interface ResearchTool {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export interface ResearchToolHandler {
  (input: Record<string, unknown>, context: ResearchToolContext): Promise<ToolResult>
}

// ============================================================================
// List Collections Tool
// ============================================================================

const listResearchableCollectionsTool: ResearchTool = {
  name: 'list_researchable_collections',
  description: 'List all collections that have research enabled for the current website. Use this to discover what types of data can be researched.',
  input_schema: {
    type: 'object',
    properties: {},
    required: []
  }
}

async function listResearchableCollectionsHandler(
  _input: Record<string, unknown>,
  context: ResearchToolContext
): Promise<ListCollectionsResult> {
  try {
    const { rows } = await db.query<{
      collection_type: string
      display_name: string
      singular_name: string | null
      description: string | null
    }>(
      `SELECT wc.collection_type, wc.display_name, wc.singular_name, wc.description
       FROM website_collections wc
       JOIN collection_research_config crc ON crc.collection_id = wc.id
       WHERE wc.website_id = $1 AND wc.enabled = true AND crc.enabled = true
       ORDER BY wc.display_name`,
      [context.websiteId]
    )

    return {
      success: true,
      collections: rows.map(row => ({
        type: row.collection_type,
        display_name: row.display_name,
        singular_name: row.singular_name || undefined,
        description: row.description || undefined
      }))
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return {
      success: false,
      error: `Failed to list collections: ${errorMessage}`,
      collections: []
    }
  }
}

// ============================================================================
// Tool Registry
// ============================================================================

/**
 * Get all research tools available for a website
 */
export async function getResearchToolsForWebsite(websiteId: string): Promise<ResearchTool[]> {
  // Base composable tools - always available
  // Note: extractDataTool removed - agent should directly populate store_items
  const tools: ResearchTool[] = [
    listResearchableCollectionsTool,
    webSearchTool,
    storeItemsTool
  ]

  // Check if the website has any research-enabled collections
  const { rows } = await db.query<{ count: string }>(
    `SELECT COUNT(*) as count
     FROM website_collections wc
     JOIN collection_research_config crc ON crc.collection_id = wc.id
     WHERE wc.website_id = $1 AND wc.enabled = true AND crc.enabled = true`,
    [websiteId]
  )

  const hasResearchCollections = parseInt(rows[0]?.count || '0') > 0

  if (!hasResearchCollections) {
    // No research-enabled collections - return empty (or could return just list tool)
    console.log(`[ToolRegistry] No research-enabled collections for website ${websiteId}`)
    return [listResearchableCollectionsTool]
  }

  return tools
}

/**
 * Handle a research tool call
 */
export async function handleResearchToolCall(
  toolName: string,
  input: Record<string, unknown>,
  context: ResearchToolContext
): Promise<ToolResult> {
  switch (toolName) {
    case 'list_researchable_collections':
      return listResearchableCollectionsHandler(input, context)

    case 'research_web_search':
      return webSearchHandler(
        input as { query: string; collection_type: string; max_results?: number },
        context
      )

    // Note: research_extract_data handler removed - agent should directly use store_items

    case 'research_store_items':
      return storeItemsHandler(
        input as { items: Record<string, unknown>[]; collection_type: string; publish?: boolean },
        context
      )

    default:
      return {
        success: false,
        error: `Unknown research tool: ${toolName}`
      }
  }
}

/**
 * Check if a tool name is a research tool
 */
export function isResearchTool(toolName: string): boolean {
  return [
    'list_researchable_collections',
    'research_web_search',
    'research_store_items'
  ].includes(toolName)
}

/**
 * Get tool definitions as Anthropic Tool format
 */
export function getToolDefinitions(): ResearchTool[] {
  return [
    listResearchableCollectionsTool,
    webSearchTool,
    storeItemsTool
  ]
}
