import { z } from 'zod'

/**
 * JSON Block Model — Canonical content format for agent.press
 * See: /domain/content-model/JSON_BLOCK_MODEL.md
 */

// ============================================================================
// Base Types
// ============================================================================

const ImageObjectSchema = z.object({
  src: z.string().url(),
  alt: z.string(),
  caption: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
})

const FAQItemSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
})

// ============================================================================
// Block Schemas
// ============================================================================

export const ParagraphBlockSchema = z.object({
  type: z.literal('paragraph'),
  markdown: z.string().min(1),
})

export const HeadingBlockSchema = z.object({
  type: z.literal('heading'),
  level: z.union([z.literal(2), z.literal(3), z.literal(4)]),
  text: z.string().min(1),
  id: z.string().optional(),
})

export const HeroBlockSchema = z.object({
  type: z.literal('hero'),
  title: z.string().min(1),
  subtitle: z.string().optional(),
  backgroundImage: z.string().url().optional(),
})

export const ImageBlockSchema = z.object({
  type: z.literal('image'),
  src: z.string().min(1), // URL or S3 path
  alt: z.string().min(1),
  caption: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
})

export const GalleryBlockSchema = z.object({
  type: z.literal('gallery'),
  layout: z.enum(['grid', 'carousel', 'masonry']),
  images: z.array(ImageObjectSchema).min(1),
})

export const QuoteBlockSchema = z.object({
  type: z.literal('quote'),
  text: z.string().min(1),
  attribution: z.string().optional(),
})

export const ListBlockSchema = z.object({
  type: z.literal('list'),
  ordered: z.boolean(),
  items: z.array(z.string().min(1)).min(1),
})

export const FAQBlockSchema = z.object({
  type: z.literal('faq'),
  items: z.array(FAQItemSchema).min(1),
})

export const CalloutBlockSchema = z.object({
  type: z.literal('callout'),
  style: z.enum(['info', 'warning', 'success', 'error']),
  title: z.string().optional(),
  content: z.string().min(1),
})

export const EmbedBlockSchema = z.object({
  type: z.literal('embed'),
  provider: z.enum(['youtube', 'vimeo', 'maps', 'custom']),
  url: z.string().url(),
  title: z.string().optional(),
})

// ============================================================================
// Union of All Blocks
// ============================================================================

export const ContentBlockSchema = z.discriminatedUnion('type', [
  ParagraphBlockSchema,
  HeadingBlockSchema,
  HeroBlockSchema,
  ImageBlockSchema,
  GalleryBlockSchema,
  QuoteBlockSchema,
  ListBlockSchema,
  FAQBlockSchema,
  CalloutBlockSchema,
  EmbedBlockSchema,
])

export const ContentBlocksSchema = z.array(ContentBlockSchema)

// ============================================================================
// TypeScript Types
// ============================================================================

export type ParagraphBlock = z.infer<typeof ParagraphBlockSchema>
export type HeadingBlock = z.infer<typeof HeadingBlockSchema>
export type HeroBlock = z.infer<typeof HeroBlockSchema>
export type ImageBlock = z.infer<typeof ImageBlockSchema>
export type GalleryBlock = z.infer<typeof GalleryBlockSchema>
export type QuoteBlock = z.infer<typeof QuoteBlockSchema>
export type ListBlock = z.infer<typeof ListBlockSchema>
export type FAQBlock = z.infer<typeof FAQBlockSchema>
export type CalloutBlock = z.infer<typeof CalloutBlockSchema>
export type EmbedBlock = z.infer<typeof EmbedBlockSchema>

export type ContentBlock = z.infer<typeof ContentBlockSchema>
export type ContentBlocks = z.infer<typeof ContentBlocksSchema>

// ============================================================================
// Validation Helper
// ============================================================================

/**
 * Validate an array of content blocks
 * @throws ZodError if validation fails
 */
export function validateContentBlocks(blocks: unknown): ContentBlocks {
  return ContentBlocksSchema.parse(blocks)
}

/**
 * Safely validate content blocks
 * Returns { success: true, data } or { success: false, error }
 */
export function safeValidateContentBlocks(blocks: unknown) {
  return ContentBlocksSchema.safeParse(blocks)
}
