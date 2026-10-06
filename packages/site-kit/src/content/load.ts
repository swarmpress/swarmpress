/**
 * Content loading with validation: pages (`content/pages/**.json`),
 * collections (per-region arrays), the closed media index and the theme's
 * custom block schemas. Pure Node — used by the integration, the routes and
 * the `kit` CLI alike.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import type { Finding } from '../findings'
import type { CollectionDef, SiteManifest } from '../manifest/schema'
import { SchemaRegistry, summarizeErrors, toFindings, validatePage } from './validate'

export interface PageRecord {
  /** Repo-relative path (`content/pages/riomaggiore.json`). */
  file: string
  id: string
  pageType: string
  /** lang → normalized route without trailing slash (`/en/riomaggiore`). */
  routes: Record<string, string>
  data: PageData
}

export interface PageData {
  id: string
  slug: Record<string, string>
  title: unknown
  page_type: string
  seo?: { title?: unknown; description?: unknown; og_image?: string; keywords?: string[]; canonical?: string; [k: string]: unknown }
  body: Block[]
  metadata?: Record<string, unknown>
  status?: string
  created_at?: string
  updated_at?: string
  template?: string
  [k: string]: unknown
}

export interface Block {
  type: string
  [k: string]: unknown
}

export interface CollectionItemRecord {
  type: string
  key: string
  region?: string
  file: string
  index: number
  data: Record<string, unknown>
}

export interface MediaEntry {
  id: string
  url: string
  alt?: unknown
  width?: number
  height?: number
  [k: string]: unknown
}

export interface CustomBlockDef {
  /** `x:<name>` */
  type: string
  name: string
  dir: string
  schema: unknown
  example?: unknown
  hasComponent: boolean
}

export interface LoadedSite {
  root: string
  contentDir: string
  themeDir: string
  manifest: SiteManifest
  pages: PageRecord[]
  collections: Map<string, CollectionItemRecord[]>
  media: Map<string, MediaEntry>
  customBlocks: CustomBlockDef[]
  registry: SchemaRegistry
  findings: Finding[]
  /**
   * Tools' outputs as site data (ADR-0072, build-time bindings):
   * `content/data/<tool>/<key>.json` by `<tool>/<key>`. Written by the
   * platform after a run, validated against the tool's output type.
   */
  data: Map<string, unknown>
}

export interface LoadOptions {
  root: string
  manifest: SiteManifest
  /** Repo-relative content dir. Default `content`. */
  contentDir?: string
  /** Repo-relative theme dir. Default `manifest.themeDir`. */
  themeDir?: string
}

export const MEDIA_INDEX = 'config/media-index.json'

export function toPosix(p: string): string {
  return p.split(sep).join('/')
}

export function walkJson(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  const visit = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const full = join(d, name)
      const st = statSync(full)
      if (st.isDirectory()) visit(full)
      else if (name.endsWith('.json')) out.push(full)
    }
  }
  visit(dir)
  return out
}

function readJson(full: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(readFileSync(full, 'utf8')) }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** `/en/riomaggiore/` → `/en/riomaggiore`; strips query and fragment. */
export function normalizeRoute(s: string): string {
  const cut = s.search(/[?#]/)
  let p = (cut >= 0 ? s.slice(0, cut) : s).trim().replace(/\/+$/, '')
  if (!p) return '/'
  if (!p.startsWith('/')) p = '/' + p
  return p.replace(/\/{2,}/g, '/')
}

function loadCustomBlocks(root: string, themeDir: string, registry: SchemaRegistry, findings: Finding[]): CustomBlockDef[] {
  const blocksDir = join(root, themeDir, 'blocks')
  if (!existsSync(blocksDir)) return []
  const out: CustomBlockDef[] = []
  for (const name of readdirSync(blocksDir).sort()) {
    const dir = join(blocksDir, name)
    if (!statSync(dir).isDirectory()) continue
    const rel = toPosix(relative(root, dir))
    const schemaFile = join(dir, 'schema.json')
    if (!existsSync(schemaFile)) {
      findings.push({ severity: 'error', code: 'custom_block', file: rel, path: '', message: `theme/blocks/${name}/ has no schema.json` })
      continue
    }
    const parsed = readJson(schemaFile)
    if (!parsed.ok) {
      findings.push({ severity: 'error', code: 'invalid_json', file: `${rel}/schema.json`, path: '', message: parsed.error })
      continue
    }
    let type: string
    try {
      type = registry.registerCustom(name, parsed.value)
    } catch (e) {
      findings.push({ severity: 'error', code: 'custom_block', file: `${rel}/schema.json`, path: '', message: (e as Error).message })
      continue
    }
    const hasComponent = existsSync(join(dir, 'Component.astro'))
    if (!hasComponent) {
      findings.push({ severity: 'error', code: 'missing_renderer', file: rel, path: '', message: `custom block \`${type}\` has no Component.astro` })
    }
    let example: unknown
    const exampleFile = join(dir, 'example.json')
    if (existsSync(exampleFile)) {
      const ex = readJson(exampleFile)
      if (!ex.ok) {
        findings.push({ severity: 'error', code: 'invalid_json', file: `${rel}/example.json`, path: '', message: ex.error })
      } else {
        example = ex.value
        const entry = registry.get(type)!
        if (!entry.validate(example)) {
          for (const s of summarizeErrors(entry.validate.errors ?? [])) {
            findings.push({ severity: 'error', code: 'custom_block_example', file: `${rel}/example.json`, path: s.path || '/', message: `${type}: ${s.message}` })
          }
        }
      }
    } else {
      findings.push({ severity: 'warning', code: 'custom_block_example', file: rel, path: '', message: `custom block \`${type}\` has no example.json (used by the block gallery and blocks-doc)` })
    }
    out.push({ type, name, dir: rel, schema: parsed.value, example, hasComponent })
  }
  return out
}

function loadMedia(contentRoot: string, root: string, findings: Finding[]): Map<string, MediaEntry> {
  const media = new Map<string, MediaEntry>()
  const file = join(contentRoot, MEDIA_INDEX)
  if (!existsSync(file)) return media
  const rel = toPosix(relative(root, file))
  const parsed = readJson(file)
  if (!parsed.ok) {
    findings.push({ severity: 'error', code: 'invalid_json', file: rel, path: '', message: parsed.error })
    return media
  }
  const images = (parsed.value as { images?: unknown })?.images
  if (!Array.isArray(images)) return media
  images.forEach((img, i) => {
    const e = img as MediaEntry
    if (!e || typeof e.id !== 'string' || typeof e.url !== 'string') {
      findings.push({ severity: 'warning', code: 'media_index', file: rel, path: `/images/${i}`, message: 'media entry needs string `id` and `url`' })
      return
    }
    if (media.has(e.id)) {
      findings.push({ severity: 'warning', code: 'media_index', file: rel, path: `/images/${i}`, message: `duplicate media id \`${e.id}\`` })
      return
    }
    const dims = (e as { dimensions?: { width?: number; height?: number } }).dimensions
    media.set(e.id, { ...e, width: e.width ?? dims?.width, height: e.height ?? dims?.height })
  })
  return media
}

function looksLikeJsonSchema(v: unknown): boolean {
  const o = v as Record<string, unknown>
  return !!o && typeof o === 'object' && (typeof o.$schema === 'string' || (o.type === 'object' && typeof o.properties === 'object'))
}

function loadCollection(root: string, def: CollectionDef, regionSlugs: Set<string>, findings: Finding[]): CollectionItemRecord[] {
  const dir = join(root, def.dir)
  const items: CollectionItemRecord[] = []
  if (!existsSync(dir)) {
    findings.push({ severity: 'error', code: 'collection_dir', file: def.dir, path: '', message: `collection "${def.type}" directory does not exist` })
    return items
  }
  let validateItem: ((v: unknown) => boolean) & { errors?: any } | undefined
  if (def.schema) {
    const sf = join(root, def.schema)
    const parsed = existsSync(sf) ? readJson(sf) : undefined
    if (!parsed) {
      findings.push({ severity: 'error', code: 'collection_schema', file: def.schema, path: '', message: 'schema file not found' })
    } else if (!parsed.ok) {
      findings.push({ severity: 'error', code: 'invalid_json', file: def.schema, path: '', message: parsed.error })
    } else if (looksLikeJsonSchema(parsed.value)) {
      const ajv = new Ajv({ allErrors: true, strict: false })
      ;(addFormats as unknown as (a: Ajv) => void)(ajv)
      try {
        validateItem = ajv.compile(parsed.value as object) as any
      } catch (e) {
        findings.push({ severity: 'error', code: 'collection_schema', file: def.schema, path: '', message: `does not compile: ${(e as Error).message}` })
      }
    }
  }
  const seen = new Map<string, string>()
  for (const full of readdirSync(dir).filter((n) => n.endsWith('.json') && !n.startsWith('_')).sort()) {
    const file = toPosix(relative(root, join(dir, full)))
    const stem = full.replace(/\.json$/, '')
    const parsed = readJson(join(dir, full))
    if (!parsed.ok) {
      findings.push({ severity: 'error', code: 'invalid_json', file, path: '', message: parsed.error })
      continue
    }
    const v = parsed.value as unknown
    const arr = Array.isArray(v) ? v : Array.isArray((v as { items?: unknown })?.items) ? ((v as { items: unknown[] }).items) : undefined
    const prefix = Array.isArray(v) ? '' : '/items'
    if (!arr) {
      findings.push({ severity: 'error', code: 'collection_shape', file, path: '', message: 'expected an array or { "items": [...] }' })
      continue
    }
    arr.forEach((raw, index) => {
      const data = raw as Record<string, unknown>
      const k = data?.[def.itemKey] ?? data?.id ?? data?.slug
      if (typeof k !== 'string' && typeof k !== 'number') {
        findings.push({ severity: 'warning', code: 'collection_item_key', file, path: `${prefix}/${index}`, message: `item has no "${def.itemKey}" (or id) and gets no URL` })
        return
      }
      const key = String(k)
      const regionValue = def.regionField ? data[def.regionField] : undefined
      const region = typeof regionValue === 'string' ? regionValue : regionSlugs.has(stem) ? stem : undefined
      if (def.detailRoute) {
        const prev = seen.get(key)
        if (prev) {
          findings.push({ severity: 'warning', code: 'duplicate_item', file, path: `${prefix}/${index}`, message: `item key "${key}" already used in ${prev}; only the first gets /${def.type}/${key}/` })
        } else seen.set(key, file)
      }
      if (validateItem && !validateItem(data)) {
        for (const s of summarizeErrors(validateItem.errors ?? [])) {
          findings.push({ severity: 'error', code: 'collection_schema', file, path: `${prefix}/${index}${s.path}`, message: `${def.type}: ${s.message}` })
        }
      }
      items.push({ type: def.type, key, region, file, index, data })
    })
  }
  return items
}

/** Loads and validates everything the site renders. Never throws on bad content; returns findings. */
export function loadSite(opts: LoadOptions): LoadedSite {
  const root = opts.root
  const contentDir = opts.contentDir ?? 'content'
  const themeDir = opts.themeDir ?? opts.manifest.themeDir
  const manifest = opts.manifest
  const contentRoot = join(root, contentDir)
  const findings: Finding[] = []
  const registry = SchemaRegistry.core()
  const customBlocks = loadCustomBlocks(root, themeDir, registry, findings)
  const media = loadMedia(contentRoot, root, findings)
  const languages = new Set(manifest.languages)

  const pages: PageRecord[] = []
  for (const full of walkJson(join(contentRoot, 'pages'))) {
    const file = toPosix(relative(root, full))
    const parsed = readJson(full)
    if (!parsed.ok) {
      findings.push({ severity: 'error', code: 'invalid_json', file, path: '', message: parsed.error })
      continue
    }
    const data = parsed.value as PageData
    findings.push(...toFindings(file, validatePage(data, registry)))
    if (!data || typeof data !== 'object' || !data.slug || typeof data.slug !== 'object' || !Array.isArray(data.body)) continue
    const routes: Record<string, string> = {}
    for (const [lang, slug] of Object.entries(data.slug)) {
      if (typeof slug !== 'string') continue
      const route = normalizeRoute(slug)
      if (!languages.has(lang)) {
        findings.push({ severity: 'warning', code: 'undeclared_language', file, path: `/slug/${lang}`, message: `language "${lang}" is not declared in site.manifest.json languages; not routed` })
        continue
      }
      if (route !== `/${lang}` && !route.startsWith(`/${lang}/`)) {
        findings.push({ severity: 'warning', code: 'slug_language_mismatch', file, path: `/slug/${lang}`, message: `slug "${slug}" does not start with /${lang}/; not routed` })
        continue
      }
      routes[lang] = route
    }
    pages.push({ file, id: String(data.id ?? file), pageType: String(data.page_type ?? ''), routes, data })
  }

  const regionSlugs = new Set((manifest.regions?.items ?? []).map((r) => r.slug))
  const collections = new Map<string, CollectionItemRecord[]>()
  for (const def of manifest.collections) {
    collections.set(def.type, loadCollection(root, def, regionSlugs, findings))
  }

  const data = new Map<string, unknown>()
  const dataRoot = join(contentRoot, 'data')
  for (const full of walkJson(dataRoot)) {
    const rel = toPosix(relative(dataRoot, full)).replace(/\.json$/, '')
    const parts = rel.split('/')
    if (parts.length !== 2) {
      findings.push({ severity: 'warning', code: 'data_path', file: toPosix(relative(root, full)), path: '', message: 'tool data lives at content/data/<tool>/<key>.json' })
      continue
    }
    const parsed = readJson(full)
    if (!parsed.ok) {
      findings.push({ severity: 'error', code: 'invalid_json', file: toPosix(relative(root, full)), path: '', message: parsed.error })
      continue
    }
    data.set(rel, parsed.value)
  }

  return { root, contentDir, themeDir, manifest, pages, collections, media, customBlocks, registry, findings, data }
}
