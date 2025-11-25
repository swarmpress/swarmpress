/**
 * WriterAgent Tool Definitions
 * Tools for content creation and management
 */

import {
  ToolDefinition,
  stringProp,
  arrayProp,
  objectProp,
} from '../base/tools'

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * Get content brief - fetch the brief and current state of a content item
 */
export const getContentTool: ToolDefinition = {
  name: 'get_content',
  description:
    'Fetch a content item by ID to see its current state, brief, title, body, and metadata. Use this to understand what you need to write or revise.',
  input_schema: {
    type: 'object',
    properties: {
      content_id: stringProp('The UUID of the content item to fetch'),
    },
    required: ['content_id'],
  },
}

/**
 * Write draft - create or update content body with JSON blocks
 */
export const writeDraftTool: ToolDefinition = {
  name: 'write_draft',
  description: `Create or update a content draft with structured JSON blocks.

IMPORTANT: The body must be an array of content blocks. Each block must have a "type" field.

Supported block types:
- heading: { type: "heading", level: 1-6, text: "..." }
- paragraph: { type: "paragraph", text: "..." }
- hero: { type: "hero", title: "...", subtitle: "...", backgroundImage: "url", cta: { text: "...", url: "..." } }
- image: { type: "image", url: "https://...", alt: "description", caption: "..." }
- list: { type: "list", ordered: true/false, items: ["item1", "item2", ...] }
- quote: { type: "quote", text: "...", author: "...", role: "..." }
- faq: { type: "faq", items: [{ question: "...", answer: "..." }, ...] }
- callout: { type: "callout", variant: "info"|"warning"|"success"|"error", title: "...", text: "..." }
- gallery: { type: "gallery", images: [{ url: "...", alt: "...", caption: "..." }, ...], columns: 2-4 }
- embed: { type: "embed", provider: "youtube"|"vimeo", url: "...", title: "..." }

After writing, the content will be in "draft" status.`,
  input_schema: {
    type: 'object',
    properties: {
      content_id: stringProp('The UUID of the content item to update'),
      title: stringProp('The title of the content'),
      body: arrayProp(
        'Array of content blocks (heading, paragraph, image, list, etc.)',
        objectProp('A content block with type and type-specific fields')
      ),
    },
    required: ['content_id', 'title', 'body'],
  },
}

/**
 * Revise draft - update content based on feedback
 */
export const reviseDraftTool: ToolDefinition = {
  name: 'revise_draft',
  description:
    'Update an existing draft based on editorial feedback. Use this when content was returned for changes. Provide the complete updated body.',
  input_schema: {
    type: 'object',
    properties: {
      content_id: stringProp('The UUID of the content item to revise'),
      title: stringProp('The updated title (optional, only if changing)'),
      body: arrayProp(
        'The complete updated array of content blocks',
        objectProp('A content block with type and type-specific fields')
      ),
      revision_notes: stringProp('Brief notes about what was changed'),
    },
    required: ['content_id', 'body'],
  },
}

/**
 * Submit for review - transition content to editorial review
 */
export const submitForReviewTool: ToolDefinition = {
  name: 'submit_for_review',
  description:
    'Submit completed content for editorial review. Only use this when the draft is complete and ready for review. The content status will change to "in_editorial_review".',
  input_schema: {
    type: 'object',
    properties: {
      content_id: stringProp('The UUID of the content item to submit'),
    },
    required: ['content_id'],
  },
}

// ============================================================================
// Export All Tools
// ============================================================================

export const writerTools = [
  getContentTool,
  writeDraftTool,
  reviseDraftTool,
  submitForReviewTool,
]
