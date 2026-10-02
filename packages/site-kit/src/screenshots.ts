/**
 * `kit screenshots` — Playwright screenshots of `manifest.screenshotPages` at
 * 375/768/1280/1440 px for `en` (or the default language) and the "longest"
 * language (most text in the content), served from the built `dist/`.
 * Emits a `cockpit.visual.v1` document; with `--baseline <dir>` each shot is
 * pixel-diffed (in the browser, no extra deps) against the same file name.
 */
import { execFileSync } from 'node:child_process'
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { extname, join, relative, resolve, sep } from 'node:path'
import type { LoadedSite } from './content/load'
import type { SiteManifest } from './manifest/schema'

export const DEFAULT_WIDTHS = [375, 768, 1280, 1440]
export const DEFAULT_CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ico': 'image/x-icon',
}

/** Serves `dist/` under the site base (directory format: /x/ → /x/index.html). */
export function serveDist(dist: string, base: string): Promise<{ server: Server; origin: string }> {
  const b = base.replace(/\/+$/, '')
  const server = createServer((req, res) => {
    let path = decodeURIComponent((req.url ?? '/').split('?')[0])
    if (b && path.startsWith(b)) path = path.slice(b.length) || '/'
    let file = join(dist, path)
    if (!file.startsWith(resolve(dist))) {
      res.statusCode = 403
      return res.end()
    }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
    if (!existsSync(file)) {
      res.statusCode = 404
      const nf = join(dist, '404.html')
      if (existsSync(nf)) {
        res.setHeader('Content-Type', MIME['.html'])
        return createReadStream(nf).pipe(res)
      }
      return res.end('not found')
    }
    res.setHeader('Content-Type', MIME[extname(file)] ?? 'application/octet-stream')
    createReadStream(file).pipe(res)
  })
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => {
    const addr = server.address()
    ok({ server, origin: `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}` })
  }))
}

/** The non-default language with the most text in the content (for overflow checks). */
export function longestLanguage(site: LoadedSite): string | undefined {
  const total = new Map<string, number>()
  const visit = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(visit)
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (site.manifest.languages.includes(k) && typeof x === 'string') total.set(k, (total.get(k) ?? 0) + x.length)
        else visit(x)
      }
    }
  }
  for (const p of site.pages) visit(p.data.body)
  const candidates = site.manifest.languages.filter((l) => l !== 'en' && l !== site.manifest.defaultLanguage)
  return candidates.sort((a, b) => (total.get(b) ?? 0) - (total.get(a) ?? 0))[0]
}

export interface ScreenshotOptions {
  root: string
  site: LoadedSite
  dist: string
  outDir: string
  widths?: number[]
  langs?: string[]
  baselineDir?: string
  /** Max share of differing pixels for `pass` (default 0.005 = 0.5%). */
  threshold?: number
  executablePath?: string
  pages?: string[]
}

export interface VisualComparison {
  id: string
  title: string
  component: string
  browser: string
  viewport: { width: number; height: number }
  actual: { path: string }
  baseline?: { path: string }
  diff?: { path: string }
  metrics?: { changed_pixels?: number; difference_ratio?: number }
  threshold?: { max_difference_ratio: number }
  status: 'pass' | 'fail' | 'missing_baseline' | 'inconclusive'
  reason?: string
}

export interface VisualDocument {
  schema: 'cockpit.visual.v1'
  source: string
  suite: string
  provenance: { commit?: string; branch?: string; dirty?: boolean; generated_at: string; tool: { name: string; version: string } }
  features: string[]
  comparisons: VisualComparison[]
}

function git(root: string, args: string[]): string | undefined {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return undefined
  }
}

const slugOf = (p: string) => p.replace(/^\/+|\/+$/g, '').replace(/[^a-z0-9]+/gi, '-') || 'home'

export async function takeScreenshots(opts: ScreenshotOptions): Promise<VisualDocument> {
  const m: SiteManifest = opts.site.manifest
  const widths = opts.widths ?? DEFAULT_WIDTHS
  const first = m.languages.includes('en') ? 'en' : m.defaultLanguage
  const langs = opts.langs ?? [...new Set([first, longestLanguage(opts.site)].filter((x): x is string => !!x))]
  const pages = opts.pages ?? m.screenshotPages
  const threshold = opts.threshold ?? 0.005
  mkdirSync(opts.outDir, { recursive: true })
  const { chromium } = await import('playwright-core')
  const executablePath = opts.executablePath ?? process.env.CHROMIUM_PATH ?? (existsSync(DEFAULT_CHROMIUM) ? DEFAULT_CHROMIUM : undefined)
  const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] })
  const { server, origin } = await serveDist(opts.dist, m.base)
  const comparisons: VisualComparison[] = []
  const docDir = opts.outDir
  const relToDoc = (f: string) => relative(docDir, f).split(sep).join('/')
  try {
    const context = await browser.newContext({ deviceScaleFactor: 1, reducedMotion: 'reduce' })
    // Never phone home from screenshots (tracker, remote images stay allowed).
    await context.route('**/t/s.js', (r) => r.fulfill({ status: 204, body: '' }))
    const page = await context.newPage()
    for (const p of pages) {
      for (const lang of langs) {
        const path = `${m.base.replace(/\/+$/, '')}/${lang}${p === '/' ? '/' : p.startsWith('/') ? p : '/' + p}`
        for (const width of widths) {
          const height = width < 768 ? 812 : 900
          await page.setViewportSize({ width, height })
          const resp = await page.goto(origin + path, { waitUntil: 'networkidle', timeout: 45_000 }).catch(() => null)
          await page.evaluate(() => (document as Document & { fonts?: FontFaceSet }).fonts?.ready).catch(() => undefined)
          const name = `${slugOf(p)}--${lang}--${width}.png`
          const file = join(opts.outDir, name)
          await page.screenshot({ path: file, fullPage: true })
          const c: VisualComparison = {
            id: `${slugOf(p)}/${lang}/${width}`,
            title: `${p} (${lang}) @ ${width}px`,
            component: 'site',
            browser: 'chromium',
            viewport: { width, height },
            actual: { path: relToDoc(file) },
            status: 'missing_baseline',
          }
          if (!resp || resp.status() >= 400) {
            c.status = 'inconclusive'
            c.reason = `HTTP ${resp?.status() ?? 'error'} for ${path}`
          } else if (opts.baselineDir && existsSync(join(opts.baselineDir, name))) {
            const basePng = join(opts.baselineDir, name)
            const result = await page.evaluate(
              async ([a, b]) => {
                const load = (src: string) =>
                  new Promise<HTMLImageElement>((ok, err) => {
                    const i = new Image()
                    i.onload = () => ok(i)
                    i.onerror = err
                    i.src = src
                  })
                const [ia, ib] = await Promise.all([load(a), load(b)])
                const w = Math.max(ia.width, ib.width)
                const h = Math.max(ia.height, ib.height)
                const draw = (img: HTMLImageElement) => {
                  const c = document.createElement('canvas')
                  c.width = w
                  c.height = h
                  const g = c.getContext('2d')!
                  g.fillStyle = '#ff00ff'
                  g.fillRect(0, 0, w, h)
                  g.drawImage(img, 0, 0)
                  return g.getImageData(0, 0, w, h)
                }
                const da = draw(ia)
                const db = draw(ib)
                const out = document.createElement('canvas')
                out.width = w
                out.height = h
                const og = out.getContext('2d')!
                const diff = og.createImageData(w, h)
                let changed = 0
                for (let i = 0; i < da.data.length; i += 4) {
                  const d = Math.abs(da.data[i] - db.data[i]) + Math.abs(da.data[i + 1] - db.data[i + 1]) + Math.abs(da.data[i + 2] - db.data[i + 2])
                  const hit = d > 48
                  if (hit) changed++
                  diff.data[i] = hit ? 255 : da.data[i] * 0.3
                  diff.data[i + 1] = hit ? 0 : da.data[i + 1] * 0.3
                  diff.data[i + 2] = hit ? 0 : da.data[i + 2] * 0.3
                  diff.data[i + 3] = 255
                }
                og.putImageData(diff, 0, 0)
                return { changed, total: w * h, png: out.toDataURL('image/png') }
              },
              [
                `data:image/png;base64,${readFileSync(file).toString('base64')}`,
                `data:image/png;base64,${readFileSync(basePng).toString('base64')}`,
              ] as [string, string],
            )
            const ratio = result.total ? result.changed / result.total : 0
            const diffFile = join(opts.outDir, name.replace(/\.png$/, '.diff.png'))
            writeFileSync(diffFile, Buffer.from(result.png.split(',')[1], 'base64'))
            c.baseline = { path: relToDoc(basePng) }
            c.diff = { path: relToDoc(diffFile) }
            c.metrics = { changed_pixels: result.changed, difference_ratio: Number(ratio.toFixed(6)) }
            c.threshold = { max_difference_ratio: threshold }
            c.status = ratio <= threshold ? 'pass' : 'fail'
          }
          comparisons.push(c)
        }
      }
    }
    await context.close()
  } finally {
    await browser.close()
    server.close()
  }
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
  const doc: VisualDocument = {
    schema: 'cockpit.visual.v1',
    source: 'site',
    suite: 'screenshots',
    provenance: {
      commit: git(opts.root, ['rev-parse', 'HEAD']),
      branch: git(opts.root, ['rev-parse', '--abbrev-ref', 'HEAD']),
      dirty: git(opts.root, ['status', '--porcelain']) ? true : false,
      generated_at: new Date().toISOString(),
      tool: { name: 'kit-screenshots', version: pkg.version },
    },
    features: ['FEAT-044', 'FEAT-045'],
    comparisons,
  }
  writeFileSync(join(opts.outDir, 'cockpit.visual.json'), JSON.stringify(doc, null, 2) + '\n')
  return doc
}

/** Minimal structural validation of a cockpit.visual.v1 document. */
export function validateVisualDocument(doc: unknown): string[] {
  const errs: string[] = []
  const d = doc as Partial<VisualDocument>
  if (d?.schema !== 'cockpit.visual.v1') errs.push('schema must be "cockpit.visual.v1"')
  if (!Array.isArray(d?.comparisons)) errs.push('comparisons must be an array')
  for (const [i, c] of (d?.comparisons ?? []).entries()) {
    if (!c.id) errs.push(`comparisons[${i}].id missing`)
    if (!c.actual?.path) errs.push(`comparisons[${i}].actual.path missing`)
    if (!['pass', 'fail', 'missing_baseline', 'new_baseline', 'inconclusive', 'skipped'].includes(c.status)) errs.push(`comparisons[${i}].status invalid`)
    if (!c.viewport?.width) errs.push(`comparisons[${i}].viewport missing`)
  }
  if (!d?.provenance?.generated_at) errs.push('provenance.generated_at missing')
  return errs
}

