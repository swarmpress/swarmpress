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
// Section Version (for tracking content history)
// ============================================================================

export const SectionVersionSchema = z.object({
  id: z.string(), // Version ID (UUID or timestamp-based)
  content: z.record(z.unknown()), // Snapshot of the content at this version
  timestamp: z.string(), // ISO timestamp when version was created
  source: z.enum(['human', 'ai']), // Who created this version
  agentId: z.string().optional(), // If AI, which agent created it
  agentName: z.string().optional(), // Agent's display name
  message: z.string().optional(), // Optional description of changes
})

export type SectionVersion = z.infer<typeof SectionVersionSchema>

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

  // Version History (for tracking changes over time)
  versions: z.array(SectionVersionSchema).optional(), // Array of previous versions
  currentVersionId: z.string().optional(), // ID of the current active version

  // Metadata
  locked: z.boolean().nullish(), // Prevent accidental edits
  notes: z.string().nullish(), // Internal notes for editors
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

// ============================================================================
// Version Management Helpers
// ============================================================================

/**
 * Generate a unique version ID
 */
export function generateVersionId(): string {
  return `v_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Create a new version snapshot from current content
 */
export function createVersion(
  content: Record<string, unknown>,
  source: 'human' | 'ai',
  options?: {
    agentId?: string
    agentName?: string
    message?: string
  }
): SectionVersion {
  return {
    id: generateVersionId(),
    content,
    timestamp: new Date().toISOString(),
    source,
    agentId: options?.agentId,
    agentName: options?.agentName,
    message: options?.message,
  }
}

/**
 * Add a version to a section's history
 * Returns a new section with the version added
 */
export function addVersionToSection(
  section: PageSection,
  version: SectionVersion
): PageSection {
  const versions = section.versions || []
  return {
    ...section,
    versions: [...versions, version],
    currentVersionId: version.id,
  }
}

/**
 * Get a specific version from a section's history
 */
export function getVersion(
  section: PageSection,
  versionId: string
): SectionVersion | undefined {
  return section.versions?.find((v) => v.id === versionId)
}

/**
 * Restore a section to a specific version
 * Returns a new section with the content from that version
 */
export function restoreVersion(
  section: PageSection,
  versionId: string
): PageSection | null {
  const version = getVersion(section, versionId)
  if (!version) return null

  return {
    ...section,
    content: version.content,
    currentVersionId: versionId,
  }
}

/**
 * Get the version history of a section (sorted by timestamp, newest first)
 */
export function getVersionHistory(section: PageSection): SectionVersion[] {
  return [...(section.versions || [])].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  )
}

/**
 * Check if section has version history
 */
export function hasVersionHistory(section: PageSection): boolean {
  return !!(section.versions && section.versions.length > 0)
}
