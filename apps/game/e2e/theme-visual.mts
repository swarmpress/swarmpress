// The web designer's visual check (FEAT-115, ADR-0093): a design's pages next to the pages its
// theme renders, scored per page and width by `visualSimilarity` (src/site-design/visual.ts). A
// runner step, not a test (Playwright's testMatch only takes *.spec.ts): the job's digest does
// not carry the score yet, because the browser executor cannot screenshot its own WordPress.
//
//   cd apps/game && bun e2e/theme-visual.mts --design <dir> --site <dir> --out <dir> \
//     [--pair pages/06-applied-homepage.html=/] … [--widths 375,1280] [--cols 16]
//
// `--design` is a bundle directory (`swarmpress-site-theme --out …/design`), `--site` a static
// export (`swarmpress wp-migrate … --out …`: `export/`). Each `--pair` names a design page and
// the site's URL that renders its template (default: the applied homepage and `/`). Both are
// served from loopback, screenshotted full page at each width (animations off, fonts loaded),
// scaled to 256 px across in the browser and compared; the report (`visual.json`) has the score,
// colour, structure, coverage and the worst cells per pair and width, and the screenshots sit
// beside it.
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { extname, join, resolve } from 'node:path'
import { chromium, type Page } from '@playwright/test'
import { visualSimilarity, type Raster } from '../src/site-design/visual.ts'

const argv = process.argv.slice(2)
const arg = (name: string, dflt?: string) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : dflt
}
const all = (name: string) => argv.flatMap((a, i) => (a === `--${name}` ? [argv[i + 1]] : []))
const designDir = resolve(arg('design') ?? '')
const siteDir = resolve(arg('site') ?? '')
const out = resolve(arg('out') ?? 'reports/theme-visual')
const widths = (arg('widths', '375,1280') ?? '').split(',').map(Number)
const cols = Number(arg('cols', '16'))
const pairs = (all('pair').length ? all('pair') : ['pages/06-applied-homepage.html=/']).map((p) => {
  const [design, site] = p.split('=')
  return { design, site }
})
if (!existsSync(designDir) || !existsSync(siteDir)) {
  console.error('usage: bun e2e/theme-visual.mts --design <dir> --site <dir> --out <dir> [--pair page=url]… [--widths 375,1280]')
  process.exit(2)
}

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

/** A full-page screenshot of `url` at `width`, saved, and the same scaled to 256 px across. */
async function shot(page: Page, url: string, width: number, file: string): Promise<Raster> {
  await page.setViewportSize({ width, height: 900 })
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  const png = await page.screenshot({ fullPage: true, animations: 'disabled', path: file })
  const b64 = png.toString('base64')
  const small = await page.evaluate(async (data) => {
    const img = new Image()
    img.src = `data:image/png;base64,${data}`
    await img.decode()
    const w = 256
    const h = Math.max(1, Math.round((img.naturalHeight * w) / img.naturalWidth))
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const g = c.getContext('2d')!
    g.imageSmoothingQuality = 'high'
    g.drawImage(img, 0, 0, w, h)
    return { width: w, height: h, data: Array.from(g.getImageData(0, 0, w, h).data) }
  }, b64)
  return { width: small.width, height: small.height, data: Uint8ClampedArray.from(small.data) }
}

const design = await serve(designDir)
const site = await serve(siteDir)
mkdirSync(out, { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage()
const results: unknown[] = []
try {
  for (const p of pairs) {
    for (const width of widths) {
      const name = `${p.design.replace(/[^a-z0-9]+/gi, '-')}@${width}`
      const a = await shot(page, `${design.origin}/${p.design}`, width, join(out, `${name}.design.png`))
      const b = await shot(page, `${site.origin}${p.site}`, width, join(out, `${name}.site.png`))
      const s = visualSimilarity(a, b, { cols })
      const scale = width / 256
      results.push({
        design: p.design,
        site: p.site,
        width,
        ...s,
        worst: s.worst.map((r) => ({ ...r, x: Math.round(r.x * scale), y: Math.round(r.y * scale), width: Math.round(r.width * scale), height: Math.round(r.height * scale) })),
      })
      console.log(`${p.design} ↔ ${p.site} @${width}px: ${s.similarity}‰ (colour ${s.colour}, structure ${s.structure}, coverage ${s.coverage})`)
    }
  }
} finally {
  await browser.close()
  design.server.close()
  site.server.close()
}
writeFileSync(join(out, 'visual.json'), JSON.stringify({ pairs: results }, null, 2) + '\n')
