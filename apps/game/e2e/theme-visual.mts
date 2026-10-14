// The web designer's visual check (FEAT-115, ADR-0093): a design's pages next to the pages its
// theme renders, compared region by region at each width. A runner step, not a test
// (Playwright's testMatch only takes *.spec.ts); the web designer's job runs it through its host
// (`swarmpress-site-theme --wordpress …`) and puts the score in its digest.
//
//   cd apps/game && bun e2e/theme-visual.mts --spec <spec.json> --out <dir>
//
// The spec (written by the host):
//   { "design": "<bundle dir>",                      // served from loopback
//     "site": "<a static export dir, or an origin>", // a directory is served from loopback
//     "widths": [375, 1280],
//     "mask": { "design": ".ph", "site": ".ds-tile,.ds-card-img" },
//     "pages": [ { "name": "front-page", "design": "pages/06-applied-homepage.static.html",
//                  "site": "/", "regions": [ { "name": "hero", "design": "[data-sp-section=hero]",
//                  "site": ".sp-hero" }, … ] }, … ] }
//
// Pictures are masked on both sides (every <img>, and the selectors under `mask`: the design's
// picture placeholders, the site's picture frames) as one flat grey, so real photographs against
// the design's placeholders do not count; what is compared is layout, type, colour and rules.
// Each region is cut from a full-page screenshot, both crops scaled to 256 px across and scored
// with `visualSimilarity`; a page's score is the regions' scores weighted by the design region's
// height (`pageScore`), a region the site lacks scoring 0. `visual.json` has, per page and
// width, the score, every region's score and the site region's markup (for a repair turn), and
// the whole-page score of the same masked screenshots for reference; the crops sit beside it.
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { extname, join, resolve } from 'node:path'
import { chromium, type Page } from '@playwright/test'
import { pageScore, visualSimilarity, type Raster, type RegionScore } from '../src/site-design/visual.ts'

interface RegionSpec {
  name: string
  design: string
  site: string
  /** Compare only as much of the site's region as the design's has, at the same aspect (a list
   * of twelve entries against the design's row of three). */
  sameAspect?: boolean
}
interface PageSpec {
  name: string
  design: string
  site: string
  regions: RegionSpec[]
}
interface Spec {
  design: string
  site: string
  widths?: number[]
  mask?: { design?: string; site?: string }
  pages: PageSpec[]
}

const argv = process.argv.slice(2)
const arg = (name: string, dflt?: string) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : dflt
}
const specFile = arg('spec')
const out = resolve(arg('out') ?? 'reports/theme-visual')
if (!specFile || !existsSync(specFile)) {
  console.error('usage: bun e2e/theme-visual.mts --spec <spec.json> --out <dir>')
  process.exit(2)
}
const spec = JSON.parse(readFileSync(specFile, 'utf8')) as Spec
const widths = spec.widths?.length ? spec.widths : [375, 1280]

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml',
}

/** Serves a directory (`/x/` → `/x/index.html`) on loopback. */
function serve(root: string): Promise<{ server: Server; origin: string }> {
  const server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0])
    let file = join(root, path)
    if (!file.startsWith(root)) {
      res.statusCode = 403
      return res.end()
    }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
    if (!existsSync(file)) {
      res.statusCode = 404
      return res.end('not found')
    }
    res.setHeader('Content-Type', MIME[extname(file)] ?? 'application/octet-stream')
    createReadStream(file).pipe(res)
  })
  return new Promise((ok) =>
    server.listen(0, '127.0.0.1', () => {
      const a = server.address()
      ok({ server, origin: `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}` })
    }),
  )
}

const MASK_COLOUR = '#8c8c8c'
const maskCss = (extra: string | undefined) =>
  `img{object-position:-99999px 0!important;background:${MASK_COLOUR}!important}` +
  (extra ? `${extra}{background:${MASK_COLOUR}!important;background-image:none!important}` : '') +
  '*,*::before,*::after{transition:none!important}' +
  // What overflows the viewport (a picture wider than a phone) is cut, as a phone shows it.
  'html,body{overflow-x:clip!important}'

interface Shot {
  /** The page's laid-out width (wider than the viewport: a fixed-width sheet). */
  fixedWidth: number
  png: Buffer
  regions: Record<string, { x: number; y: number; width: number; height: number; html: string } | null>
  height: number
}

/** A full-page screenshot of `url` at `width`, with the boxes of the named regions. */
async function shoot(page: Page, url: string, width: number, mask: string | undefined, regions: { name: string; selector: string }[]): Promise<Shot> {
  await page.setViewportSize({ width, height: 900 })
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.addStyleTag({ content: maskCss(mask) })
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  // Entrance animations run to their end (a headline that rises into view is compared risen).
  await page.evaluate(() =>
    Promise.race([
      Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))),
      new Promise((ok) => setTimeout(ok, 3000)),
    ]).then(() => undefined),
  )
  const boxes = await page.evaluate((rs) => {
    const out: Record<string, { x: number; y: number; width: number; height: number; html: string } | null> = {}
    for (const r of rs) {
      const el = document.querySelector(r.selector)
      if (!el) {
        out[r.name] = null
        continue
      }
      const b = el.getBoundingClientRect()
      out[r.name] = { x: b.left + scrollX, y: b.top + scrollY, width: b.width, height: b.height, html: el.outerHTML.slice(0, 8000) }
    }
    return out
  }, regions)
  const png = await page.screenshot({ fullPage: true, animations: 'disabled' })
  const height = await page.evaluate(() => document.documentElement.scrollHeight)
  // A sheet laid out at a fixed width: its outer containers are wider than the viewport.
  const fixedWidth = await page.evaluate(() =>
    Math.max(0, ...[...document.querySelectorAll('body > *, body > * > *, body > * > * > *')].map((e) => Math.round(e.getBoundingClientRect().width))),
  )
  return { png, regions: boxes, height, fixedWidth }
}

type Box = { x: number; y: number; width: number; height: number }

/** Crops of one screenshot (CSS pixels; device scale 1), each scaled to 256 px across; `null` is
 * the whole picture. The PNG is decoded once. */
async function crops(page: Page, png: Buffer, boxes: (Box | null)[]): Promise<Raster[]> {
  const out = await page.evaluate(
    async ({ data, boxes }) => {
      const img = new Image()
      img.src = `data:image/png;base64,${data}`
      await img.decode()
      return boxes.map((box) => {
        const b = box ?? { x: 0, y: 0, width: img.naturalWidth, height: img.naturalHeight }
        const w = 256
        const sw = Math.max(1, Math.min(b.width, img.naturalWidth - b.x))
        const sh = Math.max(1, Math.min(b.height, img.naturalHeight - b.y))
        const h = Math.max(1, Math.round((sh * w) / sw))
        const c = document.createElement('canvas')
        c.width = w
        c.height = h
        const g = c.getContext('2d')!
        g.imageSmoothingQuality = 'high'
        g.drawImage(img, b.x, b.y, sw, sh, 0, 0, w, h)
        return { width: w, height: h, data: Array.from(g.getImageData(0, 0, w, h).data) }
      })
    },
    { data: png.toString('base64'), boxes },
  )
  return out.map((r) => ({ width: r.width, height: r.height, data: Uint8ClampedArray.from(r.data) }))
}

const design = await serve(resolve(spec.design))
const siteIsDir = !/^https?:/.test(spec.site)
const site = siteIsDir ? await serve(resolve(spec.site)) : { server: null, origin: spec.site.replace(/\/$/, '') }
mkdirSync(out, { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage()
const results: unknown[] = []
try {
  for (const p of spec.pages) {
    const done = new Set<number>()
    for (const asked of widths) {
      let width = asked
      let a = await shoot(page, `${design.origin}/${p.design}`, width, spec.mask?.design, p.regions.map((r) => ({ name: r.name, selector: r.design })))
      if (a.fixedWidth > width + 20) {
        // A sheet laid out at a fixed width (a components sheet) is compared at that width only.
        results.push({ page: p.name, design: p.design, site: p.site, width: asked, compared: false, reason: `the design's sheet is ${a.fixedWidth} px wide; compared at ${a.fixedWidth} px` })
        width = a.fixedWidth
        if (done.has(width)) continue
        console.log(`${p.name}: the design's page is ${width} px wide at any width; compared at ${width} px`)
        a = await shoot(page, `${design.origin}/${p.design}`, width, spec.mask?.design, p.regions.map((r) => ({ name: r.name, selector: r.design })))
      }
      done.add(width)
      const name = `${p.name}@${width}`
      const b = await shoot(page, `${site.origin}${p.site}`, width, spec.mask?.site, p.regions.map((r) => ({ name: r.name, selector: r.site })))
      writeFileSync(join(out, `${name}.design.png`), a.png)
      writeFileSync(join(out, `${name}.site.png`), b.png)
      // The regions both sides have, cropped in one pass per screenshot.
      const pairs = p.regions
        .map((r) => {
          const da = a.regions[r.name]
          const db = b.regions[r.name]
          const sb = db && r.sameAspect && da && da.width > 0 ? { ...db, height: Math.min(db.height, (da.height * db.width) / da.width) } : db
          return { r, da, db, sb }
        })
        .filter((x) => x.da && x.da.height >= 4)
      const both = pairs.filter((x) => x.db && x.db.height >= 4)
      const ra = await crops(page, a.png, [null, ...both.map((x) => x.da!)])
      const rb = await crops(page, b.png, [null, ...both.map((x) => x.sb!)])
      const whole = visualSimilarity(ra[0], rb[0])
      const regions: (RegionScore & { site_html?: string })[] = []
      for (const x of pairs) {
        const i = both.indexOf(x)
        if (i < 0) {
          regions.push({ name: x.r.name, weight: Math.round(x.da!.height), similarity: 0, found: false })
          continue
        }
        // A thin region (a bar) gets cells small enough to have rows.
        const thin = Math.max(1, Math.min(ra[i + 1].height, rb[i + 1].height))
        const s = visualSimilarity(ra[i + 1], rb[i + 1], { cols: Math.min(128, Math.max(16, Math.ceil(256 / thin))) })
        regions.push({ name: x.r.name, weight: Math.round(x.da!.height), similarity: s.similarity, found: true, site_html: x.db!.html })
      }
      if (!regions.length) {
        results.push({ page: p.name, design: p.design, site: p.site, width, compared: false, reason: 'no region of the design is on this page' })
        continue
      }
      const score = pageScore(regions)
      results.push({ page: p.name, design: p.design, site: p.site, width, score, whole: whole.similarity, regions })
      console.log(
        `${p.name} @${width}px: ${score}‰ by region (whole page ${whole.similarity}‰) — ` +
          regions.map((r) => `${r.name} ${r.found ? r.similarity : 'missing'}`).join(', '),
      )
    }
  }
} finally {
  await browser.close()
  design.server.close()
  site.server?.close()
}
writeFileSync(join(out, 'visual.json'), JSON.stringify({ pages: results }, null, 2) + '\n')
