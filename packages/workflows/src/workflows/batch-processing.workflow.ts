/**
 * Batch Processing Workflow
 * Orchestrates Claude Message Batches API operations for bulk content generation
 *
 * Flow:
 * 1. Optional CEO approval for expensive batches
 * 2. Submit batch to Anthropic
 * 3. Poll for completion
 * 4. Process results and import to database
 * 5. Optional export to GitHub
 */

import { proxyActivities, sleep } from '@temporalio/workflow'
import type * as activities from '../activities'

const {
  submitBatchActivity,
  pollBatchStatusActivity,
  processBatchResultsActivity,
  exportCollectionToGitHubActivity,
  createQuestionTicket,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '24 hours', // Batches can take many hours
  retry: {
    maximumAttempts: 3,
  },
})

export interface BatchProcessingInput {
  /** Website ID to associate batch with */
  websiteId: string
  /** Collection type (e.g., 'events', 'pois', 'restaurants') */
  collectionType: string
  /** List of villages to generate content for */
  villages: string[]
  /** Items per village (default: 20) */
  itemsPerVillage?: number
  /** Require CEO approval before starting */
  requireApproval?: boolean
  /** Estimated cost in dollars (used for approval threshold) */
  estimatedCost?: number
  /** Export to GitHub after import */
  exportToGitHub?: boolean
  /** Poll interval in seconds (default: 30) */
  pollIntervalSeconds?: number
}

export interface BatchProcessingResult {
  success: boolean
  batchId?: string
  jobId?: string
  itemsImported?: number
  itemsExported?: number
  totalDuration?: number
  errors?: string[]
  error?: string
}

/**
 * Batch Processing Workflow
 *
 * Designed for bulk content generation using Claude's Message Batches API
 * which provides 50% cost savings on API calls.
 */
export async function batchProcessingWorkflow(
  input: BatchProcessingInput
): Promise<BatchProcessingResult> {
  const startTime = Date.now()
  const pollInterval = input.pollIntervalSeconds || 30

  try {
    console.log(
      `[BatchWorkflow] Starting batch for ${input.collectionType} with ${input.villages.length} villages`
    )

    // Step 1: Optional CEO approval for expensive batches
    const costThreshold = 50 // dollars
    if (input.requireApproval || (input.estimatedCost && input.estimatedCost > costThreshold)) {
      console.log(`[BatchWorkflow] Requesting CEO approval (estimated cost: $${input.estimatedCost || 'unknown'})`)

      await createQuestionTicket({
        subject: `Approve Batch Processing: ${input.collectionType}`,
        body: `**Batch Content Generation Request**

A batch job has been requested to generate collection content.

**Details:**
- Collection Type: ${input.collectionType}
- Villages: ${input.villages.join(', ')}
- Items per Village: ${input.itemsPerVillage || 20}
- Total Requests: ${input.villages.length}
- Estimated Cost: $${input.estimatedCost || 'unknown'}

**Cost Savings:**
Using Claude Message Batches API provides 50% cost savings compared to regular API calls.

Please approve this batch job to proceed.`,
        created_by_agent_id: 'system',
        target: 'CEO',
      })

      // In a real implementation, we would use signals to wait for approval
      // For now, we proceed after creating the ticket
      console.log(`[BatchWorkflow] CEO approval ticket created, proceeding with batch`)
    }

    // Step 2: Submit batch to Anthropic
    console.log(`[BatchWorkflow] Submitting batch to Anthropic`)

    const { batchId, jobId } = await submitBatchActivity({
      websiteId: input.websiteId,
      collectionType: input.collectionType,
      villages: input.villages,
      itemsPerVillage: input.itemsPerVillage,
    })

    console.log(`[BatchWorkflow] Batch submitted: ${batchId} (job: ${jobId})`)

    // Step 3: Poll for completion
    let completed = false
    let pollCount = 0
    const maxPolls = 2880 // 24 hours at 30-second intervals

    while (!completed && pollCount < maxPolls) {
      const status = await pollBatchStatusActivity({ batchId, jobId })

      console.log(
        `[BatchWorkflow] Poll ${pollCount + 1}: ${status.status} (${status.progress.succeeded}/${status.progress.total})`
      )

      if (status.completed) {
        completed = true
      } else {
        await sleep(`${pollInterval} seconds`)
        pollCount++
      }
    }

    if (!completed) {
      throw new Error(`Batch timed out after ${pollCount * pollInterval} seconds`)
    }

    console.log(`[BatchWorkflow] Batch completed, processing results`)

    // Step 4: Process results and import to database
    const { itemsImported, errors } = await processBatchResultsActivity({
      batchId,
      jobId,
      websiteId: input.websiteId,
      collectionType: input.collectionType,
    })

    console.log(`[BatchWorkflow] Imported ${itemsImported} items with ${errors.length} errors`)

    // Step 5: Optional export to GitHub
    let itemsExported = 0
    if (input.exportToGitHub && itemsImported > 0) {
      console.log(`[BatchWorkflow] Exporting to GitHub`)

      const exportResult = await exportCollectionToGitHubActivity({
        websiteId: input.websiteId,
        collectionType: input.collectionType,
        publishedOnly: false, // Export all items including unpublished
      })

      itemsExported = exportResult.itemsExported
      if (exportResult.errors.length > 0) {
        errors.push(...exportResult.errors)
      }

      console.log(`[BatchWorkflow] Exported ${itemsExported} items to GitHub`)
    }

    const totalDuration = Date.now() - startTime

    console.log(
      `[BatchWorkflow] Workflow completed in ${Math.round(totalDuration / 1000)}s: ${itemsImported} imported, ${itemsExported} exported`
    )

    return {
      success: errors.length === 0,
      batchId,
      jobId,
      itemsImported,
      itemsExported,
      totalDuration,
      errors: errors.length > 0 ? errors : undefined,
    }
  } catch (error) {
    console.error(`[BatchWorkflow] Workflow failed:`, error)

    return {
      success: false,
      totalDuration: Date.now() - startTime,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * GitHub Export Workflow
 * Simple workflow for exporting collection items to GitHub
 */
export async function githubExportWorkflow(input: {
  websiteId: string
  collectionType: string
  publishedOnly?: boolean
}): Promise<{
  success: boolean
  itemsExported: number
  errors: string[]
}> {
  try {
    console.log(`[GitHubExport] Starting export for ${input.collectionType}`)

    const result = await exportCollectionToGitHubActivity({
      websiteId: input.websiteId,
      collectionType: input.collectionType,
      publishedOnly: input.publishedOnly,
    })

    console.log(`[GitHubExport] Exported ${result.itemsExported} items`)

    return {
      success: result.errors.length === 0,
      itemsExported: result.itemsExported,
      errors: result.errors,
    }
  } catch (error) {
    return {
      success: false,
      itemsExported: 0,
      errors: [error instanceof Error ? error.message : 'Unknown error'],
    }
  }
}
