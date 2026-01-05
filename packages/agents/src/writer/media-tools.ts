/**
 * WriterAgent Media Tool Definitions
 * Tools for image generation and stock photo selection
 */

import {
  ToolDefinition,
  stringProp,
  numberProp,
} from '../base/tools'

// ============================================================================
// Media Tool Definitions
// ============================================================================

/**
 * Generate image - create an AI-generated image using Google Gemini/Imagen
 */
export const generateImageTool: ToolDefinition = {
  name: 'generate_image',
  description: `Generate an AI image using Google Gemini/Imagen based on a text description.

The generated image will be:
1. Created by Google's Imagen 3 model
2. Automatically uploaded to our CDN
3. Returned as a permanent URL you can use in content

Best practices for prompts:
- Be specific and descriptive
- Include style hints (photorealistic, artistic, cinematic)
- Mention lighting (golden hour, soft light, dramatic shadows)
- Include mood/atmosphere (peaceful, vibrant, mysterious)

Example prompts:
- "Sunset over Vernazza harbor with colorful fishing boats, golden hour light, photorealistic, 8k"
- "Cinque Terre coastal trail with hikers, dramatic cliff views, cinematic composition"
- "Traditional Italian seafood dish at a harbor restaurant, warm ambient lighting, food photography"

Returns: { url: string, altText: string, source: "ai-generated" }`,
  input_schema: {
    type: 'object',
    properties: {
      prompt: stringProp('Detailed description of the image to generate. Be specific about subject, style, lighting, and mood.'),
      purpose: stringProp(
        'Intended use of the image (affects aspect ratio)',
        ['hero', 'gallery', 'thumbnail', 'illustration']
      ),
      aspectRatio: stringProp(
        'Image aspect ratio: landscape (16:9), portrait (9:16), square (1:1)',
        ['landscape', 'portrait', 'square']
      ),
    },
    required: ['prompt', 'purpose'],
  },
}

/**
 * Search stock photos - find images from Unsplash/Pexels
 */
export const searchStockPhotosTool: ToolDefinition = {
  name: 'search_stock_photos',
  description: `Search stock photo libraries (Unsplash, Pexels) for images.

Returns a list of photo options with:
- id: Photo identifier for selection
- previewUrl: Small preview image
- photographer: Attribution credit
- source: "unsplash" or "pexels"

After reviewing the options, use select_stock_photo to download and use the image.

Search tips:
- Use specific location names (Vernazza, Manarola, etc.)
- Add type keywords (restaurant, beach, hiking, sunset)
- Combine for better results: "Vernazza Italy colorful houses harbor"

Returns: { photos: [{ id, previewUrl, photographer, source, description }] }`,
  input_schema: {
    type: 'object',
    properties: {
      query: stringProp('Search query for photos (e.g., "Vernazza Italy harbor sunset")'),
      orientation: stringProp(
        'Photo orientation preference',
        ['landscape', 'portrait', 'square']
      ),
      count: numberProp('Number of results to return (default: 5, max: 20)'),
    },
    required: ['query'],
  },
}

/**
 * Select stock photo - download and upload a chosen photo
 */
export const selectStockPhotoTool: ToolDefinition = {
  name: 'select_stock_photo',
  description: `Select and use a stock photo from search results.

This tool:
1. Downloads the selected photo
2. Converts to WebP for optimal performance
3. Uploads to our CDN
4. Returns the permanent URL with attribution

IMPORTANT: Always include proper attribution in captions:
- Unsplash: "Photo by [photographer] on Unsplash"
- Pexels: "Photo by [photographer] on Pexels"

Returns: { url: string, altText: string, attribution: string, source: string }`,
  input_schema: {
    type: 'object',
    properties: {
      photoId: stringProp('The photo ID from search results'),
      source: stringProp('The source of the photo', ['unsplash', 'pexels']),
      altText: stringProp('Descriptive alt text for accessibility (required for SEO)'),
    },
    required: ['photoId', 'source', 'altText'],
  },
}

/**
 * Upload image from URL - import an external image to our CDN
 */
export const uploadImageFromUrlTool: ToolDefinition = {
  name: 'upload_image_from_url',
  description: `Upload an image from an external URL to our CDN.

Use this when you have a specific image URL that you want to:
1. Import into our storage
2. Convert to optimal format (WebP)
3. Serve from our fast CDN

Common uses:
- User-provided image URLs
- Images from partner sites
- Importing existing assets

Returns: { url: string, key: string, size: number }`,
  input_schema: {
    type: 'object',
    properties: {
      sourceUrl: stringProp('The URL of the image to upload'),
      filename: stringProp('Filename for the uploaded image (without extension)'),
      folder: stringProp('Optional folder path (e.g., "cinqueterre/images/2024")'),
    },
    required: ['sourceUrl', 'filename'],
  },
}

// ============================================================================
// Export All Media Tools
// ============================================================================

export const mediaTools = [
  generateImageTool,
  searchStockPhotosTool,
  selectStockPhotoTool,
  uploadImageFromUrlTool,
]

/**
 * Map of media tool names to definitions
 */
export const mediaToolMap: Record<string, ToolDefinition> = {
  generate_image: generateImageTool,
  search_stock_photos: searchStockPhotosTool,
  select_stock_photo: selectStockPhotoTool,
  upload_image_from_url: uploadImageFromUrlTool,
}
