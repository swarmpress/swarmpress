/**
 * `inferManifest(contentRoot)` — TypeScript port of
 * `knowledge::SiteManifest::infer` (crates/knowledge/src/manifest.rs) that
 * emits the site-kit manifest shape. It reads what legacy sites already have:
 * `site.json`, `config/site.json`, `config/sitemap-index.json`,
 * `config/entity-index.json`, `config/navigation.json`, `config/villages/*.json`
 * and the `collections/` tree. Every inference is recorded in `notes`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { Localized, SiteManifest } from './schema'
import { MANIFEST_SCHEMA_VERSION, assertManifest } from './schema'

export interface InferredManifest {
  manifest: SiteManifest
  notes: string[]
}

type Json = any

function readJson(path: string): Json {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function strings(v: Json): string[] {
  return Array.isArray(v) ? v.filter((s) => typeof s === 'string') : []
}

function firstStr(...candidates: Json[]): string | undefined {
  return candidates.find((v) => typeof v === 'string' && v.length > 0)
}

/** String or object → Localized with `en`; empty translations are dropped (they fall back). */
function localized(v: Json): Localized | undefined {
  if (typeof v === 'string' && v) return v
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const cleaned = Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === 'string' && x !== '')) as Record<string, string>
    if (typeof cleaned.en === 'string') {
      const values = new Set(Object.values(cleaned))
      // A translation map with one distinct value is a plain name.
      return values.size === 1 ? cleaned.en : cleaned
    }
  }
  return undefined
}

function listJson(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((n) => n.endsWith('.json'))
    .sort()
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function inferManifest(contentRoot: string): InferredManifest {
  const repoRoot = dirname(contentRoot)
  const contentDir = basename(contentRoot)
  const site = readJson(join(contentRoot, 'site.json')) ?? {}
  const config = readJson(join(contentRoot, 'config/site.json')) ?? {}
  const sitemap = readJson(join(contentRoot, 'config/sitemap-index.json')) ?? {}
  const entities = readJson(join(contentRoot, 'config/entity-index.json')) ?? {}
  const nav = readJson(join(contentRoot, 'config/navigation.json')) ?? {}
  const collectionConfig = readJson(join(contentRoot, 'collections/config.json')) ?? {}
  const notes = ['inferred: site.manifest.json not found']

  const name = firstStr(site.name, config.site?.name) ?? 'site'
  const baseUrlRaw = firstStr(config.site?.base_url, sitemap.baseUrl, collectionConfig.domain ? `https://${collectionConfig.domain}` : undefined)
  const baseUrl = (baseUrlRaw ?? 'https://example.com').replace(/\/+$/, '')
  if (!baseUrlRaw) notes.push('baseUrl unknown; using https://example.com')
  const defaultLanguage = firstStr(site.defaultLocale, sitemap.defaultLanguage, config.site?.default_language) ?? 'en'

  // Languages: union of every declaration, in first-seen order.
  const declared: [string, string[]][] = [
    ['content/site.json locales', strings(site.locales)],
    ['sitemap-index languages', strings(sitemap.languages)],
    ['config/site.json site.languages', strings(config.site?.languages)],
  ]
  const languages: string[] = []
  for (const [, langs] of declared) for (const l of langs) if (!languages.includes(l)) languages.push(l)
  if (languages.length === 0) languages.push(defaultLanguage)
  for (const [what, langs] of declared) {
    if (langs.length && langs.length !== languages.length) {
      notes.push(`${what} lists [${langs.join(', ')}] but the union of declarations is [${languages.join(', ')}]`)
    }
  }
  if (!languages.includes(defaultLanguage)) languages.unshift(defaultLanguage)

  // Regions: village config files, ordered by entity-index position.
  type R = { order?: number; slug: string; name: Localized; entity: boolean; geo?: { lat: number; lng: number }; color?: string }
  const regionsRaw: R[] = []
  const villagesDir = join(contentRoot, 'config/villages')
  for (const file of listJson(villagesDir)) {
    const stem = file.replace(/\.json$/, '')
    if (stem.startsWith('_')) continue
    const v = readJson(join(villagesDir, file))
    if (!v) continue
    const slug = typeof v.slug === 'string' ? v.slug : stem
    const ent = entities.villages?.[slug]
    regionsRaw.push({
      order: typeof ent?.position === 'number' ? ent.position : undefined,
      slug,
      name: localized(ent?.name) ?? localized(v.hero?.title) ?? slug,
      entity: !!ent,
      geo: ent?.coordinates && typeof ent.coordinates.lat === 'number' ? { lat: ent.coordinates.lat, lng: ent.coordinates.lng } : undefined,
      color: typeof ent?.color === 'string' ? ent.color : undefined,
    })
  }
  if (regionsRaw.length === 0 && entities.villages && typeof entities.villages === 'object') {
    notes.push('regions taken from entity-index (no config/villages)')
    for (const [slug, ent] of Object.entries<Json>(entities.villages)) {
      regionsRaw.push({
        order: typeof ent?.position === 'number' ? ent.position : undefined,
        slug,
        name: localized(ent?.name) ?? slug,
        entity: true,
        geo: ent?.coordinates && typeof ent.coordinates.lat === 'number' ? { lat: ent.coordinates.lat, lng: ent.coordinates.lng } : undefined,
      })
    }
  }
  regionsRaw.sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) || a.slug.localeCompare(b.slug))
  const regionSlugs = new Set(regionsRaw.map((r) => r.slug))
  const regionItems = regionsRaw.map((r, i) => ({
    slug: r.slug,
    name: r.name,
    order: i + 1,
    ...(r.color ? { color: r.color } : {}),
    ...(r.geo ? { geo: r.geo } : {}),
    ...(r.entity ? { entityRef: r.slug } : {}),
  }))

  // Collections: <content>/collections/<kind>/.
  const collectionsDir = join(contentRoot, 'collections')
  const kinds = existsSync(collectionsDir)
    ? readdirSync(collectionsDir)
        .filter((n) => statSync(join(collectionsDir, n)).isDirectory())
        .sort()
    : []
  const collections = kinds
    .map((kind) => {
      const files = listJson(join(collectionsDir, kind)).filter((f) => !f.startsWith('_'))
      if (files.length === 0) return undefined
      const schema = readJson(join(collectionsDir, kind, '_schema.json'))
      const configured = Array.isArray(collectionConfig.collections)
        ? collectionConfig.collections.find((c: Json) => c?.type === kind)
        : undefined
      const perRegion = files.some((f) => regionSlugs.has(f.replace(/\.json$/, '')))
      const label = firstStr(configured?.displayName, schema?.display_name) ?? kind
      const looksLikeSchema = schema && (schema.$schema || (schema.type === 'object' && schema.properties))
      return {
        type: kind,
        dir: `${contentDir}/collections/${kind}`,
        label,
        ...(looksLikeSchema ? { schema: `${contentDir}/collections/${kind}/_schema.json` } : {}),
        detailRoute: false,
        itemKey: 'slug',
        ...(perRegion ? { regionField: 'village' } : {}),
      }
    })
    .filter((c): c is NonNullable<typeof c> => !!c)
  const collectionTypes = new Set(collections.map((c) => c.type))

  // Sections: sitemap-index top-level pages + per-region children.
  type S = { slug: string; label?: Localized; perRegion: boolean; collection?: string }
  const sections = new Map<string, S>()
  if (sitemap.pages && typeof sitemap.pages === 'object') {
    for (const [key, p] of Object.entries<Json>(sitemap.pages)) {
      const parent = typeof p?.parent === 'string' ? p.parent : undefined
      let slug: string
      let perRegion: boolean
      const slash = key.indexOf('/')
      if (slash >= 0) {
        const head = key.slice(0, slash)
        if (!regionSlugs.has(head)) continue // e.g. blog/<post>: content, not a section
        slug = key.slice(slash + 1)
        perRegion = true
      } else {
        if (regionSlugs.has(key) || parent === undefined) continue
        slug = key
        perRegion = false
      }
      const entry = sections.get(slug) ?? { slug, perRegion }
      entry.perRegion = entry.perRegion || perRegion
      if (!perRegion && entry.label === undefined) entry.label = localized(p?.title)
      const coll = typeof p?.collection === 'string' ? p.collection : collectionTypes.has(slug) ? slug : undefined
      if (coll && collectionTypes.has(coll)) entry.collection = coll
      sections.set(slug, entry)
    }
  } else {
    notes.push('sections taken from navigation.json (no sitemap-index)')
    for (const item of Array.isArray(nav.main_nav) ? nav.main_nav : []) {
      const url = String(item?.url ?? '').replace(/^\/+|\/+$/g, '')
      if (!url || url.includes('/') || regionSlugs.has(url)) continue
      sections.set(url, { slug: url, label: localized(item.title), perRegion: false })
    }
  }
  const sectionList = [...sections.values()]
    .filter((s) => /^[a-z0-9][a-z0-9-]*$/.test(s.slug))
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .map((s) => ({
      slug: s.slug,
      label: s.label ?? s.slug.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase()),
      ...(s.collection ? { collection: s.collection } : {}),
      perRegion: s.perRegion,
    }))
  const hasBlog = sectionList.some((s) => s.slug === 'blog') || existsSync(join(contentRoot, 'pages/blog'))

  const screenshotPages = ['/']
  if (regionItems[0]) screenshotPages.push(`/${regionItems[0].slug}/`)
  if (hasBlog) screenshotPages.push('/blog/')

  const host = (() => {
    try {
      return new URL(baseUrl).host
    } catch {
      return undefined
    }
  })()
  const draft = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    siteId: firstStr(site.id) ?? slugify(name),
    baseUrl,
    base: '/',
    ...(host ? { domain: host } : {}),
    languages,
    defaultLanguage,
    brand: {
      name,
      ...(localized(config.site?.tagline) ? { tagline: localized(config.site?.tagline) } : {}),
      ...(typeof config.site?.logo === 'string' && /^(https?:\/\/|\/)/.test(config.site.logo) ? { logo: config.site.logo } : {}),
      ...(typeof config.site?.favicon === 'string' && /^(https?:\/\/|\/)/.test(config.site.favicon) ? { favicon: config.site.favicon } : {}),
      ...(existsSync(join(contentRoot, 'config/style-guide.json')) ? { voiceRef: `${contentDir}/config/style-guide.json` } : {}),
    },
    ...(regionItems.length ? { regions: { label: 'Regions', items: regionItems } } : {}),
    sections: sectionList,
    collections,
    routes: { ...(hasBlog ? { blogIndex: 'blog' } : {}) },
    screenshotPages,
    themeDir: 'theme',
  }
  if (regionItems.length) {
    // Name the regions after the legacy concept they came from.
    const fromVillages = existsSync(villagesDir)
    ;(draft as Json).regions.label = fromVillages ? 'Villages' : 'Regions'
  }
  void repoRoot
  return { manifest: assertManifest(draft, 'inferred manifest'), notes }
}
