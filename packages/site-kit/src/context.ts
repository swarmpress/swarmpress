/**
 * The render context every layout, chrome component and block renderer
 * receives as `ctx`. It is the only way a theme reads data: localized values,
 * UI strings, resolved links and media, navigation and SEO head data.
 */
import { FALLBACK_LANG } from '@swarm-press/content-schema'
import type { CollectionItemRecord, LoadedSite, PageRecord } from './content/load'
import { createT, languageName, localize, localizeAny, localizeList, textDirection, type UiStrings } from './i18n'
import type { CollectionDef, Region, Section, SiteManifest } from './manifest/schema'
import { absoluteUrl, resolveHref, resolveMedia, routeUrl, type LinkContext, type ResolvedMedia } from './resolve'
import { alternatesOf, isArticle, type RoutePlan, type RouteEntry } from './routes/plan'

export interface NavLink {
  href: string
  label: string
  current: boolean
  slug?: string
  color?: string
}

export interface LanguageLink extends NavLink {
  lang: string
  /** False when the current page has no translation and the link points to that language's home. */
  translated: boolean
}

export interface HeadData {
  title: string
  description: string
  canonical: string
  alternates: { hreflang: string; href: string }[]
  xDefault?: string
  ogType: 'website' | 'article'
  ogImage?: string
  ogLocale: string
  siteName: string
  favicon?: string
  jsonLd: Record<string, unknown>[]
  robots?: string
  tracker?: { src: string; project: string; endpoint: string }
}

export interface PostSummary {
  page: PageRecord
  href: string
  title: string
  excerpt: string
  image?: ResolvedMedia
  date?: string
  author?: string
  category?: string
}

export interface RenderContext {
  lang: string
  dir: 'ltr' | 'rtl'
  languages: readonly string[]
  defaultLanguage: string
  manifest: SiteManifest
  entry: RouteEntry
  page?: PageRecord
  region?: Region
  section?: Section
  collection?: CollectionDef
  item?: CollectionItemRecord
  isArticle: boolean
  brand: { name: string; tagline: string; logo?: ResolvedMedia; homeHref: string }
  /** Localized text for the current language (fallback chain: default language, en). */
  l: (value: unknown) => string
  /** Localized list of text. */
  list: (value: unknown) => string[]
  /** Raw localized value (any type) for the current language. */
  pick: <T = unknown>(value: unknown) => T | undefined
  /** UI string. */
  t: (key: string, vars?: Record<string, string | number>) => string
  /** Resolve a MediaRef (`media:<id>`, URL, /path). */
  media: (ref: unknown) => ResolvedMedia | undefined
  /** Resolve a (possibly localized) href; internal links get the language prefix and base. */
  href: (value: unknown) => string
  /** Public URL of a route path (`/en/x` → `/base/en/x/`). */
  url: (route: string) => string
  nav: {
    home: NavLink
    regionsLabel: string
    regions: NavLink[]
    sections: NavLink[]
    languages: LanguageLink[]
    breadcrumb: NavLink[]
    /** Sub-pages of the current entry (a region's sections and collections). */
    children: NavLink[]
  }
  /**
   * A tool's output as site data (ADR-0072): `content/data/<tool>/<key>.json`.
   * `key` defaults to the page's own key (its file name), then `latest`.
   */
  toolData: <T = unknown>(tool: string, key?: string) => T | undefined
  /** Items of a collection, optionally filtered by region and/or keys (in key order). */
  collectionItems: (type: string, opts?: { region?: string; keys?: string[] }) => CollectionItemRecord[]
  itemTitle: (item: CollectionItemRecord) => string
  itemImage: (item: CollectionItemRecord) => ResolvedMedia | undefined
  itemHref: (item: CollectionItemRecord) => string | undefined
  /** Blog posts in the current language, newest first. */
  posts: () => PostSummary[]
  /** Title of the current entry (localized, without the brand suffix). */
  title: string
  head: HeadData
  year: number
}

export interface ContextOptions {
  site: LoadedSite
  plan: RoutePlan
  entry: RouteEntry
  strings?: UiStrings
  /** Build year (passed in so renders are reproducible). */
  year?: number
}

function itemField(item: CollectionItemRecord, keys: string[]): unknown {
  for (const k of keys) if (item.data[k] !== undefined && item.data[k] !== null && item.data[k] !== '') return item.data[k]
  return undefined
}

export function createRenderContext(opts: ContextOptions): RenderContext {
  const { site, plan, entry } = opts
  const { manifest } = site
  const lang = entry.lang
  const fallbacks = [...new Set([manifest.defaultLanguage, FALLBACK_LANG])]
  const l = (v: unknown) => localize(v, lang, fallbacks)
  const t = createT(lang, opts.strings, fallbacks)
  const base = manifest.base
  const known = new Set(plan.byPath.keys())
  const linkCtx: LinkContext = { base, languages: manifest.languages, known }
  const url = (route: string) => routeUrl(base, route)
  const media = (ref: unknown) => resolveMedia(localizeAny(ref as any, lang, fallbacks), site.media, { base, lang, fallbacks })
  const href = (value: unknown) => {
    const raw = localizeAny<string>(value as any, lang, fallbacks)
    return typeof raw === 'string' && raw ? resolveHref(raw, lang, linkCtx).href : ''
  }
  const entryIn = (key: string, l2 = lang) => plan.byKey.get(key)?.get(l2)
  const brandName = manifest.brand.name

  const regions = [...(manifest.regions?.items ?? [])].sort((a, b) => a.order - b.order)
  const navRegions: NavLink[] = regions
    .map((r) => ({ r, e: entryIn(`region:${r.slug}`) }))
    .filter((x) => x.e)
    .map(({ r, e }) => ({ href: url(e!.path), label: l(r.name), slug: r.slug, color: r.color, current: entry.region?.slug === r.slug }))
  const navSections: NavLink[] = manifest.sections
    .filter((s) => !s.perRegion)
    .map((s) => ({ s, e: entryIn(s.slug === plan.blogSegment ? 'blog' : `section:${s.slug}`) }))
    .filter((x) => x.e)
    .map(({ s, e }) => ({ href: url(e!.path), label: l(s.label), slug: s.slug, current: entry.section?.slug === s.slug || (entry.kind === 'blog-index' && s.slug === plan.blogSegment) }))

  const alternates = alternatesOf(plan, entry, manifest.languages)
  const languages: LanguageLink[] = manifest.languages.map((lg) => {
    const alt = alternates.find((a) => a.lang === lg)
    const target = alt ?? entryIn('home', lg)
    return {
      lang: lg,
      href: target ? url(target.path) : url(`/${lg}`),
      label: languageName(lg),
      current: lg === lang,
      translated: !!alt,
    }
  })

  const itemTitle = (item: CollectionItemRecord) => l(itemField(item, ['name', 'title'])) || item.key
  const itemImage = (item: CollectionItemRecord) => {
    const img = itemField(item, ['image', 'heroImage', 'photo'])
    const first = img ?? (Array.isArray(item.data.images) ? item.data.images[0] : undefined)
    const ref = first && typeof first === 'object' && !Array.isArray(first) && 'src' in (first as object) ? (first as { src: unknown }).src : first
    return media(ref)
  }
  const itemHref = (item: CollectionItemRecord) => {
    const e = entryIn(`item:${item.type}/${item.key}`)
    return e ? url(e.path) : undefined
  }
  const collectionItems = (type: string, o: { region?: string; keys?: string[] } = {}) => {
    let items = (site.collections.get(type) ?? []).filter((i) => !o.region || i.region === o.region)
    if (o.keys?.length) {
      const order = new Map(o.keys.map((k, i) => [k, i]))
      items = items.filter((i) => order.has(i.key) || order.has(String(i.data.slug))).sort((a, b) => (order.get(a.key) ?? order.get(String(a.data.slug)) ?? 0) - (order.get(b.key) ?? order.get(String(b.data.slug)) ?? 0))
    }
    return items
  }

  // Titles
  const page = entry.page
  const pageTitle = page ? l(page.data.title) : ''
  let title = pageTitle
  if (!title) {
    switch (entry.kind) {
      case 'home':
        title = brandName
        break
      case 'region':
        title = l(entry.region?.name)
        break
      case 'region-section':
      case 'section':
        title = entry.region ? t('collection.in', { collection: l(entry.section?.label), region: l(entry.region.name) }) : l(entry.section?.label)
        break
      case 'collection-index': {
        const label = l(entry.section?.label) || l(entry.collection?.label) || entry.collection?.type || ''
        title = entry.region ? t('collection.in', { collection: label, region: l(entry.region.name) }) : label
        break
      }
      case 'collection-item':
        title = entry.item ? itemTitle(entry.item) : ''
        break
      case 'blog-index':
        title = t('blog.title')
        break
      case 'not-found':
        title = t('notFound.title')
        break
      default:
        title = page?.id ?? ''
    }
  }
  const seoTitle = page ? l(page.data.seo?.title) : ''
  const fullTitle = seoTitle || (title && title !== brandName && !title.includes(brandName) ? `${title} | ${brandName}` : title || brandName)
  const tagline = l(manifest.brand.tagline)
  const itemDesc = entry.item ? l(itemField(entry.item, ['description', 'summary', 'intro'])) : ''
  const description = (page ? l(page.data.seo?.description) : '') || itemDesc || tagline

  // Breadcrumb
  const home = entryIn('home')
  const crumbs: NavLink[] = []
  if (home && entry.kind !== 'home') {
    crumbs.push({ href: url(home.path), label: t('nav.home'), current: false })
    if (entry.region && entry.kind !== 'region') {
      const r = entryIn(`region:${entry.region.slug}`)
      if (r) crumbs.push({ href: url(r.path), label: l(entry.region.name), current: false })
    }
    if (entry.kind === 'collection-item' && entry.collection) {
      const idx = entryIn(`section:${entry.collection.type}`) ?? entryIn(`collection:${entry.collection.type}`)
      if (idx) crumbs.push({ href: url(idx.path), label: l(entry.collection.label) || entry.collection.type, current: false })
    }
    if (entry.kind === 'blog-post') {
      const b = entryIn('blog')
      if (b) crumbs.push({ href: url(b.path), label: t('blog.title'), current: false })
    }
    crumbs.push({ href: url(entry.path), label: title, current: true })
  }

  // Children (a region's sections / collection indexes)
  const children: NavLink[] = entry.kind === 'region' && entry.region
    ? plan.entries
        .filter((e) => e.lang === lang && e.region?.slug === entry.region!.slug && (e.kind === 'region-section' || e.kind === 'collection-index'))
        .map((e) => ({
          href: url(e.path),
          label: l(e.section?.label) || l(e.collection?.label) || e.params.section,
          slug: e.params.section,
          current: false,
        }))
    : []

  // Head
  const canonical = absoluteUrl(manifest.baseUrl, base, entry.path)
  const article = isArticle(entry)
  const blogBlock = page?.data.body.find((b) => b.type === 'blog-article') as Record<string, unknown> | undefined
  const firstImage = (() => {
    if (page?.data.seo?.og_image) return media(page.data.seo.og_image)
    for (const b of page?.data.body ?? []) {
      const ref = (b as Record<string, unknown>).image ?? (b as Record<string, unknown>).heroImage ?? (b as Record<string, unknown>).backgroundImage
      const m = media(ref)
      if (m) return m
    }
    if (entry.item) return itemImage(entry.item)
    return undefined
  })()
  const absolute = (src?: string) => (src && src.startsWith('/') ? manifest.baseUrl.replace(/\/+$/, '') + src : src)
  const logo = media(manifest.brand.logo)
  const jsonLd: Record<string, unknown>[] = []
  const siteUrl = absoluteUrl(manifest.baseUrl, base, `/${lang}`)
  if (entry.kind === 'home') {
    jsonLd.push({ '@context': 'https://schema.org', '@type': 'WebSite', name: brandName, url: siteUrl, inLanguage: lang, ...(tagline ? { description: tagline } : {}) })
  }
  if (article) {
    const authorRaw = blogBlock?.author
    const author = typeof authorRaw === 'object' && authorRaw && !Array.isArray(authorRaw) && 'name' in authorRaw ? l((authorRaw as { name: unknown }).name) : l(authorRaw)
    jsonLd.push({
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: l(blogBlock?.title) || title,
      inLanguage: lang,
      url: canonical,
      mainEntityOfPage: canonical,
      ...(firstImage ? { image: absolute(firstImage.src) } : {}),
      ...(page?.data.created_at ? { datePublished: page.data.created_at } : {}),
      ...(page?.data.updated_at ? { dateModified: page.data.updated_at } : {}),
      ...(author ? { author: { '@type': 'Person', name: author } } : {}),
      publisher: { '@type': 'Organization', name: brandName, ...(logo ? { logo: { '@type': 'ImageObject', url: absolute(logo.src) } } : {}) },
      ...(description ? { description } : {}),
    })
  }
  if (entry.kind === 'region' && entry.region) {
    jsonLd.push({
      '@context': 'https://schema.org',
      '@type': 'Place',
      name: l(entry.region.name),
      url: canonical,
      ...(entry.region.geo ? { geo: { '@type': 'GeoCoordinates', latitude: entry.region.geo.lat, longitude: entry.region.geo.lng } } : {}),
    })
  }
  if (crumbs.length > 1) {
    jsonLd.push({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.label, item: manifest.baseUrl.replace(/\/+$/, '') + c.href })),
    })
  }
  const isNotFound = entry.kind === 'not-found'
  const head: HeadData = {
    title: fullTitle,
    description,
    canonical,
    alternates: isNotFound ? [] : alternates.map((a) => ({ hreflang: a.lang, href: absoluteUrl(manifest.baseUrl, base, a.path) })),
    xDefault: isNotFound ? undefined : (() => {
      const d = alternates.find((a) => a.lang === manifest.defaultLanguage)
      return d ? absoluteUrl(manifest.baseUrl, base, d.path) : undefined
    })(),
    ogType: article ? 'article' : 'website',
    ogImage: absolute(firstImage?.src),
    ogLocale: lang.replace('-', '_'),
    siteName: brandName,
    favicon: media(manifest.brand.favicon)?.src,
    jsonLd,
    robots: isNotFound ? 'noindex' : undefined,
    tracker: manifest.analytics
      ? {
          src: `${manifest.analytics.endpoint.replace(/\/+$/, '')}/t/s.js`,
          project: manifest.analytics.projectKey,
          endpoint: manifest.analytics.endpoint.replace(/\/+$/, ''),
        }
      : undefined,
  }

  const posts = (): PostSummary[] => {
    const blog = entryIn('blog')
    const list = blog?.posts ?? plan.entries.filter((e) => e.lang === lang && e.kind === 'blog-post').map((e) => e.page!)
    return list
      .map((p): PostSummary | undefined => {
        const e = plan.byPath.get(p.routes[lang])
        if (!e) return undefined
        const b = p.data.body.find((x) => x.type === 'blog-article') as Record<string, any> | undefined
        const post = (b?.post ?? b) as Record<string, any> | undefined
        const authorRaw = post?.author
        const firstPara = p.data.body.find((x) => x.type === 'paragraph') as Record<string, unknown> | undefined
        return {
          page: p,
          href: url(e.path),
          title: l(post?.title) || l(p.data.title),
          excerpt: l(p.data.seo?.description) || l(post?.subtitle) || l(firstPara?.markdown),
          image: media(post?.heroImage ?? post?.image ?? p.data.seo?.og_image ?? (p.data.body.find((x) => x.type === 'editorial-hero') as any)?.image),
          date: l(post?.date) || (p.data.created_at ? String(p.data.created_at).slice(0, 10) : undefined),
          author: authorRaw && typeof authorRaw === 'object' && 'name' in authorRaw ? l(authorRaw.name) : l(authorRaw) || undefined,
          category: l(post?.category) || undefined,
        }
      })
      .filter((x): x is PostSummary => !!x)
  }

  return {
    lang,
    dir: textDirection(lang),
    languages: manifest.languages,
    defaultLanguage: manifest.defaultLanguage,
    manifest,
    entry,
    page,
    region: entry.region,
    section: entry.section,
    collection: entry.collection,
    item: entry.item,
    isArticle: article,
    brand: { name: brandName, tagline, logo, homeHref: home ? url(home.path) : url(`/${lang}`) },
    l,
    list: (v) => localizeList(v, lang, fallbacks),
    pick: <T,>(v: unknown) => localizeAny<T>(v as any, lang, fallbacks),
    t,
    media,
    href,
    url,
    nav: {
      home: { href: home ? url(home.path) : url(`/${lang}`), label: t('nav.home'), current: entry.kind === 'home' },
      regionsLabel: l(manifest.regions?.label) || t('nav.regions'),
      regions: navRegions,
      sections: navSections,
      languages,
      breadcrumb: crumbs,
      children,
    },
    toolData: <T,>(tool: string, key?: string): T | undefined => {
      const own = page ? page.file.split('/').pop()?.replace(/\.json$/, '') : undefined
      for (const k of key ? [key] : [own, 'latest']) {
        if (k && site.data.has(`${tool}/${k}`)) return site.data.get(`${tool}/${k}`) as T
      }
      return undefined
    },
    collectionItems,
    itemTitle,
    itemImage,
    itemHref,
    posts,
    title,
    head,
    year: opts.year ?? new Date().getFullYear(),
  }
}
