/**
 * Batch Processing API Router
 * Endpoints for managing Claude Message Batches API jobs
 */

import { z } from 'zod'
import { router, publicProcedure, protectedProcedure } from '../trpc'
import { batchRepository, websiteCollectionRepository, collectionItemRepository } from '../../db/repositories'
import { TRPCError } from '@trpc/server'
import { events } from '@swarm-press/event-bus'
import { getBatchProcessingService } from '../../services/batch-processing.service'

/**
 * Batch Router
 */
export const batchRouter = router({
  /**
   * List batch jobs with filtering
   */
  list: publicProcedure
    .input(
      z.object({
        websiteId: z.string().uuid().optional(),
        status: z.enum(['pending', 'processing', 'ended', 'completed', 'failed']).optional(),
        collectionType: z.string().optional(),
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ input }) => {
      const { items, total } = await batchRepository.listRecent({
        limit: input.limit,
        offset: input.offset,
        websiteId: input.websiteId,
        status: input.status,
        collectionType: input.collectionType,
      })

      return {
        items,
        total,
        limit: input.limit,
        offset: input.offset,
      }
    }),

  /**
   * Get batch job by ID
   */
  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const job = await batchRepository.findById(input.id)

      if (!job) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Batch job ${input.id} not found`,
        })
      }

      return job
    }),

  /**
   * Get batch job by Anthropic batch ID
   */
  getByBatchId: publicProcedure
    .input(z.object({ batchId: z.string() }))
    .query(async ({ input }) => {
      const job = await batchRepository.findByBatchId(input.batchId)

      if (!job) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Batch job with batch_id ${input.batchId} not found`,
        })
      }

      return job
    }),

  /**
   * Get batch job statistics
   */
  getStatistics: publicProcedure
    .input(z.object({ websiteId: z.string().uuid().optional() }))
    .query(async ({ input }) => {
      return await batchRepository.getStatistics(input.websiteId)
    }),

  /**
   * Submit a new batch job for collection content generation
   */
  submit: protectedProcedure
    .input(
      z.object({
        websiteId: z.string().uuid(),
        collectionType: z.string(),
        villages: z.array(z.string()).min(1).max(10),
        itemsPerVillage: z.number().min(5).max(50).default(20),
      })
    )
    .mutation(async ({ input }) => {
      const service = getBatchProcessingService()

      // Get or create a default schema for the collection type
      const defaultSchema = {
        type: 'object',
        properties: {},
        required: ['slug', 'name', 'village'],
      }

      // Create batch requests for each village using the service method
      // createCollectionBatch takes (collectionType, schema, villages, options)
      const requests = service.createCollectionBatch(
        input.collectionType,
        defaultSchema,
        input.villages,
        { itemCount: input.itemsPerVillage }
      )

      // Submit batch to Anthropic - returns object with batch_id
      const batchResponse = await service.submitBatch(requests)

      // Record in database
      const job = await batchRepository.create({
        batch_id: batchResponse.batch_id,
        job_type: 'content_generation',
        collection_type: input.collectionType,
        website_id: input.websiteId,
        status: 'processing',
        items_count: input.villages.length,
        items_processed: 0,
        results_processed: false,
        metadata: {
          villages: input.villages,
          items_per_village: input.itemsPerVillage,
        },
      })

      // Emit event
      await events.batchSubmitted(batchResponse.batch_id, 'content_generation', input.websiteId)

      console.log(`[BatchRouter] Batch submitted: ${batchResponse.batch_id} (job: ${job.id})`)

      return {
        id: job.id,
        batchId: batchResponse.batch_id,
        status: job.status,
        itemsCount: job.items_count,
      }
    }),

  /**
   * Check batch status (polls Anthropic API)
   */
  checkStatus: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const job = await batchRepository.findById(input.id)

      if (!job) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Batch job ${input.id} not found`,
        })
      }

      // If job is already completed or failed, return cached status
      if (job.status === 'completed' || job.status === 'failed') {
        return {
          id: job.id,
          batchId: job.batch_id,
          status: job.status,
          itemsCount: job.items_count,
          itemsProcessed: job.items_processed,
          resultsUrl: job.results_url,
          errorMessage: job.error_message,
        }
      }

      // Poll Anthropic for current status
      const service = getBatchProcessingService()
      const status = await service.getBatchStatus(job.batch_id)

      // Map Anthropic status to our BatchJobStatus
      // Anthropic uses: in_progress, ended, canceling
      // We use: pending, processing, ended, completed, failed
      const mappedStatus = status.status === 'in_progress' ? 'processing' : status.status === 'ended' ? 'ended' : 'processing'

      // Update database with latest status
      const updatedJob = await batchRepository.updateStatus(job.id, mappedStatus as 'pending' | 'processing' | 'ended' | 'completed' | 'failed', {
        items_processed: status.request_counts.succeeded,
        results_url: status.results_url,
      })

      // Emit progress event
      await events.batchProcessing(job.batch_id, {
        succeeded: status.request_counts.succeeded,
        total: status.request_counts.total,
      })

      return {
        id: updatedJob?.id || job.id,
        batchId: job.batch_id,
        status: status.status,
        itemsCount: status.request_counts.total,
        itemsProcessed: status.request_counts.succeeded,
        resultsUrl: status.results_url,
      }
    }),

  /**
   * Fetch and process batch results
   */
  processResults: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const job = await batchRepository.findById(input.id)

      if (!job) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Batch job ${input.id} not found`,
        })
      }

      if (job.status !== 'ended') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Batch job is not complete (status: ${job.status})`,
        })
      }

      if (job.results_processed) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Batch results have already been processed',
        })
      }

      const service = getBatchProcessingService()

      // Get results URL if not cached
      let resultsUrl = job.results_url
      if (!resultsUrl) {
        const status = await service.getBatchStatus(job.batch_id)
        resultsUrl = status.results_url
        if (!resultsUrl) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'No results URL available',
          })
        }
      }

      // Fetch and parse results
      const results = await service.fetchResults(resultsUrl)

      let itemsImported = 0
      const errors: string[] = []

      // Get or create website collection
      let collectionId: string | null = null
      if (job.website_id && job.collection_type) {
        const collection = await websiteCollectionRepository.findByType(
          job.website_id,
          job.collection_type
        )
        collectionId = collection?.id || null
      }

      // Process each result
      for (const result of results) {
        const extracted = service.extractContent(result)

        if (extracted.success && extracted.data) {
          const items = (extracted.data as { items?: unknown[] }).items || []

          for (const item of items) {
            const itemData = item as { slug?: string; village?: string }

            try {
              if (collectionId) {
                await collectionItemRepository.create({
                  website_collection_id: collectionId,
                  slug: itemData.slug || `item-${Date.now()}`,
                  data: item as Record<string, unknown>,
                  published: false,
                  featured: false,
                })
                itemsImported++
              }
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
      const updatedJob = await batchRepository.markCompleted(
        job.id,
        itemsImported,
        resultsUrl
      )

      // Emit completion event
      await events.batchCompleted(job.batch_id, itemsImported, job.website_id)

      console.log(
        `[BatchRouter] Batch ${job.batch_id} processed: ${itemsImported} items imported, ${errors.length} errors`
      )

      return {
        id: updatedJob?.id || job.id,
        itemsImported,
        errors: errors.length > 0 ? errors : undefined,
      }
    }),

  /**
   * Cancel a batch job
   */
  cancel: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const job = await batchRepository.findById(input.id)

      if (!job) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Batch job ${input.id} not found`,
        })
      }

      if (job.status !== 'pending' && job.status !== 'processing') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Cannot cancel batch with status: ${job.status}`,
        })
      }

      // Cancel in Anthropic
      const service = getBatchProcessingService()
      await service.cancelBatch(job.batch_id)

      // Update database
      const updatedJob = await batchRepository.markFailed(job.id, 'Cancelled by user')

      // Emit event
      await events.batchFailed(job.batch_id, 'Cancelled by user')

      console.log(`[BatchRouter] Batch ${job.batch_id} cancelled`)

      return {
        id: updatedJob?.id || job.id,
        status: 'failed',
        message: 'Batch job cancelled',
      }
    }),

  /**
   * List batches from Anthropic API directly (for debugging)
   */
  listFromApi: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(20) }))
    .query(async ({ input }) => {
      const service = getBatchProcessingService()
      const batches = await service.listBatches(input.limit)
      return batches
    }),
})
