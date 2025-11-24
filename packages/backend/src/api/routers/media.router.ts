/**
 * Media Router
 * tRPC router for media operations
 */

import { z } from 'zod';
import { router, publicProcedure } from '../trpc';
import { TRPCError } from '@trpc/server';
import { createMediaService } from '../../services/media.service';

/**
 * Media Router
 */
export const mediaRouter = router({
  // =============================================================================
  // UPLOAD
  // =============================================================================

  /**
   * Generate presigned upload URL for direct browser upload
   */
  generateUploadUrl: publicProcedure
    .input(
      z.object({
        websiteId: z.string().uuid(),
        filename: z.string(),
        mimeType: z.string(),
        expiresIn: z.number().int().min(60).max(3600).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const mediaService = createMediaService(ctx.db);

      const { url, key } = await mediaService.generatePresignedUploadUrl(
        input.websiteId,
        input.filename,
        input.mimeType,
        input.expiresIn
      );

      return { url, key };
    }),

  /**
   * Complete upload and create media record
   * Called after the browser has uploaded the file to S3
   */
  completeUpload: publicProcedure
    .input(
      z.object({
        websiteId: z.string().uuid(),
        storageKey: z.string(),
        filename: z.string(),
        mimeType: z.string(),
        sizeBytes: z.number().int().min(0),
        altText: z.string().optional(),
        caption: z.string().optional(),
        title: z.string().optional(),
        tags: z.array(z.string()).optional(),
        category: z.string().optional(),
        uploadedByAgentId: z.string().uuid().optional(),
        uploadedByUserId: z.string().uuid().optional(),
        uploadSource: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Insert media record
      const result = await ctx.db.query(
        `INSERT INTO media (
          website_id, filename, original_filename, mime_type, size_bytes,
          storage_provider, storage_bucket, storage_path,
          url, alt_text, caption, title, seo_filename, tags, category,
          uploaded_by_agent_id, uploaded_by_user_id, upload_source,
          processing_status, variants_generated
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8,
          $9, $10, $11, $12, $13, $14, $15,
          $16, $17, $18,
          $19, $20
        ) RETURNING *`,
        [
          input.websiteId,
          input.storageKey.split('/').pop(),
          input.filename,
          input.mimeType,
          input.sizeBytes,
          process.env.MEDIA_STORAGE_PROVIDER || 'r2',
          process.env.MEDIA_STORAGE_BUCKET || '',
          input.storageKey,
          `${process.env.MEDIA_CDN_URL || ''}/${input.storageKey}`,
          input.altText || null,
          input.caption || null,
          input.title || null,
          input.filename
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, '-')
            .replace(/-+/g, '-'),
          input.tags || [],
          input.category || null,
          input.uploadedByAgentId || null,
          input.uploadedByUserId || null,
          input.uploadSource || 'user_uploaded',
          input.mimeType.startsWith('image/') ? 'pending' : 'completed',
          false,
        ]
      );

      const media = result.rows[0];

      // Queue variant generation for images
      if (input.mimeType.startsWith('image/')) {
        await ctx.db.query(
          `INSERT INTO media_processing_queue (media_id, task_type, priority)
           VALUES ($1, $2, $3)`,
          [media.id, 'generate_variants', 5]
        );
      }

      return media;
    }),

  // =============================================================================
  // RETRIEVE
  // =============================================================================

  /**
   * Get media by ID
   */
  get: publicProcedure
    .input(
      z.object({
        mediaId: z.string().uuid(),
      })
    )
    .query(async ({ input, ctx }) => {
      const result = await ctx.db.query('SELECT * FROM media WHERE id = $1', [
        input.mediaId,
      ]);

      if (result.rows.length === 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Media not found',
        });
      }

      return result.rows[0];
    }),

  /**
   * List media for a website
   */
  list: publicProcedure
    .input(
      z.object({
        websiteId: z.string().uuid(),
        category: z.string().optional(),
        tags: z.array(z.string()).optional(),
        mimeType: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ input, ctx }) => {
      const mediaService = createMediaService(ctx.db);

      return await mediaService.listMedia(input.websiteId, {
        category: input.category,
        tags: input.tags,
        mimeType: input.mimeType,
        limit: input.limit,
        offset: input.offset,
      });
    }),

  /**
   * Search media
   */
  search: publicProcedure
    .input(
      z.object({
        websiteId: z.string().uuid(),
        query: z.string(),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ input, ctx }) => {
      // Full-text search on media metadata
      const result = await ctx.db.query(
        `SELECT *,
          ts_rank(
            to_tsvector('english',
              coalesce(alt_text, '') || ' ' ||
              coalesce(caption, '') || ' ' ||
              coalesce(title, '') || ' ' ||
              coalesce(filename, '')
            ),
            plainto_tsquery('english', $2)
          ) as rank
         FROM media
         WHERE website_id = $1
           AND to_tsvector('english',
                coalesce(alt_text, '') || ' ' ||
                coalesce(caption, '') || ' ' ||
                coalesce(title, '') || ' ' ||
                coalesce(filename, '')
              ) @@ plainto_tsquery('english', $2)
         ORDER BY rank DESC
         LIMIT $3 OFFSET $4`,
        [input.websiteId, input.query, input.limit, input.offset]
      );

      // Get total count
      const countResult = await ctx.db.query(
        `SELECT COUNT(*) as count
         FROM media
         WHERE website_id = $1
           AND to_tsvector('english',
                coalesce(alt_text, '') || ' ' ||
                coalesce(caption, '') || ' ' ||
                coalesce(title, '') || ' ' ||
                coalesce(filename, '')
              ) @@ plainto_tsquery('english', $2)`,
        [input.websiteId, input.query]
      );

      return {
        items: result.rows,
        total: parseInt(countResult.rows[0].count),
        limit: input.limit,
        offset: input.offset,
      };
    }),

  // =============================================================================
  // UPDATE
  // =============================================================================

  /**
   * Update media metadata
   */
  update: publicProcedure
    .input(
      z.object({
        mediaId: z.string().uuid(),
        altText: z.string().optional(),
        caption: z.string().optional(),
        title: z.string().optional(),
        tags: z.array(z.string()).optional(),
        category: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const mediaService = createMediaService(ctx.db);

      return await mediaService.updateMedia(input.mediaId, {
        altText: input.altText,
        caption: input.caption,
        title: input.title,
        tags: input.tags,
        category: input.category,
      });
    }),

  // =============================================================================
  // DELETE
  // =============================================================================

  /**
   * Delete media
   */
  delete: publicProcedure
    .input(
      z.object({
        mediaId: z.string().uuid(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const mediaService = createMediaService(ctx.db);

      await mediaService.deleteMedia(input.mediaId);

      return { success: true };
    }),

  // =============================================================================
  // PROCESSING
  // =============================================================================

  /**
   * Get processing status
   */
  getProcessingStatus: publicProcedure
    .input(
      z.object({
        mediaId: z.string().uuid(),
      })
    )
    .query(async ({ input, ctx }) => {
      const result = await ctx.db.query(
        `SELECT processing_status, processing_error, variants_generated
         FROM media
         WHERE id = $1`,
        [input.mediaId]
      );

      if (result.rows.length === 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Media not found',
        });
      }

      return result.rows[0];
    }),

  /**
   * Regenerate variants for an image
   */
  regenerateVariants: publicProcedure
    .input(
      z.object({
        mediaId: z.string().uuid(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Check if media exists and is an image
      const result = await ctx.db.query(
        'SELECT mime_type FROM media WHERE id = $1',
        [input.mediaId]
      );

      if (result.rows.length === 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Media not found',
        });
      }

      if (!result.rows[0].mime_type.startsWith('image/')) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Media is not an image',
        });
      }

      // Reset processing status
      await ctx.db.query(
        `UPDATE media
         SET processing_status = 'pending',
             processing_error = NULL,
             variants_generated = false,
             updated_at = NOW()
         WHERE id = $1`,
        [input.mediaId]
      );

      // Queue variant generation
      await ctx.db.query(
        `INSERT INTO media_processing_queue (media_id, task_type, priority)
         VALUES ($1, $2, $3)`,
        [input.mediaId, 'generate_variants', 8]
      );

      return { success: true };
    }),

  /**
   * Process pending media queue item (for background workers)
   */
  processQueue: publicProcedure.mutation(async ({ ctx }) => {
    // Get next pending item
    const result = await ctx.db.query(
      `SELECT * FROM media_processing_queue
       WHERE status = 'pending'
         AND attempts < max_attempts
       ORDER BY priority DESC, created_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED`
    );

    if (result.rows.length === 0) {
      return { processed: false, message: 'No pending items' };
    }

    const queueItem = result.rows[0];

    // Update status to processing
    await ctx.db.query(
      `UPDATE media_processing_queue
       SET status = 'processing',
           attempts = attempts + 1,
           started_at = NOW()
       WHERE id = $1`,
      [queueItem.id]
    );

    try {
      // Process the task
      const mediaService = createMediaService(ctx.db);

      if (queueItem.task_type === 'generate_variants') {
        await mediaService.generateVariants(queueItem.media_id);
      }

      // Mark as completed
      await ctx.db.query(
        `UPDATE media_processing_queue
         SET status = 'completed',
             completed_at = NOW()
         WHERE id = $1`,
        [queueItem.id]
      );

      return {
        processed: true,
        queueItemId: queueItem.id,
        mediaId: queueItem.media_id,
        taskType: queueItem.task_type,
      };
    } catch (error) {
      // Mark as failed
      await ctx.db.query(
        `UPDATE media_processing_queue
         SET status = 'failed',
             error = $1,
             completed_at = NOW()
         WHERE id = $2`,
        [error instanceof Error ? error.message : 'Unknown error', queueItem.id]
      );

      throw error;
    }
  }),

  // =============================================================================
  // DOWNLOAD
  // =============================================================================

  /**
   * Generate presigned download URL
   */
  generateDownloadUrl: publicProcedure
    .input(
      z.object({
        mediaId: z.string().uuid(),
        expiresIn: z.number().int().min(60).max(3600).optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      const result = await ctx.db.query(
        'SELECT storage_path FROM media WHERE id = $1',
        [input.mediaId]
      );

      if (result.rows.length === 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Media not found',
        });
      }

      const mediaService = createMediaService(ctx.db);

      const url = await mediaService.generatePresignedDownloadUrl(
        result.rows[0].storage_path,
        input.expiresIn
      );

      return { url };
    }),

  // =============================================================================
  // STATISTICS
  // =============================================================================

  /**
   * Get media statistics for a website
   */
  getStats: publicProcedure
    .input(
      z.object({
        websiteId: z.string().uuid(),
      })
    )
    .query(async ({ input, ctx }) => {
      const result = await ctx.db.query(
        `SELECT
          COUNT(*) as total_count,
          SUM(size_bytes) as total_size,
          COUNT(*) FILTER (WHERE mime_type LIKE 'image/%') as image_count,
          COUNT(*) FILTER (WHERE mime_type LIKE 'video/%') as video_count,
          COUNT(*) FILTER (WHERE mime_type LIKE 'audio/%') as audio_count,
          COUNT(*) FILTER (WHERE processing_status = 'pending') as pending_count,
          COUNT(*) FILTER (WHERE processing_status = 'processing') as processing_count,
          COUNT(*) FILTER (WHERE processing_status = 'failed') as failed_count
         FROM media
         WHERE website_id = $1`,
        [input.websiteId]
      );

      return result.rows[0];
    }),
});
