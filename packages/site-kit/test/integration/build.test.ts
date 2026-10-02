/**
 * Integration: `astro build` of the starter theme's fixture site (cinqueterre-mini
 * content + site.manifest.json), at the root and under a preview base path, then
 * `kit screenshots` against the build when a Chromium is available.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadSite } from '../../src/content/load'
import { loadManifest } from '../../src/manifest/load'
import { DEFAULT_CHROMIUM, takeScreenshots, validateVisualDocument } from '../../src/screenshots'
import { FIXTURE_SITE } from '../helpers'

const manifest = JSON.parse(readFileSync(join(FIXTURE_SITE, 'site.manifest.json'), 'utf8')) as {
  baseUrl: string
  languages: string[]
  analytics: { endpoint: string; projectKey: string }
}
const LANGS = manifest.languages
const ORIGIN = manifest.baseUrl.replace(/\/+$/, '')

const work = mkdtempSync(join(tmpdir(), 'kit-build-'))
const OUT_ROOT = join(work, 'root')
const OUT_BASE = join(work, 'preview')
const PREVIEW_BASE = '/preview/42/'

function astroBuild(outDir: string, env: Record<string, string> = {}) {
  const req = createRequire(join(FIXTURE_SITE, '..', 'package.json'))
  const astroBin = join(dirname(req.resolve('astro/package.json')), 'astro.js')
  execFileSync(process.execPath, [astroBin, 'build', '--outDir', outDir], {
    cwd: FIXTURE_SITE,
    env: { ...process.env, ...env, ASTRO_TELEMETRY_DISABLED: '1' },
    stdio: 'pipe',
  })
}

const html = (out: string, route: string) => readFileSync(join(out, route, 'index.html'), 'utf8')
const attr = (doc: string, re: RegExp) => [...doc.matchAll(re)].map((m) => m[1])

beforeAll(() => {
  astroBuild(OUT_ROOT)
  astroBuild(OUT_BASE, { SITE_KIT_BASE: PREVIEW_BASE })
}, 600_000)

afterAll(() => rmSync(work, { recursive: true, force: true }))

describe('astro build of the starter fixture site', () => {
  it('builds every route kind in every language', () => {
    for (const lang of LANGS) {
      for (const route of [
        lang, // home
        `${lang}/riomaggiore`, // region (village page)
        `${lang}/vernazza`, // region without a page (kit default layout)
        `${lang}/riomaggiore/restaurants`, // region section → collection
        `${lang}/restaurants`, // collection index
        `${lang}/restaurants/rio-bistrot`, // collection item detail
        `${lang}/blog`, // blog index
        `${lang}/404`,
      ]) {
        expect(existsSync(join(OUT_ROOT, route, 'index.html')), route).toBe(true)
      }
    }
    // Localized blog slug from the page's own slug map.
    expect(existsSync(join(OUT_ROOT, 'de/blog/5-versteckte-gelaterias-die-sie-probieren-muessen/index.html'))).toBe(true)
    expect(existsSync(join(OUT_ROOT, 'en/blog/5-hidden-gelaterias-you-need-to-try/index.html'))).toBe(true)
    // Collections without detailRoute get no item pages.
    expect(existsSync(join(OUT_ROOT, 'en/hikes/riomaggiore'))).toBe(false)
  })

  it('writes a root 404, a root redirect, sitemap.xml and robots.txt', () => {
    expect(existsSync(join(OUT_ROOT, '404.html'))).toBe(true)
    expect(readFileSync(join(OUT_ROOT, '404.html'), 'utf8')).toMatch(/<meta name="robots" content="noindex"/)
    expect(readFileSync(join(OUT_ROOT, 'index.html'), 'utf8')).toMatch(/\/en\//)
    const sitemap = readFileSync(join(OUT_ROOT, 'sitemap.xml'), 'utf8')
    for (const lang of LANGS) expect(sitemap).toContain(`<loc>${ORIGIN}/${lang}/riomaggiore/</loc>`)
    expect(sitemap).toContain('hreflang="de"')
    expect(sitemap).not.toMatch(/\/404\//)
    const robots = readFileSync(join(OUT_ROOT, 'robots.txt'), 'utf8')
    expect(robots).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`)
  })

  it('renders canonical, hreflang (available languages only), OG and JSON-LD', () => {
    const doc = html(OUT_ROOT, 'de/riomaggiore')
    expect(attr(doc, /<link rel="canonical" href="([^"]+)"/g)).toEqual([`${ORIGIN}/de/riomaggiore/`])
    const alts = attr(doc, /<link rel="alternate" hreflang="([^"]+)"/g)
    expect(alts.sort()).toEqual([...LANGS, 'x-default'].sort())
    expect(doc).toMatch(/<html[^>]* lang="de"/)
    expect(doc).toMatch(/<meta property="og:title"/)
    expect(doc).toMatch(/"@type":"Place"/)

    // The portovenere post exists in four languages; the gelaterias post too.
    const post = html(OUT_ROOT, 'en/blog/5-hidden-gelaterias-you-need-to-try')
    expect(post).toMatch(/<meta property="og:type" content="article"/)
    expect(post).toMatch(/"@type":"Article"/)
    expect(attr(post, /hreflang="([^"]+)"/g)).toContain('de')

    // Home has WebSite JSON-LD.
    expect(html(OUT_ROOT, 'en')).toMatch(/"@type":"WebSite"/)
  })

  it('omits hreflang for languages a page is not translated into', () => {
    // last-light-on-sentiero-azzurro is English-only in the fixture content.
    const page = JSON.parse(readFileSync(join(FIXTURE_SITE, 'content/pages/blog/last-light-on-sentiero-azzurro.json'), 'utf8'))
    const langs = Object.keys(page.slug)
    const doc = html(OUT_ROOT, page.slug.en.replace(/^\/+|\/+$/g, ''))
    const alts = attr(doc, /<link rel="alternate" hreflang="([^"]+)"/g).filter((l) => l !== 'x-default')
    expect(alts.sort()).toEqual([...langs].sort())
  })

  it('renders the first-party tracker tag from manifest.analytics', () => {
    const doc = html(OUT_ROOT, 'it')
    const { endpoint, projectKey } = manifest.analytics
    expect(doc).toContain(`<script defer src="${endpoint}/t/s.js" data-project="${projectKey}" data-endpoint="${endpoint}"></script>`)
  })

  it('resolves internal links and assets against the base path', () => {
    const doc = html(OUT_BASE, 'en/riomaggiore')
    expect(attr(doc, /<link rel="canonical" href="([^"]+)"/g)).toEqual([`${ORIGIN}${PREVIEW_BASE}en/riomaggiore/`])
    expect(attr(doc, /hreflang="de" href="([^"]+)"/g)).toEqual([`${ORIGIN}${PREVIEW_BASE}de/riomaggiore/`])
    const hrefs = attr(doc, /<a [^>]*href="(\/[^"]*)"/g)
    expect(hrefs.length).toBeGreaterThan(5)
    expect(hrefs.filter((h) => !h.startsWith(PREVIEW_BASE))).toEqual([])
    const assets = attr(doc, /(?:href|src)="(\/_astro\/[^"]+)"/g)
    expect(assets).toEqual([])
    expect(readFileSync(join(OUT_BASE, 'sitemap.xml'), 'utf8')).toContain(`<loc>${ORIGIN}${PREVIEW_BASE}en/</loc>`)
  })

  it('writes the closed-world link report and the content report', () => {
    const links = JSON.parse(readFileSync(join(FIXTURE_SITE, '.kit/link-report.json'), 'utf8'))
    expect(links.checked).toBeGreaterThan(0)
    expect(links.broken.some((b: { href: string }) => b.href === '/en/itinerary')).toBe(true)
    const content = JSON.parse(readFileSync(join(FIXTURE_SITE, '.kit/content-report.json'), 'utf8'))
    expect(content.newErrors).toBe(0)
  })

  it('renders theme overrides, kit fallbacks and the custom block', () => {
    const home = html(OUT_ROOT, 'en')
    expect(home).toMatch(/data-block="editorial-hero"/)
    const sources = new Set(attr(home, /data-block-source="([a-z]+)"/g))
    expect(sources.has('theme')).toBe(true)
  })
})

const chromium = process.env.CHROMIUM_PATH ?? DEFAULT_CHROMIUM
describe.skipIf(!existsSync(chromium))('kit screenshots', () => {
  it('captures manifest.screenshotPages and writes a valid cockpit.visual.v1 document', async () => {
    const m = loadManifest(FIXTURE_SITE)
    const site = loadSite({ root: FIXTURE_SITE, manifest: m.manifest })
    const outDir = join(work, 'shots')
    const doc = await takeScreenshots({ root: FIXTURE_SITE, site, dist: OUT_ROOT, outDir, widths: [375, 1280], executablePath: chromium })
    expect(validateVisualDocument(doc)).toEqual([])
    // 3 pages × (en + longest language) × 2 widths
    expect(doc.comparisons).toHaveLength(3 * 2 * 2)
    expect(doc.comparisons.every((c) => c.status === 'missing_baseline')).toBe(true)
    const pngs = readdirSync(outDir).filter((f) => f.endsWith('.png'))
    expect(pngs).toHaveLength(12)
    const written = JSON.parse(readFileSync(join(outDir, 'cockpit.visual.json'), 'utf8'))
    expect(written.schema).toBe('cockpit.visual.v1')

    // Against itself as the baseline, everything passes.
    const again = await takeScreenshots({ root: FIXTURE_SITE, site, dist: OUT_ROOT, outDir: join(work, 'shots2'), widths: [375], pages: ['/'], baselineDir: outDir, executablePath: chromium })
    expect(again.comparisons.map((c) => c.status)).toEqual(['pass', 'pass'])
  }, 300_000)
})
