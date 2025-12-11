/**
 * Batch Processing Activities
 * Temporal activities for Claude Message Batches API operations
 */

import {
  getBatchProcessingService,
  batchRepository,
  collectionItemRepository,
  websiteCollectionRepository,
} from '@swarm-press/backend'
import { events } from '@swarm-press/event-bus'

/**
 * Submit a batch job to Claude Message Batches API
 */
export async function submitBatchActivity(params: {
  websiteId: string
  collectionType: string
  villages: string[]
  itemsPerVillage?: number
}): Promise<{ batchId: string; jobId: string }> {
  const service = getBatchProcessingService()
  const itemsPerVillage = params.itemsPerVillage || 20

  // Default schema for collection
  const defaultSchema = {
    type: 'object' as const,
    properties: {},
    required: ['slug', 'name', 'village'],
  }

  // Create batch requests for each village using proper API signature
  // createCollectionBatch(collectionType, schema, villages, options)
  const requests = service.createCollectionBatch(
    params.collectionType,
    defaultSchema,
    params.villages,
    { itemCount: itemsPerVillage }
  )

  // Submit batch to Anthropic - returns object with batch_id
  const batchResponse = await service.submitBatch(requests)

  // Record in database
  const job = await batchRepository.create({
    batch_id: batchResponse.batch_id,
    job_type: 'content_generation',
    collection_type: params.collectionType,
    website_id: params.websiteId,
    status: 'processing',
    items_count: params.villages.length,
    items_processed: 0,
    results_processed: false,
    metadata: {
      villages: params.villages,
      items_per_village: itemsPerVillage,
    },
  })

  // Emit event
  await events.batchSubmitted(batchResponse.batch_id, 'content_generation', params.websiteId)

  console.log(`[BatchActivity] Batch submitted: ${batchResponse.batch_id} (job: ${job.id})`)

  return { batchId: batchResponse.batch_id, jobId: job.id }
}

/**
 * Poll batch status from Anthropic API
 */
export async function pollBatchStatusActivity(params: {
  batchId: string
  jobId: string
}): Promise<{
  completed: boolean
  status: string
  progress: { succeeded: number; total: number }
  resultsUrl?: string
}> {
  const service = getBatchProcessingService()
  const status = await service.getBatchStatus(params.batchId)

  const progress = {
    succeeded: status.request_counts.succeeded,
    total: status.request_counts.total,
  }

  // Map Anthropic status to our BatchJobStatus
  // Anthropic uses: in_progress, ended, canceling
  // We use: pending, processing, ended, completed, failed
  const mappedStatus = status.status === 'in_progress' ? 'processing' : status.status === 'ended' ? 'ended' : 'processing'

  // Update database
  await batchRepository.updateStatus(params.jobId, mappedStatus as 'pending' | 'processing' | 'ended' | 'completed' | 'failed', {
    items_processed: progress.succeeded,
    results_url: status.results_url,
  })

  // Emit progress event
  await events.batchProcessing(params.batchId, progress)

  console.log(
    `[BatchActivity] Batch ${params.batchId} status: ${status.status} (${progress.succeeded}/${progress.total})`
  )

  return {
    completed: status.status === 'ended',
    status: status.status,
    progress,
    resultsUrl: status.results_url,
  }
}

/**
 * Process batch results and import to database
 */
export async function processBatchResultsActivity(params: {
  batchId: string
  jobId: string
  websiteId: string
  collectionType: string
}): Promise<{ itemsImported: number; errors: string[] }> {
  const service = getBatchProcessingService()

  // Get job from database
  const job = await batchRepository.findById(params.jobId)
  if (!job) {
    throw new Error(`Batch job ${params.jobId} not found`)
  }

  // Get results URL
  let resultsUrl = job.results_url
  if (!resultsUrl) {
    const status = await service.getBatchStatus(params.batchId)
    resultsUrl = status.results_url
    if (!resultsUrl) {
      throw new Error('No results URL available')
    }
  }

  // Fetch and parse results
  const results = await service.fetchResults(resultsUrl)

  let itemsImported = 0
  const errors: string[] = []

  // Get website collection ID
  const collection = await websiteCollectionRepository.findByType(
    params.websiteId,
    params.collectionType
  )

  if (!collection) {
    throw new Error(
      `Collection ${params.collectionType} not found for website ${params.websiteId}`
    )
  }

  // Process each result
  for (const result of results) {
    const extracted = service.extractContent(result)

    if (extracted.success && extracted.data) {
      const data = extracted.data as { items?: Array<Record<string, unknown>> }
      const items = data.items || []

      for (const item of items) {
        try {
          const slug = (item.slug as string) || `item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

          await collectionItemRepository.create({
            website_collection_id: collection.id,
            slug,
            data: item,
            published: false,
            featured: false,
          })
          itemsImported++
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : 'Unknown error'
          errors.push(`Failed to import item: ${errorMsg}`)
        }
      }
    } else {
      errors.push(`${extracted.customId}: ${extracted.error}`)
    }
  }

  // Update job status
  await batchRepository.markCompleted(params.jobId, itemsImported, resultsUrl)

  // Emit completion event
  await events.batchCompleted(params.batchId, itemsImported, params.websiteId)

  console.log(
    `[BatchActivity] Batch ${params.batchId} processed: ${itemsImported} items imported, ${errors.length} errors`
  )

  return { itemsImported, errors }
}

/**
 * Cancel a batch job
 */
export async function cancelBatchActivity(params: {
  batchId: string
  jobId: string
}): Promise<{ success: boolean }> {
  const service = getBatchProcessingService()

  try {
    await service.cancelBatch(params.batchId)

    // Update database
    await batchRepository.markFailed(params.jobId, 'Cancelled')

    // Emit event
    await events.batchFailed(params.batchId, 'Cancelled')

    console.log(`[BatchActivity] Batch ${params.batchId} cancelled`)

    return { success: true }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error'
    console.error(`[BatchActivity] Failed to cancel batch ${params.batchId}: ${errorMsg}`)
    return { success: false }
  }
}

/**
 * Get batch statistics for a website
 */
export async function getBatchStatisticsActivity(params: {
  websiteId?: string
}): Promise<{
  total: number
  pending: number
  processing: number
  completed: number
  failed: number
  totalItemsProcessed: number
}> {
  return await batchRepository.getStatistics(params.websiteId)
}
