import { z } from 'zod'

/**
 * Inline Prompt Schemas
 *
 * These schemas define inline prompt configurations that can be used
 * directly in site definitions without requiring the full 3-level
 * prompt management system.
 *
 * Extracted to avoid circular dependencies between:
 * - site-definition.ts (imports PageSectionSchema)
 * - page-section.ts (imports InlinePromptSchema)
 */

// ============================================================================
// AI Hints (simplified version for quick configuration)
// ============================================================================

export const SiteAIHintsSchema = z.object({
  purpose: z.string().optional(),
  tone: z.string().optional(),
  audience: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  contentGuidelines: z.array(z.string()).optional(),
  examples: z.array(z.string()).optional(),
  avoid: z.array(z.string()).optional(),
})

export type SiteAIHints = z.infer<typeof SiteAIHintsSchema>

// ============================================================================
// Per-Field Hints (for granular control over text and media generation)
// ============================================================================

/**
 * Text field hint - routed to Writer Agent
 */
export const TextFieldHintSchema = z.object({
  prompt: z.string().optional(), // Specific instructions for this field
  tone: z.string().optional(), // Override section tone for this field
  maxLength: z.number().optional(), // Character/word limit
  examples: z.array(z.string()).optional(), // Example content
})

export type TextFieldHint = z.infer<typeof TextFieldHintSchema>

/**
 * Media field hint - routed to Media Production Agent
 */
export const MediaFieldHintSchema = z.object({
  prompt: z.string().optional(), // Description of desired image/video
  style: z.enum([
    'photographic',
    'illustration',
    'icon',
    '3d-render',
    'artistic',
    'minimal',
    'stock-photo',
  ]).optional(),
  mood: z.string().optional(), // e.g., "warm, inviting", "professional, clean"
  aspectRatio: z.enum(['1:1', '4:3', '16:9', '3:2', '2:3', '9:16', 'auto']).optional(),
  subjects: z.array(z.string()).optional(), // What should be in the image
  colorPalette: z.array(z.string()).optional(), // Preferred colors
  avoid: z.array(z.string()).optional(), // What to avoid in the image
})

export type MediaFieldHint = z.infer<typeof MediaFieldHintSchema>

/**
 * Union of text and media field hints
 */
export const FieldHintSchema = z.union([
  TextFieldHintSchema.extend({ _type: z.literal('text').optional() }),
  MediaFieldHintSchema.extend({ _type: z.literal('media').optional() }),
])

export type FieldHint = z.infer<typeof FieldHintSchema>

/**
 * Map of field name to hint
 */
export const FieldHintsMapSchema = z.record(z.string(), FieldHintSchema)

export type FieldHintsMap = z.infer<typeof FieldHintsMapSchema>

// ============================================================================
// Inline Prompt (for quick configuration in site definition)
// ============================================================================

export const InlinePromptSchema = z.object({
  type: z.literal('inline').optional(), // Default type

  // Core prompt content
  systemPrompt: z.string().optional(), // Base system prompt
  researchPrompt: z.string().optional(), // How to research this content
  writingPrompt: z.string().optional(), // How to write this content
  reviewPrompt: z.string().optional(), // How to review this content

  // Style guidance
  tone: z.string().optional(), // e.g., "informative, welcoming, inspiring"
  perspective: z.enum(['first_person', 'second_person', 'third_person']).optional(),
  formality: z.enum(['casual', 'neutral', 'formal']).optional(),

  // Content guidance
  keywords: z.array(z.string()).optional(), // SEO keywords to include
  avoid: z.array(z.string()).optional(), // Things to avoid
  examples: z.array(z.string()).optional(), // Reference examples

  // Constraints
  minWordCount: z.number().optional(),
  maxWordCount: z.number().optional(),
  requiredSections: z.array(z.string()).optional(),

  // Variables (placeholders that get replaced at runtime)
  variables: z.record(z.string()).optional(), // e.g., { "city": "Monterosso", "region": "Cinque Terre" }

  // Per-field hints (for granular control over individual content fields)
  // Keys are field names from the section's contentFields
  // Text fields: { prompt, tone, maxLength, examples }
  // Media fields: { prompt, style, mood, aspectRatio, subjects, colorPalette, avoid }
  fieldHints: FieldHintsMapSchema.optional(),
})

export type InlinePrompt = z.infer<typeof InlinePromptSchema>

// ============================================================================
// Prompt Reference (for linking to PostgreSQL prompt system)
// ============================================================================

export const PromptReferenceSchema = z.object({
  type: z.literal('reference'),
  companyPromptId: z.string().uuid().optional(), // Company-level prompt ID
  websitePromptId: z.string().uuid().optional(), // Website-level override ID
  capability: z.string().optional(), // Capability name (e.g., 'content_writing')
})

export type PromptReference = z.infer<typeof PromptReferenceSchema>

// ============================================================================
// Prompt Template (union of inline and reference)
// ============================================================================

export const PromptTemplateSchema = z.union([
  InlinePromptSchema,
  PromptReferenceSchema,
])

export type PromptTemplate = z.infer<typeof PromptTemplateSchema>

/**
 * Helper to check if a prompt is a reference
 */
export function isPromptReference(prompt: PromptTemplate): prompt is PromptReference {
  return 'type' in prompt && prompt.type === 'reference'
}
