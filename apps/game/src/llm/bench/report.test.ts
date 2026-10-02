// The reports: cockpit.benchmark.v1 documents as Cockpit reads them, file
// names that match the cockpit.toml globs, and the go/no-go table with its
// verdict at each threshold of docs/design/mvp-runtime.md section 7.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { FrameSummary, Stats } from './metrics'
import {
  THRESHOLDS,
  frameTimeDoc,
  frameTimeFile,
  higherVerdict,
  lowerVerdict,
  machineSlug,
  modelEvalDoc,
  modelEvalFile,
  overallVerdict,
  qualificationFile,
  qualificationMarkdown,
  qualify,
  runLabel,
  validateBenchmarkDoc,
  type ReportContext,
  type Row,
} from './report'
import { call, calls, load, results, usage } from './testing'

const CTX: ReportContext = {
  provenance: { commit: '90685f2b1c3d4e5f60718293a4b5c6d7e8f90123', branch: 'main', dirty: false, generatedAt: '2026-10-02T12:00:00Z' },
  machine: { slug: 'apple-m3-max-128gb', os: 'macos', arch: 'aarch64', cpus: 16, cpuModel: 'Apple M3 Max', memoryGb: 128, osVersion: '26.4' },
}

const row = (rows: Row[], id: string) => rows.find((r) => r.id === id)!
const verdict = (rows: Row[], id: string) => row(rows, id).verdict

function phase(p50: number, p95: number, n = 100): Stats & { samples: number[] } {
  return { n, p50, p95, min: p50 / 2, max: p95 * 1.5, mean: p50, samples: [p50, p95] }
}

function frames(quality: string, generatingP95: number, idleP95 = 17): FrameSummary {
  return { renderer: 'webgpu', quality, hiddenMs: 0, phases: { idle: phase(16.7, idleP95), generating: phase(20, generatingP95) } }
}

/** The glob of a cockpit.toml evidence entry as a regular expression (only `*` is used there). */
const glob = (g: string) => new RegExp(`^${g.replace(/[.]/g, '\\.').replace(/\*/g, '[^/]*')}$`)

describe('file names', () => {
  it('match the bench/model-eval and bench/frame-time globs of cockpit.toml', () => {
    const toml = readFileSync(new URL('../../../../../cockpit.toml', import.meta.url), 'utf8')
    expect(toml).toContain('"artifacts/bench/model-eval*.json"')
    expect(toml).toContain('"artifacts/bench/frame-time*.json"')
    const modelEval = glob('artifacts/bench/model-eval*.json')
    const frameTime = glob('artifacts/bench/frame-time*.json')
    expect(modelEvalFile('bonsai', 'apple-m3-max-128gb')).toBe('model-eval-bonsai.apple-m3-max-128gb.json')
    expect(modelEvalFile('bonsai', 'apple-m3-max-128gb', 'soak')).toBe('model-eval-bonsai.apple-m3-max-128gb.soak.json')
    expect(frameTimeFile('medium', 'bonsai')).toBe('frame-time-llm-medium.json')
    expect(frameTimeFile('low', 'chrome')).toBe('frame-time-llm-low.chrome.json')
    for (const f of [modelEvalFile('chrome', 'm'), modelEvalFile('fake', 'm', 'load-cold')]) expect(`artifacts/bench/${f}`).toMatch(modelEval)
    for (const f of [frameTimeFile('high', 'bonsai'), frameTimeFile('low', 'fake')]) expect(`artifacts/bench/${f}`).toMatch(frameTime)
    expect(`artifacts/bench/${modelEvalFile('bonsai', 'm')}`).toMatch(modelEval)
    expect(qualificationFile('2026-10-02', 'bonsai', 'apple-m3-max-128gb')).toBe('2026-10-02-bonsai-apple-m3-max-128gb.md')
  })

  it('names the machine by its CPU and memory', () => {
    expect(machineSlug('Apple M3 Max', 128 * 1024 ** 3)).toBe('apple-m3-max-128gb')
    expect(machineSlug('Intel(R) Core(TM) i9-13900K CPU @ 3.00GHz', 64 * 1024 ** 3)).toBe('intel-core-i9-13900k-64gb')
  })

  it('labels each kind of run', () => {
    expect(runLabel(results())).toBe('full')
    expect(runLabel(results({}, { repeat: 20 }))).toBe('soak')
    expect(runLabel(results({ loads: [load('cold', 1000)] }, { suite: 'load' }))).toBe('load-cold')
    expect(runLabel(results({}, { suite: 'load', start: 'warm' }))).toBe('load-warm')
    expect(runLabel(results({}, { suite: 'load', deviceLoss: 'manual' }))).toBe('device-loss')
    expect(runLabel(results({}, { suite: 'frames', quality: 'high' }))).toBe('frames-high')
  })
})

describe('validateBenchmarkDoc', () => {
  it('accepts the example of docs/guides/testing.md and the CI writer shape', () => {
    const guide = readFileSync(new URL('../../../../../docs/guides/testing.md', import.meta.url), 'utf8')
    const example = JSON.parse(/```json\n([\s\S]*?)```/.exec(guide.split('## Add a benchmark document')[1])![1].replace('"<git rev-parse HEAD>"', '"90685f2b1c3d4e5f60718293a4b5c6d7e8f90123"'))
    expect(validateBenchmarkDoc(example)).toEqual([])
    const ci = {
      schema: 'cockpit.benchmark.v1',
      name: 'wasm-size',
      component: 'client-wasm',
      provenance: { commit: '90685f2', generated_at: '2026-10-02T12:00:00Z' },
      metrics: [{ name: 'client_wasm_bg.wasm gzip', unit: 'bytes', value: 1, determinism: 'deterministic', direction: 'lower_is_better', budget: { max: 409600 } }],
    }
    expect(validateBenchmarkDoc(ci)).toEqual([])
  })

  it('rejects what Cockpit would refuse, drop or misread', () => {
    expect(validateBenchmarkDoc(null)).toEqual(['the document is not an object'])
    const good = { schema: 'cockpit.benchmark.v1', name: 'x', metrics: [{ name: 'm', unit: 'ms', value: 1 }] }
    expect(validateBenchmarkDoc(good)).toEqual([])
    expect(validateBenchmarkDoc({ ...good, schema: 'cockpit.benchmark.v2' })).toEqual(['schema must be "cockpit.benchmark.v1"'])
    expect(validateBenchmarkDoc({ ...good, metrics: [] })).toEqual(['metrics must be a non-empty list'])
    expect(validateBenchmarkDoc({ ...good, metrics: [{ name: 'm', unit: 'ms', value: NaN }] })).toEqual(['metrics[0].value must be a finite number'])
    expect(validateBenchmarkDoc({ ...good, metrics: [{ name: 'm', unit: 'ms', value: 1, determinism: 'random' }] })[0]).toMatch(/determinism/)
    expect(validateBenchmarkDoc({ ...good, metrics: [{ name: 'm', unit: 'ms', value: 1, budget: 'low' }] })[0]).toMatch(/budget/)
    expect(validateBenchmarkDoc({ ...good, metrics: [{ name: 'm', unit: 'ms', value: 1, statistics: { p42: 1 } }] })[0]).toMatch(/not a known statistic/)
    expect(validateBenchmarkDoc({ ...good, metrics: [good.metrics[0], good.metrics[0]] })).toEqual(['metrics[1] repeats the series /m'])
    expect(validateBenchmarkDoc({ ...good, feature_ids: ['feat-1'] })[0]).toMatch(/FEAT-nnn/)
    expect(validateBenchmarkDoc({ ...good, provenance: { commit: 'HEAD' } })[0]).toMatch(/git sha/)
  })
})

describe('the Cockpit documents of a Bonsai run', () => {
  const r = results(
    {
      loads: [load('cold', 300_000, 5000), load('warm', 40_000, 3000, 1), load('warm', 50_000, 3000, 2)],
      calls: [
        ...calls('short-action', 50, (i) => ({ wallMs: 5000 + i, gens: [{ wallMs: 5000, finishReason: 'stop', usage: usage({ promptTokens: 1400, prefillMs: 3000, tokensPerSec: 22, completionTokens: 40 }) }] })),
        ...calls('meeting-turn', 20, () => ({ wallMs: 7000, ttftMs: 2500 })),
      ],
      memory: [{ atMs: 1, label: 'after load', gpuLiveBytes: 7e9, gpuPeakBytes: 8e9, uaBytes: 4e8 }],
      frames: frames('medium', 30),
      equivalence: { prompts: 5, tokens: 64, mismatches: [], ids: [], deviceKey: 'apple|metal-3|m3-max|f16|sg|no-sgmat' },
    },
    { quality: 'medium' },
  )

  it('are valid cockpit.benchmark.v1 documents for the evidence entries', () => {
    const evalDoc = modelEvalDoc(r, CTX)
    expect(validateBenchmarkDoc(evalDoc)).toEqual([])
    expect(evalDoc).toMatchObject({
      schema: 'cockpit.benchmark.v1',
      name: 'model-eval-bonsai',
      component: 'inference',
      feature_ids: ['FEAT-037', 'FEAT-038'],
      provenance: { commit: CTX.provenance.commit, branch: 'main', dirty: false, generated_at: '2026-10-02T12:00:00Z', tool: { name: 'swarmpress-bench' } },
      machine: { os: 'macos', arch: 'aarch64', cpus: 16, cpu_model: 'Apple M3 Max', runner: 'local' },
      workload: { backend: 'bonsai', model: 'ternary-bonsai-2-27b', scene: 'medium', suite: 'full' },
    })
    const frameDoc = frameTimeDoc(r, CTX)!
    expect(validateBenchmarkDoc(frameDoc)).toEqual([])
    expect(frameDoc).toMatchObject({ name: 'frame-time-llm-medium', component: 'render', feature_ids: ['FEAT-022', 'FEAT-040'] })
  })

  it('carry the measured values, timing as environment-sensitive, never inconclusive for a real backend', () => {
    const m = modelEvalDoc(r, CTX).metrics
    const get = (name: string, subject: string) => m.find((x) => x.name === name && x.subject === subject)
    expect(get('load.ready_ms', 'warm')).toMatchObject({ value: 48_000, unit: 'ms', determinism: 'environment-sensitive', direction: 'lower_is_better' })
    expect(get('load.ready_ms', 'cold')).toMatchObject({ value: 305_000 })
    expect(get('prefill.tokens_per_sec', 'short-action')).toMatchObject({ value: 466.67, unit: 'tokens/s', direction: 'higher_is_better' })
    expect(get('valid.one_repair_pct', 'short-action')).toMatchObject({ value: 100, unit: '%', determinism: 'semi-deterministic' })
    expect(get('gpu.peak_bytes', 'memory')).toMatchObject({ value: 8e9, unit: 'bytes' })
    expect(get('equivalence.mismatches', 'equivalence')).toMatchObject({ value: 0, budget: { max: 0 } })
    expect(get('tokens_per_sec', 'ternary-bonsai-2-27b')).toBeDefined()
    expect(m.some((x) => x.status === 'inconclusive')).toBe(false)
    // Nothing unmeasured is written: there was no staged article and no device-loss step.
    expect(m.some((x) => x.subject === 'staged-article')).toBe(false)
    expect(m.some((x) => x.name.startsWith('device_loss'))).toBe(false)
    const f = frameTimeDoc(r, CTX)!.metrics
    expect(f.find((x) => x.name === 'frame.p95_ms' && x.subject === 'generating')).toMatchObject({ value: 30, unit: 'ms', determinism: 'environment-sensitive' })
  })

  it('have no frame-time document without the scene', () => {
    expect(frameTimeDoc(results(), CTX)).toBeNull()
  })
})

describe('verdict helpers', () => {
  it('lower is better: at the go threshold is a go, past the no-go threshold is a no-go', () => {
    expect(lowerVerdict(60_000, 60_000, 120_000)).toBe('go')
    expect(lowerVerdict(60_001, 60_000, 120_000)).toBe('conditional')
    expect(lowerVerdict(120_000, 60_000, 120_000)).toBe('conditional')
    expect(lowerVerdict(120_001, 60_000, 120_000)).toBe('no-go')
    expect(lowerVerdict(1e9, 1, null)).toBe('conditional')
  })

  it('higher is better: at the go threshold is a go, under the no-go threshold is a no-go', () => {
    expect(higherVerdict(300, 300, 100)).toBe('go')
    expect(higherVerdict(299.9, 300, 100)).toBe('conditional')
    expect(higherVerdict(100, 300, 100)).toBe('conditional')
    expect(higherVerdict(99.9, 300, 100)).toBe('no-go')
  })

  it('one no-go decides; anything unmeasured leaves it open', () => {
    const r = (verdict: Row['verdict']): Row => ({ id: verdict, metric: '', go: '', noGo: '', measured: '', verdict })
    expect(overallVerdict([r('go'), r('go'), r('n/a')])).toBe('go')
    expect(overallVerdict([r('go'), r('conditional')])).toBe('conditional')
    expect(overallVerdict([r('conditional'), r('not-measured')])).toBe('incomplete')
    expect(overallVerdict([r('go'), r('insufficient')])).toBe('incomplete')
    expect(overallVerdict([r('not-measured'), r('no-go')])).toBe('no-go')
  })
})

describe('the go/no-go table at its thresholds', () => {
  it('lists every row of the design table, in order', () => {
    expect(qualify([results()]).map((r) => r.metric)).toEqual([
      'Warm start to ready',
      'Prefill rate',
      'Decode rate, scene at medium',
      'Short action',
      'Valid after one repair or fewer',
      'Section, about 300 words',
      'Staged article',
      'Meeting turn',
      'Frame p95 while generating',
      'Full-suite runs without device loss',
      'GPU peak at 16K context',
      'Equivalence mismatches',
    ])
  })

  it('warm start: load plus warm-up, p50 over every warm load', () => {
    const at = (ms: number) => verdict(qualify([results({ loads: [load('cold', 999_999), load('warm', ms - 1000, 1000, 1)] })]), 'warm-start')
    expect(at(THRESHOLDS.warmStartMs.go)).toBe('go')
    expect(at(60_001)).toBe('conditional')
    expect(at(120_000)).toBe('conditional')
    expect(at(120_001)).toBe('no-go')
    expect(verdict(qualify([results({ loads: [load('cold', 10)] })]), 'warm-start')).toBe('not-measured')
    // Across runs: a load-only run with three warm reloads counts.
    const multi = qualify([results(), results({ loads: [load('warm', 50_000, 0), load('warm', 70_000, 0), load('warm', 55_000, 0)] }, { suite: 'load' })])
    expect(row(multi, 'warm-start')).toMatchObject({ verdict: 'go', measured: expect.stringContaining('p50 55.0 s (n=3') })
  })

  it('prefill: tokens per second over the uncached prompt', () => {
    const at = (tps: number) => verdict(qualify([results({ calls: [call({ gens: [{ wallMs: 1, finishReason: 'stop', usage: usage({ promptTokens: 3000, prefillMs: (3000 * 1000) / tps }) }] })] })]), 'prefill')
    expect(at(300)).toBe('go')
    expect(at(299)).toBe('conditional')
    expect(at(100)).toBe('conditional')
    expect(at(99)).toBe('no-go')
    expect(row(qualify([results({ calls: [call({ gens: [{ wallMs: 1, finishReason: 'stop', usage: usage({ promptTokens: 3000, prefillMs: 15_000 }) }] })] })]), 'prefill').note).toMatch(/prefix snapshots and contexts of 4K or less/)
    expect(verdict(qualify([results({ calls: [call({ gens: [{ wallMs: 1, finishReason: 'stop', usage: usage({ prefillMs: undefined }) }] })] })]), 'prefill')).toBe('not-measured')
  })

  it('decode: only from a run with the scene at medium', () => {
    const run = (tps: number, quality: string | null) =>
      results({ calls: calls('meeting-turn', 3, () => ({ gens: [{ wallMs: 1, finishReason: 'stop', usage: usage({ completionTokens: 200, tokensPerSec: tps }) }] })), frames: quality ? frames(quality, 20) : null }, { quality: (quality as 'medium') ?? null })
    expect(verdict(qualify([run(20, 'medium')]), 'decode')).toBe('go')
    expect(verdict(qualify([run(19.9, 'medium')]), 'decode')).toBe('conditional')
    expect(verdict(qualify([run(10, 'medium')]), 'decode')).toBe('conditional')
    expect(verdict(qualify([run(9.9, 'medium')]), 'decode')).toBe('no-go')
    const without = row(qualify([run(25, null)]), 'decode')
    expect(without).toMatchObject({ verdict: 'not-measured', note: expect.stringContaining('without it p50 25.0 tok/s') })
    expect(verdict(qualify([run(25, null), run(21, 'medium')]), 'decode')).toBe('go')
  })

  it('short action: p50 under 10 s and p95 under 20 s; p50 over 20 s is a no-go', () => {
    const at = (p50: number, p95: number) => {
      // 50 calls: 45 at p50 and 5 at p95 put both percentiles on those values.
      const list = calls('short-action', 50, (i) => ({ wallMs: i < 45 ? p50 : p95 }))
      return verdict(qualify([results({ calls: list })]), 'short-action')
    }
    expect(at(9999, 9999)).toBe('go')
    expect(at(10_000, 10_000)).toBe('conditional')
    expect(at(5000, 25_000)).toBe('conditional')
    expect(at(20_000, 20_000)).toBe('conditional')
    expect(at(20_001, 20_001)).toBe('no-go')
    // A failed call is in the percentiles with the time it took.
    const failing = calls('short-action', 50, (i) => ({ wallMs: 1000, ...(i < 26 ? { ok: false, wallMs: 30_000, error: { name: 'Timeout', message: 'x' } } : {}) }))
    expect(row(qualify([results({ calls: failing })]), 'short-action')).toMatchObject({ verdict: 'no-go', measured: expect.stringContaining('26 failed') })
  })

  it('validity: 98% after one repair or fewer with 90% first attempt, over at least 50 distinct prompts', () => {
    const at = (n: number, withinOne: number, first: number) => {
      const list = calls('short-action', n, (i) => ({ firstAttemptValid: i < first, validWithinOneRepair: i < withinOne, ok: i < withinOne, extraTurns: i < first ? 0 : 1 }))
      return verdict(qualify([results({ calls: list })]), 'validity')
    }
    expect(at(50, 49, 45)).toBe('go')
    expect(at(50, 48, 45)).toBe('conditional')
    expect(at(50, 49, 44)).toBe('conditional')
    expect(at(50, 45, 45)).toBe('conditional')
    expect(at(50, 44, 44)).toBe('no-go')
    // Fewer than 50 prompts cannot establish the rate, unless it is already a no-go.
    expect(at(20, 20, 20)).toBe('insufficient')
    expect(at(20, 17, 17)).toBe('no-go')
    // Only the first pass counts: a repeated prompt says nothing new under greedy decoding.
    const twice = [...calls('short-action', 50), ...calls('short-action', 50, () => ({ pass: 1, firstAttemptValid: false, validWithinOneRepair: false, ok: false }))]
    expect(verdict(qualify([results({ calls: twice })]), 'validity')).toBe('go')
    // Free-text calls are not part of it.
    expect(verdict(qualify([results({ calls: calls('meeting-turn', 20) })]), 'validity')).toBe('not-measured')
  })

  it('section: p50 60 s or less and 95% valid, the mirrored checks included', () => {
    const at = (ms: number, bad: number) => verdict(qualify([results({ calls: calls('section', 50, (i) => ({ wallMs: ms, checkErrors: i < bad ? ['too_short: x'] : [] })) })]), 'section')
    expect(at(60_000, 2)).toBe('go')
    expect(at(60_001, 0)).toBe('conditional')
    expect(at(30_000, 3)).toBe('conditional')
  })

  it('staged article: p50 over the completed ones; none completed is a no-go', () => {
    const art = (ok: boolean, wallMs: number, index: number) => ({ index, pass: 0, ok, wallMs, calls: 8, words: 1200, checkFailures: 0, ...(ok ? {} : { failedStage: 'outline' as const }) })
    const at = (ms: number) => verdict(qualify([results({ articles: [art(true, ms, 0)] })]), 'article')
    expect(at(8 * 60_000)).toBe('go')
    expect(at(8 * 60_000 + 1)).toBe('conditional')
    expect(at(15 * 60_000)).toBe('conditional')
    expect(at(15 * 60_000 + 1)).toBe('no-go')
    expect(verdict(qualify([results({ articles: [art(false, 1000, 0)] })]), 'article')).toBe('no-go')
    expect(row(qualify([results({ articles: [art(true, 60_000, 0), art(false, 1000, 1)] })]), 'article').note).toMatch(/1 article\(s\) did not complete/)
  })

  it('meeting turn: TTFT 3 s or less and total 8 s or less, on p50', () => {
    const at = (ttft: number | null, total: number) => verdict(qualify([results({ calls: calls('meeting-turn', 20, () => ({ ttftMs: ttft, wallMs: total })) })]), 'meeting')
    expect(at(3000, 8000)).toBe('go')
    expect(at(3001, 8000)).toBe('conditional')
    expect(at(3000, 8001)).toBe('conditional')
    expect(at(null, 1000)).toBe('not-measured')
  })

  it('frames: p95 while generating 33 ms or less; over 50 ms at low is a no-go', () => {
    const at = (p95: number, low?: number) => {
      const runs = [results({ frames: frames('medium', p95) }, { quality: 'medium' })]
      if (low !== undefined) runs.push(results({ frames: frames('low', low), startedAt: '2026-10-02T09:00:00.000Z' }, { suite: 'frames', quality: 'low' }))
      return qualify(runs)
    }
    expect(verdict(at(33), 'frames')).toBe('go')
    expect(verdict(at(33.1), 'frames')).toBe('conditional')
    expect(verdict(at(30, 50), 'frames')).toBe('go')
    expect(verdict(at(30, 50.1), 'frames')).toBe('no-go')
    expect(row(at(30, 20), 'frames').measured).toContain('low 20.0 ms')
    expect(row(at(30), 'frames').note).toMatch(/low tier was not measured/)
    expect(verdict(qualify([results()]), 'frames')).toBe('not-measured')
  })

  it('device loss: 95% of 20 passes; under 80% is a no-go, as soon as the losses make it one', () => {
    const at = (n: number, lost: number) => {
      const passes = Array.from({ length: n }, (_, i) => ({ index: i, startedMs: 0, wallMs: 1, calls: 1, failures: 0, deviceLost: i < lost }))
      return verdict(qualify([results({ passes }, { repeat: n })]), 'device-loss')
    }
    expect(at(20, 1)).toBe('go')
    expect(at(20, 2)).toBe('conditional')
    expect(at(20, 4)).toBe('conditional')
    expect(at(20, 5)).toBe('no-go')
    expect(at(10, 0)).toBe('insufficient')
    expect(at(10, 4)).toBe('insufficient')
    expect(at(10, 5)).toBe('no-go')
    expect(at(1, 0)).toBe('insufficient')
  })

  it('GPU memory: the runtime peak, 12 GB or less', () => {
    const at = (peak: number | null) => verdict(qualify([results({ memory: [{ atMs: 0, label: 'after load', gpuLiveBytes: peak, gpuPeakBytes: peak, uaBytes: null }] })]), 'gpu-memory')
    expect(at(12e9)).toBe('go')
    expect(at(12e9 + 1)).toBe('conditional')
    expect(at(null)).toBe('not-measured')
    expect(row(qualify([results()], { gpuProcessPeakRssBytes: 9e9 }), 'gpu-memory').note).toMatch(/GPU process RSS peak 9.00 GB/)
  })

  it('equivalence: zero mismatches; only the Bonsai backend has one to check', () => {
    const eq = (mismatches: number) => ({ prompts: 5, tokens: 64, mismatches: Array.from({ length: mismatches }, (_, i) => ({ prompt: i, index: 3, expected: 1, actual: 2 })), ids: [], deviceKey: 'k' })
    expect(verdict(qualify([results({ equivalence: eq(0) })]), 'equivalence')).toBe('go')
    expect(verdict(qualify([results({ equivalence: eq(1) })]), 'equivalence')).toBe('no-go')
    expect(verdict(qualify([results({ equivalence: eq(0) })], { golden: { status: 'mismatch', mismatches: 2 } }), 'equivalence')).toBe('no-go')
    expect(verdict(qualify([results()]), 'equivalence')).toBe('not-measured')
    expect(verdict(qualify([results({}, { backend: 'chrome' })]), 'equivalence')).toBe('n/a')
  })
})

describe('the Markdown report', () => {
  const r = results({
    loads: [load('cold', 300_000, 5000), load('warm', 40_000, 3000, 1)],
    calls: calls('short-action', 50, (i) => ({ wallMs: 4000, ...(i === 7 ? { ok: false, validWithinOneRepair: false, firstAttemptValid: false, error: { name: 'StructuredOutputError', message: 'failed after 3 attempts' } } : {}) })),
    frames: frames('medium', 28),
  }, { quality: 'medium' })
  const md = qualificationMarkdown({ runs: [r], context: CTX, sources: ['artifacts/bench/raw/bench-bonsai.apple-m3-max-128gb.full.json'] })

  it('starts with the verdict and the filled table', () => {
    expect(md.split('\n')[0]).toBe('# Model qualification: bonsai on Apple M3 Max, 128 GB')
    expect(md).toContain('**Verdict:** INCOMPLETE')
    expect(md).toContain('| Metric | Go | No-go | Measured | Verdict |')
    expect(md).toContain('| Warm start to ready | 60 s p50 or less | over 120 s | p50 43.0 s (n=1, max 43.0 s) | **go** |')
    expect(md).toContain('| Staged article | p50 8 min or less | over 15 min | not measured | not measured |')
    expect(md).toContain('| Valid after one repair or fewer | 98% or more, with 90% or more first attempt | under 90% | 98.0% after one repair or fewer, 98.0% first attempt (49 and 49 of 50 distinct prompts) | **go** |')
    expect(md).not.toContain('This is the scripted backend')
  })

  it('keeps failures, sources and the environment', () => {
    expect(md).toContain('- **short-action:** 1 of 50')
    expect(md).toContain('1 × StructuredOutputError: failed after N attempts (short-action/7)')
    expect(md).toContain('`artifacts/bench/raw/bench-bonsai.apple-m3-max-128gb.full.json`')
    expect(md).toContain('| Commit | 90685f2b1c3d4e5f60718293a4b5c6d7e8f90123 on main |')
    expect(md).toContain('| cold | 1 |')
    expect(md).toContain('| full | medium | webgpu | generating |')
  })

  it('says so when the backend is the scripted one, and when a run stopped early', () => {
    const fake = qualificationMarkdown({ runs: [results({ complete: false, fatal: 'boom' }, { backend: 'fake' })], context: CTX })
    expect(fake).toContain('**This is the scripted backend.** No model ran.')
    expect(fake).toContain('**Incomplete runs:** full (boom)')
    expect(fake).toContain('only the Bonsai backend has an upstream')
  })
})
