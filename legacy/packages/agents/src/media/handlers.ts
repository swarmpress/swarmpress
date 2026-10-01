/**
 * MediaAgent Tool Handlers
 * Implementations for media generation, stock photos, and content integration
 */

import { ToolHandler, ToolResult, toolSuccess, toolError, ToolContext } from '../base/tools'

// Import core media handlers from writer (reuse the same implementations)
import {
  generateImageHandler,
  searchStockPhotosHandler,
  selectStockPhotoHandler,
  uploadImageFromUrlHandler,
} from '../writer/media-handlers'

// ============================================================================
// Service Imports (lazy loaded)
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

interface MediaGetContentInput {
  contentId: string
}

interface ImageAttachment {
  url: string
  placement: 'hero' | 'gallery' | 'inline' | 'thumbnail' | 'og_image'
  altText: string
  caption?: string
}

interface AttachMediaInput {
  contentId: string
  images: ImageAttachment[]
}

interface CreateThumbnailInput {
  sourceUrl: string
  size?: 'small' | 'medium' | 'large'
  aspectRatio?: 'square' | 'original' | '16:9' | '4:3'
}

interface BatchGenerateImagesInput {
  prompts: string[]
  purpose: 'hero' | 'gallery' | 'thumbnail' | 'illustration'
  aspectRatio?: 'landscape' | 'portrait' | 'square'
}

interface SearchTravelPhotosInput {
  location: string
  type?: 'landscape' | 'landmark' | 'food' | 'culture' | 'people' | 'hotel' | 'beach'
  orientation?: 'landscape' | 'portrait' | 'square'
  count?: number
}

// ============================================================================
// Helper Functions
// ============================================================================

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
}

function getFolderPath(context: ToolContext, subfolder?: string): string {
  const year = new Date().getFullYear()
  const month = String(new Date().getMonth() + 1).padStart(2, '0')
  const websiteFolder = context.websiteId || 'shared'

  if (subfolder) {
    return `${websiteFolder}/images/${subfolder}`
  }
  return `${websiteFolder}/images/${year}/${month}`
}

// ============================================================================
// Media-Specific Tool Handlers
// ============================================================================

/**
 * Get content handler - fetch a content item for media work
 */
export const mediaGetContentHandler: ToolHandler<MediaGetContentInput> = async (
  input,
  _context
): Promise<ToolResult> => {
  try {
    console.log(`[MediaHandler] media_get_content called for: ${input.contentId}`)

    // Use direct fetch to the API server
    const apiUrl = process.env.API_URL || 'http://localhost:3000'
    const response = await fetch(`${apiUrl}/api/trpc/content.get?input=${encodeURIComponent(JSON.stringify({ json: { id: input.contentId } }))}`)

    if (!response.ok) {
      return toolError(`Failed to fetch content: ${response.statusText}`)
    }

    const result = await response.json() as { result?: { data?: { json?: unknown } } }
    const content = result?.result?.data?.json as Record<string, unknown> | undefined

    if (!content) {
      return toolError(`Content item not found: ${input.contentId}`)
    }

    return toolSuccess({
      id: content.id,
      title: content.title,
      slug: content.slug,
      status: content.status,
      body: content.body,
      seoTitle: content.seo_title,
      seoDescription: content.seo_description,
      // Extract existing images from body if any
      existingImages: extractImagesFromBody(content.body),
    })
  } catch (error) {
    console.error('[MediaHandler] media_get_content error:', error)
    return toolError(error instanceof Error ? error.message : 'Failed to fetch content')
  }
}

/**
 * Extract image blocks from content body
 */
function extractImagesFromBody(body: unknown): Array<{ url: string; alt: string; placement: string }> {
  if (!Array.isArray(body)) return []

  const images: Array<{ url: string; alt: string; placement: string }> = []

  for (const block of body) {
    if (block && typeof block === 'object') {
      const b = block as Record<string, unknown>
      if (b.type === 'image' && typeof b.url === 'string') {
        images.push({
          url: b.url,
          alt: (b.alt as string) || '',
          placement: 'inline',
        })
      } else if (b.type === 'hero' && typeof b.backgroundImage === 'string') {
        images.push({
          url: b.backgroundImage,
          alt: (b.title as string) || 'Hero image',
          placement: 'hero',
        })
      } else if (b.type === 'gallery' && Array.isArray(b.images)) {
        for (const img of b.images) {
          if (img && typeof img === 'object' && typeof (img as Record<string, unknown>).url === 'string') {
            images.push({
              url: (img as Record<string, unknown>).url as string,
              alt: ((img as Record<string, unknown>).alt as string) || '',
              placement: 'gallery',
            })
          }
        }
      }
    }
  }

  return images
}

/**
 * Attach media handler - add images to a content item
 */
export const attachMediaHandler: ToolHandler<AttachMediaInput> = async (
  input,
  _context
): Promise<ToolResult> => {
  try {
    console.log(`[MediaHandler] attach_media called for content: ${input.contentId}`)
    console.log(`[MediaHandler] Attaching ${input.images.length} images`)

    // Use direct fetch to the API server
    const apiUrl = process.env.API_URL || 'http://localhost:3000'

    // First, fetch the current content
    const getResponse = await fetch(`${apiUrl}/api/trpc/content.get?input=${encodeURIComponent(JSON.stringify({ json: { id: input.contentId } }))}`)

    if (!getResponse.ok) {
      return toolError(`Failed to fetch content: ${getResponse.statusText}`)
    }

    const getResult = await getResponse.json() as { result?: { data?: { json?: unknown } } }
    const content = getResult?.result?.data?.json as Record<string, unknown> | undefined

    if (!content) {
      return toolError(`Content item not found: ${input.contentId}`)
    }

    // Get current body as array
    const body = Array.isArray(content.body) ? [...(content.body as unknown[])] : []

    // Process each image attachment
    for (const image of input.images) {
      switch (image.placement) {
        case 'hero': {
          // Find existing hero block or add new one at the start
          const heroIndex = body.findIndex(
            (b) => b && typeof b === 'object' && (b as Record<string, unknown>).type === 'hero'
          )
          const heroBlock = {
            type: 'hero',
            backgroundImage: image.url,
            title: content.title,
            altText: image.altText,
          }
          if (heroIndex >= 0) {
            body[heroIndex] = { ...(body[heroIndex] as object), ...heroBlock }
          } else {
            body.unshift(heroBlock)
          }
          break
        }

        case 'gallery': {
          // Find existing gallery block or create new one
          const galleryIndex = body.findIndex(
            (b) => b && typeof b === 'object' && (b as Record<string, unknown>).type === 'gallery'
          )
          if (galleryIndex >= 0) {
            const gallery = body[galleryIndex] as Record<string, unknown>
            const images = Array.isArray(gallery.images) ? gallery.images : []
            images.push({ url: image.url, alt: image.altText, caption: image.caption })
            body[galleryIndex] = { ...gallery, images }
          } else {
            body.push({
              type: 'gallery',
              images: [{ url: image.url, alt: image.altText, caption: image.caption }],
            })
          }
          break
        }

        case 'inline': {
          // Add image block at the end
          body.push({
            type: 'image',
            url: image.url,
            alt: image.altText,
            caption: image.caption,
          })
          break
        }

        case 'thumbnail':
        case 'og_image': {
          // These are stored in metadata, not body
          console.log(`[MediaHandler] ${image.placement} would be stored in metadata`)
          break
        }
      }
    }

    // Update the content with new body via mutation
    const updateResponse = await fetch(`${apiUrl}/api/trpc/content.update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ json: { id: input.contentId, body } }),
    })

    if (!updateResponse.ok) {
      return toolError(`Failed to update content: ${updateResponse.statusText}`)
    }

    return toolSuccess({
      contentId: input.contentId,
      attachedImages: input.images.length,
      message: `Successfully attached ${input.images.length} image(s) to content`,
    })
  } catch (error) {
    console.error('[MediaHandler] attach_media error:', error)
    return toolError(error instanceof Error ? error.message : 'Failed to attach media')
  }
}

/**
 * Create thumbnail handler - generate a thumbnail version
 */
export const createThumbnailHandler: ToolHandler<CreateThumbnailInput> = async (
  input,
  context
): Promise<ToolResult> => {
  try {
    console.log(`[MediaHandler] create_thumbnail called:`, {
      sourceUrl: input.sourceUrl.slice(0, 100),
      size: input.size,
      aspectRatio: input.aspectRatio,
    })

    const storageService = await getStorageService()

    // Size mappings
    const sizeMap: Record<string, number> = {
      small: 150,
      medium: 300,
      large: 600,
    }
    const targetSize = sizeMap[input.size || 'medium']

    // Generate thumbnail using storage service variants
    const folder = getFolderPath(context, 'thumbnails')

    // Download source image
    const sourceResponse = await fetch(input.sourceUrl)
    if (!sourceResponse.ok) {
      return toolError(`Failed to download source image: ${sourceResponse.statusText}`)
    }
    const sourceBuffer = Buffer.from(await sourceResponse.arrayBuffer())

    const variants = await storageService.generateVariants({
      sourceBuffer,
      baseFilename: `thumb-${Date.now()}`,
      folder,
    })

    // Return the appropriate variant based on size
    const thumbnailUrl =
      input.size === 'small'
        ? variants.thumbnail
        : input.size === 'large'
          ? variants.large
          : variants.medium

    return toolSuccess({
      originalUrl: input.sourceUrl,
      thumbnailUrl,
      size: input.size || 'medium',
      dimensions: targetSize,
    })
  } catch (error) {
    console.error('[MediaHandler] create_thumbnail error:', error)
    return toolError(error instanceof Error ? error.message : 'Failed to create thumbnail')
  }
}

/**
 * Batch generate images handler - create multiple AI images
 */
export const batchGenerateImagesHandler: ToolHandler<BatchGenerateImagesInput> = async (
  input,
  context
): Promise<ToolResult> => {
  try {
    console.log(`[MediaHandler] batch_generate_images called:`, {
      promptCount: input.prompts.length,
      purpose: input.purpose,
      aspectRatio: input.aspectRatio,
    })

    const imageGenService = await getImageGenerationService()
    const storageService = await getStorageService()

    if (!imageGenService.isConfigured()) {
      return toolError('Image generation not configured. Set GOOGLE_API_KEY.')
    }

    // Map aspect ratio
    type ImageAspectRatio = '1:1' | '16:9' | '9:16' | '4:3' | '3:4'
    const aspectRatioMap: Record<string, ImageAspectRatio> = {
      landscape: '16:9',
      portrait: '9:16',
      square: '1:1',
    }
    const aspectRatio = aspectRatioMap[input.aspectRatio || 'landscape']

    const results: Array<{ url: string; prompt: string; error?: string }> = []
    const folder = getFolderPath(context, 'ai-generated/batch')

    // Process each prompt
    for (const prompt of input.prompts) {
      try {
        const result = await imageGenService.generate({
          prompt,
          aspectRatio,
          numberOfImages: 1,
        })

        if (result.success && result.images && result.images.length > 0) {
          const image = result.images[0]
          if (image) {
            const uploaded = await storageService.upload({
              buffer: image.buffer,
              filename: `${slugify(prompt.slice(0, 40))}.png`,
              mimeType: image.mimeType,
              folder,
            })

            results.push({
              url: uploaded.url,
              prompt,
            })
          } else {
            results.push({
              url: '',
              prompt,
              error: 'No image generated',
            })
          }
        } else {
          results.push({
            url: '',
            prompt,
            error: result.error || 'Generation failed',
          })
        }
      } catch (err) {
        results.push({
          url: '',
          prompt,
          error: err instanceof Error ? err.message : 'Unknown error',
        })
      }
    }

    const successful = results.filter((r) => r.url)
    const failed = results.filter((r) => !r.url)

    return toolSuccess({
      images: results,
      totalRequested: input.prompts.length,
      successful: successful.length,
      failed: failed.length,
    })
  } catch (error) {
    console.error('[MediaHandler] batch_generate_images error:', error)
    return toolError(error instanceof Error ? error.message : 'Failed to batch generate images')
  }
}

/**
 * Search travel photos handler - specialized travel search
 */
export const searchTravelPhotosHandler: ToolHandler<SearchTravelPhotosInput> = async (
  input,
  _context
): Promise<ToolResult> => {
  try {
    console.log(`[MediaHandler] search_travel_photos called:`, {
      location: input.location,
      type: input.type,
      orientation: input.orientation,
      count: input.count,
    })

    const stockService = await getStockPhotoService()
    const sources = stockService.getAvailableSources()

    if (sources.length === 0) {
      return toolError('No stock photo services configured.')
    }

    // Build optimized travel search query
    let query = input.location

    if (input.type) {
      const typeKeywords: Record<string, string> = {
        landscape: 'scenery vista view',
        landmark: 'landmark monument famous',
        food: 'cuisine restaurant dish meal',
        culture: 'traditional local heritage',
        people: 'travelers tourists locals',
        hotel: 'hotel accommodation resort',
        beach: 'beach coast sea ocean',
      }
      query = `${input.location} ${typeKeywords[input.type] || input.type}`
    }

    // Add Italy/travel context for better results
    if (!query.toLowerCase().includes('italy')) {
      query = `${query} Italy travel`
    }

    const result = await stockService.search({
      query,
      orientation: input.orientation,
      count: input.count || 10,
    })

    if (!result.success) {
      return toolError(result.error || 'Failed to search photos')
    }

    return toolSuccess({
      photos: result.photos.map((photo) => ({
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
      searchQuery: query,
      location: input.location,
      type: input.type,
    })
  } catch (error) {
    console.error('[MediaHandler] search_travel_photos error:', error)
    return toolError(error instanceof Error ? error.message : 'Failed to search travel photos')
  }
}

// ============================================================================
// Content Integrity Audit Handlers
// ============================================================================

interface AuditImageUrlInput {
  url: string
  timeout?: number
}

interface ValidateImageContentInput {
  imageUrl: string
  expectedContext: string
  villageContext?: string
  categoryContext?: string
}

interface FixBrokenImageInput {
  contentPath: string
  jsonPath: string
  currentUrl?: string
  expectedContext: string
  villageContext?: string
  categoryContext?: string
}

interface AuditContentImagesInput {
  contentPath: string
  validateContent?: boolean
  concurrency?: number
}

/**
 * Audit image URL handler - check if an image is accessible
 */
export const auditImageUrlHandler: ToolHandler<AuditImageUrlInput> = async (
  input,
  _context
): Promise<ToolResult> => {
  try {
    console.log(`[MediaHandler] audit_image_url called: ${input.url.slice(0, 100)}...`)

    const { checkUrl, isImageContentType } = await import('@swarm-press/shared')
    const result = await checkUrl({ url: input.url, timeout: input.timeout || 5000 })

    return toolSuccess({
      url: input.url,
      accessible: result.accessible,
      statusCode: result.statusCode,
      isImage: isImageContentType(result.contentType),
      contentType: result.contentType,
      contentLength: result.contentLength,
      responseTimeMs: result.responseTimeMs,
      error: result.error,
      suggestedAction: result.accessible ? 'none' : 'replace',
    })
  } catch (error) {
    console.error('[MediaHandler] audit_image_url error:', error)
    return toolError(error instanceof Error ? error.message : 'Failed to audit image URL')
  }
}

/**
 * Validate image content handler - use vision to check if image matches context
 */
export const validateImageContentHandler: ToolHandler<ValidateImageContentInput> = async (
  input,
  _context
): Promise<ToolResult> => {
  try {
    console.log(`[MediaHandler] validate_image_content called:`, {
      imageUrl: input.imageUrl.slice(0, 100),
      expectedContext: input.expectedContext,
      villageContext: input.villageContext,
    })

    // Get Anthropic client
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const client = new Anthropic()

    const { validateImageContent } = await import('@swarm-press/shared')
    const result = await validateImageContent(
      {
        imageUrl: input.imageUrl,
        expectedContext: input.expectedContext,
        villageContext: input.villageContext,
        categoryContext: input.categoryContext,
      },
      client
    )

    return toolSuccess({
      imageUrl: input.imageUrl,
      isCorrect: result.isCorrect,
      confidence: result.confidence,
      actualContent: result.actualContent,
      locationMatch: result.locationMatch,
      categoryMatch: result.categoryMatch,
      suggestedAction: result.suggestedAction,
      issues: result.issues,
      reasoning: result.reasoning,
    })
  } catch (error) {
    console.error('[MediaHandler] validate_image_content error:', error)
    return toolError(error instanceof Error ? error.message : 'Failed to validate image content')
  }
}

/**
 * Fix broken image handler - find replacement and update content
 */
export const fixBrokenImageHandler: ToolHandler<FixBrokenImageInput> = async (
  input,
  context
): Promise<ToolResult> => {
  try {
    console.log(`[MediaHandler] fix_broken_image called:`, {
      contentPath: input.contentPath,
      jsonPath: input.jsonPath,
      expectedContext: input.expectedContext,
    })

    const stockService = await getStockPhotoService()
    const storageService = await getStorageService()
    const { readFile, writeFile } = await import('fs/promises')

    // Build search query
    let searchQuery = input.expectedContext
    if (input.villageContext) {
      searchQuery = `${input.villageContext} ${searchQuery}`
    }
    if (!searchQuery.toLowerCase().includes('cinque terre') && !searchQuery.toLowerCase().includes('italy')) {
      searchQuery = `${searchQuery} Cinque Terre Italy`
    }

    // Search for replacement
    console.log(`[MediaHandler] Searching for: ${searchQuery}`)
    const searchResult = await stockService.search({
      query: searchQuery,
      orientation: 'landscape',
      count: 5,
    })

    if (!searchResult.success || searchResult.photos.length === 0) {
      return toolSuccess({
        fixed: false,
        reason: 'NEEDS_MEDIA',
        searchQuery,
        message: `No suitable replacement found for: ${input.expectedContext}. Manual intervention required.`,
      })
    }

    // Select the best match (first result)
    const selectedPhoto = searchResult.photos[0]
    if (!selectedPhoto) {
      return toolSuccess({
        fixed: false,
        reason: 'NEEDS_MEDIA',
        searchQuery,
        message: 'Search returned empty results',
      })
    }

    // Download and upload to CDN
    console.log(`[MediaHandler] Downloading replacement from: ${selectedPhoto.source}`)
    const downloadResult = await stockService.download({
      photoId: selectedPhoto.id,
      source: selectedPhoto.source,
      size: 'large',
    })

    if (!downloadResult.success || !downloadResult.buffer) {
      return toolError('Failed to download replacement image')
    }

    // Upload to our CDN
    const folder = getFolderPath(context, 'replacements')
    const filename = `${slugify(input.expectedContext.slice(0, 30))}-${Date.now()}.jpg`

    const uploadResult = await storageService.upload({
      buffer: downloadResult.buffer,
      filename,
      mimeType: 'image/jpeg',
      folder,
    })

    // Update the content file
    const content = JSON.parse(await readFile(input.contentPath, 'utf-8'))

    // Navigate to the JSON path and update
    const pathParts = input.jsonPath.split(/[.\[\]]/).filter(Boolean)
    let current: any = content
    for (let i = 0; i < pathParts.length - 1; i++) {
      const part = pathParts[i]
      if (part) {
        current = current[isNaN(Number(part)) ? part : Number(part)]
      }
    }
    const lastPart = pathParts[pathParts.length - 1]
    if (lastPart) {
      const key = isNaN(Number(lastPart)) ? lastPart : Number(lastPart)
      current[key] = uploadResult.url
    }

    // Write updated content
    await writeFile(input.contentPath, JSON.stringify(content, null, 2), 'utf-8')

    return toolSuccess({
      fixed: true,
      contentPath: input.contentPath,
      jsonPath: input.jsonPath,
      oldUrl: input.currentUrl,
      newUrl: uploadResult.url,
      source: selectedPhoto.source,
      photographer: selectedPhoto.photographer,
      attribution: selectedPhoto.attribution,
    })
  } catch (error) {
    console.error('[MediaHandler] fix_broken_image error:', error)
    return toolError(error instanceof Error ? error.message : 'Failed to fix broken image')
  }
}

/**
 * Audit content images handler - scan all images in content
 */
export const auditContentImagesHandler: ToolHandler<AuditContentImagesInput> = async (
  input,
  _context
): Promise<ToolResult> => {
  try {
    console.log(`[MediaHandler] audit_content_images called:`, {
      contentPath: input.contentPath,
      validateContent: input.validateContent,
    })

    const { runContentAudit, filterIssuesByCategory } = await import('@swarm-press/shared')

    // Get Anthropic client if we need vision validation
    let anthropicClient
    if (input.validateContent) {
      const Anthropic = (await import('@anthropic-ai/sdk')).default
      anthropicClient = new Anthropic()
    }

    const auditResult = await runContentAudit({
      contentPath: input.contentPath,
      checks: ['images'],
      anthropicClient,
      options: {
        validateImageContent: input.validateContent || false,
        concurrency: input.concurrency || 5,
      },
    })

    const brokenImages = filterIssuesByCategory(auditResult.issues, 'broken_image')
    const wrongImages = filterIssuesByCategory(auditResult.issues, 'wrong_image')

    return toolSuccess({
      summary: {
        totalImages: auditResult.urlScanResult.urls.filter((u) => u.type === 'image').length,
        brokenImages: brokenImages.length,
        wrongImages: wrongImages.length,
        totalIssues: auditResult.summary.totalIssues,
      },
      issues: auditResult.issues.map((issue) => ({
        category: issue.category,
        severity: issue.severity,
        file: issue.relativePath,
        jsonPath: issue.jsonPath,
        url: issue.url,
        description: issue.description,
        suggestedFix: issue.suggestedFix,
        autoFixable: issue.autoFixable,
      })),
      filesScanned: auditResult.summary.totalFilesScanned,
      generatedAt: auditResult.generatedAt,
    })
  } catch (error) {
    console.error('[MediaHandler] audit_content_images error:', error)
    return toolError(error instanceof Error ? error.message : 'Failed to audit content images')
  }
}

// ============================================================================
// Handler Map Export
// ============================================================================

/**
 * Map of all media agent tool handlers
 */
export const mediaAgentHandlers: Record<string, ToolHandler<any>> = {
  // Core media handlers (from writer)
  generate_image: generateImageHandler,
  search_stock_photos: searchStockPhotosHandler,
  select_stock_photo: selectStockPhotoHandler,
  upload_image_from_url: uploadImageFromUrlHandler,
  // Media-specific handlers
  media_get_content: mediaGetContentHandler,
  attach_media: attachMediaHandler,
  create_thumbnail: createThumbnailHandler,
  batch_generate_images: batchGenerateImagesHandler,
  search_travel_photos: searchTravelPhotosHandler,
  // Content integrity audit handlers
  audit_image_url: auditImageUrlHandler,
  validate_image_content: validateImageContentHandler,
  fix_broken_image: fixBrokenImageHandler,
  audit_content_images: auditContentImagesHandler,
}
