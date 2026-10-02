/**
 * @swarm-press/site-kit — public API.
 *
 *   import siteKit, { defineTheme } from '@swarm-press/site-kit'
 *   export default defineConfig({ integrations: [siteKit()] })   // astro.config.mjs
 *   export default defineTheme({ name: 'my-theme', ... })          // theme/theme.config.ts
 */
import siteKit from './integration'

export default siteKit
export { siteKit }
export type { SiteKitOptions } from './integration'

export { defineTheme, LAYOUT_NAMES, CHROME_NAMES, ThemeDefinitionError } from './theme'
export type { ThemeDefinition, CustomBlockSpec, LayoutName, ChromeName, AstroComponent } from './theme'

export {
  SiteManifestSchema,
  LocalizedSchema,
  MediaRefSchema,
  MANIFEST_FILE,
  MANIFEST_SCHEMA_VERSION,
  parseManifest,
  assertManifest,
} from './manifest/schema'
export type { SiteManifest, SiteManifestInput, Region, Section, CollectionDef, Localized } from './manifest/schema'
export { inferManifest } from './manifest/infer'
export { loadManifest } from './manifest/load'

export { localize, localizeAny, localizeList, languagesOf, createT, languageName, textDirection, KIT_STRINGS } from './i18n'
export type { UiStrings, LocalizedValue } from './i18n'

export { loadSite, normalizeRoute } from './content/load'
export type { LoadedSite, PageRecord, PageData, Block, CollectionItemRecord, MediaEntry, CustomBlockDef } from './content/load'
export { SchemaRegistry, validatePage, summarizeErrors } from './content/validate'

export { planRoutes, alternatesOf, staticPathsFor, isArticle } from './routes/plan'
export type { RoutePlan, RouteEntry, EntryKind, RouteId } from './routes/plan'

export { resolveMedia, resolveHref, withBase, routeUrl, absoluteUrl, collectLinks, collectMedia, checkLinksIn, checkMediaIn } from './resolve'
export type { ResolvedMedia, ResolvedLink, LinkReport } from './resolve'

export { createRenderContext } from './context'
export type { RenderContext, HeadData, NavLink, LanguageLink, PostSummary } from './context'

export { createBlockResolver, coverage } from './blocks/registry'
export { FALLBACK_RENDERER } from './blocks/fallback-map'
export { tokensToCss, flattenTokens, mergeTokens, DEFAULT_TOKENS } from './tokens'
export type { DesignTokens, TokenVar } from './tokens'
export { richTextHtml, sanitizeHtml, escapeHtml } from './richtext'

export { runCheck, formatCheckReport } from './check'
export type { CheckOptions, CheckReport } from './check'
export { lintTheme, pathGuard, DEPENDENCY_ALLOWLIST } from './lint'
export { migratePage, migrateContent, RULES as MIGRATION_RULES } from './migrate'
export { blocksDoc } from './blocks-doc'
export type { Finding, Severity } from './findings'
