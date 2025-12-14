import { z } from 'zod'
import { InlinePromptSchema } from './inline-prompts'

/**
 * Page Section Schemas
 *
 * These schemas define the structure of sections within a page.
 * Each page's `body` array contains sections that can have:
 * - AI prompts for content generation
 * - AI hints for style guidance
 * - Collection bindings for dynamic data
 */

// ============================================================================
// Page Section AI Hints (detailed version for section-level guidance)
// Note: Named with Page prefix to avoid conflict with AIHints in sitemap.ts
// ============================================================================

export const PageAIHintsSchema = z.object({
  purpose: z.string().optional(), // What this section should accomplish
  tone: z.string().optional(), // e.g., "welcoming", "professional", "casual"
  wordRange: z.object({
    min: z.number(),
    max: z.number(),
  }).optional(),
  keywords: z.array(z.string()).optional(), // SEO keywords to include
  style: z.string().optional(), // Writing style guidance
  examples: z.array(z.string()).optional(), // Reference examples
  audience: z.string().optional(), // Target audience description
  avoid: z.array(z.string()).optional(), // Things to avoid
})

export type PageAIHints = z.infer<typeof PageAIHintsSchema>

// ============================================================================
// Collection Source (for binding sections to dynamic data)
// ============================================================================

export const CollectionSourceSchema = z.object({
  collection: z.string(), // Collection type (e.g., "villages", "events", "blog")
  filter: z.record(z.unknown()).optional(), // Filter criteria
  limit: z.number().optional(), // Max items to fetch
  sort: z.object({
    field: z.string(),
    direction: z.enum(['asc', 'desc']),
  }).optional(),
  offset: z.number().optional(), // Skip first N items
})

export type CollectionSource = z.infer<typeof CollectionSourceSchema>

// ============================================================================
// Page Section
// ============================================================================

export const PageSectionSchema = z.object({
  id: z.string(), // Unique section ID (e.g., "hero-1", "features-2")
  type: z.string(), // Section type (e.g., "hero-section", "feature-section")
  variant: z.string().optional(), // Variant (e.g., "split-with-image", "simple-grid")
  order: z.number(), // Sort order (0-indexed)

  // Content (varies by section type, can be any JSON)
  // This is what gets rendered - title, subtitle, features array, etc.
  content: z.record(z.unknown()).optional(),

  // AI Configuration (for agent content generation)
  prompts: InlinePromptSchema.optional(), // Full prompt configuration
  ai_hints: PageAIHintsSchema.optional(), // Quick style guidance

  // Collection Binding (for dynamic data sections)
  collectionSource: CollectionSourceSchema.optional(),

  // Metadata
  locked: z.boolean().optional(), // Prevent accidental edits
  notes: z.string().optional(), // Internal notes for editors
})

export type PageSection = z.infer<typeof PageSectionSchema>

// ============================================================================
// Page Body (array of sections)
// ============================================================================

export const PageBodySchema = z.array(PageSectionSchema)

export type PageBody = z.infer<typeof PageBodySchema>

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if a section has AI configuration (prompts or hints)
 */
export function hasAIConfig(section: PageSection): boolean {
  return !!(section.prompts || section.ai_hints)
}

/**
 * Check if a section is bound to a collection
 */
export function hasCollectionBinding(section: PageSection): boolean {
  return !!section.collectionSource
}

/**
 * Generate a unique section ID
 */
export function generateSectionId(type: string, existingIds: string[]): string {
  const baseId = type.replace('-section', '')
  let counter = 1
  let id = `${baseId}-${counter}`
  while (existingIds.includes(id)) {
    counter++
    id = `${baseId}-${counter}`
  }
  return id
}

/**
 * Reorder sections and update their order property
 */
export function reorderSections(
  sections: PageSection[],
  fromIndex: number,
  toIndex: number
): PageSection[] {
  const result = [...sections]
  const removed = result.splice(fromIndex, 1)[0]
  if (!removed) return sections // Guard against invalid index
  result.splice(toIndex, 0, removed)
  return result.map((section, index) => ({
    ...section,
    order: index,
  }))
}
