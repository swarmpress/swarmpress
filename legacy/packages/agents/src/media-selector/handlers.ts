/**
 * MediaSelectorAgent Tool Handlers
 * Implementations that query media-index.json and validate media relevance
 */

import { ToolHandler, ToolResult, toolSuccess, toolError } from '../base/tools'
import { getBlockMetadata, validateMediaForBlock } from '@swarm-press/shared'
import * as fs from 'fs/promises'
import * as path from 'path'

// ============================================================================
// Types
// ============================================================================

interface MediaImage {
  id: string
  url: string
  tags: {
    village: string
    category: string
    subcategory?: string
    season?: string
    timeOfDay?: string
    mood?: string
  }
  license?: string
  photographer?: string
  dimensions?: {
    width: number
    height: number
  }
  usedIn?: string[]
}

interface MediaIndex {
  $schema: string
  version: string
  lastUpdated: string
  images: MediaImage[]
}

// ============================================================================
// Media Index Access
// ============================================================================

let cachedMediaIndex: MediaIndex | null = null
let cacheTimestamp: number = 0
const CACHE_TTL = 60000 // 1 minute cache

async function getMediaIndex(contentRepoPath?: string): Promise<MediaIndex> {
  const now = Date.now()
  if (cachedMediaIndex && (now - cacheTimestamp) < CACHE_TTL) {
    return cachedMediaIndex
  }

  // Try to find content repo path
  const basePath = contentRepoPath || process.env.CONTENT_REPO_PATH || path.join(process.cwd(), 'cinqueterre.travel')
  const mediaIndexPath = path.join(basePath, 'content', 'config', 'media-index.json')

  try {
    const content = await fs.readFile(mediaIndexPath, 'utf-8')
    cachedMediaIndex = JSON.parse(content) as MediaIndex
    cacheTimestamp = now
    return cachedMediaIndex
  } catch (error) {
    console.error(`[MediaSelector] Failed to read media index from ${mediaIndexPath}:`, error)
    // Return empty index on error
    return {
      $schema: './media-schema.json',
      version: '1.0.0',
      lastUpdated: new Date().toISOString(),
      images: [],
    }
  }
}

function clearMediaIndexCache(): void {
  cachedMediaIndex = null
  cacheTimestamp = 0
}

// ============================================================================
// Helper Functions
// ============================================================================

function matchesVillage(image: MediaImage, village: string, entityMatch: string): boolean {
  if (entityMatch === 'none') return true
  if (entityMatch === 'category') return true // Category-only matching doesn't check village

  // Strict matching
  if (image.tags.village === village) return true
  if (image.tags.village === 'region') return true // Region images can be used anywhere
  return false
}

function matchesCategory(image: MediaImage, categories: string[]): boolean {
  if (!categories || categories.length === 0) return true
  return categories.includes(image.tags.category)
}

function matchesAspectRatio(image: MediaImage, aspectRatio?: string): boolean {
  if (!aspectRatio || aspectRatio === 'any') return true
  if (!image.dimensions) return true // Can't verify, assume ok

  const { width, height } = image.dimensions
  const ratio = width / height

  switch (aspectRatio) {
    case 'landscape':
      return ratio > 1.2
    case 'portrait':
      return ratio < 0.8
    case 'square':
      return ratio >= 0.8 && ratio <= 1.2
    case 'video':
      return ratio >= 1.7 && ratio <= 1.8 // ~16:9
    default:
      return true
  }
}

function scoreImage(image: MediaImage, preferences: { mood?: string; categories?: string[] }): number {
  let score = 0

  // Mood match bonus
  if (preferences.mood && image.tags.mood === preferences.mood) {
    score += 10
  }

  // Category exact match bonus
  if (preferences.categories && preferences.categories[0] === image.tags.category) {
    score += 5
  }

  // Has dimensions (higher quality metadata)
  if (image.dimensions) {
    score += 2
  }

  // Has photographer attribution
  if (image.photographer) {
    score += 1
  }

  return score
}

// ============================================================================
// Tool Handlers
// ============================================================================

/**
 * Find matching images
 */
export const findMatchingImagesHandler: ToolHandler<{
  village: string
  categories?: string[]
  entity_match: string
  aspect_ratio?: string
  mood?: string
  limit?: number
  exclude_ids?: string[]
}> = async (input, _context): Promise<ToolResult> => {
  try {
    const mediaIndex = await getMediaIndex()
    const limit = input.limit || 10

    // Filter images
    let matches = mediaIndex.images.filter((image) => {
      // Village matching
      if (!matchesVillage(image, input.village, input.entity_match)) {
        return false
      }

      // Category matching
      if (input.categories && !matchesCategory(image, input.categories)) {
        return false
      }

      // Aspect ratio matching
      if (!matchesAspectRatio(image, input.aspect_ratio)) {
        return false
      }

      // Exclusion list
      if (input.exclude_ids && input.exclude_ids.includes(image.id)) {
        return false
      }

      return true
    })

    // Score and sort
    matches = matches
      .map((image) => ({
        ...image,
        _score: scoreImage(image, { mood: input.mood, categories: input.categories }),
      }))
      .sort((a, b) => b._score - a._score)
      .slice(0, limit)
      .map(({ _score, ...image }) => image)

    return toolSuccess({
      count: matches.length,
      total_available: mediaIndex.images.length,
      query: {
        village: input.village,
        categories: input.categories,
        entity_match: input.entity_match,
        aspect_ratio: input.aspect_ratio,
      },
      images: matches,
      message: matches.length > 0
        ? `Found ${matches.length} matching images`
        : `No images found matching criteria. Consider using suggest_missing_media to request new imagery.`,
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to search media index')
  }
}

/**
 * Validate image relevance
 */
export const validateImageRelevanceHandler: ToolHandler<{
  image_id: string
  block_type: string
  component_village: string
  component_category?: string
}> = async (input, _context): Promise<ToolResult> => {
  try {
    const mediaIndex = await getMediaIndex()
    const image = mediaIndex.images.find((img) => img.id === input.image_id)

    if (!image) {
      return toolError(`Image not found in media index: ${input.image_id}`)
    }

    // Get block metadata for validation rules
    const blockMetadata = getBlockMetadata(input.block_type)
    const warnings: string[] = []

    // Use the shared validation function
    const validation = validateMediaForBlock(
      input.block_type,
      image.tags.village,
      input.component_village,
      image.tags.category
    )

    // Additional warnings
    if (image.tags.village !== input.component_village && image.tags.village !== 'region') {
      if (blockMetadata?.mediaRequirements?.entityMatch === 'category') {
        warnings.push(
          `Image village "${image.tags.village}" differs from component village "${input.component_village}" (allowed for category-only matching)`
        )
      }
    }

    // Check if image is already heavily used
    if (image.usedIn && image.usedIn.length > 5) {
      warnings.push(`Image is used in ${image.usedIn.length} other places - consider variety`)
    }

    return toolSuccess({
      image_id: input.image_id,
      block_type: input.block_type,
      component_village: input.component_village,
      valid: validation.valid,
      reason: validation.reason,
      warnings,
      image_tags: image.tags,
      block_requirements: blockMetadata?.mediaRequirements || null,
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to validate image')
  }
}

/**
 * Suggest missing media
 */
export const suggestMissingMediaHandler: ToolHandler<{
  block_type: string
  village: string
  categories: string[]
  aspect_ratio?: string
  context?: string
  urgency?: string
}> = async (input, _context): Promise<ToolResult> => {
  try {
    const blockMetadata = getBlockMetadata(input.block_type)
    const mediaIndex = await getMediaIndex()

    // Count existing images for this village/category combo
    const existingCount = mediaIndex.images.filter((img) =>
      img.tags.village === input.village &&
      input.categories.includes(img.tags.category)
    ).length

    const requirement = {
      id: `NEEDS_MEDIA_${Date.now()}`,
      status: 'pending',
      block_type: input.block_type,
      required_tags: {
        village: input.village,
        categories: input.categories,
        aspect_ratio: input.aspect_ratio || blockMetadata?.mediaRequirements?.aspectRatio || 'landscape',
      },
      context: input.context,
      urgency: input.urgency || 'medium',
      created_at: new Date().toISOString(),
      existing_similar_count: existingCount,
      block_requirements: blockMetadata?.mediaRequirements || null,
      suggested_sources: [
        'Unsplash (search: Cinque Terre, ' + input.village + ')',
        'Getty Images (editorial license)',
        'Local photographer commission',
      ],
    }

    return toolSuccess({
      requirement,
      message: `Media requirement created. ${existingCount} similar images exist but don't match all criteria.`,
      action_needed: 'Human or media agent should source imagery matching these specifications.',
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to create media requirement')
  }
}

/**
 * Get media index stats
 */
export const getMediaIndexStatsHandler: ToolHandler<{
  village?: string
}> = async (input, _context): Promise<ToolResult> => {
  try {
    const mediaIndex = await getMediaIndex()
    let images = mediaIndex.images

    // Filter by village if specified
    if (input.village) {
      images = images.filter((img) =>
        img.tags.village === input.village || img.tags.village === 'region'
      )
    }

    // Aggregate stats
    const byVillage: Record<string, number> = {}
    const byCategory: Record<string, number> = {}
    const byAspectRatio: Record<string, number> = { landscape: 0, portrait: 0, square: 0, unknown: 0 }

    for (const image of images) {
      // Count by village
      byVillage[image.tags.village] = (byVillage[image.tags.village] || 0) + 1

      // Count by category
      byCategory[image.tags.category] = (byCategory[image.tags.category] || 0) + 1

      // Count by aspect ratio
      if (image.dimensions) {
        const ratio = image.dimensions.width / image.dimensions.height
        if (ratio > 1.2) byAspectRatio.landscape++
        else if (ratio < 0.8) byAspectRatio.portrait++
        else byAspectRatio.square++
      } else {
        byAspectRatio.unknown++
      }
    }

    return toolSuccess({
      total_images: images.length,
      filter_applied: input.village ? `village=${input.village}` : 'none',
      by_village: byVillage,
      by_category: byCategory,
      by_aspect_ratio: byAspectRatio,
      last_updated: mediaIndex.lastUpdated,
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to get media stats')
  }
}

/**
 * Batch validate media
 */
export const batchValidateMediaHandler: ToolHandler<{
  content: string
  page_village: string
}> = async (input, _context): Promise<ToolResult> => {
  try {
    const mediaIndex = await getMediaIndex()
    let content: unknown

    try {
      content = JSON.parse(input.content)
    } catch {
      return toolError('Invalid JSON content provided')
    }

    // Extract all image references from content
    const imageRefs: Array<{ image_id?: string; url?: string; block_type?: string; path: string }> = []

    function extractImages(obj: unknown, path: string = ''): void {
      if (!obj || typeof obj !== 'object') return

      if (Array.isArray(obj)) {
        obj.forEach((item, idx) => extractImages(item, `${path}[${idx}]`))
        return
      }

      const record = obj as Record<string, unknown>

      // Check for image-like properties
      if (record.type && typeof record.type === 'string') {
        const type = record.type
        if (record.image && typeof record.image === 'string') {
          imageRefs.push({ url: record.image as string, block_type: type, path })
        }
        if (record.src && typeof record.src === 'string') {
          imageRefs.push({ url: record.src as string, block_type: type, path })
        }
        if (record.backgroundImage && typeof record.backgroundImage === 'string') {
          imageRefs.push({ url: record.backgroundImage as string, block_type: type, path })
        }
      }

      // Recurse into nested objects
      for (const [key, value] of Object.entries(record)) {
        if (typeof value === 'object' && value !== null) {
          extractImages(value, path ? `${path}.${key}` : key)
        }
      }
    }

    extractImages(content)

    // Validate each image
    const results = {
      valid: [] as Array<{ url: string; path: string; block_type?: string }>,
      invalid: [] as Array<{ url: string; path: string; block_type?: string; reason: string }>,
      unknown: [] as Array<{ url: string; path: string; block_type?: string; reason: string }>,
    }

    for (const ref of imageRefs) {
      // Find image in index by URL
      const image = mediaIndex.images.find((img) => img.url === ref.url)

      if (!image) {
        results.unknown.push({
          url: ref.url || '',
          path: ref.path,
          block_type: ref.block_type,
          reason: 'Image not found in media index',
        })
        continue
      }

      // Validate using shared function
      const validation = validateMediaForBlock(
        ref.block_type || 'image',
        image.tags.village,
        input.page_village,
        image.tags.category
      )

      if (validation.valid) {
        results.valid.push({
          url: ref.url || '',
          path: ref.path,
          block_type: ref.block_type,
        })
      } else {
        results.invalid.push({
          url: ref.url || '',
          path: ref.path,
          block_type: ref.block_type,
          reason: validation.reason || 'Validation failed',
        })
      }
    }

    return toolSuccess({
      page_village: input.page_village,
      total_images: imageRefs.length,
      valid_count: results.valid.length,
      invalid_count: results.invalid.length,
      unknown_count: results.unknown.length,
      results,
      summary: results.invalid.length === 0 && results.unknown.length === 0
        ? 'All images validated successfully'
        : `Found ${results.invalid.length} invalid and ${results.unknown.length} untracked images`,
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to batch validate media')
  }
}

// ============================================================================
// Export Handler Map
// ============================================================================

export const mediaSelectorToolHandlers: Record<string, ToolHandler> = {
  find_matching_images: findMatchingImagesHandler,
  validate_image_relevance: validateImageRelevanceHandler,
  suggest_missing_media: suggestMissingMediaHandler,
  get_media_index_stats: getMediaIndexStatsHandler,
  batch_validate_media: batchValidateMediaHandler,
}

// Export cache control for testing
export { clearMediaIndexCache }
