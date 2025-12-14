import { z } from 'zod'
import { PageSectionSchema } from './page-section'

// Re-export inline prompt schemas for backward compatibility
export {
  SiteAIHintsSchema,
  SiteAIHints,
  InlinePromptSchema,
  InlinePrompt,
  PromptReferenceSchema,
  PromptReference,
  PromptTemplateSchema,
  PromptTemplate,
  isPromptReference,
} from './inline-prompts'

// Import for use in this file
import {
  SiteAIHintsSchema,
  InlinePromptSchema,
  PromptTemplateSchema,
} from './inline-prompts'

/**
 * Site Definition Schema
 *
 * The site definition is the single source of truth for:
 * - Page types and collection types (schemas)
 * - Sitemap structure (nodes + edges)
 * - Agent configuration
 *
 * Stored in GitHub at: content/site.json
 */

// ============================================================================
// Localized Strings
// ============================================================================

export const LocalizedStringSchema = z.union([
  z.string(),
  z.record(z.string()), // { "en": "...", "de": "..." }
])

export type LocalizedString = z.infer<typeof LocalizedStringSchema>

// ============================================================================
// Section Definitions (for page types)
// ============================================================================

export const SectionDefinitionSchema = z.object({
  type: z.string(),
  required: z.boolean().optional(),
  multiple: z.boolean().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
})

export type SectionDefinition = z.infer<typeof SectionDefinitionSchema>

// ============================================================================
// Field Definitions (for entity/collection types)
// ============================================================================

export const FieldDefinitionSchema = z.object({
  name: z.string(),
  type: z.enum(['string', 'number', 'boolean', 'array', 'object', 'enum', 'date', 'rich-text', 'image', 'reference']),
  required: z.boolean().optional(),
  options: z.array(z.string()).optional(), // For enum type
  default: z.any().optional(),
  description: z.string().optional(),
  localized: z.boolean().optional(), // Whether field supports localization
})

export type FieldDefinition = z.infer<typeof FieldDefinitionSchema>

// ============================================================================
// Display Configuration
// ============================================================================

export const DisplayConfigSchema = z.object({
  title_field: z.string(),
  summary_field: z.string().optional(),
  image_field: z.string().optional(),
  list_fields: z.array(z.string()).optional(),
})

export type DisplayConfig = z.infer<typeof DisplayConfigSchema>

// ============================================================================
// Template Page Structure (for collection types with sub-pages)
// ============================================================================

/**
 * Collection binding for template pages
 * Supports dynamic filter templates with instance context
 */
export const TemplateCollectionBindingSchema = z.object({
  collection: z.string(), // e.g., "poi"
  filter: z.record(z.any()).optional(), // Static filter
  filterTemplate: z.string().optional(), // Dynamic filter: "{ \"village\": \"{{instance.id}}\" }"
  limit: z.number().optional(),
  sort: z.object({
    field: z.string(),
    direction: z.enum(['asc', 'desc']),
  }).optional(),
})

export type TemplateCollectionBinding = z.infer<typeof TemplateCollectionBindingSchema>

/**
 * Template page definition within a collection type
 * Defines a page that each instance of the collection will have
 */
export const TemplatePageSchema = z.object({
  slug: z.string(), // e.g., "overview", "restaurants"
  pageType: z.string(), // Reference to a page type definition
  title: LocalizedStringSchema, // Localized title template
  required: z.boolean().default(true), // Can instances skip this page?

  // Sections can be defined inline or inherited from pageType
  sections: z.array(PageSectionSchema).optional(),

  // Collection binding for dynamic data
  collectionBinding: TemplateCollectionBindingSchema.optional(),

  // AI configuration for this template page
  prompts: InlinePromptSchema.optional(),
  ai_hints: SiteAIHintsSchema.optional(),
})

export type TemplatePage = z.infer<typeof TemplatePageSchema>

/**
 * Page structure for collection types
 * Defines the sub-pages each collection instance gets automatically
 */
export const PageStructureSchema = z.object({
  // Template pages that each instance will have
  pages: z.array(TemplatePageSchema),

  // Default prompts applied to all pages in structure
  defaultPrompts: InlinePromptSchema.optional(),

  // URL pattern with placeholders: "/{locale}/{instance.slug}/{page.slug}"
  urlPattern: z.string().optional(),
})

export type PageStructure = z.infer<typeof PageStructureSchema>

/**
 * Page override within an instance
 * Allows customizing sections/prompts for a specific page
 */
export const PageOverrideSchema = z.object({
  sections: z.array(PageSectionSchema).optional(),
  prompts: InlinePromptSchema.optional(),
  ai_hints: SiteAIHintsSchema.optional(),
})

export type PageOverride = z.infer<typeof PageOverrideSchema>

/**
 * Override configuration per collection instance
 * Allows skipping pages, adding custom pages, or overriding page configs
 */
export const InstanceOverrideSchema = z.object({
  instanceId: z.string(), // e.g., "corniglia"

  // Skip specific template pages for this instance
  skipPages: z.array(z.string()).optional(), // e.g., ["beaches"]

  // Add custom pages beyond the template (instance-specific)
  additionalPages: z.array(TemplatePageSchema).optional(),

  // Override specific page configurations
  pageOverrides: z.record(PageOverrideSchema).optional(), // keyed by page slug
})

export type InstanceOverride = z.infer<typeof InstanceOverrideSchema>

// ============================================================================
// Content Type (Page or Entity/Collection)
// ============================================================================

export const ContentTypeSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['page', 'entity']),
  icon: z.string().optional(),
  color: z.string().optional(),
  description: z.string().optional(),

  schema: z.object({
    sections: z.array(SectionDefinitionSchema).optional(), // For 'page' kind
    fields: z.array(FieldDefinitionSchema).optional(), // For 'entity' kind
  }).optional(),

  // Default prompts for all content of this type (can be overridden per-node)
  prompts: PromptTemplateSchema.optional(),

  // Quick AI hints (subset of prompts for simple cases)
  ai_hints: SiteAIHintsSchema.optional(),

  display: DisplayConfigSchema.optional(),

  // Page structure for collection types (Template + Override pattern)
  // Defines the sub-pages each collection instance gets automatically
  pageStructure: PageStructureSchema.optional(),
})

export type ContentType = z.infer<typeof ContentTypeSchema>

// ============================================================================
// Node Position
// ============================================================================

export const NodePositionSchema = z.object({
  x: z.number(),
  y: z.number(),
})

export type NodePosition = z.infer<typeof NodePositionSchema>

// ============================================================================
// Sitemap Node (matches site.json format)
// ============================================================================

export const SitemapNodeSchema = z.object({
  id: z.string(),
  type: z.string(), // References type ID (e.g., "landing-page", "collection:restaurants")
  position: NodePositionSchema.optional(),
  data: z.object({
    slug: z.string().optional(),
    title: LocalizedStringSchema.optional(),
    status: z.enum(['draft', 'in_progress', 'in_review', 'approved', 'published', 'archived']).optional(),
    prompts: PromptTemplateSchema.optional(),
    filter: z.record(z.any()).optional(), // For collection nodes

    // Template collection fields
    isTemplate: z.boolean().optional(), // true = collection has pageStructure
    instanceOverrides: z.array(InstanceOverrideSchema).optional(), // Per-instance customization
  }).optional(),
})

export type SitemapNode = z.infer<typeof SitemapNodeSchema>

// ============================================================================
// Sitemap Edge (matches site.json format)
// ============================================================================

export const SitemapEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  type: z.enum(['parent-child', 'collection-link']),
})

export type SitemapEdge = z.infer<typeof SitemapEdgeSchema>

// ============================================================================
// Agent Configuration
// ============================================================================

export const AgentConfigSchema = z.object({
  contentProduction: z.object({
    enabled: z.boolean().optional(),
    autoResearch: z.boolean().optional(),
    languages: z.array(z.string()).optional(),
    defaultWriter: z.string().nullable().optional(),
    defaultEditor: z.string().nullable().optional(),
  }).optional(),
  publishing: z.object({
    autoPublish: z.boolean().optional(),
    requireApproval: z.boolean().optional(),
    deployBranch: z.string().optional(),
    deployPath: z.string().optional(),
  }).optional(),
  seo: z.object({
    enabled: z.boolean().optional(),
    targetKeywords: z.array(z.string()).optional(),
    competitors: z.array(z.string()).optional(),
  }).optional(),
})

export type AgentConfig = z.infer<typeof AgentConfigSchema>

// ============================================================================
// Site Definition (Main Schema - matches site.json format)
// ============================================================================

export const SiteDefinitionSchema = z.object({
  // Identity
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  version: z.string().optional(),

  // Localization
  locales: z.array(z.string()),
  defaultLocale: z.string(),

  // Content Types (nested structure with pages and collections)
  types: z.object({
    pages: z.record(ContentTypeSchema).optional(),
    collections: z.record(ContentTypeSchema).optional(),
  }),

  // Sitemap Structure
  sitemap: z.object({
    nodes: z.array(SitemapNodeSchema),
    edges: z.array(SitemapEdgeSchema).optional(),
  }),

  // Agent Configuration
  agentConfig: AgentConfigSchema.optional(),

  // Metadata
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
})

export type SiteDefinition = z.infer<typeof SiteDefinitionSchema>

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get all content types (both pages and collections) as a flat record
 */
export function getAllTypes(siteDefinition: SiteDefinition): Record<string, ContentType> {
  const result: Record<string, ContentType> = {}

  if (siteDefinition.types.pages) {
    Object.entries(siteDefinition.types.pages).forEach(([id, type]) => {
      result[id] = type
    })
  }

  if (siteDefinition.types.collections) {
    Object.entries(siteDefinition.types.collections).forEach(([id, type]) => {
      result[`collection:${id}`] = type
    })
  }

  return result
}

/**
 * Check if a node type is a collection
 */
export function isCollectionNode(nodeType: string): boolean {
  return nodeType.startsWith('collection:')
}

/**
 * Get the collection ID from a node type (e.g., "collection:restaurants" -> "restaurants")
 */
export function getCollectionId(nodeType: string): string | null {
  if (!isCollectionNode(nodeType)) return null
  return nodeType.replace('collection:', '')
}

/**
 * Get localized value from a LocalizedString
 */
export function getLocalizedValue(
  value: LocalizedString | undefined,
  locale: string = 'en'
): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  return value[locale] || value['en'] || Object.values(value)[0] || ''
}

// ============================================================================
// Template Collection Helper Functions
// ============================================================================

/**
 * Check if a content type has a page structure (is a template collection)
 */
export function hasPageStructure(contentType: ContentType): boolean {
  return !!(contentType.pageStructure?.pages && contentType.pageStructure.pages.length > 0)
}

/**
 * Get instance override for a specific instance
 */
export function getInstanceOverride(
  node: SitemapNode,
  instanceId: string
): InstanceOverride | undefined {
  return node.data?.instanceOverrides?.find((o) => o.instanceId === instanceId)
}

/**
 * Check if a template page is skipped for an instance
 */
export function isPageSkipped(
  override: InstanceOverride | undefined,
  pageSlug: string
): boolean {
  return override?.skipPages?.includes(pageSlug) ?? false
}

/**
 * Get page override for a specific page within an instance
 */
export function getPageOverride(
  override: InstanceOverride | undefined,
  pageSlug: string
): PageOverride | undefined {
  return override?.pageOverrides?.[pageSlug]
}

/**
 * Resolve filter template with instance context
 * Replaces {{instance.id}}, {{instance.slug}}, etc. with actual values
 */
export function resolveFilterTemplate(
  filterTemplate: string,
  instance: { id: string; slug?: string; [key: string]: unknown }
): Record<string, unknown> {
  let resolved = filterTemplate

  // Replace instance placeholders
  resolved = resolved.replace(/\{\{instance\.(\w+)\}\}/g, (_, key) => {
    const value = instance[key]
    return typeof value === 'string' ? value : String(value ?? '')
  })

  try {
    return JSON.parse(resolved)
  } catch {
    console.error('Failed to parse filter template:', filterTemplate)
    return {}
  }
}
