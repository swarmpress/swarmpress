// The whole qualification run against the scripted backend, in Node: every
// call is recorded, the faults the backend is scripted with show up as
// exactly those repairs, cut-offs, check failures and failures, and the
// reports come out valid.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import init, { validateJson } from 'orchestrator-wasm'
import { rustValidator } from '../../orchestrator/bridge'
import { openBackend } from '../backend'
import type { ChatMessage, GenerateOptions, GenerateResult, LocalLlm, Validator } from '../types'
import { BENCH_FAKE_MODEL, BenchFakeLlm, FAKE_FAULTS } from './fake'
import { buildSuite, type Suite } from './fixtures'
import { FrameRecorder } from './frames'
import { summarize, summarizeArticles, summarizeByFixture, type BenchConfig, type BenchResults } from './metrics'
import { writeRun } from './node-writer'
import { modelEvalDoc, qualify, validateBenchmarkDoc, type ReportContext } from './report'
import { LoadTracker, startBench, withTimeout, BackendHungError, type BenchDeps } from './runner'

let validate: Validator

beforeAll(async () => {
  const url = new URL('../../../../../crates/orchestrator-wasm/pkg/orchestrator_wasm_bg.wasm', import.meta.url)
  await init({ module_or_path: await readFile(url) })
  validate = rustValidator(validateJson)
})

const ENV: BenchResults['env'] = { userAgent: 'vitest', browser: null, crossOriginIsolated: false, hardwareConcurrency: 1, deviceMemoryGb: null, gpu: null }

export function config(over: Partial<BenchConfig> = {}): BenchConfig {
  return {
    backend: 'fake',
    quality: null,
    suite: 'full',
    scale: 1,
    fixtures: [],
    thinking: null,
    context: null,
    pipelineDepth: null,
    repeat: 1,
    reloads: 0,
    start: 'unknown',
    deviceLoss: 'none',
    callTimeoutMs: 10_000,
    idleMs: 0,
    ...over,
  }
}

function fakeRun(suite: Suite, over: Partial<BenchConfig> = {}, deps: Partial<BenchDeps> = {}) {
  let fake: BenchFakeLlm | null = null
  // The run is created first so the backend's events can reach it.
  let event: (kind: string, message: string) => void = () => undefined
  const run = startBench({
    config: config(over),
    suite,
    modelId: BENCH_FAKE_MODEL,
    open: () =>
      openBackend('fake', {
        fake: () => {
          fake = new BenchFakeLlm(suite, { onEvent: (e) => event(e.kind, e.message) })
          return fake
        },
      }),
    validate,
    env: ENV,
    inferStart: async () => 'cold',
    loseDevice: () => fake?.loseDevice(),
    ...deps,
  })
  event = run.event
  return run
}

describe('a full run on the scripted backend', () => {
  const suite = buildSuite()
  let r: BenchResults

  beforeAll(async () => {
    r = await fakeRun(suite, { reloads: 2, deviceLoss: 'hook' }).done
  })

  it('completes and records every call', () => {
    expect(r.fatal).toBeUndefined()
    expect(r.complete).toBe(true)
    const by = summarizeByFixture(r.calls)
    expect(Object.fromEntries([...by].map(([id, s]) => [id, s.calls]))).toEqual({
      'short-action': 50,
      'short-answer': 30,
      'context-inspection': 50,
      section: 50,
      // Seven articles of eight calls, but article 4 stops at its outline.
      'staged-article': 6 * 8 + 1,
      'meeting-turn': 20,
      'moderator-pick': 50,
    })
    expect(r.calls).toHaveLength(299)
    expect(r.fixtures.map((f) => [f.id, f.count, f.fullCount])).toEqual([
      ['short-action', 50, 50],
      ['short-answer', 30, 30],
      ['context-inspection', 50, 50],
      ['section', 50, 50],
      ['staged-article', 7, 7],
      ['meeting-turn', 20, 20],
      ['moderator-pick', 50, 50],
    ])
  })

  it('counts the scripted faults exactly: repairs, cut-offs, failed checks and failures', () => {
    const s = (id: string) => summarizeByFixture(r.calls).get(id as never)!
    // short-action: two repair-once, one repair-twice, one never-valid (3 turns), one cut off then valid, one fenced, one wrong.
    expect(s('short-action')).toMatchObject({ failed: 1, firstAttemptValid: 45, validWithinOneRepair: 48, validEventually: 49, extraTurns: 1 + 1 + 2 + 2 + 1, truncations: 1, checkFailed: 1 })
    expect(s('short-answer')).toMatchObject({ failed: 0, truncations: 1, checkFailed: 2 })
    expect(s('context-inspection')).toMatchObject({ failed: 0, firstAttemptValid: 47, validWithinOneRepair: 49, extraTurns: 1 + 2 + 1, truncations: 1, checkFailed: 2 })
    expect(s('section')).toMatchObject({ failed: 1, firstAttemptValid: 47, validWithinOneRepair: 49, extraTurns: 1 + 1 + 2, checkFailed: 1 })
    expect(s('staged-article')).toMatchObject({ failed: 1, extraTurns: 1 + 2, checkFailed: 1 })
    expect(s('meeting-turn')).toMatchObject({ failed: 1, truncations: 1 })
    expect(s('moderator-pick')).toMatchObject({ failed: 0, firstAttemptValid: 48, validWithinOneRepair: 49, extraTurns: 2 + 1, checkFailed: 1 })
    // Every scripted fault is in the fixtures (none points at a prompt that does not exist).
    for (const [id, faults] of Object.entries(FAKE_FAULTS)) {
      for (const k of Object.keys(faults)) {
        const key = `${id}/${k}`
        const seen = r.calls.some((c) => c.key === key) || (id === 'staged-article' && r.calls.some((c) => c.key === `staged-article/${k}`))
        expect(seen, key).toBe(true)
      }
    }
  })

  it('keeps the failures, with their reasons, instead of dropping them', () => {
    const all = summarize(r.calls)
    expect(all.failed).toBe(4)
    expect(all.wallMs!.n).toBe(299)
    const messages = all.failures.map((f) => f.message)
    expect(messages.some((m) => m.startsWith('StructuredOutputError: structured output failed after N attempts'))).toBe(true)
    expect(messages).toContain('Error: the scripted backend failed this call on purpose')
    // Grouped by message (digits folded); the validator's errors differ per schema, so these are separate groups.
    const never = all.failures.filter((f) => f.message.startsWith('StructuredOutputError')).flatMap((f) => f.keys)
    expect(never.sort()).toEqual(['section/41', 'short-action/41', 'staged-article/4/outline'].sort())
    expect(all.failures.reduce((a, f) => a + f.count, 0)).toBe(all.failed)
  })

  it('runs the staged articles stage by stage and stops one at its failed stage', () => {
    const a = summarizeArticles(r.articles)
    expect(a).toMatchObject({ articles: 7, completed: 6, failed: 1, failedStages: { outline: 1 } })
    expect(r.articles.find((x) => x.index === 5)!.checkFailures).toBe(1)
    const stages = r.calls.filter((c) => c.fixture === 'staged-article' && c.index === 0).map((c) => c.stage)
    expect(stages).toEqual(['outline', 'section-1', 'section-2', 'section-3', 'section-4', 'section-5', 'closing', 'review'])
    expect(a.words!.p50).toBeGreaterThan(900)
  })

  it('records a cold load and the warm reloads, with stages', () => {
    expect(r.start).toEqual({ declared: 'unknown', inferred: 'cold' })
    expect(r.loads.map((l) => [l.kind, l.ok])).toEqual([
      ['cold', true],
      ['warm', true],
      ['warm', true],
    ])
    expect(r.loads[0].stages.map((s) => s.stage)).toEqual(['verify', 'weights', 'warm-up'])
    expect(r.loads[0].stages[1]).toMatchObject({ bytesLoaded: 64 * 1024 * 1024, bytesTotal: 64 * 1024 * 1024 })
    expect(r.loads.every((l) => l.warmupMs !== null)).toBe(true)
  })

  it('loses the device through the test hook and recovers', () => {
    expect(r.deviceLoss).toMatchObject({ mode: 'hook', observed: true, inFlightFailed: true })
    expect(r.deviceLoss!.recoveryMs).not.toBeNull()
    expect(r.deviceLoss!.error).toBeUndefined()
    expect(r.events.filter((e) => e.kind === 'device-lost')).toHaveLength(1)
    // The loss was after the suite: no pass lost its device.
    expect(r.passes).toEqual([expect.objectContaining({ index: 0, calls: 299, failures: 4, deviceLost: false })])
  })

  it('samples the GPU bytes the backend reports', () => {
    expect(r.memory.map((m) => m.label)).toContain('after load')
    expect(r.memory.find((m) => m.label === 'after load')).toMatchObject({ gpuLiveBytes: 64 * 1024 * 1024, gpuPeakBytes: 128 * 1024 * 1024, uaBytes: null })
    expect(r.capabilities.probe?.backend).toBe('fake')
    expect(r.capabilities.loaded?.contextTokens).toBe(16384)
  })

  it('is the same run every time', async () => {
    const again = await fakeRun(suite, { reloads: 2, deviceLoss: 'hook' }).done
    const shape = (x: BenchResults) => x.calls.map((c) => [c.key, c.ok, c.extraTurns, c.truncations, c.checkErrors.length, c.firstAttemptValid])
    expect(shape(again)).toEqual(shape(r))
  })

  it('writes Cockpit documents and a qualification report that holds the verdicts', () => {
    const root = mkdtempSync(join(tmpdir(), 'bench-'))
    try {
      const context: ReportContext = {
        provenance: { commit: 'a'.repeat(40), branch: 'main', dirty: false, generatedAt: '2026-10-02T12:00:00Z' },
        machine: { slug: 'apple-m3-max-128gb', os: 'macos', arch: 'aarch64', cpus: 16, cpuModel: 'Apple M3 Max', memoryGb: 128 },
      }
      const w = writeRun({ root, results: r, context })
      expect(w.label).toBe('full')
      expect(w.modelEval).toBe(join(root, 'artifacts/bench/model-eval-fake.apple-m3-max-128gb.json'))
      expect(w.frameTime).toBeNull()
      expect(w.qualification).toBe(join(root, 'artifacts/bench/qualification/2026-10-02-fake-apple-m3-max-128gb.md'))
      const doc = JSON.parse(readFileSync(w.modelEval, 'utf8'))
      expect(validateBenchmarkDoc(doc)).toEqual([])
      expect(doc).toMatchObject({ schema: 'cockpit.benchmark.v1', name: 'model-eval-fake', component: 'inference', feature_ids: ['FEAT-037'] })
      // Counts are deterministic for the scripted backend; its timings are inconclusive.
      const metric = (name: string, subject: string) => doc.metrics.find((m: { name: string; subject: string }) => m.name === name && m.subject === subject)
      expect(metric('calls', 'all')).toMatchObject({ value: 299, determinism: 'deterministic' })
      expect(metric('failures', 'all')).toMatchObject({ value: 4, determinism: 'deterministic', direction: 'lower_is_better' })
      expect(metric('wall.p50_ms', 'all')).toMatchObject({ status: 'inconclusive', determinism: 'environment-sensitive' })
      const md = readFileSync(w.qualification, 'utf8')
      expect(md).toContain('**This is the scripted backend.**')
      expect(md).toContain('| Metric | Go | No-go | Measured | Verdict |')
      expect(w.rows.map((x) => x.id)).toEqual(qualify([r]).map((x) => x.id))
      const raw = JSON.parse(readFileSync(w.raw, 'utf8'))
      expect(raw.results.calls).toHaveLength(299)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('run options', () => {
  it('runs passes, records them, and counts the calls of each', async () => {
    const suite = buildSuite({ scale: 0.1 })
    const r = await fakeRun(suite, { repeat: 3 }).done
    expect(r.passes.map((p) => p.calls)).toEqual([25 + 8, 25 + 8, 25 + 8])
    expect(new Set(r.calls.map((c) => c.pass))).toEqual(new Set([0, 1, 2]))
    expect(modelEvalDoc(r, CTX).name).toBe('model-eval-fake-soak')
  })

  it('loads only, for the cold and warm start measurements', async () => {
    const r = await fakeRun(buildSuite(), { suite: 'load', reloads: 3, start: 'warm' }).done
    expect(r.calls).toEqual([])
    expect(r.loads.map((l) => l.kind)).toEqual(['warm', 'warm', 'warm', 'warm'])
    expect(r.start).toEqual({ declared: 'warm', inferred: 'cold' })
  })

  it('sorts frames by what the model is doing', async () => {
    const frames = new FrameRecorder()
    let t = 0
    const timer = setInterval(() => frames.frame((t += 16)), 1)
    try {
      const r = await fakeRun(buildSuite({ only: ['meeting-turn'], scale: 0.5 }), { quality: 'low', idleMs: 20 }, { frames, frameInfo: () => ({ renderer: 'test', quality: 'low' }) }).done
      expect(r.frames?.quality).toBe('low')
      expect(Object.keys(r.frames!.phases)).toEqual(expect.arrayContaining(['idle-unloaded', 'idle']))
    } finally {
      clearInterval(timer)
    }
  })

  it('stops with a fatal error when the backend never opens, keeping what it has', async () => {
    const r = await startBench({
      config: config(),
      suite: buildSuite({ scale: 0.1 }),
      modelId: 'x',
      open: () => openBackend('bonsai', {}),
      validate,
      env: ENV,
    }).done
    expect(r.complete).toBe(false)
    expect(r.fatal).toMatch(/cannot be used here: this build has no adapter for it/)
    expect(r.loads).toEqual([])
  })

  it('times a call out, records it, and stops the run when the backend does not even answer the cancel', async () => {
    const hung: LocalLlm = {
      modelId: 'x',
      async load() {},
      generate(messages: ChatMessage[], opts?: GenerateOptions): Promise<GenerateResult> {
        // Answers the warm-up; hangs on every fixture prompt, cancel or not.
        if (messages.some((m) => m.content.includes('Reference: bench/'))) return new Promise(() => undefined)
        void opts
        return Promise.resolve({ text: 'OK', finishReason: 'stop', usage: { promptTokens: 1, completionTokens: 1, durationMs: 1, tokensPerSec: 1 } })
      },
      stream: () => ({ [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true, value: undefined }) }) }),
      async structured() {
        return new Promise(() => undefined)
      },
      async dispose() {},
    }
    const r = await startBench({
      config: config({ callTimeoutMs: 20 }),
      suite: buildSuite({ only: ['meeting-turn'], scale: 0.1 }),
      modelId: 'x',
      open: async () => ({ info: { id: 'fake', label: 'hung', runsIn: 'memory', modelId: null, description: '' }, llm: hung, capabilities: { backend: 'hung', label: 'hung', webgpu: false, supportsConstrainedOutput: false, supportsPrefixReuse: false, supportsVision: false, reasoningModes: ['off'], contextTokens: null } }),
      validate,
      env: ENV,
      cancelGraceMs: 20,
    }).done
    expect(r.complete).toBe(false)
    expect(r.fatal).toMatch(/did not finish within 0 s, not even after a cancel/)
    expect(r.calls).toHaveLength(1)
    expect(r.calls[0]).toMatchObject({ ok: false, error: { name: 'BackendHungError' } })
  })
})

const CTX: ReportContext = {
  provenance: { commit: null, branch: null, dirty: null, generatedAt: '2026-10-02T12:00:00Z' },
  machine: { slug: 'm', os: 'macos', arch: 'aarch64', cpus: 1, cpuModel: 'M', memoryGb: 1 },
}

describe('LoadTracker', () => {
  it('splits a load at its first progress event and at the first init event', () => {
    const t = new LoadTracker(0)
    t.progress({ modelId: 'm', phase: 'download', files: {}, loaded: 10, total: 100, fraction: 0.1, message: 'Streaming weights' }, 1000)
    t.progress({ modelId: 'm', phase: 'download', files: {}, loaded: 100, total: 100, fraction: 1, message: 'Streaming weights' }, 31000)
    t.progress({ modelId: 'm', phase: 'init', files: {}, loaded: 100, total: 100, fraction: 1, message: 'Compiling kernels' }, 32000)
    t.progress({ modelId: 'm', phase: 'init', files: {}, loaded: 100, total: 100, fraction: 1, message: 'Tuning decode' }, 40000)
    expect(t.stages(45000)).toEqual([
      { stage: 'verify', ms: 1000, messages: [] },
      { stage: 'weights', ms: 31000, bytesLoaded: 100, bytesTotal: 100, messages: ['Streaming weights'] },
      { stage: 'init', ms: 13000, messages: ['Compiling kernels', 'Tuning decode'] },
    ])
  })

  it('is one init stage when the backend reports nothing', () => {
    expect(new LoadTracker(5).stages(25)).toEqual([{ stage: 'init', ms: 20, messages: [] }])
  })
})

describe('withTimeout', () => {
  it('passes a result through and turns a hang into BackendHungError', async () => {
    await expect(withTimeout(Promise.resolve(3), 50, 'x')).resolves.toBe(3)
    await expect(withTimeout(new Promise(() => undefined), 10, 'the thing')).rejects.toBeInstanceOf(BackendHungError)
  })
})

afterAll(() => undefined)
