/**
 * Closed-world resolution: internal links must resolve to a known route,
 * `media:<id>` references must resolve through `content/config/media-index.json`.
 */
import { LINK_KEYS, MEDIA_KEYS } from '@swarm-press/content-schema'
import type { Finding } from './findings'
import { isLocalized, localize, localizeAny } from './i18n'
import type { MediaEntry } from './content/load'

/** Joins the site base (`/` or `/preview/42/`) and a root-relative path. */
export function withBase(base: string, path: string): string {
  const b = base.replace(/\/+$/, '')
  if (!path.startsWith('/')) path = '/' + path
  return (b + path) || '/'
}

/** Public URL path of a route (`/en/riomaggiore` → `/base/en/riomaggiore/`). */
export function routeUrl(base: string, route: string): string {
  const p = route === '/' ? '/' : route.replace(/\/+$/, '') + '/'
  return withBase(base, p)
}

/** Absolute URL of a route, for canonical / hreflang / sitemap. */
export function absoluteUrl(baseUrl: string, base: string, route: string): string {
  return baseUrl.replace(/\/+$/, '') + routeUrl(base, route)
}

export interface ResolvedMedia {
  src: string
  alt?: string
  width?: number
  height?: number
  /** Media index id when the reference was closed-world. */
  id?: string
}

/** Resolves a `MediaRef` (`media:<id>`, URL or /path) to a renderable source. */
export function resolveMedia(
  ref: unknown,
  media: Map<string, MediaEntry>,
  opts: { base: string; lang: string; fallbacks?: readonly string[] },
): ResolvedMedia | undefined {
  if (typeof ref !== 'string' || !ref) return undefined
  if (ref.startsWith('media:')) {
    const e = media.get(ref.slice(6))
    if (!e) return undefined
    return {
      src: e.url.startsWith('/') && !e.url.startsWith('//') ? withBase(opts.base, e.url) : e.url,
      alt: e.alt !== undefined ? localize(e.alt, opts.lang, opts.fallbacks) : undefined,
      width: e.width,
      height: e.height,
      id: e.id,
    }
  }
  if (/^https?:\/\/\S+$/.test(ref)) return { src: ref }
  if (ref.startsWith('/') && !ref.startsWith('//')) return { src: withBase(opts.base, ref) }
  return undefined
}

export interface FieldRef {
  /** JSON pointer of the field. */
  path: string
  key: string
  value: unknown
}

function walk(value: unknown, path: string, key: string | undefined, keys: readonly string[], out: FieldRef[]): void {
  if (key && keys.includes(key) && (typeof value === 'string' || (isLocalized(value) && Object.values(value).every((v) => typeof v === 'string')))) {
    out.push({ path, key, value })
    return
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => walk(v, `${path}/${i}`, key, keys, out))
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) walk(v, `${path}/${k.replace(/~/g, '~0').replace(/\//g, '~1')}`, k, keys, out)
  }
}

/** Every link field (`href`, `url`, …) in a value, with JSON pointers. */
export function collectLinks(value: unknown, basePath = ''): FieldRef[] {
  const out: FieldRef[] = []
  walk(value, basePath, undefined, LINK_KEYS, out)
  return out
}

/** Every media field (`image`, `src`, …) in a value, with JSON pointers. */
export function collectMedia(value: unknown, basePath = ''): FieldRef[] {
  const out: FieldRef[] = []
  walk(value, basePath, undefined, MEDIA_KEYS, out)
  return out
}

export interface LinkContext {
  base: string
  languages: readonly string[]
  /** Normalized route paths that exist (`/en/riomaggiore`). */
  known: Set<string>
}

export interface ResolvedLink {
  /** Final href to render. */
  href: string
  internal: boolean
  /** Internal link that resolves to a known route (always true for external). */
  ok: boolean
  /** The route an internal link was resolved to (without base). */
  route?: string
}

const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i

/**
 * Resolves an href for a page in `lang`. Internal paths without a language
 * prefix get the current language (`/riomaggiore/` → `/it/riomaggiore/`), and
 * the site base is prepended. Paths with a file extension are treated as
 * static assets and not checked.
 */
export function resolveHref(href: string, lang: string, ctx: LinkContext): ResolvedLink {
  const raw = href.trim()
  if (!raw) return { href: '', internal: true, ok: false }
  if (EXTERNAL.test(raw)) return { href: raw, internal: false, ok: true }
  const cut = raw.search(/[?#]/)
  const suffix = cut >= 0 ? raw.slice(cut) : ''
  let p = (cut >= 0 ? raw.slice(0, cut) : raw).replace(/\/+$/, '')
  if (!p.startsWith('/')) p = '/' + p
  if (p === '/') p = ''
  const last = p.split('/').pop() ?? ''
  if (/\.[a-z0-9]{2,5}$/i.test(last)) {
    return { href: withBase(ctx.base, p) + suffix, internal: true, ok: true, route: p }
  }
  const first = p.split('/')[1] ?? ''
  const route = ctx.languages.includes(first) ? p : `/${lang}${p}`
  return { href: routeUrl(ctx.base, route) + suffix, internal: true, ok: ctx.known.has(route), route }
}

export interface BrokenLink {
  file: string
  path: string
  lang: string
  href: string
  resolved?: string
}

export interface LinkReport {
  generatedAt: string
  checked: number
  broken: BrokenLink[]
}

/** Checks every link field of `value` (a page) for `lang`. */
export function checkLinksIn(
  value: unknown,
  file: string,
  lang: string,
  ctx: LinkContext,
  fallbacks: readonly string[] = ['en'],
): { checked: number; broken: BrokenLink[] } {
  let checked = 0
  const broken: BrokenLink[] = []
  for (const ref of collectLinks(value)) {
    const href = localizeAny<string>(ref.value as any, lang, fallbacks)
    if (typeof href !== 'string' || !href) continue
    const r = resolveHref(href, lang, ctx)
    if (!r.internal) continue
    checked++
    if (!r.ok) broken.push({ file, path: ref.path, lang, href, resolved: r.route })
  }
  return { checked, broken }
}

export function brokenLinkFindings(broken: BrokenLink[], severity: 'warning' | 'error' = 'warning'): Finding[] {
  // One finding per field; list the languages it breaks in.
  const byField = new Map<string, BrokenLink[]>()
  for (const b of broken) {
    const k = `${b.file}#${b.path}`
    byField.set(k, [...(byField.get(k) ?? []), b])
  }
  return [...byField.values()].map((list) => ({
    severity,
    code: 'broken_link',
    file: list[0].file,
    path: list[0].path,
    message: `"${list[0].href}" does not resolve to a known route (${list.map((b) => `${b.lang}: ${b.resolved}`).join(', ')})`,
  }))
}

/** `media:<id>` values that are not in the media index (closed world). */
export function checkMediaIn(value: unknown, file: string, media: Map<string, MediaEntry>): Finding[] {
  const out: Finding[] = []
  for (const ref of collectMedia(value)) {
    const values = typeof ref.value === 'string' ? [ref.value] : Object.values(ref.value as Record<string, string>)
    for (const v of values) {
      if (typeof v === 'string' && v.startsWith('media:') && !media.has(v.slice(6))) {
        out.push({
          severity: 'error',
          code: 'unknown_media',
          file,
          path: ref.path,
          message: `"${v}" is not in content/config/media-index.json`,
        })
      }
    }
  }
  return out
}
