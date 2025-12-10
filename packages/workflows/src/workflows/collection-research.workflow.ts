/**
 * Collection Research Workflow
 * Orchestrates research for a single collection type using an agent
 */

import { proxyActivities, sleep } from '@temporalio/workflow'
import type * as activities from '../activities'

const {
  researchCollection,
  getCollectionItemCount,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '20 minutes',
  retry: {
    maximumAttempts: 3,
    initialInterval: '30 seconds',
    backoffCoefficient: 2.0,
  },
})

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
  itemsBefore: number
  itemsAfter: number
  errors: string[]
}

// ============================================================================
// Workflow
// ============================================================================

/**
 * Collection Research Workflow
 *
 * Flow:
 * 1. Get initial item count
 * 2. Invoke agent with research tools
 * 3. Agent searches web, extracts data, stores items
 * 4. Get final item count
 * 5. Return results
 */
export async function collectionResearchWorkflow(
  input: CollectionResearchInput
): Promise<CollectionResearchResult> {
  const { websiteId, collectionType, agentId, maxResults = 50 } = input

  console.log(`[CollectionResearch] Starting for ${collectionType}`)

  try {
    // Get initial count
    const initialCount = await getCollectionItemCount(websiteId, collectionType)
    console.log(`[CollectionResearch] Initial items: ${initialCount.total}`)

    // Perform research
    const researchResult = await researchCollection({
      websiteId,
      collectionType,
      agentId,
      maxResults,
    })

    // Small delay before checking final count
    await sleep('2 seconds')

    // Get final count
    const finalCount = await getCollectionItemCount(websiteId, collectionType)
    console.log(`[CollectionResearch] Final items: ${finalCount.total}`)

    return {
      success: researchResult.success,
      collectionType,
      itemsCreated: researchResult.itemsCreated,
      itemsSkipped: researchResult.itemsSkipped,
      itemsBefore: initialCount.total,
      itemsAfter: finalCount.total,
      errors: researchResult.errors,
    }
  } catch (error) {
    console.error(`[CollectionResearch] Error:`, error)
    return {
      success: false,
      collectionType,
      itemsCreated: 0,
      itemsSkipped: 0,
      itemsBefore: 0,
      itemsAfter: 0,
      errors: [error instanceof Error ? error.message : 'Unknown error'],
    }
  }
}
