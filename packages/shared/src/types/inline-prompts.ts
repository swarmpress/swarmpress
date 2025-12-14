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
