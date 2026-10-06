/**
 * The brick canvas's colours (design §4.2, §4.3): a block's storey takes the
 * colour of its intent, exactly as the town does (`intent_colour` in
 * `crates/blueprint/src/town.rs`), and a tool's tube the colour of the type
 * flowing through it. Colours are palette ids of `kit/palette.json`, so the
 * canvas and the bricks agree; the hex values come from the palette itself.
 */
import paletteJson from '../../../../kit/palette.json'
import blockMetaJson from '../../../../packages/content-schema/data/block-meta.json'
import type { Intent } from './types'

interface PaletteEntry {
  id: string
  name: string
  hex: string
  class: string
}

export const PALETTE: readonly PaletteEntry[] = (paletteJson as { colours: PaletteEntry[] }).colours
const HEX = new Map(PALETTE.map((c) => [c.id, c.hex]))

/** The hex of a palette colour (grey for an id the palette does not have). */
export function hexOf(id: string): string {
  return HEX.get(id) ?? '#a3a8ab'
}

/** The brick colour of a block intent (fixed: players learn it). Mirrors town.rs `intent_colour`. */
export const INTENT_COLOUR: Readonly<Record<Intent, string>> = {
  showcase: 'orange',
  inform: 'blue',
  navigate: 'green',
  convert: 'red',
  compare: 'yellow',
  orient: 'sand',
  engage: 'plum',
}

/** A block of the closed catalogue (`packages/content-schema/data/block-meta.json`). */
export interface CatalogueBlock {
  type: string
  category: string
  intent: Intent
  description: string
}

/** The core block catalogue, in schema order (the same data `BLOCK_META` parses). */
export const CATALOGUE: readonly CatalogueBlock[] = (blockMetaJson as { blocks: CatalogueBlock[] }).blocks.map((b) => ({
  type: b.type,
  category: b.category,
  intent: b.intent,
  description: b.description,
}))
const BY_TYPE = new Map(CATALOGUE.map((b) => [b.type, b]))

export function catalogueBlock(type: string): CatalogueBlock | undefined {
  return BY_TYPE.get(type)
}

/** The palette id of a block's storey: its intent's colour, `grey-light` for a block without metadata (a site's own). */
export function blockColour(type: string | undefined): string {
  const b = type ? BY_TYPE.get(type) : undefined
  return b ? INTENT_COLOUR[b.intent] : 'grey-light'
}

/** The categories of the catalogue in the order the parts bin shows them. */
export const CATEGORY_LABEL: Readonly<Record<string, string>> = {
  core: 'Core',
  section: 'Sections',
  editorial: 'Editorial',
  theme: 'Theme',
  template: 'Templates',
  custom: 'This site',
}

/** Built-in types have fixed tube colours (design §4.3); a site's own types hash into the rest. */
export const TYPE_COLOUR: Readonly<Record<string, string>> = {
  string: 'white',
  number: 'grey-light',
  integer: 'grey-light',
  boolean: 'grey-dark',
  url: 'denim',
  LocalizedString: 'sand',
  Article: 'blue',
  Media: 'green',
  Page: 'navy',
}

/** Solid colours left for a site's own types: not the fixed ones, not red (issues) and not black (the ink). */
const SPARE: readonly string[] = PALETTE.filter(
  (c) => c.class === 'solid' && !Object.values(TYPE_COLOUR).includes(c.id) && !['red', 'red-dark', 'black'].includes(c.id),
).map((c) => c.id)

/** FNV-1a over UTF-16 code units: stable across sessions and engines. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

/** The palette id of a type's tube; a list (`T[]`) has the colour of `T`. */
export function typeColour(type: string | null | undefined): string {
  if (!type) return 'grey-light'
  const base = type.replace(/(\[\])+$/, '')
  return TYPE_COLOUR[base] ?? SPARE[fnv1a(base) % SPARE.length]
}

/** Black or white text on a palette colour, by luminance. */
export function inkOn(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#1b1f2a' : '#f2f0ea'
}
