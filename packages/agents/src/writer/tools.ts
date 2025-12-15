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

/**
 * Generate page content - create content for a website page from GitHub
 */
export const generatePageContentTool: ToolDefinition = {
  name: 'generate_page_content',
  description: `Generate engaging, emotional content for a website page.

This tool:
1. Reads the page from GitHub to get metadata (village, page_type, language)
2. Loads relevant collection items filtered by village
3. Returns the page brief with collection context for you to write content

After receiving the brief, use write_page_content to save the content back to GitHub.

The content should:
- Be emotionally engaging and reflect your unique writing persona
- Curate and embed collection items naturally in the narrative
- Use appropriate block types (hero, paragraph, collection-embed, callout, etc.)
- Include practical tips and local insights`,
  input_schema: {
    type: 'object',
    properties: {
      website_id: stringProp('The UUID of the website'),
      page_path: stringProp('The page path in GitHub (e.g., "content/pages/en/manarola/restaurants.json")'),
    },
    required: ['website_id', 'page_path'],
  },
}

/**
 * Write page content - save generated content to a GitHub page
 */
export const writePageContentTool: ToolDefinition = {
  name: 'write_page_content',
  description: `Save generated content to a website page in GitHub.

The body must be an array of content blocks. Each block must have a "type" field.

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
- collection-embed: { type: "collection-embed", collectionType: "restaurants", heading: "...", items: [...], display: { layout: "grid"|"list"|"carousel"|"compact", columns: 2-4 } }

For collection-embed blocks, the items should be pre-filtered by village and contain:
- slug: URL-friendly identifier
- title: Display name
- summary: Brief description (optional)
- image: Featured image URL (optional)
- url: Link to detail page
- data: Full item data for custom rendering`,
  input_schema: {
    type: 'object',
    properties: {
      website_id: stringProp('The UUID of the website'),
      page_path: stringProp('The page path in GitHub (e.g., "content/pages/en/manarola/restaurants.json")'),
      title: stringProp('The page title'),
      body: arrayProp(
        'Array of content blocks (heading, paragraph, image, collection-embed, etc.)',
        objectProp('A content block with type and type-specific fields')
      ),
      seo: objectProp('SEO metadata (title, description, keywords)'),
    },
    required: ['website_id', 'page_path', 'title', 'body'],
  },
}

/**
 * Generate page sections - recommend and create section structure for a page
 */
export const generatePageSectionsTool: ToolDefinition = {
  name: 'generate_page_sections',
  description: `Generate a recommended set of sections for a website page based on the page context and questionnaire answers.

This tool analyzes:
1. The page type (landing page, article, service page, etc.)
2. The user's answers about purpose, audience, and desired sections
3. Best practices for the content type

Returns an array of section definitions with:
- type: The section type (e.g., "hero-section", "feature-section")
- variant: The recommended variant
- order: The section order
- prompts: AI hints for content generation

Use this when the user wants to start with a blank page and get AI-recommended sections.`,
  input_schema: {
    type: 'object',
    properties: {
      page_context: objectProp('Context about the page including type, title, and site information'),
      questionnaire: objectProp(`User's answers to the generation questionnaire: { purpose: string, audience: string, keySections: string[], tone: string }`),
    },
    required: ['page_context', 'questionnaire'],
  },
}

/**
 * Optimize section content - generate or improve content for a single section
 */
export const optimizeSectionTool: ToolDefinition = {
  name: 'optimize_section',
  description: `Generate or optimize content for a single page section.

This tool:
1. Analyzes the section type, variant, and configured prompts/hints
2. Uses the page context and any existing content
3. Generates structured content appropriate for the section type

The content structure depends on the section type:
- hero-section: { title, subtitle, cta: { text, url }, backgroundImage }
- feature-section: { heading, subheading, features: [{ title, description, icon }] }
- content-section: { heading, content (markdown) }
- stats-section: { heading, stats: [{ value, label, description }] }
- cta-section: { heading, description, primaryCta: { text, url }, secondaryCta: { text, url } }
- faq-section: { heading, items: [{ question, answer }] }
- testimonial-section: { heading, testimonials: [{ quote, author, role, avatar }] }

Returns the optimized content object for the section.`,
  input_schema: {
    type: 'object',
    properties: {
      section: objectProp('The section to optimize including type, variant, current content, prompts, and ai_hints'),
      page_context: objectProp('Context about the page including title, purpose, and site information'),
    },
    required: ['section', 'page_context'],
  },
}

/**
 * Optimize all sections - generate content for all sections on a page
 */
export const optimizeAllSectionsTool: ToolDefinition = {
  name: 'optimize_all_sections',
  description: `Generate or optimize content for all sections on a page in a single operation.

This tool:
1. Analyzes each section's type, variant, and configured prompts/hints
2. Ensures consistency across all sections (tone, style, narrative flow)
3. Generates appropriate content for each section type

Returns an array of section updates with their optimized content.

Use this when the user wants to populate all sections at once with AI-generated content.`,
  input_schema: {
    type: 'object',
    properties: {
      sections: arrayProp(
        'Array of sections to optimize, each with type, variant, current content, prompts, and ai_hints',
        objectProp('A section object')
      ),
      page_context: objectProp('Context about the page including title, purpose, and site information'),
    },
    required: ['sections', 'page_context'],
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
  generatePageContentTool,
  writePageContentTool,
  generatePageSectionsTool,
  optimizeSectionTool,
  optimizeAllSectionsTool,
]
