// The site QA stage's browser side (ADR-0094, FEAT-116): every page of a static export rendered in
// a real browser at the standard's widths (1280 and 390 px) and observed, never judged. The facts
// (boxes, pictures, links, requests, headings, labels, the head) go to `facts.jsonl`; the rules of
// site standard (v2) are judged in Rust (`crates/site-quality`, run by `swarmpress-wp-migrate qa`),
// one implementation for the runner, the CLI and the browser executor. A runner step, not a test
// (Playwright's testMatch only takes *.spec.ts).
//
//   cd apps/game && bun e2e/page-audit.mts --export <export dir> --out <dir>
//        [--theme-data <theme-data.json>] [--production https://cinqueterre.travel]
//        [--public-origin URL] [--exceptions <file>] [--only /en/vernazza/] [--limit N] [--jobs 6]
//        [--shots] [--bench <cockpit.benchmark.v1 file>] [--branch NAME --commit SHA]
//        [--judge <swarmpress-wp-migrate>] [--facts-only]
//
// Locally, against a built export (`swarmpress-wp-migrate export --out DIR`):
//   pnpm --filter @swarm-press/game audit:pages --export DIR --out DIR --bench \
//     ../../artifacts/bench/site-quality.json
// (Cockpit's `bench/site-quality` evidence; never a GitHub job: WordPress runs locally.)
//
// The export dir is `swarmpress-wp-migrate export --out`'s (its `files/` and `release.json`). Every
// HTML page of the release is served from loopback as a static host would, scrolled through so lazy
// pictures load, and observed. Pictures from other hosts are answered with a 1×1 picture in the
// browser (layout is what the page is looked at for) and each is fetched once from here; one that
// fails is a fact of every page that shows it. `--shots` writes a full-length screenshot of the
// first page of each page type at both widths to `<out>/types/`, with the real pictures. The exit code is the judge's: 1
// when the gate blocks.
import { spawnSync } from 'node:child_process'
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, resolve } from 'node:path'
import { chromium, type Browser } from '@playwright/test'

const args = process.argv.slice(2)
const arg = (k: string) => {
  const i = args.indexOf(k)
  return i >= 0 ? args[i + 1] : undefined
}
const exportDir = resolve(arg('--export') ?? die('--export <dir>'))
const out = resolve(arg('--out') ?? die('--out <dir>'))
const production = (arg('--production') ?? 'https://cinqueterre.travel').replace(/\/$/, '')
const only = arg('--only')
const limit = Number(arg('--limit') ?? 0)
const jobs = Number(arg('--jobs') ?? 6)
const shots = args.includes('--shots')
const WIDTHS = [1280, 390]

function die(m: string): never {
  console.error(`page-audit: ${m}`)
  process.exit(2)
}

interface Release {
  files: Record<string, { sha256: string; content_type: string }>
  redirects: Record<string, string>
}
const release: Release = JSON.parse(readFileSync(join(exportDir, 'release.json'), 'utf8'))
const filesDir = join(exportDir, 'files')
const pages = Object.entries(release.files)
  .filter(([p, f]) => f.content_type.startsWith('text/html') && p !== '/404.html')
  .map(([p]) => p)
  .filter((p) => !only || p.startsWith(only))
  .sort()
const chosen = limit > 0 ? pages.slice(0, limit) : pages

// The export served as a static host serves it.
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.xml': 'application/xml', '.txt': 'text/plain',
}
const server = createServer((req, res) => {
  let f = join(filesDir, decodeURIComponent((req.url ?? '/').split('?')[0]))
  if (existsSync(f) && statSync(f).isDirectory()) f = join(f, 'index.html')
  if (!existsSync(f)) {
    res.statusCode = 404
    f = join(filesDir, '404.html')
    if (!existsSync(f)) return res.end('not found')
  }
  res.setHeader('Content-Type', MIME[extname(f)] ?? 'application/octet-stream')
  createReadStream(f).pipe(res)
})
await new Promise<void>((ok) => server.listen(0, '127.0.0.1', () => ok()))
const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`

// What runs in the page: observation only (crates/site-quality/src/facts.rs is the shape).
const observe = (input: { width: number }) => {
  const clip = (s: string, n = 160) => s.replace(/\s+/g, ' ').trim().slice(0, n)
  const shown = (el: Element) => {
    const s = getComputedStyle(el)
    return s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0'
  }
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect()
    return r.width > 1 && r.height > 1 && shown(el) && !el.closest('[hidden]')
  }
  const label = (el: Element) => {
    const c = (el.getAttribute('class') ?? '')
      .split(/\s+/)
      .filter((x) => x.startsWith('ds-') || x.startsWith('ct-') || x.startsWith('wp-block-'))
      .slice(0, 3)
      .join('.')
    const t = clip(el.textContent ?? '', 40)
    return `${el.tagName.toLowerCase()}${c ? '.' + c : ''}${t ? ` "${t}"` : ''}`
  }
  const authored = (el: Element) => !!el.closest('.wp-block-post-content, .entry-content')
  const chrome = (el: Element) => !!el.closest('header, footer, nav, .ds-masthead, .ds-footer')
  const main = document.querySelector('main') ?? document.body
  const lang = (document.documentElement.lang || 'en').slice(0, 2).toLowerCase()
  const body = document.body.className
  const page_type =
    document.body.classList.contains('home') || document.body.classList.contains('front-page')
      ? 'front-page'
      : body.match(/page-template-([a-z0-9-]+)/)?.[1]?.replace(/^default$/, 'page') ??
      (body.match(/\bsingle-([a-z0-9_-]+)/)?.[1]
        ? body.includes('single-post') ? 'single' : `single-${body.match(/\bsingle-([a-z0-9_-]+)/)![1]}`
        : body.match(/post-type-archive-([a-z0-9_-]+)/)?.[1]
          ? `archive-${body.match(/post-type-archive-([a-z0-9_-]+)/)![1]}`
          : ['category', 'tag', 'author', 'search', 'error404', 'archive'].find((c) => document.body.classList.contains(c)) ??
            'page')
  // head
  const meta = (n: string) => document.querySelector(`meta[name="${n}"]`)?.getAttribute('content') ?? undefined
  const head = {
    title: document.title,
    description: meta('description'),
    canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? undefined,
    alternates: [...document.querySelectorAll('link[rel="alternate"][hreflang]')].map((l) => ({
      lang: l.getAttribute('hreflang') ?? '',
      href: l.getAttribute('href') ?? '',
    })),
    robots: meta('robots'),
  }
  // headings
  const hs = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')].filter(visible)
  const headings = hs.map((h) => ({
    level: Number(h.tagName[1]),
    text: clip(h.textContent ?? '', 120),
    chrome: chrome(h),
    authored: authored(h),
    title_block: h.matches('.wp-block-post-title, .wp-block-query-title'),
  }))
  // the authored hero
  let hero
  const heroEl = [...main.querySelectorAll('.wp-block-post-content [class*="ct-"][class*="-hero"]:not(.ct-hero-image)')].find(visible)
  if (heroEl) {
    const t = heroEl.querySelector('h1, h2, .wp-block-heading')
    const h1 = hs.find((h) => h.tagName === 'H1')
    const top = heroEl.getBoundingClientRect().top
    const after = [...main.querySelectorAll('.wp-block-query, [class*="ct-collection"], .ds-bar, .ds-cards, .ds-entries')]
      .filter((e) => visible(e) && !heroEl.contains(e) && !e.contains(heroEl) && e.getBoundingClientRect().top < top - 10)
      .slice(0, 3)
      .map(label)
    hero = { title: clip(t?.textContent ?? '', 120), contains_h1: !!h1 && heroEl.contains(h1), after }
  }
  // picture boxes
  const frames = [...main.querySelectorAll('.ds-card-img, .wp-block-image, .wp-block-post-featured-image, .ds-tile, figure, .ds-featured-img')]
    .filter(visible)
    .map((f) => {
      const r = f.getBoundingClientRect()
      const imgs = [...f.querySelectorAll('img')].filter((i) => (i.getAttribute('src') ?? '').trim() !== '' || (i.getAttribute('srcset') ?? '').trim() !== '')
      const kind = f.matches('.ds-card-img') ? 'card' : f.matches('.wp-block-post-featured-image, .ds-featured-img') ? 'featured' : f.matches('.ds-tile') ? 'tile' : f.matches('.wp-block-image') ? 'image' : 'figure'
      const bg = getComputedStyle(f).backgroundImage
      return {
        label: label(f),
        kind,
        w: Math.round(r.width),
        h: Math.round(r.height),
        images: imgs.length,
        loaded: imgs.filter((i) => i.complete && i.naturalWidth > 0 && visible(i)).length,
        media: f.querySelectorAll('svg, video, iframe, canvas, table, object, embed').length,
        background: !!bg && bg !== 'none',
        text: (f.textContent ?? '').replace(/\s+/g, ' ').trim().length,
        authored: authored(f),
      }
    })
  // pictures
  const images = [...document.querySelectorAll('img')]
    .filter((i) => shown(i) && !i.closest('[aria-hidden="true"], [hidden]') && (visible(i) || (i.complete && i.naturalWidth === 0)))
    .map((i) => ({
      src: clip(i.currentSrc || i.getAttribute('src') || '', 200),
      alt: i.getAttribute('alt') ?? undefined,
      loaded: !(i.complete && i.naturalWidth === 0),
      decorative: ['presentation', 'none'].includes(i.getAttribute('role') ?? ''),
      authored: authored(i),
    }))
  // links
  const links = [...document.querySelectorAll('a[href]')].map((a) => {
    const href = a.getAttribute('href') ?? ''
    let target_found: boolean | undefined
    if (href.startsWith('#') && href.length > 1) {
      const id = decodeURIComponent(href.slice(1))
      target_found = !!document.getElementById(id) || document.getElementsByName(id).length > 0
    }
    return { href, label: label(a), authored: authored(a), target_found }
  })
  // scripts and styles
  const assets = [
    ...[...document.querySelectorAll('script')].map((s) => ({
      kind: 'script',
      src: s.getAttribute('src') ?? undefined,
      id: s.id || undefined,
      snippet: s.getAttribute('src') ? undefined : clip(s.textContent ?? '', 160),
    })),
    ...[...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => ({ kind: 'style', src: l.getAttribute('href') ?? undefined, id: l.id || undefined })),
    ...[...document.querySelectorAll('style')].map((s) => ({ kind: 'style', id: s.id || undefined, snippet: clip(s.textContent ?? '', 80) })),
  ]
  // width
  const scroll_width = document.scrollingElement?.scrollWidth ?? 0
  const wide =
    scroll_width > input.width + 1
      ? [...document.body.querySelectorAll('*')]
          .filter((e) => {
            // Hidden boxes still widen the page (an off-screen drawer): any box past the edge.
            const r = e.getBoundingClientRect()
            return r.right > input.width + 1 && r.width > 0 && r.height > 0
          })
          .filter((e, _, all) => !all.some((o) => o !== e && o.contains(e)) || e.children.length === 0)
          .slice(0, 4)
          .map(label)
      : []
  // Boxes whose content runs past them, deepest first (a summary that does not wrap).
  if (scroll_width > input.width + 1) {
    const inner = [...document.body.querySelectorAll('*')].filter(
      (e) => e.clientWidth > 0 && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX === 'visible',
    )
    for (const e of inner.filter((e) => !inner.some((o) => o !== e && e.contains(o))).slice(0, 3)) {
      wide.push(`${label(e)} holds ${e.scrollWidth} px in ${e.clientWidth}`)
    }
  }
  // Text that runs past the edge (a long word in a narrow box).
  if (scroll_width > input.width + 1) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n && wide.length < 6; n = walker.nextNode()) {
      const range = document.createRange()
      range.selectNodeContents(n)
      const r = range.getBoundingClientRect()
      if (r.right > input.width + 1 && r.width > 0 && n.parentElement) wide.push(`text "${clip(n.textContent ?? '', 40)}" in ${label(n.parentElement)}`)
    }
  }
  // blocks narrower than their page container at a desktop width
  const blocks: unknown[] = []
  if (input.width >= 1200) {
    const cand = [...main.querySelectorAll('.wp-block-group, .wp-block-columns, figure, .wp-block-media-text, .wp-block-query, details, .wp-block-cover')]
    const taken: Element[] = []
    for (const b of cand) {
      if (!visible(b) || taken.some((t) => t.contains(b))) continue
      const box = b.parentElement?.closest('.ds-wrap') ?? main
      const br = box.getBoundingClientRect()
      const bs = getComputedStyle(box)
      const inner = br.width - parseFloat(bs.paddingLeft) - parseFloat(bs.paddingRight)
      const r = b.getBoundingClientRect()
      if (r.height < 100 || r.width >= inner - 1) continue
      const beside = [...box.querySelectorAll('*')].some((s) => {
        if (s === b || s.contains(b) || b.contains(s) || !visible(s)) return false
        const sr = s.getBoundingClientRect()
        if (sr.width < 24 || sr.height < 24) return false
        const overlap = Math.min(sr.bottom, r.bottom) - Math.max(sr.top, r.top)
        return overlap > 40 && (sr.left >= r.right - 4 || sr.right <= r.left + 4)
      })
      const measure = !!b.closest('.ct-blog-article, .ds-prose-article, .ds-article')
      if (!beside && !measure) taken.push(b)
      blocks.push({ label: label(b), w: Math.round(r.width), container: Math.round(inner), h: Math.round(r.height), beside, measure })
    }
  }
  // chips
  const chips = [...document.querySelectorAll('.ds-chip, .ds-filter-chip, .ct-category, .ds-eyebrow, .wp-block-post-terms a, .ct-tags li, .ds-chips a, .ct-badge, .ds-panel-name')]
    .filter(visible)
    .map((c) => ({
      label: label(c),
      text: clip(c.textContent ?? '', 60),
      // The content's own label (an entry's kind, a badge of the page's text), or the design's.
      authored: !!c.closest('.wp-block-post-content, .wp-block-post-template, .wp-block-post-terms'),
    }))
  // A filter chip mirrors the entries' own labels: the content's when a card's chip says the same.
  for (const c of chips) {
    if (!c.authored && c.label.includes('ds-filter-chip') && chips.some((o) => o.authored && o.text === c.text)) c.authored = true
  }
  // short visible texts (pages in another language: the design's words left in English)
  const texts: string[] = []
  if (lang !== 'en') {
    const seen = new Set<string>()
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n && texts.length < 600; n = walker.nextNode()) {
      const p = n.parentElement
      if (!p || p.closest('script, style, noscript') || !visible(p)) continue
      const t = clip(n.textContent ?? '', 200)
      if (t && t.length <= 80 && !seen.has(t)) {
        seen.add(t)
        texts.push(t)
      }
    }
  }
  // v3: paragraphs of a page in another language (its letters)
  const paragraphs: { text: string; authored: boolean }[] = []
  if (lang !== 'en') {
    const TEXTS = 'p, h1, h2, h3, h4, h5, h6, li, summary, figcaption, blockquote, .ds-featured-title, .ds-panel-line, .ds-panel-name'
    for (const e of document.body.querySelectorAll(TEXTS)) {
      // The innermost text only (a menu's item holds its panel's texts).
      if (paragraphs.length >= 500 || e.closest('script, style, noscript') || e.querySelector(TEXTS) || !visible(e)) continue
      const t = clip(e.textContent ?? '', 300)
      // The site's content: its pages' own text and its entries' (titles, excerpts, cards).
      // (a menu panel's story title and place line are the content's, shown by the theme)
      const content = !!e.closest('.wp-block-post-content, .entry-content, .wp-block-post-template, .wp-block-post-title, .wp-block-post-excerpt, .ds-featured-title, .ds-panel-line, .wp-block-post-terms')
      if (t) paragraphs.push({ text: t, authored: content })
    }
  }
  // v3: one-value lines of the authored content, and whether they carry their label
  const values = [...main.querySelectorAll('.wp-block-post-content p[class*="ct-"]')]
    .filter((e) => visible(e) && (e.textContent ?? '').trim().length <= 60)
    .map((e) => {
      const cls = [...e.classList].filter((c) => c.startsWith('ct-') && c !== 'ct-meta')
      const before = getComputedStyle(e, '::before').content
      const prev = e.previousElementSibling
      const labelled =
        !!e.querySelector('.ct-meta-key, .ds-label') ||
        (!!before && before !== 'none' && before !== 'normal' && before !== '""') ||
        (!!prev && /(^|\s)(ct-[a-z-]*(label|key)|ds-label)(\s|$)/.test(prev.getAttribute('class') ?? ''))
      return { class: cls[0] ?? '', text: clip(e.textContent ?? '', 60), labelled }
    })
  // v3: the design's fact cells
  const cells = [...main.querySelectorAll('.ds-facts > *')]
    .filter((c) => visible(c) && c.querySelector('.ds-label'))
    .map((c) => {
      const l = c.querySelector('.ds-label')!
      const label = clip(l.textContent ?? '', 60)
      const value = clip([...c.children].filter((x) => x !== l).map((x) => x.textContent ?? '').join(' '), 80)
      return { label, value }
    })
  // v3: listings, the heading over them and their entries' places
  const listings = [...main.querySelectorAll('.wp-block-query')].filter(visible).map((q) => {
    let heading = ''
    let at: Element | null = q.closest('section') ?? q
    for (let i = 0; at && i < 4 && !heading; i++) {
      let prev = at.previousElementSibling
      while (prev && !heading) {
        const bar = prev.matches('.ds-bar') ? prev : prev.querySelector('.ds-bar')
        if (bar) heading = clip(bar.querySelector('.ds-meta, h2, h3')?.textContent ?? '', 80)
        prev = heading ? null : prev.previousElementSibling
      }
      at = at.parentElement
    }
    const places = [...new Set([...q.querySelectorAll('li')].flatMap((li) => [...li.classList].filter((c) => c.startsWith('sp_place-')).map((c) => c.slice(9))))]
    return { label: label(q), heading, places }
  })
  // v3: grid rows with a stretch of their width that nothing covers
  const columns: unknown[] = []
  if (input.width >= 1200) {
    for (const g of main.querySelectorAll('*')) {
      if (columns.length >= 40) break
      const gs = getComputedStyle(g)
      if (gs.display !== 'grid' || !visible(g) || g.closest('.ct-blog-article, .ds-prose-article, .ds-article')) continue
      const r = g.getBoundingClientRect()
      if (r.width < 600 || r.height < 100) continue
      const kids = [...g.children].filter(visible)
      if (kids.length === 0) continue
      // Text kept at its reading measure (a max-width) covers its track to the row's end.
      const iv = kids
        .map((k) => {
          const kr = k.getBoundingClientRect()
          const measured = getComputedStyle(k).maxWidth !== 'none' && k.matches('p, h1, h2, h3, h4, h5, h6, blockquote, ul, ol, .wp-block-heading')
          return [Math.max(kr.left, r.left), measured ? r.right : Math.min(kr.right, r.right)] as [number, number]
        })
        .sort((a, b) => a[0] - b[0])
      let reach = r.left
      let best = 0
      let where = 'middle'
      for (const [a, b] of iv) {
        if (a - reach > best) {
          best = a - reach
          where = reach === r.left ? 'left' : 'middle'
        }
        reach = Math.max(reach, b)
      }
      if (r.right - reach > best) {
        best = r.right - reach
        where = 'right'
      }
      if (best >= 0.15 * r.width) columns.push({ label: label(g), w: Math.round(r.width), h: Math.round(r.height), empty: Math.round(best), at: where })
    }
  }
  return { lang, page_type, head, headings, hero, frames, images, links, assets, scroll_width, wide, blocks, chips, texts, paragraphs, values, cells, listings, columns }
}

const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')
const imagesOf: Record<string, Set<string>> = {}
type Facts = Record<string, unknown> & { path: string; width: number; page_type?: string; requests: unknown[] }
const facts: Facts[] = []
const typeOf: Record<string, string> = {}
const firstOfType: Record<string, string> = {}

async function audit(browser: Browser, path: string, width: number, shot?: string): Promise<Facts> {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } })
  const page = await ctx.newPage()
  const requests: { url: string; status: number; failure?: string; kind: string }[] = []
  page.on('requestfailed', (r) => requests.push({ url: r.url().slice(0, 300), status: 0, failure: r.failure()?.errorText ?? 'failed', kind: r.resourceType() }))
  page.on('response', (r) => {
    if (r.status() >= 400) requests.push({ url: r.url().slice(0, 300), status: r.status(), kind: r.request().resourceType() })
  })
  page.on('request', (r) => {
    const u = new URL(r.url())
    if (u.origin !== origin) requests.push({ url: r.url().slice(0, 300), status: 200, kind: r.resourceType() })
  })
  await page.route(
    (u) => u.origin !== origin,
    (route) => {
      const r = route.request()
      if (r.resourceType() === 'image') {
        ;(imagesOf[r.url()] ??= new Set()).add(path)
        // A screenshot shows the real pictures; the audit's layout facts need none.
        if (shot) return route.continue()
        return route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL })
      }
      return route.continue()
    },
  )
  const f: Facts = { path, width, requests: [] }
  try {
    const res = await page.goto(origin + path, { waitUntil: 'domcontentloaded', timeout: 45000 })
    f.status = res?.status() ?? 0
    await page.waitForLoadState('load', { timeout: 20000 }).catch(() => undefined)
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 700) {
        window.scrollTo(0, y)
        await new Promise((r) => setTimeout(r, 60))
      }
      window.scrollTo(0, 0)
    })
    await page.waitForFunction(() => [...document.images].every((i) => i.complete), undefined, { timeout: 8000 }).catch(() => undefined)
    Object.assign(f, await page.evaluate(observe, { width }))
    if (shot) await page.screenshot({ path: shot, fullPage: true })
  } catch (e) {
    f.error = String(e).slice(0, 200)
  }
  // Requests observed from first to last (the page's own and other hosts'), one per URL and kind.
  const seen = new Set<string>()
  f.requests = requests.filter((q) => {
    const k = `${q.url} ${q.status} ${q.failure ?? ''}`
    if (seen.has(k) || (q.status === 200 && new URL(q.url).origin === origin)) return false
    seen.add(k)
    return true
  })
  await ctx.close()
  return f
}

const browser = await chromium.launch()
const queue = chosen.flatMap((p) => WIDTHS.map((w) => ({ p, w })))
let done = 0
const started = Date.now()
async function worker() {
  for (let job = queue.shift(); job; job = queue.shift()) {
    const f = await audit(browser, job.p, job.w)
    facts.push(f)
    if (f.page_type) {
      typeOf[f.path] = f.page_type
      if (!firstOfType[f.page_type] || f.path < firstOfType[f.page_type]) firstOfType[f.page_type] = f.path
    }
    done++
    if (done % 100 === 0) console.log(`${done} of ${chosen.length * 2} (${((Date.now() - started) / 1000) | 0}s)`)
  }
}
await Promise.all(Array.from({ length: jobs }, worker))
mkdirSync(out, { recursive: true })
if (shots) {
  mkdirSync(join(out, 'types'), { recursive: true })
  for (const [type, path] of Object.entries(firstOfType).sort()) {
    for (const w of WIDTHS) await audit(browser, path, w, join(out, 'types', `${type}@${w}.png`))
  }
  writeFileSync(join(out, 'types', 'pages.json'), JSON.stringify(firstOfType, null, 2))
}
await browser.close()
server.close()
// Every picture from another host, fetched once; its answer is a fact of every page showing it.
{
  const urls = Object.keys(imagesOf)
  let i = 0
  const check = async () => {
    for (let u = urls[i++]; u; u = urls[i++]) {
      let status = 0
      let failure: string | undefined
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const r = await fetch(u, { method: 'HEAD', signal: AbortSignal.timeout(30000) })
          status = r.status
          failure = r.ok && !(r.headers.get('content-type') ?? 'image/').startsWith('image/') ? `not a picture (${r.headers.get('content-type')})` : undefined
          break
        } catch (e) {
          failure = String(e).slice(0, 80)
        }
      }
      if (status >= 400 || failure) {
        for (const f of facts.filter((x) => imagesOf[u].has(x.path) && x.width === WIDTHS[0])) {
          f.requests.push({ url: u.slice(0, 300), status, failure, kind: 'image-head' })
        }
      }
    }
  }
  await Promise.all(Array.from({ length: 8 }, check))
  console.log(`${urls.length} pictures from other hosts checked`)
}
facts.sort((a, b) => (a.path === b.path ? b.width - a.width : a.path < b.path ? -1 : 1))
const factsFile = join(out, 'facts.jsonl')
writeFileSync(factsFile, facts.map((f) => JSON.stringify(f)).join('\n') + '\n')
console.log(`${chosen.length} pages at ${WIDTHS.join(' and ')} px observed in ${((Date.now() - started) / 1000) | 0}s: ${factsFile}`)
if (args.includes('--facts-only')) process.exit(0)

// The judge: site-standard v1 in Rust.
const judge = resolve(arg('--judge') ?? join(import.meta.dirname, '../../../target/release/swarmpress-wp-migrate'))
const pass = (k: string) => (arg(k) ? [k, arg(k)!] : [])
const r = spawnSync(
  judge,
  [
    'qa', '--facts', factsFile, '--export', exportDir, '--out', join(out, 'report.json'), '--production', production,
    ...pass('--public-origin'), ...pass('--theme-data'), ...pass('--exceptions'), ...pass('--bench'), ...pass('--branch'), ...pass('--commit'),
  ],
  { stdio: 'inherit' },
)
process.exit(r.status ?? 2)
