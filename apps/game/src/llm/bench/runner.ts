/**
 * The qualification run (ADR-0057, FEAT-037): open one backend, load its
 * model, run the fixtures against the `LocalLlm` it gave, and record every
 * call. No DOM in here: harness.ts supplies the page (scene, progress view,
 * memory API), the unit tests supply the scripted backend.
 *
 * Structured calls go through the adapter's own `structured()` with the
 * options the orchestrator bridge passes (`localLlmBridge` in
 * ../../orchestrator/bridge.ts) and the injected Rust validator, so what is
 * measured is the path the game takes: prompt, extract, validate, repair.
 *
 * Order of a run: probe, idle frames, load, warm-up turn, idle frames, the
 * passes over the suite, upstream equivalence, reloads (warm starts), device
 * loss. A run that stops early still returns what it measured, marked
 * incomplete.
 */
import type { OpenedBackend } from '../backend'
import type { ChatMessage, GenerateOptions, LoadProgress, LocalLlm, RuntimeCapabilities, Validator } from '../types'
import { sectionWords, type Closing, type Outline, type SectionDraft } from './article'
import { wordCount } from './corpus'
import { ARTICLE_CALLS, FIXTURES, estimateCaseTokens, type ArticlePlan, type BenchCase, type FixtureId, type Suite } from './fixtures'
import type { FrameRecorder } from './frames'
import {
  RESULTS_SCHEMA,
  type ArticleRecord,
  type AttemptRecord,
  type BenchConfig,
  type BenchResults,
  type CallRecord,
  type DeviceLossRecord,
  type EquivalenceRecord,
  type GenRecord,
  type LoadRecord,
  type LoadStage,
  type MemorySample,
  type ModelPins,
  type PassRecord,
} from './metrics'

export const WARMUP: ChatMessage[] = [
  { role: 'system', content: 'You are a helpful assistant.' },
  { role: 'user', content: 'Reply with the single word OK.' },
]

const KEEPALIVE: ChatMessage[] = [
  { role: 'system', content: 'You are a helpful assistant.' },
  { role: 'user', content: 'Count slowly from one to forty, one number per line.' },
]

export type StageStatus = 'pending' | 'active' | 'done' | 'failed' | 'skipped'

export interface StageView {
  id: string
  label: string
  status: StageStatus
  /** Elapsed while active, final once done. */
  ms: number | null
  /** Bytes are shown only where bytes are what is being counted (the weights). */
  bytesLoaded?: number
  bytesTotal?: number
  /** What the runtime says it is doing; never a made-up percentage. */
  message?: string
}

export interface BenchState {
  status: 'idle' | 'running' | 'done' | 'failed'
  /** The stage in progress, e.g. `load:weights`, `fixture:section`, `device-loss:waiting`. */
  stage: string
  stages: StageView[]
  fixtures: { id: FixtureId; label: string; done: number; total: number; failed: number }[]
  pass: number
  passes: number
  fatal?: string
}

export interface BenchDeps {
  config: BenchConfig
  suite: Suite
  /** Construct the chosen backend's adapter and probe it; no model is loaded. Called again for every reload. */
  open(): Promise<OpenedBackend>
  modelId: string
  model?: ModelPins | null
  /** The validator structured calls repair against: the Rust one in the page. */
  validate: Validator
  env: BenchResults['env']
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  frames?: FrameRecorder | null
  /** Wait `idleMs` with no model loaded before the first load. False when the page already did (default true). */
  idleBeforeLoad?: boolean
  frameInfo?: () => { renderer: string; quality: string }
  /** Were the weights in the browser cache before the first load? */
  inferStart?: () => Promise<'cold' | 'warm' | 'unknown'>
  /** `performance.measureUserAgentSpecificMemory()`, already guarded and bounded by the page. */
  measureMemory?: () => Promise<{ bytes: number; windowBytes: number | null; workerBytes: number | null } | null>
  /** The backend's device-loss test hook, when it has one. */
  loseDevice?: () => void
  /** Upstream equivalence on the fixed prompts (the Bonsai backend). */
  equivalence?: (llm: LocalLlm) => Promise<EquivalenceRecord | null>
  /** How long the manual device-loss step waits for the loss, ms. Default 180000. */
  deviceLossWaitMs?: number
  /** Time a cancelled call gets before the backend counts as hung. Default `CANCEL_GRACE_MS`. */
  cancelGraceMs?: number
  onState?: (s: BenchState) => void
}

export interface BenchRun {
  /** The results so far; the same object the promise resolves with. */
  results: BenchResults
  state(): BenchState
  /** A backend event (the device was lost); the page's backend factory calls this. */
  event(kind: string, message: string): void
  done: Promise<BenchResults>
}

const errorOf = (e: unknown): { name: string; message: string } => ({ name: (e as Error)?.name ?? 'Error', message: (e as Error)?.message ?? String(e) })

/** The backend did not answer, not even to a cancel: the run cannot go on (one model, one turn at a time). */
export class BackendHungError extends Error {
  constructor(what: string, ms: number) {
    super(`${what} did not finish within ${Math.round(ms / 1000)} s, not even after a cancel; the run stops here`)
    this.name = 'BackendHungError'
  }
}

/** Time a cancelled call gets to wind down before the backend counts as hung. */
export const CANCEL_GRACE_MS = 30_000
/** A reload after a device loss reads the weights back from the browser cache; a cold one is not expected here. */
export const RELOAD_TIMEOUT_MS = 15 * 60_000

/** `p`, or a `BackendHungError` after `ms`. The timer never keeps a finished promise waiting. */
export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new BackendHungError(what, ms)), ms)
  })
  return Promise.race([p, deadline]).finally(() => clearTimeout(timer))
}

const isTruncation = (a: AttemptRecord) => a.errors.some((e) => /token limit/.test(e))

/** Stages of one load, from its progress events. */
export class LoadTracker {
  private firstAt: number | null = null
  private initAt: number | null = null
  private bytesLoaded = 0
  private bytesTotal = 0
  private weightMessages: string[] = []
  private initMessages: string[] = []
  /** The stage the load is in now. */
  current: 'verify' | 'weights' | 'init' = 'verify'
  lastMessage = ''

  constructor(private readonly startedAt: number) {}

  progress(p: LoadProgress, at: number): void {
    this.firstAt ??= at
    if (p.phase === 'init' && this.initAt === null) this.initAt = at
    const init = this.initAt !== null
    this.current = init ? 'init' : 'weights'
    if (!init && p.phase === 'download') {
      this.bytesLoaded = Math.max(this.bytesLoaded, p.loaded)
      this.bytesTotal = Math.max(this.bytesTotal, p.total)
    }
    if (p.message) {
      this.lastMessage = p.message
      const list = init ? this.initMessages : this.weightMessages
      if (list[list.length - 1] !== p.message && list.length < 40) list.push(p.message)
    }
  }

  get bytes(): { loaded: number; total: number } {
    return { loaded: this.bytesLoaded, total: this.bytesTotal }
  }

  /** `endedAt` is when `load()` resolved. A load without progress events is one `init` stage. */
  stages(endedAt: number): LoadStage[] {
    if (this.firstAt === null) return [{ stage: 'init', ms: endedAt - this.startedAt, messages: [] }]
    const weightsEnd = this.initAt ?? endedAt
    const out: LoadStage[] = [
      { stage: 'verify', ms: this.firstAt - this.startedAt, messages: [] },
      { stage: 'weights', ms: weightsEnd - this.firstAt, bytesLoaded: this.bytesLoaded, bytesTotal: this.bytesTotal, messages: this.weightMessages },
    ]
    if (this.initAt !== null) out.push({ stage: 'init', ms: endedAt - this.initAt, messages: this.initMessages })
    return out
  }
}

export function startBench(d: BenchDeps): BenchRun {
  const now = d.now ?? (() => performance.now())
  const sleep = d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const t0 = now()
  const since = () => now() - t0
  const { config, suite } = d
  const frames = d.frames ?? null

  const results: BenchResults = {
    schema: RESULTS_SCHEMA,
    backend: config.backend,
    backendLabel: config.backend,
    modelId: d.modelId,
    model: d.model ?? null,
    config,
    fixtures: suite.fixtures.map((f) => ({ id: f.id, letter: f.letter, label: f.label, kind: f.kind, count: f.count, fullCount: FIXTURES[f.id].count, prompts: f.kind === 'staged' ? f.count * ARTICLE_CALLS : f.count, budget: f.budget, inputTokens: f.inputTokens })),
    env: d.env,
    capabilities: { probe: null, loaded: null },
    startedAt: new Date().toISOString(),
    finishedAt: null,
    complete: false,
    start: { declared: config.start, inferred: 'unknown' },
    loads: [],
    passes: [],
    calls: [],
    articles: [],
    memory: [],
    frames: null,
    equivalence: null,
    deviceLoss: null,
    events: [],
  }

  const stageViews: StageView[] = [
    { id: 'probe', label: 'Probe the backend', status: 'pending', ms: null },
    { id: 'verify', label: 'Fetch and verify the runtime', status: 'pending', ms: null },
    { id: 'weights', label: 'Weights (download, or read from the browser cache)', status: 'pending', ms: null },
    { id: 'init', label: 'Load onto the GPU', status: 'pending', ms: null },
    { id: 'warm-up', label: 'Warm-up turn', status: 'pending', ms: null },
    { id: 'suite', label: 'Fixtures', status: config.suite === 'load' ? 'skipped' : 'pending', ms: null },
    { id: 'equivalence', label: 'Upstream equivalence', status: d.equivalence && config.suite === 'full' ? 'pending' : 'skipped', ms: null },
    { id: 'reloads', label: `Warm reloads (${config.reloads})`, status: config.reloads > 0 ? 'pending' : 'skipped', ms: null },
    { id: 'device-loss', label: 'Device loss and recovery', status: config.deviceLoss === 'none' ? 'skipped' : 'pending', ms: null },
  ]
  const perCase = (id: FixtureId) => (id === 'staged-article' ? suite.articles.length : suite.cases.filter((c) => c.fixture === id).length)
  const state: BenchState = {
    status: 'running',
    stage: 'probe',
    stages: stageViews,
    fixtures: suite.fixtures.map((f) => ({ id: f.id, label: f.label, done: 0, total: perCase(f.id) * config.repeat, failed: 0 })),
    pass: 0,
    passes: config.repeat,
  }
  const view = (id: string) => stageViews.find((s) => s.id === id)!
  const stageStarted = new Map<string, number>()
  const emit = () => {
    for (const [id, at] of stageStarted) {
      const v = view(id)
      if (v.status === 'active') v.ms = now() - at
    }
    d.onState?.(state)
  }
  const enter = (id: string, stage = id) => {
    const v = view(id)
    v.status = 'active'
    stageStarted.set(id, now())
    state.stage = stage
    emit()
  }
  const leave = (id: string, status: StageStatus = 'done', ms?: number) => {
    const v = view(id)
    v.status = status
    v.ms = ms ?? now() - (stageStarted.get(id) ?? now())
    stageStarted.delete(id)
    emit()
  }

  let llm: LocalLlm | null = null
  let sink: GenRecord[] | null = null
  let lostAt: number | null = null
  let currentPass: PassRecord | null = null
  let lossWaiter: (() => void) | null = null

  const event = (kind: string, message: string) => {
    results.events.push({ atMs: since(), kind, message })
    if (kind === 'device-lost') {
      lostAt ??= now()
      if (currentPass) currentPass.deviceLost = true
      lossWaiter?.()
    }
  }

  /** Record every underlying generation of the adapter, whichever of its methods makes it. */
  const meter = (target: LocalLlm) => {
    const inner = target.generate.bind(target)
    target.generate = async (messages, opts) => {
      const started = now()
      try {
        const r = await inner(messages, opts)
        sink?.push({ wallMs: now() - started, finishReason: r.finishReason, usage: r.usage })
        return r
      } catch (e) {
        sink?.push({ wallMs: now() - started, finishReason: 'error', usage: null, error: errorOf(e).message })
        throw e
      }
    }
  }

  const open = async (): Promise<OpenedBackend> => {
    const opened = await d.open()
    llm = opened.llm
    meter(opened.llm)
    return opened
  }

  const gpuBytes = (caps: RuntimeCapabilities | null): { live: number; peak: number } | null => {
    const g = (caps?.device as { gpuBytes?: { live?: unknown; peak?: unknown } } | undefined)?.gpuBytes
    return g && typeof g.live === 'number' && typeof g.peak === 'number' ? { live: g.live, peak: g.peak } : null
  }

  const sampleMemory = async (label: string, withUa: boolean): Promise<void> => {
    const sample: MemorySample = { atMs: since(), label, gpuLiveBytes: null, gpuPeakBytes: null, uaBytes: null }
    try {
      const caps = (await llm?.capabilities?.()) ?? null
      if (caps && label === 'after load') results.capabilities.loaded = caps
      const g = gpuBytes(caps)
      if (g) {
        sample.gpuLiveBytes = g.live
        sample.gpuPeakBytes = g.peak
      }
    } catch {
      /* a lost device has nothing to report */
    }
    if (withUa && d.measureMemory) {
      try {
        const m = await d.measureMemory()
        if (m) {
          sample.uaBytes = m.bytes
          sample.uaWindowBytes = m.windowBytes
          sample.uaWorkerBytes = m.workerBytes
        }
      } catch (e) {
        // Why the browser gave no number, so the report can say so instead of a bare "not measured".
        sample.uaError = errorOf(e).message
      }
    }
    results.memory.push(sample)
  }

  const callOptions = (c: BenchCase, signal: AbortSignal): GenerateOptions => ({
    maxTokens: c.budget.maxTokens,
    thinking: c.budget.thinking,
    reasoningBudget: c.budget.reasoningBudget,
    signal,
  })

  /** One prompt through the adapter, recorded whatever happens. Returns the answer when there is one. */
  const runCase = async (c: BenchCase, pass: number): Promise<{ record: CallRecord; answer: unknown }> => {
    const gens: GenRecord[] = []
    const attempts: AttemptRecord[] = []
    const ac = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      ac.abort()
    }, config.callTimeoutMs)
    const startedMs = since()
    const started = now()
    let firstDeltaAt = 0
    let answer: unknown
    let ok = false
    let error: { name: string; message: string } | undefined
    let finishReason: CallRecord['finishReason']
    let checkErrors: string[] = []
    sink = gens
    frames?.generation(1)
    let hung: BackendHungError | null = null
    try {
      if (!llm) throw new Error('no backend is open')
      const target = llm
      const call = async (): Promise<void> => {
        if (c.kind === 'generate') {
          const r = await target.generate(c.messages, {
            ...callOptions(c, ac.signal),
            onDelta: () => {
              if (!firstDeltaAt) firstDeltaAt = now()
            },
          })
          finishReason = r.finishReason
          // A turn cut off at the token limit is still a turn (the bridge trims it to a sentence).
          ok = r.finishReason === 'stop' || r.finishReason === 'length'
          if (ok) answer = r.text
        } else {
          answer = await target.structured(c.messages, c.schema ?? {}, {
            ...callOptions(c, ac.signal),
            answerPrefix: c.budget.answerPrefix,
            stopOnJsonEnd: c.budget.stopOnJsonEnd,
            validate: d.validate,
            onAttempt: (a) => attempts.push({ attempt: a.attempt, errors: a.errors.slice(0, 6) }),
          })
          ok = true
        }
      }
      await withTimeout(call(), config.callTimeoutMs + (d.cancelGraceMs ?? CANCEL_GRACE_MS), `call ${c.key}`)
      if (ok) checkErrors = c.check(answer)
    } catch (e) {
      if (e instanceof BackendHungError) hung = e
      error = errorOf(e)
      ok = false
      if (timedOut && !hung) error = { name: 'Timeout', message: `no answer within ${Math.round(config.callTimeoutMs / 1000)} s (${error.message})` }
    } finally {
      clearTimeout(timer)
      frames?.generation(-1)
      sink = null
    }
    if (timedOut && !error) {
      ok = false
      error = { name: 'Timeout', message: `no answer within ${Math.round(config.callTimeoutMs / 1000)} s` }
    }
    const wallMs = now() - started
    const structured = c.kind === 'structured'
    const extraTurns = structured ? Math.max(0, attempts.length - 1) : 0
    const truncations = structured ? attempts.filter(isTruncation).length : finishReason === 'length' ? 1 : 0
    const adapterTtft = gens[0]?.usage?.ttftMs
    const constrainedBackend = results.capabilities.probe?.supportsConstrainedOutput === true
    const text = typeof answer === 'string' ? answer : answer === undefined ? '' : JSON.stringify(answer)
    const record: CallRecord = {
      key: c.key,
      fixture: c.fixture,
      index: c.index,
      ...(c.stage ? { stage: c.stage } : {}),
      pass,
      kind: c.kind,
      budget: c.budget,
      estimatedPromptTokens: estimateCaseTokens(c),
      startedMs,
      wallMs,
      ok,
      ...(error ? { error } : {}),
      ...(finishReason ? { finishReason } : {}),
      gens,
      attempts,
      extraTurns,
      truncations,
      firstAttemptValid: structured && ok && extraTurns === 0,
      validWithinOneRepair: structured && ok && extraTurns <= 1,
      ...(structured && constrainedBackend && ok ? { constrained: gens.length === 0 } : {}),
      ttftMs: typeof adapterTtft === 'number' && adapterTtft > 0 ? adapterTtft : firstDeltaAt ? firstDeltaAt - started : null,
      checkErrors,
      answerChars: text.length,
    }
    results.calls.push(record)
    if (currentPass) {
      currentPass.calls++
      if (!ok) currentPass.failures++
    }
    // Recorded first, then the run stops: the next call would queue behind this one forever.
    if (hung) throw hung
    return { record, answer }
  }

  const bump = (id: FixtureId, failed: boolean) => {
    const f = state.fixtures.find((x) => x.id === id)
    if (f) {
      f.done++
      if (failed) f.failed++
    }
    emit()
  }

  /** After a device loss inside a pass: load again and go on, so one loss costs one call, not the run. */
  const recover = async () => {
    if (lostAt === null || !llm) return
    lostAt = null
    await withTimeout(llm.load(d.modelId), RELOAD_TIMEOUT_MS, 'the reload after a device loss')
    await withTimeout(llm.generate(WARMUP, { maxTokens: 16, thinking: 'off' }), config.callTimeoutMs, 'the turn after a reload')
  }

  const runArticle = async (plan: ArticlePlan, pass: number): Promise<void> => {
    const started = now()
    const rec: ArticleRecord = { index: plan.index, pass, ok: false, wallMs: 0, calls: 0, words: 0, checkFailures: 0 }
    const step = async (c: BenchCase): Promise<unknown> => {
      const { record, answer } = await runCase(c, pass)
      rec.calls++
      if (record.ok && record.checkErrors.length > 0) rec.checkFailures++
      if (!record.ok) {
        rec.failedStage = c.stage
        await recover()
        return undefined
      }
      return answer
    }
    const done = () => {
      rec.wallMs = now() - started
      results.articles.push(rec)
      bump('staged-article', !rec.ok)
    }
    const outline = (await step(plan.outline())) as Outline | undefined
    if (!outline) return done()
    const sections: SectionDraft[] = []
    for (let n = 1; n <= outline.sections.length; n++) {
      const s = (await step(plan.section(outline, n, sections))) as SectionDraft | undefined
      if (!s) return done()
      sections.push(s)
    }
    const closing = (await step(plan.closing(outline, sections))) as Closing | undefined
    if (!closing) return done()
    const review = await step(plan.review(outline, sections, closing))
    if (!review) return done()
    rec.ok = true
    rec.words = sections.reduce((a, s) => a + sectionWords(s), 0) + wordCount(closing.content)
    done()
  }

  const runPass = async (index: number): Promise<void> => {
    const started = now()
    currentPass = { index, startedMs: since(), wallMs: 0, calls: 0, failures: 0, deviceLost: false }
    results.passes.push(currentPass)
    state.pass = index + 1
    for (const f of suite.fixtures) {
      state.stage = `fixture:${f.id}`
      emit()
      // Each fixture starts from an empty prompt cache; inside it the shared system prefix is reused.
      await llm?.resetSession?.().catch(() => undefined)
      if (f.id === 'staged-article') {
        for (const plan of suite.articles) await runArticle(plan, index)
      } else {
        for (const c of suite.cases) {
          if (c.fixture !== f.id) continue
          const { record } = await runCase(c, index)
          bump(f.id, !record.ok)
          if (!record.ok) await recover()
        }
      }
      await sampleMemory(`after ${f.id}`, false)
    }
    currentPass.wallMs = now() - started
    currentPass = null
  }

  const loadOnce = async (index: number, kind: LoadRecord['kind'], first: boolean): Promise<void> => {
    if (!llm) throw new Error('no backend is open')
    const started = now()
    const tracker = new LoadTracker(started)
    frames?.setBase('loading')
    const rec: LoadRecord = { kind, index, ok: false, loadMs: 0, warmupMs: null, stages: [] }
    results.loads.push(rec)
    if (first) enter('verify', 'load:verify')
    let shown: 'verify' | 'weights' | 'init' = 'verify'
    try {
      await llm.load(d.modelId, (p) => {
        const at = now()
        tracker.progress(p, at)
        if (!first) return
        while (shown !== tracker.current) {
          leave(shown)
          shown = shown === 'verify' ? 'weights' : 'init'
          enter(shown, `load:${shown}`)
        }
        const v = view(shown)
        if (shown === 'weights') {
          v.bytesLoaded = tracker.bytes.loaded
          v.bytesTotal = tracker.bytes.total
        }
        v.message = tracker.lastMessage || undefined
        emit()
      })
      const ended = now()
      rec.loadMs = ended - started
      rec.stages = tracker.stages(ended)
      if (first) {
        leave(shown)
        for (const id of ['verify', 'weights', 'init'] as const) {
          const measured = rec.stages.find((s) => s.stage === id)
          const v = view(id)
          // A load that reported no progress is one stage; the others did not happen as far as the page can tell.
          v.status = measured ? 'done' : 'skipped'
          v.ms = measured ? measured.ms : null
        }
        enter('warm-up', 'load:warm-up')
      }
      const w0 = now()
      await llm.generate(WARMUP, { maxTokens: 16, thinking: 'off' })
      rec.warmupMs = now() - w0
      rec.stages.push({ stage: 'warm-up', ms: rec.warmupMs, messages: [] })
      rec.ok = true
      if (first) leave('warm-up')
    } catch (e) {
      rec.error = errorOf(e).message
      rec.loadMs ||= now() - started
      if (first) for (const v of stageViews) if (v.status === 'active') v.status = 'failed'
      throw e
    } finally {
      frames?.setBase('idle')
    }
  }

  const deviceLoss = async (): Promise<void> => {
    if (!llm) return
    const mode = config.deviceLoss === 'hook' ? 'hook' : 'manual'
    const rec: DeviceLossRecord = { mode, observed: false, detectMs: null, inFlightFailed: null, reloadMs: null, firstTurnMs: null, recoveryMs: null }
    results.deviceLoss = rec
    lostAt = null
    const lost = new Promise<void>((resolve) => (lossWaiter = resolve))
    try {
      let lossStarted: number
      if (mode === 'hook') {
        if (!d.loseDevice) throw new Error('this backend has no device-loss test hook; use the manual step (chrome://gpucrash)')
        enter('device-loss', 'device-loss:hook')
        const inFlight = llm.generate(KEEPALIVE, { maxTokens: 64, thinking: 'off' }).then(
          () => false,
          () => true,
        )
        lossStarted = now()
        d.loseDevice()
        await Promise.race([lost, sleep(5000)])
        rec.observed = lostAt !== null
        rec.detectMs = lostAt !== null ? lostAt - lossStarted : null
        rec.inFlightFailed = await inFlight
      } else {
        // The page cannot crash its own GPU process: someone opens chrome://gpucrash in another tab.
        enter('device-loss', 'device-loss:waiting')
        const deadline = now() + (d.deviceLossWaitMs ?? 180_000)
        let failed = false
        while (lostAt === null && !failed && now() < deadline) {
          failed = await Promise.race([
            llm.generate(KEEPALIVE, { maxTokens: 64, thinking: 'off' }).then(
              () => false,
              () => true,
            ),
            lost.then(() => false),
          ])
        }
        rec.observed = lostAt !== null || failed
        rec.inFlightFailed = failed
        lossStarted = lostAt ?? now()
        if (!rec.observed) {
          rec.error = 'no device loss was seen before the wait ended'
          leave('device-loss', 'failed')
          return
        }
      }
      state.stage = 'device-loss:recovering'
      emit()
      const r0 = now()
      await withTimeout(llm.load(d.modelId), RELOAD_TIMEOUT_MS, 'the reload after the device loss')
      rec.reloadMs = now() - r0
      const f0 = now()
      const turn = await withTimeout(llm.generate(WARMUP, { maxTokens: 16, thinking: 'off' }), config.callTimeoutMs, 'the turn after the reload')
      rec.firstTurnMs = now() - f0
      if (turn.finishReason === 'error' || turn.finishReason === 'cancelled') throw new Error(`the turn after the reload ended as ${turn.finishReason}`)
      rec.recoveryMs = now() - lossStarted
      leave('device-loss')
    } catch (e) {
      rec.error = errorOf(e).message
      leave('device-loss', 'failed')
    } finally {
      lossWaiter = null
      lostAt = null
    }
  }

  const run = async (): Promise<BenchResults> => {
    try {
      enter('probe')
      const opened = await open()
      results.backendLabel = opened.info.label
      results.capabilities.probe = opened.capabilities
      leave('probe')

      results.start.inferred = (await d.inferStart?.().catch(() => 'unknown' as const)) ?? 'unknown'
      const kind = config.start !== 'unknown' ? config.start : results.start.inferred
      if (frames && config.idleMs > 0 && d.idleBeforeLoad !== false) {
        frames.setBase('idle-unloaded')
        await sleep(config.idleMs)
      }
      await loadOnce(0, kind, true)
      await sampleMemory('after load', true)

      if (config.suite !== 'load') {
        if (frames && config.idleMs > 0) await sleep(config.idleMs)
        enter('suite', 'suite')
        for (let p = 0; p < config.repeat; p++) await runPass(p)
        leave('suite')
        await sampleMemory('after the suite', true)
      }

      if (d.equivalence && config.suite === 'full') {
        enter('equivalence')
        try {
          results.equivalence = await d.equivalence(llm!)
          leave('equivalence')
        } catch (e) {
          event('equivalence-error', errorOf(e).message)
          leave('equivalence', 'failed')
        }
      }

      if (config.reloads > 0) {
        enter('reloads')
        for (let i = 1; i <= config.reloads; i++) {
          state.stage = `reload:${i}`
          emit()
          await llm?.dispose()
          await open()
          await loadOnce(i, 'warm', false)
        }
        leave('reloads')
      }

      if (config.deviceLoss !== 'none') await deviceLoss()
      results.complete = true
      state.status = 'done'
      state.stage = 'done'
    } catch (e) {
      results.fatal = errorOf(e).message
      state.status = 'failed'
      state.fatal = results.fatal
      for (const v of stageViews) if (v.status === 'active') v.status = 'failed'
    } finally {
      results.finishedAt = new Date().toISOString()
      if (frames && d.frameInfo) {
        const info = d.frameInfo()
        results.frames = frames.summary(info.renderer, info.quality)
      }
      await (llm as LocalLlm | null)?.dispose().catch(() => undefined)
      emit()
    }
    return results
  }

  return { results, state: () => state, event, done: run() }
}
