/**
 * WriterAgent Media Tool Handlers
 * Implementations for image generation and stock photo operations
 */

import { ToolHandler, ToolResult, toolSuccess, toolError, ToolContext } from '../base/tools'

// ============================================================================
// Service Imports (lazy loaded to avoid initialization issues)
// ============================================================================

async function getStorageService() {
  const { getStorageService } = await import('@swarm-press/backend/src/services/storage.service')
  return getStorageService()
}

async function getImageGenerationService() {
  const { getImageGenerationService } = await import('@swarm-press/backend/src/services/image-generation.service')
  return getImageGenerationService()
}

async function getStockPhotoService() {
  const { getStockPhotoService } = await import('@swarm-press/backend/src/services/stock-photo.service')
  return getStockPhotoService()
}

// ============================================================================
// Type Definitions
// ============================================================================

interface GenerateImageInput {
  prompt: string
  purpose: 'hero' | 'gallery' | 'thumbnail' | 'illustration'
  aspectRatio?: 'landscape' | 'portrait' | 'square'
}

interface SearchStockPhotosInput {
  query: string
  orientation?: 'landscape' | 'portrait' | 'square'
  count?: number
}

interface SelectStockPhotoInput {
  photoId: string
  source: 'unsplash' | 'pexels'
  altText: string
}

interface UploadImageFromUrlInput {
  sourceUrl: string
  filename: string
  folder?: string
}

// ============================================================================
// Helper Functions
// ============================================================================

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
 * Get folder path based on context
 */
function getFolderPath(context: ToolContext, subfolder?: string): string {
  const year = new Date().getFullYear()
  const month = String(new Date().getMonth() + 1).padStart(2, '0')

  // Use website ID if available, otherwise use 'shared'
  const websiteFolder = context.websiteId || 'shared'

  if (subfolder) {
    return `${websiteFolder}/images/${subfolder}`
  }

  return `${websiteFolder}/images/${year}/${month}`
}

// ============================================================================
// Tool Handlers
// ============================================================================

/**
 * Generate image - create AI image with Google Gemini/Imagen and upload to CDN
 */
export const generateImageHandler: ToolHandler<GenerateImageInput> = async (
  input,
  context
): Promise<ToolResult> => {
  try {
    console.log(`[MediaHandler] generate_image called:`, {
      prompt: input.prompt.slice(0, 100),
      purpose: input.purpose,
      aspectRatio: input.aspectRatio,
    })

    const imageGenService = await getImageGenerationService()
    const storageService = await getStorageService()

    // Check if image generation is configured
    if (!imageGenService.isConfigured()) {
      return toolError(
        'Image generation not configured. Set GOOGLE_API_KEY environment variable.'
      )
    }

    // Map aspect ratio to Imagen format
    type ImageAspectRatio = '1:1' | '16:9' | '9:16' | '4:3' | '3:4'
    const aspectRatioMap: Record<string, ImageAspectRatio> = {
      landscape: '16:9',
      portrait: '9:16',
      square: '1:1',
    }
    const aspectRatio = aspectRatioMap[input.aspectRatio || 'landscape']

    // Generate image with Gemini/Imagen
    const result = await imageGenService.generate({
      prompt: input.prompt,
      aspectRatio,
      numberOfImages: 1,
    })

    if (!result.success || !result.images || result.images.length === 0) {
      return toolError(result.error || 'Failed to generate image')
    }

    console.log(`[MediaHandler] Image generated, uploading to CDN...`)

    // Get the first generated image (already a buffer)
    const generatedImage = result.images[0]
    if (!generatedImage) {
      return toolError('No image generated')
    }

    // Upload to R2/S3
    const filename = `${slugify(input.prompt.slice(0, 40))}.png`
    const folder = getFolderPath(context, 'ai-generated')

    const uploaded = await storageService.upload({
      buffer: generatedImage.buffer,
      filename,
      mimeType: generatedImage.mimeType,
      folder,
    })

    console.log(`[MediaHandler] Image uploaded to: ${uploaded.url}`)

    return toolSuccess({
      url: uploaded.url,
      altText: input.prompt,
      source: 'ai-generated',
      key: uploaded.key,
      size: uploaded.size,
    })
  } catch (error) {
    console.error('[MediaHandler] generate_image error:', error)
    return toolError(error instanceof Error ? error.message : 'Failed to generate image')
  }
}

/**
 * Search stock photos - query Unsplash/Pexels
 */
export const searchStockPhotosHandler: ToolHandler<SearchStockPhotosInput> = async (
  input,
  _context
): Promise<ToolResult> => {
  try {
    console.log(`[MediaHandler] search_stock_photos called:`, {
      query: input.query,
      orientation: input.orientation,
      count: input.count,
    })

    const stockService = await getStockPhotoService()
    const sources = stockService.getAvailableSources()

    if (sources.length === 0) {
      return toolError(
        'No stock photo services configured. Set UNSPLASH_ACCESS_KEY or PEXELS_API_KEY.'
      )
    }

    const result = await stockService.search({
      query: input.query,
      orientation: input.orientation,
      count: input.count || 5,
    })

    if (!result.success) {
      return toolError(result.error || 'Failed to search photos')
    }

    console.log(`[MediaHandler] Found ${result.photos.length} photos`)

    return toolSuccess({
      photos: result.photos.map(photo => ({
        id: photo.id,
        previewUrl: photo.previewUrl,
        photographer: photo.photographer,
        photographerUrl: photo.photographerUrl,
        source: photo.source,
        description: photo.description,
        attribution: photo.attribution,
        width: photo.width,
        height: photo.height,
      })),
      total: result.total,
      availableSources: sources,
    })
  } catch (error) {
    console.error('[MediaHandler] search_stock_photos error:', error)
    return toolError(error instanceof Error ? error.message : 'Failed to search photos')
  }
}

/**
 * Select stock photo - download and upload to CDN
 */
export const selectStockPhotoHandler: ToolHandler<SelectStockPhotoInput> = async (
  input,
  context
): Promise<ToolResult> => {
  try {
    console.log(`[MediaHandler] select_stock_photo called:`, {
      photoId: input.photoId,
      source: input.source,
      altText: input.altText,
    })

    const stockService = await getStockPhotoService()
    const storageService = await getStorageService()

    // Download the photo (triggers attribution tracking for Unsplash)
    const downloadResult = await stockService.download(input.photoId, input.source)

    if (!downloadResult.success || !downloadResult.buffer) {
      return toolError(downloadResult.error || 'Failed to download photo')
    }

    console.log(`[MediaHandler] Photo downloaded, uploading to CDN...`)

    // Upload to R2/S3
    const filename = `${input.photoId}.webp`
    const folder = getFolderPath(context, `stock/${input.source}`)

    const uploaded = await storageService.upload({
      buffer: downloadResult.buffer,
      filename,
      mimeType: 'image/webp',
      folder,
    })

    console.log(`[MediaHandler] Photo uploaded to: ${uploaded.url}`)

    return toolSuccess({
      url: uploaded.url,
      altText: input.altText,
      attribution: downloadResult.attribution,
      source: input.source,
      key: uploaded.key,
      size: uploaded.size,
    })
  } catch (error) {
    console.error('[MediaHandler] select_stock_photo error:', error)
    return toolError(error instanceof Error ? error.message : 'Failed to select photo')
  }
}

/**
 * Upload image from URL - import external image to CDN
 */
export const uploadImageFromUrlHandler: ToolHandler<UploadImageFromUrlInput> = async (
  input,
  context
): Promise<ToolResult> => {
  try {
    console.log(`[MediaHandler] upload_image_from_url called:`, {
      sourceUrl: input.sourceUrl.slice(0, 100),
      filename: input.filename,
      folder: input.folder,
    })

    const storageService = await getStorageService()

    // Upload from URL (service handles download and conversion)
    const folder = input.folder || getFolderPath(context, 'imported')

    const uploaded = await storageService.uploadFromUrl({
      sourceUrl: input.sourceUrl,
      filename: input.filename,
      folder,
      convertToWebp: true,
    })

    console.log(`[MediaHandler] Image uploaded to: ${uploaded.url}`)

    return toolSuccess({
      url: uploaded.url,
      key: uploaded.key,
      size: uploaded.size,
      mimeType: uploaded.mimeType,
    })
  } catch (error) {
    console.error('[MediaHandler] upload_image_from_url error:', error)
    return toolError(error instanceof Error ? error.message : 'Failed to upload image')
  }
}

// ============================================================================
// Handler Map Export
// ============================================================================

/**
 * Map of media tool names to their handlers
 */
export const mediaHandlers: Record<string, ToolHandler<any>> = {
  generate_image: generateImageHandler,
  search_stock_photos: searchStockPhotosHandler,
  select_stock_photo: selectStockPhotoHandler,
  upload_image_from_url: uploadImageFromUrlHandler,
}
