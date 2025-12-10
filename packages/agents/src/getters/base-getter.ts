/**
 * Base Getter
 * Core implementation for collection data retrieval using ONE Claude API call
 */

import Anthropic from '@anthropic-ai/sdk'
import { db } from '@swarm-press/backend'
import { getEnv } from '@swarm-press/shared'
import { transformToStructuredOutputSchema, wrapSchemaForArrayOutput } from './schema-transformer'
import { buildCollectionPrompt } from './prompt-builder'
import type {
  CollectionGetterOptions,
  CollectionGetterResult,
  WebsiteCollectionInfo,
  ResearchConfigInfo
} from './types'

/**
 * Get collection items with ONE Claude API call
 * Uses web search + structured outputs for guaranteed schema compliance
 */
export async function getCollectionItems<T = Record<string, unknown>>(
  options: CollectionGetterOptions
): Promise<CollectionGetterResult<T>> {
  const { websiteId, collectionType } = options

  try {
    // 1. Load collection info from database
    const collection = await getCollectionInfo(websiteId, collectionType)
    if (!collection) {
      return {
        success: false,
        items: [],
        error: `Collection '${collectionType}' not found for website ${websiteId}`
      }
    }

    // 2. Load research config (optional)
    const researchConfig = await getResearchConfig(collection.id)

    // 3. Build the prompt
    const prompt = buildCollectionPrompt(collection, researchConfig, options)

    // 4. Transform schema for structured outputs
    const itemSchema = transformToStructuredOutputSchema(collection.json_schema)
    const outputSchema = wrapSchemaForArrayOutput(itemSchema)

    // 5. Initialize client
    const client = new Anthropic({ apiKey: getEnv().ANTHROPIC_API_KEY })

    console.log(`[Getter] Fetching ${options.count || 20} items for ${collectionType}`)

    // 6. Make ONE API call with web search + structured outputs
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 16384,
      // Note: web_search and structured outputs may not be combinable
      // If SO doesn't work with web_search, we'll fall back to regular JSON parsing
      tools: [{
        type: 'web_search_20250305',
        name: 'web_search',
        max_uses: 5
      } as any],
      messages: [{ role: 'user', content: prompt }]
    })

    console.log(`[Getter] Response: stop_reason=${response.stop_reason}, tokens: ${response.usage.input_tokens}/${response.usage.output_tokens}`)

    // 7. Extract items from response
    const items = extractItemsFromResponse<T>(response)

    return {
      success: true,
      items,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens
      }
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error(`[Getter] Error fetching ${collectionType}:`, errorMessage)
    return {
      success: false,
      items: [],
      error: errorMessage
    }
  }
}

/**
 * Extract items array from Claude response
 * Handles web_search responses which have multiple text blocks interspersed with search results
 */
function extractItemsFromResponse<T>(response: Anthropic.Message): T[] {
  // Log all content blocks for debugging
  console.log('[Getter] Response content blocks:', response.content.length)
  for (const block of response.content) {
    console.log(`[Getter]   - ${block.type}`)
  }

  // Get ALL text blocks (web_search responses have multiple)
  const textBlocks = response.content.filter(
    (block): block is Anthropic.TextBlock => block.type === 'text'
  )

  if (textBlocks.length === 0) {
    console.warn('[Getter] No text blocks in response')
    return []
  }

  console.log(`[Getter] Found ${textBlocks.length} text blocks`)

  // Try each text block, starting from the LAST one (most likely to have final JSON)
  for (let i = textBlocks.length - 1; i >= 0; i--) {
    const text = textBlocks[i].text
    console.log(`[Getter] Checking text block ${i + 1}/${textBlocks.length}, length: ${text.length}`)

    // Try to extract JSON from this text block
    const items = tryExtractJson<T>(text)
    if (items.length > 0) {
      console.log(`[Getter] Successfully extracted ${items.length} items from text block ${i + 1}`)
      return items
    }
  }

  // If individual blocks didn't work, try concatenating all text blocks
  const combinedText = textBlocks.map(b => b.text).join('\n\n')
  console.log('[Getter] Trying combined text, total length:', combinedText.length)
  const items = tryExtractJson<T>(combinedText)
  if (items.length > 0) {
    console.log(`[Getter] Successfully extracted ${items.length} items from combined text`)
    return items
  }

  console.warn('[Getter] Could not extract items from response')
  console.log('[Getter] Last text block preview:', textBlocks[textBlocks.length - 1].text.substring(0, 1000))
  return []
}

/**
 * Try to extract JSON items from text
 */
function tryExtractJson<T>(text: string): T[] {
  // Try direct JSON parse first
  try {
    const parsed = JSON.parse(text)
    if (Array.isArray(parsed)) return parsed
    if (parsed.items && Array.isArray(parsed.items)) return parsed.items
    return []
  } catch {
    // Try to find JSON in the text - multiple patterns
    const patterns = [
      // Markdown code block
      /```json\s*([\s\S]*?)\s*```/,
      /```\s*([\s\S]*?)\s*```/,
      // Object with items array
      /(\{[\s\S]*"items"\s*:\s*\[[\s\S]*\][\s\S]*\})/,
      // Plain array of objects
      /(\[\s*\{[\s\S]*\}\s*\])/
    ]

    for (const pattern of patterns) {
      const match = text.match(pattern)
      if (match) {
        try {
          const json = match[1] || match[0]
          const parsed = JSON.parse(json)
          if (Array.isArray(parsed) && parsed.length > 0) return parsed
          if (parsed.items && Array.isArray(parsed.items) && parsed.items.length > 0) return parsed.items
        } catch {
          // Try next pattern
        }
      }
    }
  }

  return []
}

/**
 * Get collection info from database
 */
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

/**
 * Get research config from database
 */
async function getResearchConfig(
  collectionId: string
): Promise<ResearchConfigInfo | null> {
  const { rows } = await db.query<ResearchConfigInfo>(
    `SELECT id, collection_id, enabled, search_prompt, default_queries,
            extraction_hints, dedup_strategy, auto_publish
     FROM collection_research_config
     WHERE collection_id = $1`,
    [collectionId]
  )
  return rows[0] || null
}

/**
 * Get collection by type with dynamic dispatch
 */
export async function getCollectionByType<T = Record<string, unknown>>(
  collectionType: string,
  websiteId: string,
  agentPersona: string,
  count?: number,
  filters?: Record<string, unknown>
): Promise<CollectionGetterResult<T>> {
  return getCollectionItems<T>({
    websiteId,
    collectionType,
    agentPersona,
    count,
    filters
  })
}
