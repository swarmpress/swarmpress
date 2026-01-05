/**
 * Media Router
 * Simplified tRPC router for media operations - NO DATABASE
 *
 * This router uses direct storage and API services:
 * - StorageService for R2/S3 uploads
 * - ImageGenerationService for DALL-E
 * - StockPhotoService for Unsplash/Pexels
 *
 * Media URLs are stored directly in content JSON files, not in PostgreSQL.
 */

import { z } from 'zod'
import { router, publicProcedure } from '../trpc'
import { TRPCError } from '@trpc/server'
import {
  getStorageService,
  isStorageConfigured,
} from '../../services/storage.service'
import {
  getImageGenerationService,
  isImageGenerationConfigured,
} from '../../services/image-generation.service'
import {
  getStockPhotoService,
  isStockPhotoConfigured,
} from '../../services/stock-photo.service'

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Slugify text for filenames
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
}

/**
 * Get folder path for uploads
 */
function getFolderPath(websiteId: string, subfolder?: string): string {
  const year = new Date().getFullYear()
  const month = String(new Date().getMonth() + 1).padStart(2, '0')

  if (subfolder) {
    return `${websiteId}/images/${subfolder}`
  }

  return `${websiteId}/images/${year}/${month}`
}

// =============================================================================
// Media Router
// =============================================================================

export const mediaRouter = router({
  // ===========================================================================
  // STATUS
  // ===========================================================================

  /**
   * Check which media services are configured
   */
  getStatus: publicProcedure.query(async () => {
    return {
      storage: isStorageConfigured(),
      imageGeneration: isImageGenerationConfigured(),
      stockPhotos: isStockPhotoConfigured(),
      stockPhotoSources: isStockPhotoConfigured()
        ? getStockPhotoService().getAvailableSources()
        : [],
    }
  }),

  // ===========================================================================
  // UPLOAD
  // ===========================================================================

  /**
   * Get presigned URL for direct browser upload
   * Client uploads directly to R2/S3, bypassing the server
   */
  getUploadUrl: publicProcedure
    .input(
      z.object({
        websiteId: z.string(),
        filename: z.string(),
        mimeType: z.string(),
        folder: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      if (!isStorageConfigured()) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Storage not configured. Set R2 environment variables.',
        })
      }

      const storageService = getStorageService()
      const folder = input.folder || getFolderPath(input.websiteId)

      const result = await storageService.getPresignedUploadUrl({
        filename: input.filename,
        mimeType: input.mimeType,
        folder,
      })

      return {
        uploadUrl: result.uploadUrl,
        key: result.key,
        publicUrl: result.publicUrl,
      }
    }),

  /**
   * Upload an image from an external URL to our CDN
   */
  uploadFromUrl: publicProcedure
    .input(
      z.object({
        websiteId: z.string(),
        sourceUrl: z.string().url(),
        filename: z.string(),
        folder: z.string().optional(),
        convertToWebp: z.boolean().default(true),
      })
    )
    .mutation(async ({ input }) => {
      if (!isStorageConfigured()) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Storage not configured. Set R2 environment variables.',
        })
      }

      const storageService = getStorageService()
      const folder = input.folder || getFolderPath(input.websiteId, 'imported')

      const result = await storageService.uploadFromUrl({
        sourceUrl: input.sourceUrl,
        filename: input.filename,
        folder,
        convertToWebp: input.convertToWebp,
      })

      return {
        url: result.url,
        key: result.key,
        size: result.size,
        mimeType: result.mimeType,
      }
    }),

  // ===========================================================================
  // AI IMAGE GENERATION
  // ===========================================================================

  /**
   * Generate an AI image using Google Gemini/Imagen
   */
  generateImage: publicProcedure
    .input(
      z.object({
        websiteId: z.string(),
        prompt: z.string().min(10).max(4000),
        aspectRatio: z.enum(['1:1', '16:9', '9:16', '4:3', '3:4']).default('16:9'),
        numberOfImages: z.number().int().min(1).max(4).default(1),
      })
    )
    .mutation(async ({ input }) => {
      if (!isImageGenerationConfigured()) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Image generation not configured. Set GOOGLE_API_KEY.',
        })
      }

      if (!isStorageConfigured()) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Storage not configured. Set R2 environment variables.',
        })
      }

      const imageGenService = getImageGenerationService()
      const storageService = getStorageService()

      // Generate image with Gemini/Imagen
      const result = await imageGenService.generate({
        prompt: input.prompt,
        aspectRatio: input.aspectRatio,
        numberOfImages: input.numberOfImages,
      })

      if (!result.success || !result.images || result.images.length === 0) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: result.error || 'Failed to generate image',
        })
      }

      // Upload all generated images to our CDN
      const uploadedImages = await Promise.all(
        result.images.map(async (image, index) => {
          const suffix = result.images!.length > 1 ? `-${index + 1}` : ''
          const filename = `${slugify(input.prompt.slice(0, 40))}${suffix}.png`
          const folder = getFolderPath(input.websiteId, 'ai-generated')

          const uploaded = await storageService.upload({
            buffer: image.buffer,
            filename,
            mimeType: image.mimeType,
            folder,
          })

          return {
            url: uploaded.url,
            key: uploaded.key,
            size: uploaded.size,
          }
        })
      )

      return {
        images: uploadedImages,
        originalPrompt: input.prompt,
        aspectRatio: input.aspectRatio,
      }
    }),

  // ===========================================================================
  // STOCK PHOTOS
  // ===========================================================================

  /**
   * Search stock photos from Unsplash/Pexels
   */
  searchStock: publicProcedure
    .input(
      z.object({
        query: z.string().min(2),
        orientation: z.enum(['landscape', 'portrait', 'square']).optional(),
        source: z.enum(['unsplash', 'pexels', 'all']).default('all'),
        count: z.number().int().min(1).max(30).default(10),
      })
    )
    .query(async ({ input }) => {
      if (!isStockPhotoConfigured()) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Stock photo APIs not configured. Set UNSPLASH_ACCESS_KEY or PEXELS_API_KEY.',
        })
      }

      const stockService = getStockPhotoService()

      // Search based on source preference
      if (input.source === 'unsplash') {
        return stockService.searchUnsplash({
          query: input.query,
          orientation: input.orientation,
          count: input.count,
        })
      } else if (input.source === 'pexels') {
        return stockService.searchPexels({
          query: input.query,
          orientation: input.orientation,
          count: input.count,
        })
      } else {
        return stockService.search({
          query: input.query,
          orientation: input.orientation,
          count: input.count,
        })
      }
    }),

  /**
   * Search for travel-specific photos
   */
  searchTravelPhotos: publicProcedure
    .input(
      z.object({
        location: z.string(),
        type: z.enum(['landscape', 'landmark', 'food', 'culture', 'people', 'hotel', 'beach']).optional(),
        orientation: z.enum(['landscape', 'portrait', 'square']).optional(),
        count: z.number().int().min(1).max(30).default(10),
      })
    )
    .query(async ({ input }) => {
      if (!isStockPhotoConfigured()) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Stock photo APIs not configured.',
        })
      }

      const stockService = getStockPhotoService()

      return stockService.searchTravel(input.location, {
        type: input.type,
        orientation: input.orientation,
        count: input.count,
      })
    }),

  /**
   * Select and upload a stock photo to our CDN
   */
  selectStockPhoto: publicProcedure
    .input(
      z.object({
        websiteId: z.string(),
        photoId: z.string(),
        source: z.enum(['unsplash', 'pexels']),
        altText: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      if (!isStockPhotoConfigured()) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Stock photo APIs not configured.',
        })
      }

      if (!isStorageConfigured()) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Storage not configured.',
        })
      }

      const stockService = getStockPhotoService()
      const storageService = getStorageService()

      // Download the photo (triggers attribution tracking)
      const downloadResult = await stockService.download(input.photoId, input.source)

      if (!downloadResult.success || !downloadResult.buffer) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: downloadResult.error || 'Failed to download photo',
        })
      }

      // Upload to our CDN
      const filename = `${input.photoId}.webp`
      const folder = getFolderPath(input.websiteId, `stock/${input.source}`)

      const uploaded = await storageService.upload({
        buffer: downloadResult.buffer,
        filename,
        mimeType: 'image/webp',
        folder,
      })

      return {
        url: uploaded.url,
        key: uploaded.key,
        size: uploaded.size,
        attribution: downloadResult.attribution,
        altText: input.altText,
        source: input.source,
      }
    }),

  // ===========================================================================
  // DELETE
  // ===========================================================================

  /**
   * Delete a file from storage
   */
  delete: publicProcedure
    .input(
      z.object({
        key: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      if (!isStorageConfigured()) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Storage not configured.',
        })
      }

      const storageService = getStorageService()
      await storageService.delete(input.key)

      return { success: true }
    }),

  // ===========================================================================
  // VARIANTS (optional image processing)
  // ===========================================================================

  /**
   * Generate image variants (different sizes) for responsive images
   */
  generateVariants: publicProcedure
    .input(
      z.object({
        websiteId: z.string(),
        sourceUrl: z.string().url(),
        baseFilename: z.string(),
        folder: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      if (!isStorageConfigured()) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Storage not configured.',
        })
      }

      const storageService = getStorageService()

      // Download the source image
      const response = await fetch(input.sourceUrl)
      if (!response.ok) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Failed to download source image',
        })
      }

      const sourceBuffer = Buffer.from(await response.arrayBuffer())
      const folder = input.folder || getFolderPath(input.websiteId, 'variants')

      const variants = await storageService.generateVariants({
        sourceBuffer,
        baseFilename: input.baseFilename,
        folder,
      })

      return variants
    }),
})
