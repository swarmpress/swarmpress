/**
 * The `defineTheme` contract. A theme owns presentation only: tokens,
 * layouts, chrome, block renderers, custom blocks and islands. Routing,
 * content, i18n, SEO and the tracker belong to the kit.
 *
 * Convention over configuration: anything under the theme dir is discovered
 * automatically, and `theme.config.ts` may override it explicitly.
 *
 *   theme/
 *   ├── theme.config.ts        export default defineTheme({ … })
 *   ├── tokens.json            W3C design tokens → Tailwind 4 @theme + :root vars
 *   ├── styles.css             optional extra CSS (Tailwind utilities available)
 *   ├── layouts/<Name>.astro   Base, Page, Article, Region, CollectionIndex, CollectionItem, NotFound
 *   ├── chrome/<Name>.astro    Header, Footer, LanguageSwitcher, RegionNav
 *   ├── blocks/<type>.astro    core block overrides (paragraph.astro, editorial-hero.astro, …)
 *   ├── blocks/<name>/         custom block x:<name>: schema.json, Component.astro, example.json
 *   ├── i18n/<lang>.json       UI strings for t()
 *   └── islands/               React islands (client:visible only)
 */
import { isCoreBlock, isValidCustomBlockName } from '@swarm-press/content-schema'
import type { UiStrings } from './i18n'
import type { DesignTokens } from './tokens'

/** An Astro component (opaque to the kit). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AstroComponent = any

export const LAYOUT_NAMES = ['Base', 'Page', 'Article', 'Region', 'CollectionIndex', 'CollectionItem', 'NotFound'] as const
export const CHROME_NAMES = ['Header', 'Footer', 'LanguageSwitcher', 'RegionNav'] as const

export type LayoutName = (typeof LAYOUT_NAMES)[number]
export type ChromeName = (typeof CHROME_NAMES)[number]

export interface CustomBlockSpec {
  /** Name without the `x:` prefix (`wine-map`). */
  name: string
  component: AstroComponent
  /** JSON Schema (normally `theme/blocks/<name>/schema.json`). */
  schema?: unknown
  example?: unknown
}

export interface ThemeDefinition {
  name: string
  /** Design tokens (normally `import tokens from './tokens.json'`). CSS is generated from `tokens.json`. */
  tokens?: DesignTokens
  layouts?: Partial<Record<LayoutName, AstroComponent>>
  chrome?: Partial<Record<ChromeName, AstroComponent>>
  /** Core block type → renderer. Unlisted core blocks use the kit's neutral fallback. */
  blocks?: Record<string, AstroComponent>
  /** Custom `x:` blocks in addition to the ones discovered under `blocks/<name>/`. */
  customBlocks?: CustomBlockSpec[]
  /** React islands the theme uses (documentation for lint and the gallery; hydrate with client:visible). */
  islands?: Record<string, unknown>
  /** UI strings per language, merged over the kit's (`theme/i18n/<lang>.json` is discovered too). */
  strings?: UiStrings
}

export class ThemeDefinitionError extends Error {}

/** Declares a theme. Validates the shape eagerly so mistakes fail at build start. */
export function defineTheme<T extends ThemeDefinition>(theme: T): T {
  const problems: string[] = []
  if (!theme || typeof theme !== 'object') throw new ThemeDefinitionError('defineTheme() needs an object')
  if (typeof theme.name !== 'string' || !theme.name) problems.push('`name` is required')
  for (const k of Object.keys(theme.layouts ?? {})) {
    if (!(LAYOUT_NAMES as readonly string[]).includes(k)) problems.push(`unknown layout "${k}" (expected one of ${LAYOUT_NAMES.join(', ')})`)
  }
  for (const k of Object.keys(theme.chrome ?? {})) {
    if (!(CHROME_NAMES as readonly string[]).includes(k)) problems.push(`unknown chrome component "${k}" (expected one of ${CHROME_NAMES.join(', ')})`)
  }
  for (const k of Object.keys(theme.blocks ?? {})) {
    if (k.startsWith('x:')) problems.push(`"${k}": custom blocks go in customBlocks or theme/blocks/${k.slice(2)}/`)
    else if (!isCoreBlock(k)) problems.push(`"${k}" is not a core block type`)
  }
  const seen = new Set<string>()
  for (const c of theme.customBlocks ?? []) {
    const name = c.name?.replace(/^x:/, '')
    if (!name || !isValidCustomBlockName(name)) problems.push(`custom block name "${c.name}" must be lowercase kebab-case`)
    else if (isCoreBlock(name)) problems.push(`custom block "${name}" would shadow the core block of the same name`)
    else if (seen.has(name)) problems.push(`custom block "${name}" is declared twice`)
    seen.add(name)
    if (!c.component) problems.push(`custom block "${c.name}" needs a component`)
  }
  if (problems.length) throw new ThemeDefinitionError(`theme "${theme.name ?? '?'}" is invalid:\n  - ${problems.join('\n  - ')}`)
  return Object.freeze(theme)
}
