/**
 * The model qualification run (ADR-0057, FEAT-037, FEAT-038):
 * bench.html → the chosen backend → the fixtures → the reports
 * (docs/runbooks/model-qualification.md).
 *
 * Two tests, two projects of playwright.bonsai.config.ts:
 *
 * - `@scripted` (project `scripted`): the harness on the scripted backend in
 *   headless Chromium. No GPU, no network. The reports must come out with the
 *   counts the scripted faults dictate. Always runs.
 * - the qualification (project `bonsai`): installed Chrome, headed, with the
 *   persistent profile, against a real backend. Gated by BONSAI_E2E=1. It
 *   writes the reports whatever the verdict; it fails only when the run itself
 *   did not complete.
 *
 * Settings of the qualification run (environment):
 *   BENCH_LLM=gemma|bonsai|chrome|transformers   backend (default bonsai)
 *   BENCH_MTP=1                            gemma: load the MTP drafter and use it
 *   BENCH_SUITE=full|frames|load           default full
 *   BENCH_QUALITY=low|medium|high|off      scene tier (default medium; off for load)
 *   BENCH_SCALE, BENCH_FIXTURES, BENCH_THINKING, BENCH_CONTEXT, BENCH_DEPTH,
 *   BENCH_REPEAT, BENCH_RELOADS, BENCH_START=cold|warm, BENCH_LOSS=manual,
 *   BENCH_CALL_TIMEOUT_S, BENCH_IDLE_S     passed to bench.html (see src/llm/bench/harness.ts)
 *   BENCH_TIMEOUT_MIN                      the test's own limit (default 720)
 *   BENCH_MACHINE                          file-name slug of this machine (default from the CPU and memory)
 *   BENCH_LABEL                            run label in the file names (default from the settings)
 *   BENCH_REPORT_ONLY=1                    rebuild the qualification report from the raw results; no browser
 */
import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium, expect, test as base, type BrowserContext, type Page } from '@playwright/test'
import type { BenchState } from '../src/llm/bench/runner'
import type { BenchResults } from '../src/llm/bench/metrics'
import { summarizeByFixture } from '../src/llm/bench/metrics'
import { reportContext, writeQualification, writeRun } from '../src/llm/bench/node-writer'
// Node's loader in Playwright: nothing imported here may import JSON (the manifest does).
import { validateBenchmarkDoc, type QualificationExtras, type Row } from '../src/llm/bench/report'
import { checkGolden, type Goldens } from '../src/llm/runtime/bonsai/equivalence'
import { BONSAI_E2E, ENGINE_PATH } from './bonsai-fixture'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const GOLDENS = fileURLToPath(new URL('./bonsai-equivalence.goldens.json', import.meta.url))
// The profile of the other Bonsai specs (e2e/bonsai-fixture.ts), so the weights are shared.
const PROFILE = process.env.BONSAI_PROFILE ?? fileURLToPath(new URL('../.bonsai-profile', import.meta.url))
const env = process.env

type Bench = NonNullable<Window['__bench']>

/** Polls the page until the run ends; logs stage changes; reacts to the manual device-loss step. */
async function runToEnd(page: Page, o: { onStage?: (stage: string, s: BenchState) => Promise<void>; pollMs?: number; log?: boolean } = {}): Promise<BenchResults> {
  let last = ''
  let lastCount = ''
  for (;;) {
    const s = (await page.evaluate(() => (window as unknown as { __bench?: Bench }).__bench?.state() ?? null)) as BenchState | null
    if (s) {
      if (s.stage !== last) {
        last = s.stage
        if (o.log) console.log(`[bench] ${new Date().toISOString().slice(11, 19)} ${s.stage}`)
        await o.onStage?.(s.stage, s)
      }
      const counts = s.fixtures.map((f) => `${f.id} ${f.done}/${f.total}${f.failed ? ` (${f.failed} failed)` : ''}`).join(', ')
      if (o.log && counts !== lastCount && s.stage.startsWith('fixture:')) {
        lastCount = counts
        const f = s.fixtures.find((x) => `fixture:${x.id}` === s.stage)
        if (f && (f.done % 5 === 0 || f.done === f.total)) console.log(`[bench]   ${f.id}: ${f.done} of ${f.total}${f.failed ? `, ${f.failed} failed` : ''}`)
      }
      if (s.status === 'done' || s.status === 'failed') break
    }
    const error = await page.evaluate(() => (window as unknown as { __bench?: Bench }).__bench?.error ?? null)
    if (error && !s) throw new Error(`bench.html: ${error}`)
    await page.waitForTimeout(o.pollMs ?? 500)
  }
  return (await page.evaluate(() => (window as unknown as { __bench: Bench }).__bench.results())) as BenchResults
}

function printRows(rows: Row[]) {
  for (const r of rows) console.log(`[bench] ${r.verdict.padEnd(12)} ${r.metric}: ${r.measured}`)
}

// ---------------------------------------------------------------- the scripted backend (always)

base('@scripted the harness on the scripted backend writes both report kinds with stable counts', async ({ page }) => {
  // bench.html is in the harness build, which only playwright.bonsai.config.ts serves.
  base.skip(base.info().project.name !== 'scripted', 'runs in the scripted project of playwright.bonsai.config.ts')
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  // idle=4: software WebGPU on a CI runner can draw under one frame a second, and the idle phase needs frames.
  await page.goto('/bench.html?llm=fake&quality=low&reloads=2&loss=hook&idle=4&memory=1&autostart=1')
  const r = await runToEnd(page)

  expect(r.fatal).toBeUndefined()
  expect(r.complete).toBe(true)
  expect(r.env.crossOriginIsolated).toBe(true)
  // The counts the scripted faults dictate (src/llm/bench/fake.ts, runner.test.ts).
  expect(r.calls).toHaveLength(299)
  const by = summarizeByFixture(r.calls)
  expect(Object.fromEntries([...by].map(([id, s]) => [id, [s.calls, s.failed, s.extraTurns, s.truncations, s.checkFailed]]))).toEqual({
    'short-action': [50, 1, 7, 1, 1],
    'short-answer': [30, 0, 0, 1, 2],
    'context-inspection': [50, 0, 4, 1, 2],
    section: [50, 1, 4, 0, 1],
    'staged-article': [49, 1, 3, 0, 1],
    'meeting-turn': [20, 1, 0, 1, 0],
    'moderator-pick': [50, 0, 3, 0, 1],
  })
  expect(r.articles.filter((a) => a.ok)).toHaveLength(6)
  expect(r.loads.map((l) => [l.kind, l.ok])).toEqual([
    ['cold', true],
    ['warm', true],
    ['warm', true],
  ])
  expect(r.deviceLoss).toMatchObject({ mode: 'hook', observed: true, inFlightFailed: true })
  // The scene drew while the model was idle and while it was generating.
  expect(r.frames?.renderer).toBe('webgpu')
  expect(Object.keys(r.frames!.phases)).toEqual(expect.arrayContaining(['idle-unloaded', 'idle', 'generating']))
  // Page memory, from measureUserAgentSpecificMemory (the page is cross-origin isolated): a number,
  // or the reason the browser gave none. Never silently missing.
  const ua = r.memory.filter((m) => m.label === 'after load' || m.label === 'after the suite')
  expect(ua).toHaveLength(2)
  for (const m of ua) expect(typeof m.uaBytes === 'number' ? m.uaBytes > 0 : typeof m.uaError === 'string').toBe(true)
  console.log(`[bench] page memory: ${ua.map((m) => (m.uaBytes !== null ? `${m.uaBytes} bytes` : m.uaError)).join('; ')}`)

  const w = writeRun({ root: ROOT, results: r })
  console.log(`[bench] wrote ${[w.raw, w.modelEval, w.frameTime, w.qualification].join(', ')}`)
  expect(w.modelEval).toMatch(/artifacts\/bench\/model-eval-fake\.[a-z0-9-]+\.json$/)
  expect(w.frameTime).toMatch(/artifacts\/bench\/frame-time-llm-low\.fake\.json$/)
  expect(w.qualification).toMatch(/artifacts\/bench\/qualification\/\d{4}-\d\d-\d\d-fake-[a-z0-9-]+\.md$/)
  const evalDoc = JSON.parse(readFileSync(w.modelEval, 'utf8'))
  const frameDoc = JSON.parse(readFileSync(w.frameTime!, 'utf8'))
  expect(validateBenchmarkDoc(evalDoc)).toEqual([])
  expect(validateBenchmarkDoc(frameDoc)).toEqual([])
  const metric = (doc: { metrics: { name: string; subject?: string; value: number }[] }, name: string, subject: string) => doc.metrics.find((m) => m.name === name && m.subject === subject)?.value
  expect(metric(evalDoc, 'calls', 'all')).toBe(299)
  expect(metric(evalDoc, 'failures', 'all')).toBe(4)
  expect(metric(evalDoc, 'valid.first_attempt_pct', 'short-action')).toBe(90)
  expect(metric(evalDoc, 'article.completed', 'staged-article')).toBe(6)
  expect(metric(evalDoc, 'passes.device_lost', 'device-loss')).toBe(0)
  expect(metric(frameDoc, 'frames', 'generating')).toBeGreaterThan(0)
  const md = readFileSync(w.qualification, 'utf8')
  expect(md).toContain('**This is the scripted backend.**')
  expect(md).toContain('| Metric | Go | No-go | Measured | Verdict |')
  printRows(w.rows)
  expect(errors).toEqual([])
})

// ---------------------------------------------------------------- the qualification (gated)

const LLM = env.BENCH_LLM ?? 'bonsai'

const real = base.extend<{ context: BrowserContext; page: Page }>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext(PROFILE, {
      channel: env.BONSAI_CHANNEL ?? 'chrome',
      headless: false,
      viewport: { width: 1280, height: 800 },
      args: (env.BONSAI_CHROME_ARGS ?? '').split(' ').filter(Boolean),
      // Chrome fetches its built-in model in the background; Playwright's default flags turn that off.
      ...(LLM === 'chrome' ? { ignoreDefaultArgs: ['--disable-background-networking', '--disable-component-update'] } : {}),
    })
    await use(context)
    await context.close()
  },
  page: async ({ context }, use) => {
    await use(context.pages()[0] ?? (await context.newPage()))
  },
})

function benchUrl(): string {
  const suite = env.BENCH_SUITE ?? 'full'
  const q = new URLSearchParams({ llm: LLM, suite })
  const quality = env.BENCH_QUALITY ?? (suite === 'load' ? 'off' : 'medium')
  if (quality !== 'off') q.set('quality', quality)
  const pass: [string, string | undefined][] = [
    ['scale', env.BENCH_SCALE],
    ['fixtures', env.BENCH_FIXTURES],
    ['thinking', env.BENCH_THINKING],
    ['context', env.BENCH_CONTEXT],
    ['depth', env.BENCH_DEPTH],
    ['mtp', env.BENCH_MTP],
    ['repeat', env.BENCH_REPEAT],
    ['reloads', env.BENCH_RELOADS],
    ['start', env.BENCH_START],
    ['loss', env.BENCH_LOSS],
    ['timeout', env.BENCH_CALL_TIMEOUT_S],
    ['idle', env.BENCH_IDLE_S],
  ]
  for (const [k, v] of pass) if (v) q.set(k, v)
  return `/bench.html?${q}`
}

/** Peak resident memory of Chrome's GPU process of this profile, sampled with `ps` (macOS and Linux). */
function sampleGpuProcess(profile: string): { stop(): number | null } {
  let peak: number | null = null
  const tick = () =>
    execFile('ps', ['-A', '-o', 'rss=,command='], { maxBuffer: 64 * 1024 * 1024 }, (err, out) => {
      if (err) return
      for (const line of out.split('\n')) {
        if (!line.includes('--type=gpu-process') || !line.includes(profile)) continue
        const kb = Number(line.trim().split(/\s+/)[0])
        if (Number.isFinite(kb)) peak = Math.max(peak ?? 0, kb * 1024)
      }
    })
  tick()
  const timer = setInterval(tick, 5000)
  return {
    stop: () => {
      clearInterval(timer)
      return peak
    },
  }
}

real('the qualification run', async ({ page, context }) => {
  real.skip(!BONSAI_E2E, 'set BONSAI_E2E=1 to run the qualification against a real backend (docs/runbooks/model-qualification.md)')
  real.skip(real.info().project.name !== 'bonsai', 'runs in the bonsai project of playwright.bonsai.config.ts')
  if (env.BENCH_REPORT_ONLY) {
    const w = writeQualification({ root: ROOT, backend: LLM })
    console.log(`[bench] wrote ${w.qualification}: ${w.verdict.toUpperCase()}`)
    printRows(w.rows)
    return
  }
  real.setTimeout(Number(env.BENCH_TIMEOUT_MIN ?? 720) * 60_000)
  if (LLM === 'bonsai' && !existsSync(ENGINE_PATH)) throw new Error('the Bonsai engine is not installed: run `pnpm --filter @swarm-press/game bonsai:runtime` first')
  if (LLM === 'gemma' && !existsSync(fileURLToPath(new URL('../public/vendor/llama/llama.wasm', import.meta.url)))) {
    throw new Error('the llama.cpp runtime is not built: run `pnpm --filter @swarm-press/game llama:runtime` first')
  }
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') console.log(`[page] ${m.text()}`)
  })
  const url = benchUrl()
  console.log(`[bench] ${url}`)
  await page.goto(url)
  await page.waitForFunction(() => document.body.dataset.bench === 'idle' || document.body.dataset.bench === 'failed')
  const configError = await page.evaluate(() => (window as unknown as { __bench?: Bench }).__bench?.error ?? null)
  if (configError) throw new Error(`bench.html: ${configError}`)
  const gpu = sampleGpuProcess(PROFILE)
  // A real click: Chrome needs a user gesture to download its built-in model.
  await page.click('#start')
  let crashed = false
  const r = await runToEnd(page, {
    log: true,
    pollMs: 2000,
    onStage: async (stage) => {
      if (stage !== 'device-loss:waiting' || crashed) return
      crashed = true
      // The page cannot crash its own GPU process. Unverified that automation may open this page;
      // if nothing happens, open chrome://gpucrash in this window by hand: the page waits three minutes.
      console.log('[bench] opening chrome://gpucrash to lose the GPU device')
      const tab = await context.newPage()
      await tab.goto('chrome://gpucrash').catch((e) => console.log(`[bench] chrome://gpucrash: ${(e as Error).message}`))
      await tab.close().catch(() => undefined)
      await page.bringToFront()
    },
  })
  const extras: QualificationExtras = { gpuProcessPeakRssBytes: gpu.stop() }

  // The adapter's ids against the golden recorded for this GPU, when one exists for this pin.
  const eq = r.equivalence
  if (eq?.deviceKey && r.model) {
    const goldens = JSON.parse(readFileSync(GOLDENS, 'utf8')) as Goldens
    const check = checkGolden(goldens, eq.deviceKey, { engineSha256: r.model.engineSha256, modelRevision: r.model.revision, maxNewTokens: eq.tokens, ids: eq.ids })
    extras.golden = { status: check.status === 'match' ? 'match' : check.status === 'mismatch' ? 'mismatch' : check.status === 'stale' ? 'stale' : 'none', mismatches: check.status === 'mismatch' ? check.mismatches.length : 0 }
  }

  const ctx = reportContext(ROOT)
  const w = writeRun({ root: ROOT, results: r, extras, context: ctx, ...(env.BENCH_LABEL ? { label: env.BENCH_LABEL } : {}) })
  console.log(`[bench] ${r.backendLabel} on ${ctx.machine.cpuModel}: ${w.verdict.toUpperCase()} over every run kept for it`)
  printRows(w.rows)
  console.log(`[bench] wrote:\n  ${[w.raw, w.modelEval, w.frameTime, w.qualification].filter(Boolean).join('\n  ')}`)
  real.info().annotations.push({ type: 'verdict', description: w.verdict })

  // A no-go is a result, not a test failure. A run that did not finish is.
  expect(r.fatal, 'the run stopped early; the partial results are in the files above').toBeUndefined()
  expect(r.complete).toBe(true)
  expect(errors).toEqual([])
})
