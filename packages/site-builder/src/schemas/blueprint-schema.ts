/**
 * Blueprint Schema (Zod validation)
 * Defines the structure of page blueprints for the site generator
 */

import { z } from 'zod'

// =============================================================================
// AI HINTS SCHEMA
// =============================================================================

export const AIHintsSchema = z.object({
  purpose: z.string().optional().describe('What this section should accomplish'),
  tone: z.string().optional().describe('Writing tone: professional, casual, enthusiastic, etc.'),
  min_words: z.number().int().positive().optional().describe('Minimum word count'),
  max_words: z.number().int().positive().optional().describe('Maximum word count'),
  keywords: z.array(z.string()).optional().describe('SEO keywords to include'),
  style: z.string().optional().describe('Writing style guidance'),
  examples: z.array(z.string()).optional().describe('Example content for reference'),
})

export type AIHints = z.infer<typeof AIHintsSchema>

// =============================================================================
// COLLECTION SOURCE SCHEMA
// =============================================================================

export const CollectionSourceSchema = z.object({
  collection: z.string().describe('Collection type: events, pois, articles, etc.'),
  filter: z.record(z.unknown()).optional().describe('Filter criteria for collection items'),
  sort: z.string().optional().describe('Sort field and direction'),
  limit: z.number().int().positive().optional().describe('Maximum items to display'),
  offset: z.number().int().nonnegative().optional().describe('Skip first N items'),
})

export type CollectionSource = z.infer<typeof CollectionSourceSchema>

// =============================================================================
// COMPONENT PROPS SCHEMA
// =============================================================================

export const DisplayPropsSchema = z.object({
  layout: z.enum(['grid', 'list', 'carousel', 'compact']).optional(),
  columns: z.number().int().min(1).max(6).optional(),
  imageAspect: z.enum(['landscape', 'video', 'square', 'portrait']).optional(),
  showImage: z.boolean().optional(),
  showSummary: z.boolean().optional(),
  showDate: z.boolean().optional(),
})

export const ComponentPropsSchema = z.object({
  // Collection-specific props
  collectionType: z.string().optional(),
  heading: z.string().optional(),
  maxItems: z.number().int().positive().optional(),
  showViewAll: z.boolean().optional(),
  publishedOnly: z.boolean().optional(),
  featuredOnly: z.boolean().optional(),
  display: DisplayPropsSchema.optional(),

  // Generic props
  className: z.string().optional(),
  background: z.string().optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
  padding: z.enum(['none', 'sm', 'md', 'lg', 'xl']).optional(),
}).passthrough() // Allow additional props

export type ComponentProps = z.infer<typeof ComponentPropsSchema>

// =============================================================================
// BLUEPRINT COMPONENT SCHEMA
// =============================================================================

export const BlueprintComponentSchema = z.object({
  id: z.string().describe('Unique identifier for this component in the blueprint'),
  type: z.string().describe('Component type: hero, features, cta, etc.'),
  variant: z.string().optional().describe('Component variant: simple-centered, split-with-image, etc.'),
  order: z.number().int().nonnegative().describe('Display order (0-indexed)'),
  required: z.boolean().optional().default(false).describe('Whether this component must have content'),
  required_fields: z.array(z.string()).optional().describe('Fields that must be filled'),
  optional_fields: z.array(z.string()).optional().describe('Optional fields'),
  collectionSource: CollectionSourceSchema.optional().describe('For collection components'),
  props: ComponentPropsSchema.optional().describe('Component-specific properties'),
  ai_hints: AIHintsSchema.optional().describe('AI content generation hints'),
})

export type BlueprintComponent = z.infer<typeof BlueprintComponentSchema>

// =============================================================================
// LINKING RULES SCHEMA
// =============================================================================

export const LinkingRulesSchema = z.object({
  min_links: z.number().int().nonnegative().optional().describe('Minimum internal links per section'),
  max_links: z.number().int().positive().optional().describe('Maximum internal links per section'),
  min_total_links: z.number().int().nonnegative().optional().describe('Minimum total internal links on page'),
  max_total_links: z.number().int().positive().optional().describe('Maximum total internal links on page'),
  must_link_to_page_type: z.array(z.string()).optional().describe('Required page types to link to'),
  forbidden_slugs: z.array(z.string()).optional().describe('Slugs that should never be linked'),
  preferred_anchors: z.array(z.string()).optional().describe('Preferred anchor text patterns'),
})

export type LinkingRules = z.infer<typeof LinkingRulesSchema>

// =============================================================================
// SEO TEMPLATE SCHEMA
// =============================================================================

export const SEOTemplateSchema = z.object({
  title_pattern: z.string().optional().describe('Title template with {{variables}}'),
  meta_description_pattern: z.string().optional().describe('Meta description template'),
  required_keywords: z.array(z.string()).optional().describe('Keywords to include'),
  keyword_density: z.number().min(0).max(10).optional().describe('Target keyword density %'),
  min_word_count: z.number().int().positive().optional().describe('Minimum page word count'),
  max_word_count: z.number().int().positive().optional().describe('Maximum page word count'),
  schema_type: z.string().optional().describe('JSON-LD schema type'),
})

export type SEOTemplate = z.infer<typeof SEOTemplateSchema>

// =============================================================================
// BLUEPRINT SCHEMA (COMPLETE)
// =============================================================================

export const BlueprintSchema = z.object({
  id: z.string().uuid().optional().describe('Database ID'),
  page_type: z.string().min(1).describe('Page type identifier: village-overview, restaurant-listing, etc.'),
  name: z.string().min(1).describe('Human-readable blueprint name'),
  description: z.string().optional().describe('Blueprint description'),
  version: z.string().optional().default('1.0').describe('Blueprint version'),
  layout: z.string().optional().default('default').describe('Base layout template'),

  // Components define the page structure
  components: z.array(BlueprintComponentSchema).describe('Ordered list of page components'),

  // Linking rules for SEO
  global_linking_rules: LinkingRulesSchema.optional().describe('Internal linking constraints'),

  // SEO configuration
  seo_template: SEOTemplateSchema.optional().describe('SEO content guidelines'),

  // Metadata
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional(),
  website_id: z.string().uuid().optional(),
})

export type Blueprint = z.infer<typeof BlueprintSchema>

// =============================================================================
// VALIDATION HELPERS
// =============================================================================

/**
 * Validate a blueprint object
 */
export function validateBlueprint(data: unknown): { success: true; data: Blueprint } | { success: false; errors: z.ZodError } {
  const result = BlueprintSchema.safeParse(data)
  if (result.success) {
    return { success: true, data: result.data }
  }
  return { success: false, errors: result.error }
}

/**
 * Validate a single blueprint component
 */
export function validateBlueprintComponent(data: unknown): { success: true; data: BlueprintComponent } | { success: false; errors: z.ZodError } {
  const result = BlueprintComponentSchema.safeParse(data)
  if (result.success) {
    return { success: true, data: result.data }
  }
  return { success: false, errors: result.error }
}

/**
 * Get default AI hints for a component type
 */
export function getDefaultAIHints(type: string, _variant?: string): AIHints {
  const defaults: Record<string, AIHints> = {
    hero: {
      purpose: 'Capture attention and introduce the page topic',
      tone: 'engaging, welcoming',
      min_words: 20,
      max_words: 100,
    },
    features: {
      purpose: 'Highlight key features or benefits',
      tone: 'informative, persuasive',
      min_words: 50,
      max_words: 300,
    },
    cta: {
      purpose: 'Encourage user action',
      tone: 'compelling, urgent',
      min_words: 10,
      max_words: 50,
    },
    content: {
      purpose: 'Provide detailed information',
      tone: 'informative, clear',
      min_words: 100,
      max_words: 500,
    },
    testimonials: {
      purpose: 'Build trust through social proof',
      tone: 'authentic, positive',
      min_words: 30,
      max_words: 150,
    },
    faq: {
      purpose: 'Answer common questions',
      tone: 'helpful, clear',
      min_words: 50,
      max_words: 200,
    },
    stats: {
      purpose: 'Demonstrate credibility with data',
      tone: 'factual, impressive',
      min_words: 20,
      max_words: 100,
    },
  }

  return defaults[type] || {
    purpose: 'Provide relevant content for this section',
    tone: 'professional',
    min_words: 50,
    max_words: 200,
  }
}

/**
 * Map component type to Astro component file
 */
export function getComponentFileName(type: string, variant?: string): string {
  const typeMap: Record<string, string> = {
    'hero': 'hero',
    'header': 'header',
    'features': 'features',
    'content': 'content',
    'cta': 'cta',
    'stats': 'stats',
    'testimonials': 'testimonials',
    'faq': 'faq',
    'team': 'team',
    'contact': 'contact',
    'pricing': 'pricing',
    'newsletter': 'newsletter',
    'blog': 'blog',
    'logo-cloud': 'logo-cloud',
    'bento-grid': 'bento-grid',
    'footer': 'footer',
    'collection': 'collection',
  }

  const folder = typeMap[type] || type

  if (!variant) {
    return `${folder}/index`
  }

  // Convert variant to PascalCase filename
  // e.g., "simple-centered" -> "SimpleCentered"
  const pascalVariant = variant
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join('')

  // Prepend type prefix for most components
  const prefix = type.charAt(0).toUpperCase() + type.slice(1).replace(/-([a-z])/g, (_, c) => c.toUpperCase())

  return `${folder}/${prefix}${pascalVariant}`
}

// =============================================================================
// EXPORTS
// =============================================================================

export default {
  BlueprintSchema,
  BlueprintComponentSchema,
  AIHintsSchema,
  CollectionSourceSchema,
  LinkingRulesSchema,
  SEOTemplateSchema,
  validateBlueprint,
  validateBlueprintComponent,
  getDefaultAIHints,
  getComponentFileName,
}
