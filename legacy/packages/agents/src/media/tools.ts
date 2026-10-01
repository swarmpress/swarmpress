/**
 * MediaAgent Tool Definitions
 * Tools for image generation, stock photos, and media management
 */

import {
  ToolDefinition,
  stringProp,
  numberProp,
  arrayProp,
} from '../base/tools'

// Import core media tools from writer (reuse the same implementations)
import {
  generateImageTool,
  searchStockPhotosTool,
  selectStockPhotoTool,
  uploadImageFromUrlTool,
} from '../writer/media-tools'

// ============================================================================
// Media-Specific Tool Definitions
// ============================================================================

/**
 * Get content for media - fetch a content item to understand media requirements
 * Named differently to avoid conflict with writer's get_content
 */
export const mediaGetContentTool: ToolDefinition = {
  name: 'media_get_content',
  description: `Fetch a content item to understand what images are needed.

Returns the content item including:
- title, slug, status
- body (JSON blocks showing where images are needed)
- existing images and their metadata
- brief description and requirements

Use this to understand the visual needs before searching or generating images.`,
  input_schema: {
    type: 'object',
    properties: {
      contentId: stringProp('The UUID of the content item to fetch'),
    },
    required: ['contentId'],
  },
}

/**
 * Attach media - add images to a content item
 */
export const attachMediaTool: ToolDefinition = {
  name: 'attach_media',
  description: `Attach one or more images to a content item.

This updates the content item's body to include the images in the appropriate
places. You can specify where each image should go (hero, gallery, inline, etc.).

Example usage:
attach_media({
  contentId: "123",
  images: [
    { url: "https://cdn.../hero.webp", placement: "hero", altText: "Sunset over Vernazza" },
    { url: "https://cdn.../gallery1.webp", placement: "gallery", altText: "Colorful boats in harbor" }
  ]
})`,
  input_schema: {
    type: 'object',
    properties: {
      contentId: stringProp('The UUID of the content item'),
      images: arrayProp(
        'Array of images to attach with placement and alt text',
        {
          type: 'object',
          description: 'Image attachment specification',
        }
      ),
    },
    required: ['contentId', 'images'],
  },
}

/**
 * Create thumbnail - generate a thumbnail version of an image
 */
export const createThumbnailTool: ToolDefinition = {
  name: 'create_thumbnail',
  description: `Generate a thumbnail version of an existing image.

This creates a smaller, optimized version suitable for:
- Grid/list previews
- Social media sharing
- Quick loading on mobile

Returns the thumbnail URL alongside the original.`,
  input_schema: {
    type: 'object',
    properties: {
      sourceUrl: stringProp('URL of the original image'),
      size: stringProp(
        'Thumbnail size: small (150px), medium (300px), large (600px)',
        ['small', 'medium', 'large']
      ),
      aspectRatio: stringProp(
        'Aspect ratio for the thumbnail',
        ['square', 'original', '16:9', '4:3']
      ),
    },
    required: ['sourceUrl'],
  },
}

/**
 * Batch generate images - create multiple variations at once
 */
export const batchGenerateImagesTool: ToolDefinition = {
  name: 'batch_generate_images',
  description: `Generate multiple AI images for a content item at once.

Useful for creating a cohesive set of images (e.g., a gallery or variations).
Each prompt will be processed and uploaded to the CDN.

Returns an array of generated image URLs.`,
  input_schema: {
    type: 'object',
    properties: {
      prompts: arrayProp(
        'Array of image prompts to generate',
        { type: 'string', description: 'Image generation prompt' }
      ),
      purpose: stringProp(
        'Intended use of the images',
        ['hero', 'gallery', 'thumbnail', 'illustration']
      ),
      aspectRatio: stringProp(
        'Aspect ratio for all images',
        ['landscape', 'portrait', 'square']
      ),
    },
    required: ['prompts', 'purpose'],
  },
}

/**
 * Search travel photos - specialized search for travel/destination imagery
 */
export const searchTravelPhotosTool: ToolDefinition = {
  name: 'search_travel_photos',
  description: `Search for travel-specific photos with location and category filters.

Optimized for finding:
- Destination landscapes and landmarks
- Local food and cuisine
- Cultural scenes and traditions
- Hotels and accommodations
- Beach and nature shots

Returns curated results focused on travel photography.`,
  input_schema: {
    type: 'object',
    properties: {
      location: stringProp('Location to search for (e.g., "Vernazza", "Cinque Terre")'),
      type: stringProp(
        'Type of travel photo',
        ['landscape', 'landmark', 'food', 'culture', 'people', 'hotel', 'beach']
      ),
      orientation: stringProp(
        'Photo orientation',
        ['landscape', 'portrait', 'square']
      ),
      count: numberProp('Number of results (default: 10, max: 30)'),
    },
    required: ['location'],
  },
}

// ============================================================================
// Content Integrity Audit Tools
// ============================================================================

/**
 * Audit image URL - check if an image URL is accessible
 */
export const auditImageUrlTool: ToolDefinition = {
  name: 'audit_image_url',
  description: `Check if an image URL is accessible and valid.

Performs an HTTP HEAD request to verify:
- URL is reachable (not 404)
- Returns an image content type
- Response time is acceptable

Use this to audit existing images in content before publishing.`,
  input_schema: {
    type: 'object',
    properties: {
      url: stringProp('The image URL to check'),
      timeout: numberProp('Timeout in milliseconds (default: 5000)'),
    },
    required: ['url'],
  },
}

/**
 * Validate image content - use vision to verify image matches expected context
 */
export const validateImageContentTool: ToolDefinition = {
  name: 'validate_image_content',
  description: `Use AI vision to verify an image matches its expected context.

IMPORTANT: This tool detects images that don't belong, such as:
- A photo of Santorini used for a Cinque Terre article
- A London landmark in an Italian travel guide
- A desert scene in coastal content

Analyzes the image and compares it against:
- Expected location (e.g., "Riomaggiore", "Cinque Terre")
- Expected category (e.g., "hiking trail", "restaurant")
- Expected subject matter

Returns whether the image is correct and details any mismatches.`,
  input_schema: {
    type: 'object',
    properties: {
      imageUrl: stringProp('URL of the image to validate'),
      expectedContext: stringProp('What the image should show (e.g., "Cinque Terre village view")'),
      villageContext: stringProp('Specific village if applicable (e.g., "Riomaggiore", "Vernazza")'),
      categoryContext: stringProp('Content category (e.g., "beach", "hiking", "restaurant")'),
    },
    required: ['imageUrl', 'expectedContext'],
  },
}

/**
 * Fix broken image - find and replace a broken or wrong image
 */
export const fixBrokenImageTool: ToolDefinition = {
  name: 'fix_broken_image',
  description: `Find a replacement for a broken or incorrect image and update the content.

This is a complete fix workflow that:
1. Searches for a suitable replacement image
2. Uploads the new image to the CDN
3. Updates the content JSON with the new URL

Use this after audit_image_url or validate_image_content identifies a problem.`,
  input_schema: {
    type: 'object',
    properties: {
      contentPath: stringProp('Path to the content JSON file'),
      jsonPath: stringProp('JSON path to the image field (e.g., "body[2].image")'),
      currentUrl: stringProp('The current broken/wrong image URL'),
      expectedContext: stringProp('What the replacement should show'),
      villageContext: stringProp('Specific village if applicable'),
      categoryContext: stringProp('Content category for search'),
    },
    required: ['contentPath', 'jsonPath', 'expectedContext'],
  },
}

/**
 * Audit content images - scan all images in a content file
 */
export const auditContentImagesTool: ToolDefinition = {
  name: 'audit_content_images',
  description: `Scan all images in a content JSON file and check for issues.

Performs comprehensive audit:
- Checks all image URLs are accessible
- Validates images match their context (using vision)
- Reports broken links, wrong images, missing alt text

Returns a detailed audit report with issues and suggested fixes.`,
  input_schema: {
    type: 'object',
    properties: {
      contentPath: stringProp('Path to the content directory or file'),
      validateContent: {
        type: 'boolean',
        description: 'Whether to use vision API to validate image content (slower but more thorough)',
      },
      concurrency: numberProp('Number of concurrent checks (default: 5)'),
    },
    required: ['contentPath'],
  },
}

// ============================================================================
// Export All Media Agent Tools
// ============================================================================

export const mediaAgentTools: ToolDefinition[] = [
  // Core media tools (from writer/media-tools)
  generateImageTool,
  searchStockPhotosTool,
  selectStockPhotoTool,
  uploadImageFromUrlTool,
  // Media-specific tools
  mediaGetContentTool,
  attachMediaTool,
  createThumbnailTool,
  batchGenerateImagesTool,
  searchTravelPhotosTool,
  // Content integrity audit tools
  auditImageUrlTool,
  validateImageContentTool,
  fixBrokenImageTool,
  auditContentImagesTool,
]

/**
 * Map of tool names to definitions
 */
export const mediaAgentToolMap: Record<string, ToolDefinition> = {
  generate_image: generateImageTool,
  search_stock_photos: searchStockPhotosTool,
  select_stock_photo: selectStockPhotoTool,
  upload_image_from_url: uploadImageFromUrlTool,
  media_get_content: mediaGetContentTool,
  attach_media: attachMediaTool,
  create_thumbnail: createThumbnailTool,
  batch_generate_images: batchGenerateImagesTool,
  search_travel_photos: searchTravelPhotosTool,
  // Audit tools
  audit_image_url: auditImageUrlTool,
  validate_image_content: validateImageContentTool,
  fix_broken_image: fixBrokenImageTool,
  audit_content_images: auditContentImagesTool,
}
