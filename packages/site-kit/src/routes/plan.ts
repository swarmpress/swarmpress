/**
 * Route planner: turns the manifest + content into the complete, conflict-free
 * set of URLs the site serves. Every injected Astro route renders exactly the
 * entries assigned to it, so no two routes ever generate the same path.
 */
import { isArticleType } from '@swarm-press/content-schema'
import type { Finding } from '../findings'
import type { CollectionItemRecord, LoadedSite, PageRecord } from '../content/load'
import type { CollectionDef, Region, Section } from '../manifest/schema'

export type EntryKind =
  | 'home'
  | 'region'
  | 'section'
  | 'region-section'
  | 'collection-index'
  | 'collection-item'
  | 'blog-index'
  | 'blog-post'
  | 'page'
  | 'not-found'

/** The injected route that serves an entry. */
export type RouteId = 'home' | 'region' | 'section' | 'region-section' | 'collection-item' | 'blog-post' | 'page'

export interface RouteEntry {
  kind: EntryKind
  route: RouteId
  lang: string
  /** Normalized path without base or trailing slash (`/en/riomaggiore`). */
  path: string
  /** Language-neutral identity; entries sharing a key are translations (hreflang). */
  key: string
  params: Record<string, string>
  page?: PageRecord
  region?: Region
  section?: Section
  collection?: CollectionDef
  item?: CollectionItemRecord
  /** Items listed on index pages. */
  items?: CollectionItemRecord[]
  /** Blog posts listed on the blog index. */
  posts?: PageRecord[]
}

export interface RoutePlan {
  entries: RouteEntry[]
  byPath: Map<string, RouteEntry>
  byKey: Map<string, Map<string, RouteEntry>>
  blogSegment: string
  findings: Finding[]
}

/** An article by route kind, or by its page type in the registry (FEAT-089). */
export function isArticle(entry: RouteEntry): boolean {
  return entry.kind === 'blog-post' || (!!entry.page && isArticleType(entry.page.pageType))
}

export function planRoutes(site: LoadedSite): RoutePlan {
  const { manifest } = site
  const findings: Finding[] = []
  const entries: RouteEntry[] = []
  const byPath = new Map<string, RouteEntry>()
  const blogSegment = manifest.routes.blogIndex ?? 'blog'
  const regions = [...(manifest.regions?.items ?? [])].sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug))
  const regionSlugs = new Set(regions.map((r) => r.slug))

  const add = (e: RouteEntry): RouteEntry | undefined => {
    const prev = byPath.get(e.path)
    if (prev) {
      findings.push({
        severity: 'warning',
        code: 'route_conflict',
        file: e.page?.file ?? e.item?.file ?? 'site.manifest.json',
        path: e.path,
        message: `${e.kind} "${e.key}" and ${prev.kind} "${prev.key}" both want ${e.path}; keeping the ${prev.kind}`,
      })
      return undefined
    }
    byPath.set(e.path, e)
    entries.push(e)
    return e
  }

  // Page JSON routes, first file wins on duplicates.
  const pageAt = new Map<string, PageRecord>()
  for (const p of site.pages) {
    if (p.data.status === 'archived') continue
    for (const [lang, route] of Object.entries(p.routes)) {
      const prev = pageAt.get(route)
      if (prev) {
        findings.push({
          severity: 'error',
          code: 'duplicate_route',
          file: p.file,
          path: `/slug/${lang}`,
          message: `${route} is already claimed by ${prev.file} (id ${prev.id})`,
        })
        continue
      }
      pageAt.set(route, p)
    }
  }
  const claimed = new Set<string>()
  const pageFor = (path: string) => {
    const p = pageAt.get(path)
    if (p) claimed.add(path)
    return p
  }

  const itemsOf = (type: string, region?: string) =>
    (site.collections.get(type) ?? []).filter((i) => region === undefined || i.region === region)

  for (const lang of manifest.languages) {
    // Home
    const homePath = `/${lang}`
    const homePage = manifest.routes.home
      ? site.pages.find((p) => p.id === manifest.routes.home && p.routes[lang])
      : undefined
    if (homePage) claimed.add(homePage.routes[lang])
    add({ kind: 'home', route: 'home', lang, path: homePath, key: 'home', params: { lang }, page: homePage ?? pageFor(homePath) })

    // Regions and per-region sections / collection indexes
    for (const region of regions) {
      const rPath = `/${lang}/${region.slug}`
      add({ kind: 'region', route: 'region', lang, path: rPath, key: `region:${region.slug}`, params: { lang, region: region.slug }, region, page: pageFor(rPath) })
      const sectionSlugs = new Set<string>()
      for (const section of manifest.sections.filter((s) => s.perRegion)) {
        sectionSlugs.add(section.slug)
        const collection = section.collection ? manifest.collections.find((c) => c.type === section.collection) : undefined
        const path = `${rPath}/${section.slug}`
        add({
          kind: collection ? 'collection-index' : 'region-section',
          route: 'region-section',
          lang,
          path,
          key: `section:${region.slug}/${section.slug}`,
          params: { lang, region: region.slug, section: section.slug },
          region,
          section,
          collection,
          items: collection ? itemsOf(collection.type, region.slug) : undefined,
          page: pageFor(path),
        })
      }
      for (const collection of manifest.collections.filter((c) => c.regionField && !sectionSlugs.has(c.type))) {
        const items = itemsOf(collection.type, region.slug)
        if (items.length === 0) continue
        const path = `${rPath}/${collection.type}`
        add({
          kind: 'collection-index',
          route: 'region-section',
          lang,
          path,
          key: `collection:${collection.type}:${region.slug}`,
          params: { lang, region: region.slug, section: collection.type },
          region,
          collection,
          items,
          page: pageFor(path),
        })
      }
    }

    // Global sections and collection indexes
    const globalSections = new Set<string>()
    for (const section of manifest.sections.filter((s) => !s.perRegion)) {
      globalSections.add(section.slug)
      if (section.slug === blogSegment) continue
      const collection = section.collection ? manifest.collections.find((c) => c.type === section.collection) : undefined
      const path = `/${lang}/${section.slug}`
      add({
        kind: collection ? 'collection-index' : 'section',
        route: 'section',
        lang,
        path,
        key: `section:${section.slug}`,
        params: { lang, section: section.slug },
        section,
        collection,
        items: collection ? itemsOf(collection.type) : undefined,
        page: pageFor(path),
      })
    }
    for (const collection of manifest.collections.filter((c) => c.detailRoute)) {
      if (!globalSections.has(collection.type) && !regionSlugs.has(collection.type)) {
        const path = `/${lang}/${collection.type}`
        add({
          kind: 'collection-index',
          route: 'section',
          lang,
          path,
          key: `collection:${collection.type}`,
          params: { lang, section: collection.type },
          collection,
          items: itemsOf(collection.type),
          page: pageFor(path),
        })
      }
      const seen = new Set<string>()
      for (const item of itemsOf(collection.type)) {
        if (seen.has(item.key)) continue
        seen.add(item.key)
        const path = `/${lang}/${collection.type}/${item.key}`
        add({
          kind: 'collection-item',
          route: 'collection-item',
          lang,
          path,
          key: `item:${collection.type}/${item.key}`,
          params: { lang, collection: collection.type, item: item.key },
          collection,
          item,
          region: regions.find((r) => r.slug === item.region),
          page: pageFor(path),
        })
      }
    }
  }

  // Blog posts, then every remaining page.
  const blogPrefix = (lang: string) => `/${lang}/${blogSegment}/`
  const posts = new Map<string, PageRecord[]>()
  for (const [path, page] of pageAt) {
    if (claimed.has(path)) continue
    const lang = path.split('/')[1]
    const rest = path.slice(lang.length + 2)
    const isPost = path.startsWith(blogPrefix(lang)) && !rest.slice(blogSegment.length + 1).includes('/')
    if (isPost) {
      posts.set(lang, [...(posts.get(lang) ?? []), page])
      const slug = rest.slice(blogSegment.length + 1)
      if (blogSegment === 'blog') {
        add({ kind: 'blog-post', route: 'blog-post', lang, path, key: `page:${page.id}`, params: { lang, slug }, page })
      } else {
        add({ kind: 'blog-post', route: 'page', lang, path, key: `page:${page.id}`, params: { lang, slug: rest }, page })
      }
      continue
    }
    if (path === `/${lang}/${blogSegment}`) continue // blog index, below
    if (rest === '404') {
      findings.push({ severity: 'warning', code: 'route_conflict', file: page.file, path: `/slug/${lang}`, message: `${path} is reserved for the 404 page` })
      continue
    }
    add({ kind: 'page', route: 'page', lang, path, key: `page:${page.id}`, params: { lang, slug: rest }, page })
  }
  for (const lang of manifest.languages) {
    const path = `/${lang}/${blogSegment}`
    const page = pageAt.get(path)
    const list = (posts.get(lang) ?? []).sort((a, b) => String(b.data.created_at ?? '').localeCompare(String(a.data.created_at ?? '')))
    if (page || list.length > 0) {
      add({ kind: 'blog-index', route: 'page', lang, path, key: 'blog', params: { lang, slug: blogSegment }, page, posts: list })
    }
    add({ kind: 'not-found', route: 'page', lang, path: `/${lang}/404`, key: '404', params: { lang, slug: '404' } })
  }

  const byKey = new Map<string, Map<string, RouteEntry>>()
  for (const e of entries) {
    if (!byKey.has(e.key)) byKey.set(e.key, new Map())
    byKey.get(e.key)!.set(e.lang, e)
  }
  return { entries, byPath, byKey, blogSegment, findings }
}

/** Translations of an entry (hreflang alternates), in manifest language order. */
export function alternatesOf(plan: RoutePlan, entry: RouteEntry, languages: readonly string[]): RouteEntry[] {
  const m = plan.byKey.get(entry.key)
  if (!m) return [entry]
  return languages.map((l) => m.get(l)).filter((e): e is RouteEntry => !!e)
}

/** Astro `getStaticPaths()` result for one injected route. */
export function staticPathsFor(plan: RoutePlan, route: RouteId): { params: Record<string, string>; props: { path: string } }[] {
  return plan.entries.filter((e) => e.route === route).map((e) => ({ params: e.params, props: { path: e.path } }))
}
