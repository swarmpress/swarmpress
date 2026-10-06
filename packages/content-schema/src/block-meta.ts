import { z } from 'zod'
import blockMetaJson from '../data/block-meta.json'
import { CORE_BLOCK_TYPES } from './v2'

/**
 * Per-block semantics (FEAT-089, ADR-0072): narrative intent, media
 * requirements and linking rules for every core block type.
 *
 * The data is `data/block-meta.json`, the one source for both sides: this
 * module parses it, and the export script copies it verbatim to
 * `crates/content-schema/schema/block-meta.json`, which
 * `content_model::blocks` reads (`pnpm schema:check` fails on drift). The
 * blueprint colours a block's storey by its intent (design §4.2).
 */

export const BLOCK_META_FORMAT = 'swarmpress.block-meta.v1'

export const IntentSchema = z.enum(['showcase', 'inform', 'navigate', 'convert', 'compare', 'orient', 'engage'])
export const BlockCategorySchema = z.enum(['core', 'section', 'theme', 'editorial', 'template', 'custom'])

export const MediaRequirementsSchema = z
  .object({
    required: z.boolean(),
    min: z.number().int().min(0),
    max: z.number().int().min(0),
    entityMatch: z.enum(['strict', 'category', 'none']),
    allowedCategories: z.array(z.string()).optional(),
    aspectRatio: z.enum(['square', 'video', 'portrait', 'landscape', 'any']).optional(),
  })
  .strict()
  .refine((m) => m.min <= m.max, { message: 'min must not exceed max' })

export const LinkingRulesSchema = z
  .object({
    minLinks: z.number().int().min(0),
    maxLinks: z.number().int().min(0),
    allowedTargets: z.array(z.string()).default([]),
    anchorGuidance: z.string().optional(),
  })
  .strict()

export const BlockMetaSchema = z
  .object({
    type: z.string().min(1),
    category: BlockCategorySchema,
    intent: IntentSchema,
    description: z.string().min(1),
    media: MediaRequirementsSchema.optional(),
    linking: LinkingRulesSchema.optional(),
    context: z.array(z.string()).optional(),
  })
  .strict()

export const BlockMetaFileSchema = z
  .object({
    format: z.literal(BLOCK_META_FORMAT),
    blocks: z.array(BlockMetaSchema),
  })
  .strict()

export type Intent = z.infer<typeof IntentSchema>
export type BlockMeta = z.infer<typeof BlockMetaSchema>

/** The core block metadata, in schema order. */
export const BLOCK_META: readonly BlockMeta[] = BlockMetaFileSchema.parse(blockMetaJson).blocks

const BY_TYPE = new Map(BLOCK_META.map((m) => [m.type, m]))

/** A core block's metadata. */
export function blockMeta(type: string): BlockMeta | undefined {
  return BY_TYPE.get(type)
}

/** Core block types without metadata, and metadata for unknown types: both must be empty. */
export function blockMetaDrift(): { missing: string[]; unknown: string[] } {
  const core = new Set<string>(CORE_BLOCK_TYPES)
  return {
    missing: CORE_BLOCK_TYPES.filter((t) => !BY_TYPE.has(t)),
    unknown: BLOCK_META.map((m) => m.type).filter((t) => !core.has(t)),
  }
}
