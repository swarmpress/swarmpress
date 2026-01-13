/**
 * MediaSelectorAgent Tool Definitions
 * Tools for selecting and validating media based on entity/category constraints
 */

import {
  ToolDefinition,
  stringProp,
  numberProp,
  arrayProp,
} from '../base/tools'

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * Find matching images - Query media-index.json with entity + category constraints
 */
export const findMatchingImagesTool: ToolDefinition = {
  name: 'find_matching_images',
  description: `Search the media index for images that match the given entity and category constraints.

Use this tool when you need to find appropriate images for a content block. The tool will:
- Filter images by village (strict match or 'region' fallback)
- Filter by allowed categories
- Consider aspect ratio and mood preferences
- Return images sorted by relevance

IMPORTANT: For blocks with entityMatch='strict', images MUST have the same village tag as the component. A Riomaggiore component can only use images tagged with village='riomaggiore' or village='region'.`,
  input_schema: {
    type: 'object',
    properties: {
      village: stringProp('Village slug to match (e.g., "riomaggiore", "manarola"). Use "region" for region-wide content.'),
      categories: arrayProp(
        'Allowed image categories (e.g., ["sights", "beaches", "food"])',
        stringProp('Category slug')
      ),
      entity_match: stringProp('Match strictness: "strict" (village must match), "category" (only category must match), "none" (any image)'),
      aspect_ratio: stringProp('Preferred aspect ratio: "landscape", "portrait", "square", "video", "any"'),
      mood: stringProp('Preferred mood: "romantic", "adventurous", "serene", "vibrant", etc.'),
      limit: numberProp('Maximum number of images to return (default: 10)'),
      exclude_ids: arrayProp(
        'Image IDs to exclude from results (e.g., already used images)',
        stringProp('Image ID to exclude')
      ),
    },
    required: ['village', 'entity_match'],
  },
}

/**
 * Validate image relevance - Check if image tags match component context
 */
export const validateImageRelevanceTool: ToolDefinition = {
  name: 'validate_image_relevance',
  description: `Validate whether a specific image is appropriate for a content block.

Returns validation result with:
- valid: boolean indicating if the image can be used
- reason: explanation if invalid
- warnings: non-blocking issues to consider

Use this before assigning images to blocks to prevent mismatches like "Caribbean image on Riomaggiore page".`,
  input_schema: {
    type: 'object',
    properties: {
      image_id: stringProp('The image ID from media-index.json to validate'),
      block_type: stringProp('The block type (e.g., "hero", "gallery", "village-intro")'),
      component_village: stringProp('The village this component belongs to'),
      component_category: stringProp('The category context (e.g., "sights", "restaurants")'),
    },
    required: ['image_id', 'block_type', 'component_village'],
  },
}

/**
 * Suggest missing media - Return NEEDS_MEDIA with required tags when no match
 */
export const suggestMissingMediaTool: ToolDefinition = {
  name: 'suggest_missing_media',
  description: `Generate a media requirement specification when no suitable images exist in the media index.

Use this when find_matching_images returns no results. This tool creates a structured request that can be:
- Sent to a human to source new images
- Used by a media generation agent to create appropriate imagery
- Logged for future media acquisition planning

The output includes all tags/criteria the missing media should have.`,
  input_schema: {
    type: 'object',
    properties: {
      block_type: stringProp('The block type needing media'),
      village: stringProp('Required village tag'),
      categories: arrayProp(
        'Required categories for the image',
        stringProp('Category slug')
      ),
      aspect_ratio: stringProp('Required aspect ratio'),
      context: stringProp('Additional context about what the image should show'),
      urgency: stringProp('Priority level: "high", "medium", "low"'),
    },
    required: ['block_type', 'village', 'categories'],
  },
}

/**
 * Get media index stats - Get overview of available media
 */
export const getMediaIndexStatsTool: ToolDefinition = {
  name: 'get_media_index_stats',
  description: `Get statistics about the media index to understand available imagery.

Returns counts by:
- Village (how many images per village)
- Category (how many images per category)
- Aspect ratio distribution
- Total image count

Useful for planning content and identifying media gaps.`,
  input_schema: {
    type: 'object',
    properties: {
      village: stringProp('Optional: filter stats to a specific village'),
    },
    required: [],
  },
}

/**
 * Batch validate media - Validate all media in a page/component
 */
export const batchValidateMediaTool: ToolDefinition = {
  name: 'batch_validate_media',
  description: `Validate all media references in a content structure.

Use this to check an entire page or component for media relevance issues.
Returns a report with:
- All valid images
- All invalid images with reasons
- Suggestions for replacements`,
  input_schema: {
    type: 'object',
    properties: {
      content: stringProp('JSON string of the content structure to validate'),
      page_village: stringProp('The village context for the page'),
    },
    required: ['content', 'page_village'],
  },
}

// ============================================================================
// Export All Tools
// ============================================================================

export const mediaSelectorTools = [
  findMatchingImagesTool,
  validateImageRelevanceTool,
  suggestMissingMediaTool,
  getMediaIndexStatsTool,
  batchValidateMediaTool,
]
