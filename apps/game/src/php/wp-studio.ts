/**
 * The Brick Studio over a WordPress site (ADR-0082 §4, ADR-0077; plan M6): WordPress's structures in
 * the Studio's grammar, so its workbenches, checker, diff and booklet work unchanged.
 *
 * - **Town:** the site's post types as buildings (`post`, `page` and public custom types).
 * - **Building:** a post type's block template as storeys. A storey is a *region*: a locked group
 *   whose inner blocks are the region's allowed blocks (a repeatable region has no `max`). The
 *   regions live in the governed option `swarmpress_post_type_templates`, which the sandbox's
 *   must-use plugin applies to the post type; a post type without regions is one free region.
 * - **Blocks:** WordPress's block registry is the checker's block set (`custom_blocks`).
 * - **Paint shop:** the theme's palette from `theme.json`, overridden in the user's global styles.
 * - **Sets:** the site's plugins, each "not governed" unless the governed layer types its data.
 *
 * Every edit is a commit on a `studio-…` branch with a change request, which the CEO's build merges
 * (ADR-0077 §3: the CEO's edits land when the CEO builds them).
 */
import type { Blueprint, BlueprintPageType, BlueprintSlot, SiteModels } from '../blueprint/types'

/** WordPress post types that are not page types of the site. */
const INTERNAL_TYPES = new Set(['attachment', 'nav_menu_item', 'wp_block', 'wp_template', 'wp_template_part', 'wp_global_styles', 'wp_navigation', 'wp_font_family', 'wp_font_face', 'custom_css', 'customize_changeset', 'oembed_cache', 'user_request', 'revision'])

/** The free region of a post type without a template: WordPress's common blocks. */
export const FREE_REGION_BLOCKS = ['core/paragraph', 'core/heading', 'core/list', 'core/image', 'core/quote', 'core/gallery', 'core/buttons', 'core/columns', 'core/group', 'core/separator', 'core/table', 'core/embed']

export interface WpRegion {
  id: string
  blocks: string[]
  min?: number
  max?: number
}

export type WpTemplates = Record<string, { regions: WpRegion[] }>

export interface WpPaletteColor {
  slug: string
  name: string
  color: string
}

export interface WpPlugin {
  plugin: string
  name: string
  status: string
  /** Whether the governed layer types this plugin's data (else its tables are scratch). */
  governed: boolean
}

/** What the Studio reads from a WordPress site's `live` (WpSiteEngine.readStudio). */
export interface WpStudio {
  head: string
  postTypes: { slug: string; name: string; hierarchical: boolean }[]
  templates: WpTemplates
  blockTypes: string[]
  plugins: WpPlugin[]
  /** The theme's palette with the user's overrides applied. */
  palette: WpPaletteColor[]
  /** The user's global styles post (where the Paint shop's edits go), when the theme has one. */
  userStylesId: number | null
}

/** The SiteModels the Studio's workbenches read, plus the WordPress-only parts. */
export interface WordPressModels extends SiteModels {
  engine: 'wordpress'
  plugins: WpPlugin[]
  palette: WpPaletteColor[]
}

/** The subset of blueprint-wasm the adapter calls. */
export interface WpBlueprintApi {
  hashBlueprint(bp: string): string
  townDesign?(bp: string, flagged: string): string
}

/** A post type's storeys: its regions as slots, or one free slot. */
function slotsOf(slug: string, studio: WpStudio): BlueprintSlot[] {
  const regions = studio.templates[slug]?.regions
  const known = new Set(studio.blockTypes)
  if (regions?.length) return regions.map((r) => ({ id: r.id, blocks: r.blocks.filter((b) => known.has(b)), min: r.min ?? 0, ...(r.max ? { max: r.max } : {}) }))
  return [{ id: 'content', blocks: FREE_REGION_BLOCKS.filter((b) => known.has(b)), min: 0 }]
}

/** WordPress's structures as the Studio's blueprint. */
export function wordpressBlueprint(studio: WpStudio): Blueprint {
  const pageTypes: BlueprintPageType[] = studio.postTypes
    .filter((t) => !INTERNAL_TYPES.has(t.slug))
    .map((t) => ({ id: t.slug, label: { en: t.name }, route: '/{slug}/', source: { kind: 'page' as const }, slots: slotsOf(t.slug, studio) }))
  return { format: 'swarmpress.blueprint.v1', page_types: pageTypes, navigation: pageTypes.map((t) => ({ page_type: t.id })) }
}

export function wordpressModels(studio: WpStudio, api: WpBlueprintApi): WordPressModels {
  const blueprint = wordpressBlueprint(studio)
  const text = JSON.stringify(blueprint)
  let town: Record<string, unknown> = {}
  try {
    town = api.townDesign ? (JSON.parse(api.townDesign(text, '[]')) as Record<string, unknown>) : {}
  } catch {
    town = {}
  }
  return {
    engine: 'wordpress',
    commit: studio.head,
    source: 'repo',
    hash: api.hashBlueprint(text),
    blueprint,
    types: {},
    issues: [],
    tools: [],
    tool_errors: [],
    context: { custom_blocks: studio.blockTypes, sections: [], collections: [] },
    kit_theme: false,
    tokens: studio.palette.map((c) => [`--wp--preset--color--${c.slug}`, c.color]),
    town,
    plugins: studio.plugins,
    palette: studio.palette,
  }
}

/**
 * The regions a saved blueprint asks for, per existing post type; a page type WordPress does not
 * have is refused (a new post type is code, a plugin's job), as is a region without blocks.
 */
export function regionsOf(blueprint: Blueprint, studio: WpStudio): { templates: WpTemplates; refused: string[] } {
  const types = new Set(studio.postTypes.map((t) => t.slug))
  const templates: WpTemplates = { ...studio.templates }
  const refused: string[] = []
  for (const t of blueprint.page_types) {
    if (!types.has(t.id)) {
      refused.push(`${t.id}: a new post type is code (a plugin), not an edit`)
      continue
    }
    const slots = t.slots ?? []
    const free = slots.length === 1 && slots[0].id === 'content' && (slots[0].min ?? 0) === 0 && !slots[0].max && sameSet(slots[0].blocks, FREE_REGION_BLOCKS.filter((b) => studio.blockTypes.includes(b)))
    if (free) {
      delete templates[t.id]
      continue
    }
    const regions: WpRegion[] = []
    for (const s of slots) {
      if (!s.blocks.length) refused.push(`${t.id}/${s.id}: a region has at least one block`)
      regions.push({ id: s.id, blocks: s.blocks, ...(s.min ? { min: s.min } : {}), ...(s.max ? { max: s.max } : {}) })
    }
    templates[t.id] = { regions }
  }
  return { templates, refused }
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x))
}
