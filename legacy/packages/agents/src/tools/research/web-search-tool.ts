/**
 * Web Search Tool
 * Composable tool for searching the web for collection data
 * Uses Anthropic's web_search_20250305 tool type
 */

import Anthropic from '@anthropic-ai/sdk'
import { db } from '@swarm-press/backend'
import { buildSearchPrompt } from './prompt-builder'
import type { ResearchToolContext, WebSearchResult, WebsiteCollectionInfo, ResearchConfigInfo } from './types'

// ============================================================================
// Tool Definition (for agent tool registry)
// ============================================================================

export const webSearchTool = {
  name: 'research_web_search',
  description: 'Search the web for information about a topic. Returns raw search results that can be processed with research_extract_data.',
  input_schema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: 'Search query for finding information'
      },
      collection_type: {
        type: 'string',
        description: 'Target collection type to provide context for the search'
      },
      max_results: {
        type: 'number',
        description: 'Maximum number of search uses (default: 5)'
      }
    },
    required: ['query', 'collection_type']
  }
}

// ============================================================================
// Tool Input Type
// ============================================================================

interface WebSearchInput {
  query: string
  collection_type: string
  max_results?: number
}

// ============================================================================
// Anthropic Web Search Tool Configuration
// ============================================================================

interface WebSearchToolConfig {
  type: 'web_search_20250305'
  name: 'web_search'
  max_uses?: number
  allowed_domains?: string[]
  blocked_domains?: string[]
  user_location?: {
    type: 'approximate'
    city?: string
    region?: string
    country?: string
    timezone?: string
  }
}

/**
 * Build web_search tool configuration from research config
 */
function buildWebSearchToolConfig(
  config?: ResearchConfigInfo | null,
  maxUses: number = 5
): WebSearchToolConfig {
  const toolConfig: WebSearchToolConfig = {
    type: 'web_search_20250305',
    name: 'web_search',
    max_uses: maxUses
  }

  // Add domain filtering from research config
  if (config?.search_domains && config.search_domains.length > 0) {
    toolConfig.allowed_domains = config.search_domains
  }

  return toolConfig
}

// ============================================================================
// Tool Handler
// ============================================================================

/**
 * Execute web search for a collection using Anthropic's web_search tool
 */
export async function webSearchHandler(
  input: WebSearchInput,
  context: ResearchToolContext
): Promise<WebSearchResult> {
  const { query, collection_type, max_results = 5 } = input
  const { websiteId } = context

  try {
    // 1. Get collection and research config from database
    const collection = await getCollectionInfo(websiteId, collection_type)
    if (!collection) {
      return {
        success: false,
        error: `Collection '${collection_type}' not found for website`,
        results: '',
        collection_type,
        query
      }
    }

    const config = await getResearchConfig(collection.id)

    // 2. Build enhanced search prompt
    const searchPrompt = buildSearchPrompt(query, collection, config)

    // 3. Build web_search tool configuration
    const webSearchConfig = buildWebSearchToolConfig(config, max_results)

    // 4. Execute web search via Claude API with web_search_20250305
    const client = new Anthropic()

    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 16000,
      temperature: 0,
      tools: [webSearchConfig as any], // web_search_20250305 tool
      messages: [{ role: 'user', content: searchPrompt }]
    })

    // 5. Extract text content and sources from response
    let responseText = ''
    const sources: string[] = []

    for (const block of message.content) {
      if (block.type === 'text') {
        responseText += block.text + '\n'
      }
      // Handle web_search tool results
      // The response includes server_tool_use blocks with web_search results
      if ((block as any).type === 'server_tool_use') {
        // Server tool use block - search was executed internally
        continue
      }
      // Handle citations in the response
      if ((block as any).citations) {
        const citations = (block as any).citations as Array<{
          url: string
          title?: string
          cited_text?: string
        }>
        for (const citation of citations) {
          if (citation.url && !sources.includes(citation.url)) {
            sources.push(citation.url)
          }
        }
      }
    }

    // Also check for stop_reason and additional metadata
    if (message.stop_reason === 'tool_use') {
      // Claude wants to make additional searches - we got partial results
      console.log('[WebSearchTool] Search may have more results available')
    }

    return {
      success: true,
      results: responseText.trim(),
      collection_type,
      query,
      sources
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error('[WebSearchTool] Error:', errorMessage)
    return {
      success: false,
      error: `Search failed: ${errorMessage}`,
      results: '',
      collection_type,
      query
    }
  }
}

// ============================================================================
// Database Queries
// ============================================================================

async function getCollectionInfo(
  websiteId: string,
  collectionType: string
): Promise<WebsiteCollectionInfo | null> {
  const { rows } = await db.query<WebsiteCollectionInfo>(
    `SELECT id, website_id, collection_type, display_name, singular_name,
            json_schema, field_metadata, title_field, summary_field
     FROM website_collections
     WHERE website_id = $1 AND collection_type = $2 AND enabled = true`,
    [websiteId, collectionType]
  )
  return rows[0] || null
}

async function getResearchConfig(
  collectionId: string
): Promise<ResearchConfigInfo | null> {
  const { rows } = await db.query<ResearchConfigInfo>(
    `SELECT * FROM collection_research_config
     WHERE collection_id = $1 AND enabled = true`,
    [collectionId]
  )
  return rows[0] || null
}
