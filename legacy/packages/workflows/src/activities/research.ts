/**
 * Research Activities
 * Activities for invoking agents to perform web research on collections
 */

import {
  agentFactory,
  initializeAgents,
  getResearchToolsForWebsite,
  handleResearchToolCall,
} from '@swarm-press/agents'
import {
  websiteCollectionRepository,
  collectionResearchRepository,
  collectionItemRepository,
} from '@swarm-press/backend/dist/db/repositories'

// Ensure agents are initialized
let agentsInitialized = false

async function ensureAgentsInitialized() {
  if (!agentsInitialized) {
    initializeAgents()
    agentsInitialized = true
  }
}

// ============================================================================
// Types
// ============================================================================

export interface CollectionResearchInput {
  websiteId: string
  collectionType: string
  agentId: string
  maxResults?: number
}

export interface CollectionResearchResult {
  success: boolean
  collectionType: string
  itemsCreated: number
  itemsSkipped: number
  errors: string[]
}

export interface ResearchableCollection {
  id: string
  collectionType: string
  displayName: string
  enabled: boolean
  researchEnabled: boolean
  searchPrompt?: string
  defaultQueries: string[]
}

// ============================================================================
// Activities
// ============================================================================

/**
 * Get all collections enabled for research on a website
 */
export async function getResearchableCollections(
  websiteId: string
): Promise<ResearchableCollection[]> {
  const collections = await collectionResearchRepository.findEnabledByWebsite(websiteId)

  return collections.map((c: any) => ({
    id: c.id,
    collectionType: c.collection_type,
    displayName: c.display_name,
    enabled: c.enabled,
    researchEnabled: c.research_enabled,
    searchPrompt: c.search_prompt,
    defaultQueries: c.default_queries || [],
  }))
}

/**
 * Research a single collection using an agent
 */
export async function researchCollection(
  input: CollectionResearchInput
): Promise<CollectionResearchResult> {
  const { websiteId, collectionType, agentId, maxResults = 50 } = input
  const errors: string[] = []
  let itemsCreated = 0
  let itemsSkipped = 0

  try {
    await ensureAgentsInitialized()

    // Get collection and research config
    const collection = await websiteCollectionRepository.findByType(websiteId, collectionType)
    if (!collection) {
      return {
        success: false,
        collectionType,
        itemsCreated: 0,
        itemsSkipped: 0,
        errors: [`Collection ${collectionType} not found`],
      }
    }

    const researchConfig = await collectionResearchRepository.findByCollectionId(collection.id)
    if (!researchConfig || !researchConfig.enabled) {
      return {
        success: false,
        collectionType,
        itemsCreated: 0,
        itemsSkipped: 0,
        errors: [`Research not enabled for ${collectionType}`],
      }
    }

    // Get a FRESH writer agent (not cached to avoid conversation history collisions)
    const agent = await agentFactory.getFreshAgent(agentId)
    if (!agent) {
      return {
        success: false,
        collectionType,
        itemsCreated: 0,
        itemsSkipped: 0,
        errors: [`Agent ${agentId} not found`],
      }
    }

    // Get research tools for this website and register them with the agent
    const researchTools = await getResearchToolsForWebsite(websiteId)
    const toolRegistry = agent.getToolRegistry()
    const researchContext = { websiteId, collectionType, collectionId: collection.id }

    for (const tool of researchTools) {
      // Create a handler that calls handleResearchToolCall
      const handler = async (input: Record<string, unknown>) => {
        return handleResearchToolCall(tool.name, input, researchContext)
      }
      toolRegistry.register(tool as any, handler)
    }
    console.log(`[Research] Registered ${researchTools.length} research tools`)

    // Build research task
    const researchTask = buildResearchTask(collection, researchConfig, maxResults)

    // Note: We use getFreshAgent above which gives us a new instance each time,
    // so no need to clear history - the agent starts with a clean slate

    console.log(`[Research] Starting research for ${collectionType} with agent ${agentId}`)

    // Execute agent with research tools
    const response = await agent.execute(
      {
        taskType: 'research_collection',
        description: researchTask,
        context: {
          websiteId,
          collectionType,
          collectionId: collection.id,
        },
      },
      {
        agentId,
        websiteId,
      }
    )

    if (!response.success) {
      errors.push(`Agent research failed: ${response.error}`)
    } else {
      // Extract results from agent response
      const results = response.data?.results || {}
      itemsCreated = results.created || 0
      itemsSkipped = results.skipped || 0
      if (results.errors) {
        errors.push(...results.errors)
      }
    }

    console.log(`[Research] Completed ${collectionType}: ${itemsCreated} created, ${itemsSkipped} skipped`)

    return {
      success: errors.length === 0,
      collectionType,
      itemsCreated,
      itemsSkipped,
      errors,
    }
  } catch (error) {
    console.error(`[Research] Error researching ${collectionType}:`, error)
    return {
      success: false,
      collectionType,
      itemsCreated,
      itemsSkipped,
      errors: [error instanceof Error ? error.message : 'Unknown error'],
    }
  }
}

/**
 * Get collection item count
 */
export async function getCollectionItemCount(
  websiteId: string,
  collectionType: string
): Promise<{ total: number; published: number }> {
  const collection = await websiteCollectionRepository.findByType(websiteId, collectionType)
  if (!collection) {
    return { total: 0, published: 0 }
  }

  const total = await collectionItemRepository.countByCollection(collection.id)
  const published = await collectionItemRepository.countByCollection(collection.id, true)
  return { total, published }
}

// ============================================================================
// Helpers
// ============================================================================

function buildResearchTask(
  collection: any,
  researchConfig: any,
  maxResults: number
): string {
  const queries = researchConfig.default_queries || []
  const searchPrompt = researchConfig.search_prompt || `Research ${collection.display_name}`
  const hints = researchConfig.extraction_hints || {}

  // Format schema for the agent to understand
  const schemaStr = JSON.stringify(collection.json_schema, null, 2)

  return `You are researching data for the "${collection.display_name}" collection.

## Research Goal
${searchPrompt}

## Collection Type
${collection.collection_type}

## Target Data Schema
Your task is to find data that matches this JSON Schema:
\`\`\`json
${schemaStr}
\`\`\`

## Suggested Search Queries
${queries.map((q: string, i: number) => `${i + 1}. "${q}"`).join('\n')}

## Field Guidelines
${Object.entries(hints).map(([field, hint]) => `- **${field}**: ${hint}`).join('\n')}

## Instructions
1. Use the \`research_web_search\` tool to search for information using the suggested queries
2. From the search results, extract data items that match the schema above
3. Use the \`research_store_items\` tool to save each item directly - pass the item data formatted according to the schema
4. Aim to find and store up to ${maxResults} unique, high-quality items
5. Ensure all items have source URLs when available
6. Deduplicate results - don't store the same item twice

**Important**: You have the intelligence to understand the schema and extract data directly from search results. Format each item according to the schema structure and call research_store_items with the properly formatted data.

Focus on accuracy and completeness. Only store items that you're confident are real and have verifiable information.`
}
