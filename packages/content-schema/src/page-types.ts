import { z } from 'zod'
import { LocalizedStringSchema } from './page'
import { CORE_BLOCK_TYPES } from './v2'

/**
 * The page-type registry (FEAT-089, ADR-0072): what a page of each type may
 * hold, as data instead of code.
 *
 * A page type's `slots` are ordered: a page's body is the blocks of its
 * first slot, then those of the second, and so on. A slot names the block
 * types it holds and how many (`min`, `max`; no `max` means any number). The
 * slots of one type name disjoint block sets, so every block belongs to
 * exactly one slot and the order check needs no search. A type without
 * `slots` does not constrain its body.
 *
 * `CORE_PAGE_TYPES` are the types the platform itself has rules for. A site
 * declares its own in `content/config/page-types.json` (the same format).
 * The export script writes both the format and the core registry as JSON
 * for the Rust side (`crates/content-schema/schema/`), so the gateway, the
 * browser and the site kit read one definition.
 */

export const PAGE_TYPES_FORMAT = 'swarmpress.page-types.v1'

/** Page-type and slot ids: lowercase kebab-case. */
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/
/** A core block type or a site custom block (`x:<name>`). */
const BLOCK_ID = /^(x:)?[a-z0-9]+(-[a-z0-9]+)*$/

export const SlotSchema = z
  .object({
    id: z.string().regex(KEBAB),
    /** The block types this slot holds. */
    blocks: z.array(z.string().regex(BLOCK_ID)).min(1),
    min: z.number().int().min(0).default(0),
    /** Absent: any number. */
    max: z.number().int().min(1).optional(),
  })
  .strict()
  .refine((s) => s.max === undefined || s.min <= s.max, { message: 'min must not exceed max' })

export const PageTypeSchema = z
  .object({
    id: z.string().regex(KEBAB),
    label: LocalizedStringSchema,
    /** Other `page_type` values that mean this type (legacy spellings). */
    aliases: z.array(z.string().regex(KEBAB)).default([]),
    /**
     * Route pattern with `{lang}` and `{slug}` placeholders, when every page
     * of the type has the same shape of route.
     */
    route: z.string().startsWith('/').optional(),
    slots: z.array(SlotSchema).optional(),
    /** Blocks the body must hold at least `min` of, wherever they stand. */
    require: z
      .array(z.object({ block: z.string().regex(BLOCK_ID), min: z.number().int().min(1) }).strict())
      .default([]),
    /** Fields the theme prints as HTML: they must not hold a raw `<` or `>`. */
    html_fields: z
      .array(z.object({ block: z.string().regex(BLOCK_ID), field: z.string().min(1) }).strict())
      .default([]),
  })
  .strict()
  .superRefine((t, ctx) => {
    const seen = new Map<string, string>()
    const slotIds = new Set<string>()
    for (const slot of t.slots ?? []) {
      if (slotIds.has(slot.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `slot ${slot.id} is declared twice` })
      }
      slotIds.add(slot.id)
      for (const block of slot.blocks) {
        const other = seen.get(block)
        if (other !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `block ${block} is in slots ${other} and ${slot.id}: a block belongs to one slot`,
          })
        }
        seen.set(block, slot.id)
      }
    }
  })

export const PageTypesFileSchema = z
  .object({
    format: z.literal(PAGE_TYPES_FORMAT),
    page_types: z.array(PageTypeSchema),
  })
  .strict()
  .superRefine((f, ctx) => {
    const names = new Set<string>()
    for (const t of f.page_types) {
      for (const name of [t.id, ...t.aliases]) {
        if (names.has(name)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `page type ${name} is declared twice` })
        }
        names.add(name)
      }
    }
  })

export type Slot = z.infer<typeof SlotSchema>
export type PageType = z.infer<typeof PageTypeSchema>
export type PageTypesFile = z.infer<typeof PageTypesFileSchema>

/** The article: what the orchestrator assembles and the frozen theme renders (ADR-0061). */
const ARTICLE: z.input<typeof PageTypeSchema> = {
  id: 'blog-article',
  label: { en: 'Article' },
  aliases: ['blog-post', 'article'],
  route: '/{lang}/blog/{slug}',
  slots: [
    { id: 'hero', blocks: ['editorial-hero'], min: 1, max: 1 },
    { id: 'body', blocks: ['heading', 'paragraph', 'list', 'callout', 'image'] },
    { id: 'closing', blocks: ['closing-note'], min: 1, max: 1 },
  ],
  require: [{ block: 'paragraph', min: 1 }],
  html_fields: [
    { block: 'editorial-hero', field: 'title' },
    { block: 'closing-note', field: 'content' },
  ],
}

/** The hand-curated story list; only the gateway's finalise step writes it. */
const BLOG_INDEX: z.input<typeof PageTypeSchema> = {
  id: 'blog-index',
  label: { en: 'Blog index' },
}

export const CORE_PAGE_TYPES: PageTypesFile = PageTypesFileSchema.parse({
  format: PAGE_TYPES_FORMAT,
  page_types: [ARTICLE, BLOG_INDEX],
})

/** The core type a `page_type` value names, by id or alias. */
export function resolvePageType(name: string, registry: PageTypesFile = CORE_PAGE_TYPES): PageType | undefined {
  return registry.page_types.find((t) => t.id === name || t.aliases.includes(name))
}

/** Whether a `page_type` value is the article type (by id or alias). */
export function isArticleType(name: string): boolean {
  return resolvePageType(name)?.id === 'blog-article'
}

/** Every core block a core page type names is a core block type. */
export function unknownCoreBlocks(registry: PageTypesFile = CORE_PAGE_TYPES): string[] {
  const core = new Set<string>(CORE_BLOCK_TYPES)
  const named = registry.page_types.flatMap((t) => [
    ...(t.slots ?? []).flatMap((s) => s.blocks),
    ...t.require.map((r) => r.block),
    ...t.html_fields.map((h) => h.block),
  ])
  return [...new Set(named)].filter((b) => !b.startsWith('x:') && !core.has(b))
}
