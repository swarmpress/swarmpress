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

Cinque Terre Theme blocks:
- village-selector: { type: "village-selector", title: "...", subtitle: "...", villages: [{ name, slug, description, image, tags: [...] }, ...] }
- places-to-stay: { type: "places-to-stay", title: "...", eyebrow: "...", stays: [{ name, village, special, price, image, url }, ...], viewAllUrl: "..." }
- featured-carousel: { type: "featured-carousel", title: "...", stories: [{ id, title, category, dek, image, author, url }, ...], viewAllUrl: "..." }
- village-intro: { type: "village-intro", village: "...", leadStory: {...}, essentials: { weather, seaTemp, crowdRhythm, ... }, stories: [...] }
- trending-now: { type: "trending-now", title: "...", stories: [{ id, title, category, image, author, date, readTime, isLead }, ...] }
- about: { type: "about", title: "...", eyebrow: "...", description: ["paragraph1", "paragraph2"], image: "...", editor: { name, role, avatar } }
- curated-escapes: { type: "curated-escapes", title: "...", eyebrow: "...", escapes: [{ name, image, url }, ...] }
- latest-stories: { type: "latest-stories", title: "...", stories: [...], filters: ["All", "Guides", "Food"], showFilters: true }
- eat-drink: { type: "eat-drink", title: "...", eyebrow: "...", places: [{ name, type, village, blurb, image, url }, ...], viewAllUrl: "..." }
- highlights: { type: "highlights", title: "...", eyebrow: "...", highlights: [{ name, icon: "mountain"|"ship"|"camera"|..., desc, url }, ...] }
- audio-guides: { type: "audio-guides", title: "...", guides: [{ title, description, duration, image, url }, ...], viewAllUrl: "..." }
- practical-advice: { type: "practical-advice", advice: [{ name, icon: "train"|"map"|"users"|..., desc, url }, ...] }

Editorial blocks (for rich magazine-style content):
- editorial-hero: { type: "editorial-hero", title: "...", subtitle: "...", badge: "...", image: "url", height: "70vh" }
- editorial-intro: { type: "editorial-intro", badge: "...", quote: "...", leftContent: "<p>...</p>", rightContent: "<p>...</p>" }
- editorial-interlude: { type: "editorial-interlude", badge: "...", title: "...", quote: "...", interludeType: "primary"|"secondary", align: "left"|"right" }
- editor-note: { type: "editor-note", quote: "...", author: "Giulia Rossi", role: "Local Expert", image: "/giulia_rossi.png" }
- closing-note: { type: "closing-note", badge: "...", title: "...", content: "<p>...</p>", actions: [{ label: "...", href: "...", variant: "primary"|"secondary" }] }

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

Cinque Terre Theme blocks:
- village-selector: { type: "village-selector", title: "...", subtitle: "...", villages: [{ name, slug, description, image, tags: [...] }, ...] }
- places-to-stay: { type: "places-to-stay", title: "...", eyebrow: "...", stays: [{ name, village, special, price, image, url }, ...], viewAllUrl: "..." }
- featured-carousel: { type: "featured-carousel", title: "...", stories: [{ id, title, category, dek, image, author, url }, ...], viewAllUrl: "..." }
- village-intro: { type: "village-intro", village: "...", leadStory: {...}, essentials: { weather, seaTemp, crowdRhythm, ... }, stories: [...] }
- trending-now: { type: "trending-now", title: "...", stories: [{ id, title, category, image, author, date, readTime, isLead }, ...] }
- about: { type: "about", title: "...", eyebrow: "...", description: ["paragraph1", "paragraph2"], image: "...", editor: { name, role, avatar } }
- curated-escapes: { type: "curated-escapes", title: "...", eyebrow: "...", escapes: [{ name, image, url }, ...] }
- latest-stories: { type: "latest-stories", title: "...", stories: [...], filters: ["All", "Guides", "Food"], showFilters: true }
- eat-drink: { type: "eat-drink", title: "...", eyebrow: "...", places: [{ name, type, village, blurb, image, url }, ...], viewAllUrl: "..." }
- highlights: { type: "highlights", title: "...", eyebrow: "...", highlights: [{ name, icon: "mountain"|"ship"|"camera"|..., desc, url }, ...] }
- audio-guides: { type: "audio-guides", title: "...", guides: [{ title, description, duration, image, url }, ...], viewAllUrl: "..." }
- practical-advice: { type: "practical-advice", advice: [{ name, icon: "train"|"map"|"users"|..., desc, url }, ...] }

Editorial blocks (for rich magazine-style content):
- editorial-hero: { type: "editorial-hero", title: "...", subtitle: "...", badge: "...", image: "url", height: "70vh" }
- editorial-intro: { type: "editorial-intro", badge: "...", quote: "...", leftContent: "<p>...</p>", rightContent: "<p>...</p>" }
- editorial-interlude: { type: "editorial-interlude", badge: "...", title: "...", quote: "...", interludeType: "primary"|"secondary", align: "left"|"right" }
- editor-note: { type: "editor-note", quote: "...", author: "Giulia Rossi", role: "Local Expert", image: "/giulia_rossi.png" }
- closing-note: { type: "closing-note", badge: "...", title: "...", content: "<p>...</p>", actions: [{ label: "...", href: "...", variant: "primary"|"secondary" }] }

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

Cinque Terre Theme sections:
- village-selector: { title, subtitle, villages: [{ name, slug, description, image, tags }] }
- places-to-stay: { title, eyebrow, stays: [{ name, village, special, price, image, url }], viewAllUrl }
- featured-carousel: { title, stories: [{ id, title, category, dek, image, author, url }], viewAllUrl }
- village-intro: { village, leadStory, essentials: { weather, seaTemp, crowdRhythm, ... }, stories }
- trending-now: { title, stories: [{ id, title, category, image, author, date, readTime, isLead }] }
- about: { title, eyebrow, description: [...], image, editor: { name, role, avatar } }
- curated-escapes: { title, eyebrow, escapes: [{ name, image, url }] }
- latest-stories: { title, stories, filters, showFilters }
- eat-drink: { title, eyebrow, places: [{ name, type, village, blurb, image, url }], viewAllUrl }
- highlights: { title, eyebrow, highlights: [{ name, icon, desc, url }] }
- audio-guides: { title, guides: [{ title, description, duration, image, url }], viewAllUrl }
- practical-advice: { advice: [{ name, icon, desc, url }] }

Editorial sections (for rich magazine-style content):
- editorial-hero: { title, subtitle, badge, image, height }
- editorial-intro: { badge, quote, leftContent, rightContent }
- editorial-interlude: { badge, title, quote, interludeType, align }
- editor-note: { quote, author, role, image }
- closing-note: { badge, title, content, actions: [{ label, href, variant }] }

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
// Content Integrity Audit Tools
// ============================================================================

/**
 * Audit links - check all links in content for issues
 */
export const auditLinksTool: ToolDefinition = {
  name: 'audit_links',
  description: `Scan content for broken or problematic links.

Checks:
- Internal links resolve to existing pages
- External links are accessible (HTTP 200)
- No dead anchors (#fragment)
- Proper URL formatting

Returns a report of issues found with suggested fixes.`,
  input_schema: {
    type: 'object',
    properties: {
      content_path: stringProp('Path to the content directory or file to scan'),
      sitemap_slugs: arrayProp(
        'Valid page slugs for internal link validation',
        { type: 'string', description: 'A valid page slug' }
      ),
      check_external: {
        type: 'boolean',
        description: 'Whether to check external links (slower)',
      },
    },
    required: ['content_path'],
  },
}

/**
 * Find internal link opportunities - analyze content graph for missing connections
 */
export const findInternalLinkOpportunitiesTool: ToolDefinition = {
  name: 'find_internal_link_opportunities',
  description: `Analyze content to find opportunities for internal linking.

Looks for:
- Pages about the same village that should cross-link
- Related topics that aren't connected
- Orphan pages with no incoming links
- Hub pages that should be linked more

Returns suggested internal links to add for better SEO and navigation.`,
  input_schema: {
    type: 'object',
    properties: {
      content_path: stringProp('Path to the content directory to analyze'),
      sitemap_path: stringProp('Path to sitemap.json for page relationships'),
      min_relevance: {
        type: 'number',
        description: 'Minimum relevance score for suggestions (0-1, default 0.5)',
      },
    },
    required: ['content_path'],
  },
}

/**
 * Audit translations - check for missing translations in LocalizedString fields
 */
export const auditTranslationsTool: ToolDefinition = {
  name: 'audit_translations',
  description: `Scan content for missing translations in multi-language fields.

Checks all LocalizedString fields (objects with en, de, fr, it keys) and identifies:
- Fields with only English content
- Partially translated fields
- Empty translations

Returns a report grouped by file and language with translation requirements.`,
  input_schema: {
    type: 'object',
    properties: {
      content_path: stringProp('Path to the content directory to scan'),
      required_languages: arrayProp(
        'Languages that should be present (default: ["en", "de", "fr", "it"])',
        { type: 'string', description: 'Language code (e.g., "en", "de")' }
      ),
    },
    required: ['content_path'],
  },
}

/**
 * Generate translation - create missing language version of content
 */
export const generateTranslationTool: ToolDefinition = {
  name: 'generate_translation',
  description: `Generate a translation for missing language content.

Takes an English source text and generates the translation for the specified language.
Maintains the same tone, style, and formatting as the original.

For Cinque Terre content, uses appropriate local terminology and cultural references.`,
  input_schema: {
    type: 'object',
    properties: {
      source_text: stringProp('The English source text to translate'),
      target_language: stringProp('Target language code', ['de', 'fr', 'it']),
      context: stringProp('Context about the content (e.g., "village description for Vernazza")'),
      content_path: stringProp('Optional: Path to content file to update'),
      json_path: stringProp('Optional: JSON path to the field to update'),
    },
    required: ['source_text', 'target_language'],
  },
}

/**
 * Add internal link - insert an internal link into content
 */
export const addInternalLinkTool: ToolDefinition = {
  name: 'add_internal_link',
  description: `Add an internal link to content at an appropriate location.

Finds a suitable place in the content to add the link naturally:
- Within relevant paragraphs
- In "Related" sections
- As part of navigation elements

Updates the content file and returns the location where the link was added.`,
  input_schema: {
    type: 'object',
    properties: {
      content_path: stringProp('Path to the content file to modify'),
      target_url: stringProp('URL of the page to link to'),
      anchor_text: stringProp('Text to use for the link'),
      context_hint: stringProp('Hint about where to place the link (e.g., "near mention of hiking")'),
    },
    required: ['content_path', 'target_url', 'anchor_text'],
  },
}

/**
 * Fix broken link - repair or remove a broken link
 */
export const fixBrokenLinkTool: ToolDefinition = {
  name: 'fix_broken_link',
  description: `Repair or remove a broken link from content.

Options:
1. Replace with a working alternative URL
2. Remove the link but keep the text
3. Remove the entire sentence/element containing the link

Updates the content file and reports what was changed.`,
  input_schema: {
    type: 'object',
    properties: {
      content_path: stringProp('Path to the content file'),
      json_path: stringProp('JSON path to the broken link'),
      broken_url: stringProp('The broken URL to fix'),
      action: stringProp('Fix action', ['replace', 'remove_link', 'remove_element']),
      replacement_url: stringProp('New URL if action is "replace"'),
    },
    required: ['content_path', 'json_path', 'broken_url', 'action'],
  },
}

// ============================================================================
// Context Tools (Weather & Calendar)
// ============================================================================

/**
 * Fetch weather - get current weather and forecast for Cinque Terre
 */
export const fetchWeatherTool: ToolDefinition = {
  name: 'fetch_weather',
  description: `Get current weather conditions and forecast for Cinque Terre.

Returns:
- Current temperature, humidity, wind, and conditions
- 7-day forecast with highs/lows and precipitation chances
- Sunrise/sunset times for today

Use this tool when:
- Writing seasonal content that needs accurate weather context
- Creating travel guides with weather recommendations
- Adding weather information to village pages
- Generating content that references current conditions

Format options:
- "current": Just current conditions
- "forecast": 7-day forecast only
- "full": Both current and forecast (default)`,
  input_schema: {
    type: 'object',
    properties: {
      format: stringProp('What weather data to return', ['current', 'forecast', 'full']),
    },
    required: [],
  },
}

/**
 * Get content calendar - access seasonal content topics
 */
export const getContentCalendarTool: ToolDefinition = {
  name: 'get_content_calendar',
  description: `Get the content calendar with seasonal topics for Cinque Terre.

Returns:
- Current season and date information
- List of seasonal content topics with priorities
- Topics filtered by season and/or priority

Use this tool when:
- Planning what content to write next
- Understanding seasonal relevance for content
- Finding high-priority topics that need attention
- Getting context for scheduled content workflows

Season options:
- "current": Topics for the current season (default)
- "spring", "summer", "fall", "winter": Specific season
- "all": All seasons

Priority options:
- "all": All priorities (default)
- "high": High and critical priority only
- "critical": Critical priority only`,
  input_schema: {
    type: 'object',
    properties: {
      season: stringProp('Which season to get topics for', ['current', 'spring', 'summer', 'fall', 'winter', 'all']),
      priority: stringProp('Filter by priority level', ['all', 'high', 'critical']),
    },
    required: [],
  },
}

/**
 * Context tools for weather and content calendar awareness
 */
export const contextTools = [
  fetchWeatherTool,
  getContentCalendarTool,
]

// ============================================================================
// Import Media Tools
// ============================================================================

import { mediaTools } from './media-tools'

// ============================================================================
// Export All Tools
// ============================================================================

/**
 * Core writer tools for content creation and management
 */
export const coreWriterTools = [
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

/**
 * Content integrity audit tools
 */
export const auditTools = [
  auditLinksTool,
  findInternalLinkOpportunitiesTool,
  auditTranslationsTool,
  generateTranslationTool,
  addInternalLinkTool,
  fixBrokenLinkTool,
]

/**
 * All writer tools including media, audit, and context capabilities
 */
export const writerTools = [
  ...coreWriterTools,
  ...mediaTools,
  ...auditTools,
  ...contextTools,
]
