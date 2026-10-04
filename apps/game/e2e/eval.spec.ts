/**
 * The pipeline eval (FEAT-036, ADR-0057, ADR-0058): eval.html → briefs from
 * the site's content calendar through the real staged pipeline, the editor on
 * the site's own articles and on six seeded-bad drafts → the Cockpit document
 * and the record (docs/runbooks/eval.md).
 *
 * Two tests, two projects of playwright.eval.config.ts:
 *
 * - `@fake` (project `fake`): the scripted model, the committed
 *   cinqueterre-mini pack, three briefs, headless Chromium. Always runs. The
 *   counts are the scripted model's and must not move.
 * - the owner's run (project `real`): installed Chrome, headed, the Bonsai
 *   profile, the real site pack. Gated by BONSAI_E2E=1. It writes the reports
 *   whatever the verdict; it fails only when the run itself did not complete.
 *
 * Settings of the owner's run (environment):
 *   EVAL_PACK=<file>             the site pack (`cargo xtask site-pack <site> --articles --out <file>`); required
 *   EVAL_LLM=bonsai|chrome       backend (default bonsai)
 *   EVAL_N=20                    briefs
 *   EVAL_JOB_TIMEOUT_MIN=60      a job longer than this fails threshold 7
 *   EVAL_TIMEOUT_MIN=720         the test's own limit
 *   BENCH_MACHINE                file-name slug of this machine (default from the CPU and memory)
 *   EVAL_REPORT_ONLY=1 EVAL_RESULTS=<file>   rebuild the document and the record from results
 *                                exported by eval.html (with the owner's marks); no browser
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, expect, test as base, type BrowserContext, type Page } from '@playwright/test'
import { reportContext } from '../src/llm/bench/node-writer'
import { validateBenchmarkDoc, type ReportContext } from '../src/llm/bench/report'
import { overallVerdict, summarize, thresholdRows, type OwnerMarks } from '../src/harness/eval/metrics'
import { evalBenchmarkDoc, evalDocFile, evalMarkdown, evalRecordFile } from '../src/harness/eval/report'
import type { EvalProgress, EvalResults } from '../src/harness/eval/runner'
import { BONSAI_E2E } from './bonsai-fixture'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const PROFILE = process.env.BONSAI_PROFILE ?? fileURLToPath(new URL('../.bonsai-profile', import.meta.url))
const env = process.env

type Eval = NonNullable<Window['__eval']>

const writeJson = (path: string, value: unknown) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)

/** Writes the Cockpit document, the raw results and the record of a run. */
function writeReports(res: EvalResults, marks: OwnerMarks, ctx: ReportContext, recordDir: string) {
  const bench = join(ROOT, 'artifacts', 'bench')
  const rawDir = join(bench, 'raw')
  mkdirSync(rawDir, { recursive: true })
  mkdirSync(recordDir, { recursive: true })
  const doc = evalBenchmarkDoc(res, ctx, summarize(res, marks))
  const problems = validateBenchmarkDoc(doc)
  if (problems.length) throw new Error(`the eval document is not a valid cockpit.benchmark.v1 document: ${problems.join('; ')}`)
  const docPath = join(bench, evalDocFile(res.config.backend, ctx.machine.slug))
  writeJson(docPath, doc)
  // The raw file is what eval.html loads back for reading and marking (`Load … exported results`).
  const raw = join(rawDir, `eval-${res.config.backend}.${ctx.machine.slug}.json`)
  writeJson(raw, { results: res, marks })
  const record = join(recordDir, evalRecordFile(ctx.provenance.generatedAt.slice(0, 10), res.config.backend, ctx.machine.slug))
  writeFileSync(record, evalMarkdown(res, ctx, marks))
  return { doc, docPath, raw, record }
}

async function runToEnd(page: Page, o: { log?: boolean; pollMs?: number } = {}): Promise<EvalResults> {
  let last = ''
  for (;;) {
    const state = await page.evaluate(() => {
      const e = (window as unknown as { __eval?: Eval }).__eval
      return e ? { progress: e.progress(), results: e.results() !== null, error: e.error, status: document.body.dataset.eval } : null
    })
    if (state?.error) throw new Error(`eval.html: ${state.error}`)
    if (state?.status === 'failed') throw new Error(`eval.html failed: ${await page.locator('#status').textContent()}`)
    const p = state?.progress as EvalProgress | null
    const line = p ? `${p.phase} ${p.done}/${p.total} ${p.current} ${p.stage}` : ''
    if (o.log && line !== last) {
      last = line
      console.log(`[eval] ${new Date().toISOString().slice(11, 19)} ${line}`)
    }
    if (state?.results) break
    await page.waitForTimeout(o.pollMs ?? 250)
  }
  return (await page.evaluate(() => (window as unknown as { __eval: Eval }).__eval.results())) as EvalResults
}

// ---------------------------------------------------------------- the scripted model (always)

base('@fake the eval on the scripted model: stable counts, a valid document, the seeded-bad set rejected', async ({ page }) => {
  base.skip(base.info().project.name !== 'fake' || !!env.EVAL_REPORT_ONLY, 'runs in the fake project of playwright.eval.config.ts')
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/eval.html?llm=fake&n=3&autostart=1')
  const res = await runToEnd(page)

  expect(res.errors).toEqual([])
  expect(res.finishedAt).not.toBeNull()
  expect(res.site).toMatchObject({ commit: '3f2a9c1d5e7b4a6f8091a2b3c4d5e6f708192a3b', articles: 3, topicsAvailable: 4, published: ['day-trip-to-portovenere'] })
  const briefs = res.articles.filter((a) => a.kind === 'brief')
  // Calendar order by priority: the critical evergreen topic first, then the high ones in file order.
  expect(briefs.map((a) => a.brief.slug)).toEqual(['cinque-terre-train-schedule-guide', 'beat-the-crowds-cinque-terre-summer', 'wine-harvest-cinque-terre-vendemmia'])
  expect(briefs.map((a) => a.brief.target_words)).toEqual([1200, 1200, 900])
  // The scripted editor: 6 on a first draft, 8 after the revision.
  for (const a of briefs) {
    expect(a.outcome).toBe('approved')
    expect(a.reviews.map((r) => r.score)).toEqual([6, 8])
    expect(a.drafts.map((d) => [d.revision, d.ok, d.committed, d.gatewayIssues])).toEqual([
      [0, true, true, []],
      [1, true, true, []],
    ])
    expect(a.checks?.site_issues).toEqual([])
    expect(a.checks?.gateway_issues).toEqual([])
  }

  const s = summarize(res)
  expect(s).toMatchObject({ briefs: 3, approved: 3, medianRevisions: 1, committed: 6, committedPass: 6, controls: 3, seeded: 6, truncated: 0 })
  // Every seeded fault is caught by the checks; the scripted editor scores every first read 6.
  const seeded = res.articles.filter((a) => a.kind === 'seeded')
  expect(seeded.map((a) => a.seedKind)).toEqual(['block-order', 'banned-phrase', 'unknown-entity', 'too-short', 'raw-html', 'duplicate-slug'])
  expect(s.seededChecksRejected).toBe(6)
  expect(s.seededEditorRejected).toBe(6)
  expect(s.seededRejected).toBeGreaterThanOrEqual(5)
  expect(s.firstTryPct).toBe(100)
  expect(s.stages.map((x) => x.stage)).toEqual(expect.arrayContaining(['outline', 'section', 'closing', 'revise', 'review']))

  const rows = thresholdRows(s, res)
  const verdicts = Object.fromEntries(rows.map((r) => [r.id, r.verdict]))
  expect(verdicts).toMatchObject({ 'committed-pass': 'pass', approved: 'pass', 'median-revisions': 'pass', 'seeded-editor': 'pass', 'seeded-rejected': 'pass', briefs: 'fail', controls: 'fail', owner: 'pending' })
  expect(overallVerdict(rows)).toBe('fail')

  // The page lists every generated article for the owner, and keeps the marks.
  await expect(page.locator('article[data-kind="brief"]')).toHaveCount(3)
  await expect(page.locator('article[data-kind="seeded"]')).toHaveCount(6)
  const first = page.locator('article[data-kind="brief"]').first()
  await expect(first.locator('.text h3')).not.toBeEmpty()
  await first.getByLabel('would publish', { exact: true }).check()
  const marks = (await page.evaluate(() => (window as unknown as { __eval: Eval }).__eval.marks())) as OwnerMarks
  expect(Object.values(marks)).toEqual([{ publish: true, factualError: false }])
  await page.reload()
  await page.evaluate(() => (window as unknown as { __eval: Eval }).__eval.done())

  const ctx = reportContext(ROOT)
  const w = writeReports(res, marks, ctx, join(ROOT, 'artifacts', 'bench', 'qualification'))
  console.log(`[eval] wrote ${[w.docPath, w.raw, w.record].join(', ')}`)
  expect(w.docPath).toMatch(/artifacts\/bench\/agent-pipeline-eval-fake\.json$/)
  const doc = JSON.parse(readFileSync(w.docPath, 'utf8'))
  expect(validateBenchmarkDoc(doc)).toEqual([])
  expect(doc).toMatchObject({ schema: 'cockpit.benchmark.v1', name: 'agent-pipeline-eval-fake', feature_ids: ['FEAT-036'], component: 'agents' })
  const metric = (name: string, subject: string) => doc.metrics.find((m: { name: string; subject?: string }) => m.name === name && m.subject === subject)?.value
  expect(metric('briefs', 'pipeline')).toBe(3)
  expect(metric('committed_pass_pct', 'gateway')).toBe(100)
  expect(metric('seeded_bad.checks_rejected', 'checks')).toBe(6)
  expect(metric('first_try_pct', 'all-stages')).toBe(100)
  const md = readFileSync(w.record, 'utf8')
  expect(md).toContain('## Threshold')
  expect(md).toContain('**Verdict: FAIL**')
  expect(errors).toEqual([])
})

// ---------------------------------------------------------------- the owner's run (gated)

const LLM = env.EVAL_LLM ?? 'bonsai'

const real = base.extend<{ context: BrowserContext; page: Page }>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext(PROFILE, {
      channel: env.BONSAI_CHANNEL ?? 'chrome',
      headless: false,
      viewport: { width: 1280, height: 900 },
      args: (env.BONSAI_CHROME_ARGS ?? '').split(' ').filter(Boolean),
      ...(LLM === 'chrome' ? { ignoreDefaultArgs: ['--disable-background-networking', '--disable-component-update'] } : {}),
    })
    await use(context)
    await context.close()
  },
  page: async ({ context }, use) => {
    await use(context.pages()[0] ?? (await context.newPage()))
  },
})

const RECORD_DIR = join(ROOT, 'docs', 'qualification')

base('the owner’s eval: the reports again from results exported with the owner’s marks', async () => {
  base.skip(base.info().project.name !== 'real' || !env.EVAL_REPORT_ONLY, 'EVAL_REPORT_ONLY=1 EVAL_RESULTS=<exported json> rebuilds the reports')
  const file = env.EVAL_RESULTS
  if (!file || !existsSync(file)) throw new Error('EVAL_RESULTS=<the JSON exported by eval.html> is required with EVAL_REPORT_ONLY=1')
  const doc = JSON.parse(readFileSync(file, 'utf8')) as { results?: EvalResults; marks?: OwnerMarks }
  const res = doc.results ?? (doc as unknown as EvalResults)
  const w = writeReports(res, doc.marks ?? {}, reportContext(ROOT), RECORD_DIR)
  const rows = thresholdRows(summarize(res, doc.marks ?? {}), res)
  for (const r of rows) console.log(`[eval] ${r.verdict.padEnd(12)} ${r.metric}: ${r.measured}`)
  console.log(`[eval] ${overallVerdict(rows).toUpperCase()}; wrote ${[w.docPath, w.record].join(', ')}`)
})

real('the owner’s eval on a real local model', async ({ page }) => {
  real.skip(base.info().project.name !== 'real' || !!env.EVAL_REPORT_ONLY, 'runs in the real project of playwright.eval.config.ts')
  real.skip(!BONSAI_E2E, 'set BONSAI_E2E=1 (and EVAL_PACK) to run the eval on the real model')
  const ctx = reportContext(ROOT)
  const recordDir = RECORD_DIR
  const packFile = env.EVAL_PACK
  if (!packFile || !existsSync(packFile)) throw new Error('EVAL_PACK=<site pack file> is required: cargo xtask site-pack <site> --articles --out <file>')
  real.setTimeout(Number(env.EVAL_TIMEOUT_MIN ?? 720) * 60_000)
  const q = new URLSearchParams({ llm: LLM, n: env.EVAL_N ?? '20', timeout: env.EVAL_JOB_TIMEOUT_MIN ?? '60' })
  await page.goto(`/eval.html?${q}`)
  await page.waitForFunction(() => !!(window as unknown as { __eval?: Eval }).__eval)
  await page.evaluate((text) => (window as unknown as { __eval: Eval }).__eval.loadPack(text), readFileSync(packFile, 'utf8'))
  // A click: Chrome's built-in model needs the user activation on a cold start.
  await page.locator('#start').click()
  const res = await runToEnd(page, { log: true, pollMs: 5000 })
  const w = writeReports(res, {}, ctx, recordDir)
  const rows = thresholdRows(summarize(res), res)
  for (const r of rows) console.log(`[eval] ${r.verdict.padEnd(12)} ${r.metric}: ${r.measured}`)
  console.log(`[eval] wrote ${[w.docPath, w.raw, w.record].join(', ')}`)
  console.log('[eval] now read and mark the articles: open eval.html, load the raw file, export, then EVAL_REPORT_ONLY=1 (docs/runbooks/eval.md)')
  expect(res.finishedAt).not.toBeNull()
})
