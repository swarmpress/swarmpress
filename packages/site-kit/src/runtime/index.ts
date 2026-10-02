/**
 * Build-time runtime used by the injected routes and kit components (runs
 * inside Astro/Vite). Loads the site once per process and wires the theme's
 * components (explicit `defineTheme` over discovered conventions over kit
 * defaults).
 */
import config from 'virtual:site-kit/config'
import userTheme, { discovered } from 'virtual:site-kit/theme'
import { FALLBACKS, DEFAULT_LAYOUTS, DEFAULT_CHROME, Blocks } from '../../components/registry'
import { createBlockResolver } from '../blocks/registry'
import { loadSite, type LoadedSite } from '../content/load'
import { createRenderContext, type RenderContext } from '../context'
import type { UiStrings } from '../i18n'
import { planRoutes, staticPathsFor, type RouteEntry, type RouteId, type RoutePlan } from '../routes/plan'
import type { AstroComponent, ChromeName, LayoutName, ThemeDefinition } from '../theme'

export interface KitComponents {
  Header: AstroComponent
  Footer: AstroComponent
  LanguageSwitcher: AstroComponent
  RegionNav: AstroComponent
  Blocks: AstroComponent
}

export interface KitRuntime {
  site: LoadedSite
  plan: RoutePlan
  theme: ThemeDefinition
  layouts: Record<LayoutName, AstroComponent>
  chrome: Record<ChromeName, AstroComponent>
  resolveBlock: (type: string) => { component?: AstroComponent; source: string }
  context: (entry: RouteEntry) => RenderContext & { components: KitComponents }
  layoutFor: (entry: RouteEntry) => AstroComponent
}

const KEY = Symbol.for('@swarm-press/site-kit/runtime')

function mergeStrings(...all: (UiStrings | undefined)[]): UiStrings {
  const out: UiStrings = {}
  for (const s of all) for (const [lang, m] of Object.entries(s ?? {})) out[lang] = { ...(out[lang] ?? {}), ...m }
  return out
}

function build(): KitRuntime {
  const site = loadSite({ root: config.root, manifest: config.manifest, contentDir: config.contentDir, themeDir: config.themeDir })
  const plan = planRoutes(site)
  const theme = (userTheme ?? { name: 'kit-default' }) as ThemeDefinition
  const layouts = { ...DEFAULT_LAYOUTS, ...discovered.layouts, ...(theme.layouts ?? {}) } as Record<LayoutName, AstroComponent>
  const chrome = { ...DEFAULT_CHROME, ...discovered.chrome, ...(theme.chrome ?? {}) } as Record<ChromeName, AstroComponent>
  const custom: Record<string, AstroComponent> = { ...discovered.custom }
  for (const c of theme.customBlocks ?? []) custom[`x:${c.name.replace(/^x:/, '')}`] = c.component
  const resolveBlock = createBlockResolver({ theme: { ...discovered.blocks, ...(theme.blocks ?? {}) }, custom, fallback: FALLBACKS })
  const strings = mergeStrings(discovered.strings, theme.strings)
  const components: KitComponents = { ...chrome, Blocks }
  const year = config.buildYear
  return {
    site,
    plan,
    theme,
    layouts,
    chrome,
    resolveBlock,
    context: (entry) => ({ ...createRenderContext({ site, plan, entry, strings, year }), components }),
    layoutFor: (entry) => {
      switch (entry.kind) {
        case 'home':
          return layouts.Page
        case 'region':
          return layouts.Region
        case 'collection-index':
          return layouts.CollectionIndex
        case 'collection-item':
          return layouts.CollectionItem
        case 'blog-post':
          return layouts.Article
        case 'not-found':
          return layouts.NotFound
        case 'page':
          return entry.page && ['blog-article', 'blog-post', 'article'].includes(entry.page.pageType) ? layouts.Article : layouts.Page
        default:
          return layouts.Page
      }
    },
  }
}

/** The memoized runtime (one load per build process). */
export function getRuntime(): KitRuntime {
  const g = globalThis as unknown as Record<symbol, Map<string, KitRuntime>>
  g[KEY] ??= new Map()
  const k = `${config.root}::${config.contentDir}::${config.themeDir}`
  let rt = g[KEY].get(k)
  // In dev, content edits are picked up after a short debounce.
  const stale = config.dev && rt && Date.now() - ((rt as unknown as { builtAt: number }).builtAt ?? 0) > 1500
  if (!rt || stale) {
    rt = Object.assign(build(), { builtAt: Date.now() })
    g[KEY].set(k, rt)
  }
  return rt
}

/** `getStaticPaths()` for one injected route. */
export function pathsFor(route: RouteId) {
  return staticPathsFor(getRuntime().plan, route)
}

export function entryAt(path: string): RouteEntry {
  const e = getRuntime().plan.byPath.get(path)
  if (!e) throw new Error(`site-kit: no route entry for ${path}`)
  return e
}

export type { RenderContext, RouteEntry }
