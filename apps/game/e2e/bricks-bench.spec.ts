/**
 * The brick office spike's measurements (FEAT-081; docs/design/brick-office.md
 * section 8, docs/qualification/brick-office-spike.md): bench.html on the
 * scripted backend with the office scene at each quality tier, once with the
 * box office and once with `office=bricks`. Records frame p50/p95 idle and
 * while the scripted generation load runs, draw calls, brick and stud
 * counts, and the chunk build per room (kit compile + mesh build), and writes
 * one `cockpit.benchmark.v1` document per tier plus a Markdown table into
 * artifacts/bench/ (git-ignored).
 *
 * Project `bricks` of playwright.bonsai.config.ts (the harness build):
 *
 *   # headless here (WebGL2 on SwiftShader: timings inconclusive, counts and build times real)
 *   CI=1 pnpm --filter @swarm-press/game exec playwright test -c playwright.bonsai.config.ts --project=bricks
 *
 *   # the go/no-go run on the M3 Max: installed Chrome, headed, WebGPU
 *   BRICKS_TARGET=1 BRICKS_CHANNEL=chrome BRICKS_RENDERER=webgpu \
 *     pnpm --filter @swarm-press/game exec playwright test -c playwright.bonsai.config.ts --project=bricks
 *
 * Settings: BRICKS_TIERS (default low,medium,high), BRICKS_RENDERER=webgl|webgpu
 * (default webgl), BRICKS_CHANNEL (an installed browser; headed), BRICKS_IDLE_S
 * (idle window, default 8), BRICKS_FAKEMS (scripted delay per answer, default 40),
 * BRICKS_TARGET=1 (this is the target machine and browser: frame timings count).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, expect, test, type Page } from '@playwright/test'
import { bricksFrameDoc, bricksFrameFile, spikeRows, type BricksRun, type Conclusive } from '../src/llm/bench/bricks-report'
import type { BenchResults } from '../src/llm/bench/metrics'
import { reportContext } from '../src/llm/bench/node-writer'
import { validateBenchmarkDoc } from '../src/llm/bench/report'
import type { SceneCounts } from '../src/llm/bench/scene'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const env = process.env
const TIERS = (env.BRICKS_TIERS ?? 'low,medium,high').split(',').map((t) => t.trim()).filter(Boolean)
const RENDERER = env.BRICKS_RENDERER === 'webgpu' ? 'webgpu' : 'webgl'
const IDLE_S = Number(env.BRICKS_IDLE_S ?? 8)
const FAKE_MS = Number(env.BRICKS_FAKEMS ?? 40)

type Bench = { done(): Promise<BenchResults>; scene(): SceneCounts | null; error: string | null }

async function run(page: Page, tier: string, office: 'boxes' | 'bricks'): Promise<BricksRun> {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const q = `llm=fake&suite=frames&quality=${tier}&office=${office}&idle=${IDLE_S}&fakems=${FAKE_MS}&memory=0&autostart=1${RENDERER === 'webgl' ? '&renderer=webgl' : ''}`
  await page.goto(`/bench.html?${q}`)
  const r = (await page.evaluate(() => (window as unknown as { __bench: Bench }).__bench.done())) as BenchResults
  const counts = (await page.evaluate(() => (window as unknown as { __bench: Bench }).__bench.scene())) as SceneCounts
  expect(r.fatal).toBeUndefined()
  expect(r.frames, `${tier}/${office}: the scene drew`).toBeTruthy()
  expect(errors).toEqual([])
  return { office, quality: tier, renderer: r.frames!.renderer, browser: r.env.browser, frames: r.frames!, counts }
}

test('brick office spike: frame times, draw calls, counts and chunk builds per tier', async ({ page: headless }, info) => {
  test.skip(info.project.name !== 'bricks', 'runs in the bricks project of playwright.bonsai.config.ts')
  test.setTimeout(60 * 60_000)
  // The target run: installed, headed Chrome (WebGPU on the real GPU).
  const browser = env.BRICKS_CHANNEL ? await chromium.launch({ channel: env.BRICKS_CHANNEL, headless: false }) : null
  const page = browser ? await (await browser.newContext({ viewport: { width: 1280, height: 800 }, baseURL: info.project.use.baseURL })).newPage() : headless

  const ctx = reportContext(ROOT)
  const runs: BricksRun[] = []
  for (const tier of TIERS) for (const office of ['boxes', 'bricks'] as const) runs.push(await run(page, tier, office))
  await browser?.close()

  const renderer = runs[0].renderer
  const measuredOn: Conclusive = {
    frames: env.BRICKS_TARGET === '1' && renderer === 'webgpu',
    cpu: /M3 Max/i.test(ctx.machine.cpuModel),
    reason: renderer === 'webgpu' ? 'not declared the target run (BRICKS_TARGET=1)' : `${renderer} in headless Chromium (software rendering), not WebGPU on the target GPU`,
  }
  const dir = join(ROOT, 'artifacts', 'bench')
  mkdirSync(dir, { recursive: true })
  for (const tier of TIERS) {
    const doc = bricksFrameDoc(runs.filter((r) => r.quality === tier), ctx, measuredOn)
    expect(validateBenchmarkDoc(doc)).toEqual([])
    writeFileSync(join(dir, bricksFrameFile(tier, renderer)), `${JSON.stringify(doc, null, 2)}\n`)
  }

  // The table of the report (docs/qualification/brick-office-spike.md).
  const f = (x: number | undefined) => (x === undefined ? '–' : x.toFixed(1))
  const lines = [
    `Machine: ${ctx.machine.cpuModel}, ${ctx.machine.os}; browser ${runs[0].browser}; renderer ${renderer}; commit ${ctx.provenance.commit?.slice(0, 7)}`,
    '',
    '| Tier | Office | Bricks | Studs | Brick meshes | Draw calls | Idle p50 | Idle p95 | Generating p95 | Frames (idle/gen) |',
    '|---|---|---|---|---|---|---|---|---|---|',
    ...runs.map((r) => {
      const idle = r.frames.phases.idle ?? r.frames.phases['idle-unloaded']
      const gen = r.frames.phases.generating
      const b = r.counts.bricks
      return `| ${r.quality} | ${r.office} | ${b?.instances ?? '–'} | ${b?.studs ?? '–'} | ${b?.meshes ?? '–'} | ${r.counts.drawCalls} | ${f(idle?.p50)} | ${f(idle?.p95)} | ${f(gen?.p95)} | ${idle?.n ?? 0}/${gen?.n ?? 0} |`
    }),
    '',
    '| Room | Bricks | Studs | Meshes | Kit compile | Mesh build | Chunk build |',
    '|---|---|---|---|---|---|---|',
    ...runs
      .filter((r) => r.office === 'bricks')
      .flatMap((r) => (r.counts.bricks?.rooms ?? []).map((m) => `| ${r.quality}: ${m.kind} | ${m.instances} | ${m.studs} | ${m.meshes + m.studMeshes} | ${f(m.compileMs)} ms | ${f(m.meshMs)} ms | ${f(m.compileMs + m.meshMs)} ms |`)),
    '',
    ...runs.filter((r) => r.office === 'bricks').map((r) => `Kit load (${r.quality}): ${f(r.counts.bricks?.kitLoadMs ?? undefined)} ms; shell designs for the whole layout ${f(r.counts.bricks?.shellsMs)} ms; scene build boxes+bricks ${f(r.counts.buildMs)} ms`),
    '',
    '| Criterion (section 8.5) | Target | Measured | Verdict |',
    '|---|---|---|---|',
    ...spikeRows(runs, measuredOn).map((r) => `| ${r.criterion} | ${r.target} | ${r.measured} | ${r.verdict} |`),
  ]
  const md = join(dir, `bricks-spike.${renderer}.md`)
  writeFileSync(md, `${lines.join('\n')}\n`)
  writeFileSync(join(dir, `bricks-spike.${renderer}.json`), `${JSON.stringify(runs.map((r) => ({ ...r, frames: { ...r.frames, phases: Object.fromEntries(Object.entries(r.frames.phases).map(([k, v]) => [k, { ...v, samples: undefined }])) } })), null, 2)}\n`)
  console.log(lines.join('\n'))
  await info.attach('bricks-spike.md', { body: lines.join('\n'), contentType: 'text/markdown' })
})
