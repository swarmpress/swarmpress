/**
 * What the qualification harness records per call and how it is summarised
 * (ADR-0057, FEAT-037). Pure data and arithmetic: no DOM, no model.
 *
 * Every call ends in a `CallRecord`, whether it succeeded, failed validation,
 * was cut off, timed out or threw. Nothing is dropped: a summary counts its
 * failures next to its percentiles, and percentiles are taken over the calls
 * that have the value in question (a failed call has no time-to-first-token).
 */
import type { CallBudget, FixtureId, Stage } from './fixtures'
import type { FinishReason, RuntimeCapabilities, Usage } from '../types'

/** One underlying `generate` of a call (a structured call makes one per attempt). */
export interface GenRecord {
  wallMs: number
  finishReason: FinishReason | 'error'
  usage: Usage | null
  error?: string
}

export interface AttemptRecord {
  attempt: number
  errors: string[]
}

export interface CallRecord {
  key: string
  fixture: FixtureId
  index: number
  stage?: Stage
  /** Which pass over the suite (0-based). */
  pass: number
  kind: 'generate' | 'structured'
  budget: CallBudget
  /** Prompt size by the harness's estimator, tokens. */
  estimatedPromptTokens: number
  /** Milliseconds since the run started. */
  startedMs: number
  /** Wall time of the whole call, repairs included. */
  wallMs: number
  /** The call returned an answer: a validated value, or free text that was not cancelled. */
  ok: boolean
  error?: { name: string; message: string }
  /** Free text only: how the generation ended. */
  finishReason?: FinishReason
  gens: GenRecord[]
  attempts: AttemptRecord[]
  /** Turns after the first one: repair turns and the retry after a cut-off answer. */
  extraTurns: number
  /** Attempts that hit the token limit (free text: the answer did). */
  truncations: number
  /** Structured only: valid on the first turn. */
  firstAttemptValid: boolean
  /** Structured only: valid after at most one further turn. */
  validWithinOneRepair: boolean
  /** A backend with constrained output answered without the prompt-and-repair loop. */
  constrained?: boolean
  /** Time to the first token of the first generation; the adapter's figure, else the first delta seen by the page. */
  ttftMs: number | null
  /** Failures of the fixture's deterministic checks, for an answer that was returned. */
  checkErrors: string[]
  answerChars: number
}

export interface ArticleRecord {
  index: number
  pass: number
  /** Every stage returned a valid value. */
  ok: boolean
  /** The stage that failed, when one did; later stages were not run. */
  failedStage?: Stage
  wallMs: number
  calls: number
  /** Words of the sections and the closing, when the article completed. */
  words: number
  /** Stages whose deterministic checks failed. */
  checkFailures: number
}

export type LoadStageName = 'verify' | 'weights' | 'init' | 'warm-up'

export interface LoadStage {
  stage: LoadStageName
  ms: number
  /** `weights` only: bytes read (downloaded, or read back from the browser cache). */
  bytesLoaded?: number
  bytesTotal?: number
  /** What the runtime said it was doing, in order, without repeats. */
  messages: string[]
}

export interface LoadRecord {
  /** `cold`: the weights were not in the browser cache before this load. */
  kind: 'cold' | 'warm' | 'unknown'
  /** 0 is the first load of the page; later ones are reloads. */
  index: number
  ok: boolean
  error?: string
  /** `load()` from call to resolve. */
  loadMs: number
  /** The first generation after the load. */
  warmupMs: number | null
  stages: LoadStage[]
}

export interface PassRecord {
  index: number
  startedMs: number
  wallMs: number
  calls: number
  failures: number
  /** The GPU device was lost during this pass. */
  deviceLost: boolean
}

export interface MemorySample {
  atMs: number
  label: string
  /** GPU buffer bytes the runtime allocated, when the backend reports them. */
  gpuLiveBytes: number | null
  gpuPeakBytes: number | null
  /** `performance.measureUserAgentSpecificMemory()`, when the browser offers it. */
  uaBytes: number | null
  uaWindowBytes?: number | null
  uaWorkerBytes?: number | null
}

export type FramePhase = 'idle-unloaded' | 'loading' | 'idle' | 'generating'

export interface Stats {
  n: number
  p50: number
  p95: number
  min: number
  max: number
  mean: number
}

export interface FrameSummary {
  renderer: string
  quality: string
  /** Time the tab was hidden; frames do not run then and those gaps are not counted. */
  hiddenMs: number
  phases: Partial<Record<FramePhase, Stats & { samples: number[] }>>
}

export interface DeviceLossRecord {
  /** `hook`: the backend's test hook destroyed the device; `manual`: the page waited for `chrome://gpucrash`. */
  mode: 'hook' | 'manual'
  observed: boolean
  /** From the loss to the event reaching the page. */
  detectMs: number | null
  /** The call in flight failed instead of hanging. */
  inFlightFailed: boolean | null
  reloadMs: number | null
  firstTurnMs: number | null
  /** From the loss to the first answer after the reload. */
  recoveryMs: number | null
  error?: string
}

export interface EquivalenceRecord {
  prompts: number
  tokens: number
  /** Prompts whose adapter path and upstream benchmark, both in the worker, gave different token ids. */
  mismatches: { prompt: number; index: number; expected: number | null; actual: number | null }[]
  /** The adapter's ids, for the check against the recorded golden (done in Node). */
  ids: number[][]
  /** Adapter and feature set the ids belong to. */
  deviceKey: string | null
}

export interface RuntimeEvent {
  atMs: number
  kind: string
  message: string
}

export interface BenchConfig {
  backend: string
  /** Scene quality tier, or null when the scene is off. */
  quality: 'low' | 'medium' | 'high' | null
  suite: 'full' | 'frames' | 'load'
  scale: number
  fixtures: FixtureId[]
  thinking: 'off' | 'medium' | 'xhigh' | null
  /** Overrides of the model manifest (the fallback ladder's retune), when given. */
  context: number | null
  pipelineDepth: number | null
  /** Passes over the suite in one page. */
  repeat: number
  /** Reloads after the suite, each a warm start. */
  reloads: number
  /** What the runner said this run is. */
  start: 'cold' | 'warm' | 'unknown'
  deviceLoss: 'none' | 'hook' | 'manual'
  callTimeoutMs: number
  idleMs: number
}

export interface ModelPins {
  repo: string
  file: string
  revision: string
  sha256: string
  bytes: number
  engineSha256: string
  /** Context length the manifest pins, tokens. */
  context: number
}

export interface FixtureInfo {
  id: FixtureId
  letter: string
  label: string
  kind: 'generate' | 'structured' | 'staged'
  /** Prompts in this run (articles for the staged fixture). */
  count: number
  /** Prompts at scale 1. */
  fullCount: number
  budget: CallBudget
  inputTokens: [number, number]
}

export const RESULTS_SCHEMA = 'swarmpress.bench.v1'

/** Everything one page run measured. Written as JSON under artifacts/bench/raw/. */
export interface BenchResults {
  schema: typeof RESULTS_SCHEMA
  backend: string
  backendLabel: string
  modelId: string | null
  /** The pins of the model and its runtime, for backends that have them. */
  model: ModelPins | null
  config: BenchConfig
  /** The fixtures of this run with their prompt counts after scaling. */
  fixtures: FixtureInfo[]
  env: {
    userAgent: string
    browser: string | null
    crossOriginIsolated: boolean
    hardwareConcurrency: number | null
    deviceMemoryGb: number | null
    /** The page's own WebGPU adapter (the renderer's); the model's device is in `capabilities`. */
    gpu: Record<string, unknown> | null
  }
  capabilities: { probe: RuntimeCapabilities | null; loaded: RuntimeCapabilities | null }
  startedAt: string
  finishedAt: string | null
  /** False when the run stopped early; what was measured until then is still here. */
  complete: boolean
  fatal?: string
  start: { declared: 'cold' | 'warm' | 'unknown'; inferred: 'cold' | 'warm' | 'unknown' }
  loads: LoadRecord[]
  passes: PassRecord[]
  calls: CallRecord[]
  articles: ArticleRecord[]
  memory: MemorySample[]
  frames: FrameSummary | null
  equivalence: EquivalenceRecord | null
  deviceLoss: DeviceLossRecord | null
  events: RuntimeEvent[]
}

// ---------------------------------------------------------------- arithmetic

/** Linear-interpolated quantile (the R-7 definition); NaN for an empty list. */
export function quantile(values: number[], q: number): number {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
  if (v.length === 0) return NaN
  const pos = (v.length - 1) * Math.min(1, Math.max(0, q))
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return v[lo] + (v[hi] - v[lo]) * (pos - lo)
}

/** Summary of the finite values; null when there are none. */
export function stats(values: number[]): Stats | null {
  const v = values.filter((x) => Number.isFinite(x))
  if (v.length === 0) return null
  let min = Infinity
  let max = -Infinity
  let sum = 0
  for (const x of v) {
    if (x < min) min = x
    if (x > max) max = x
    sum += x
  }
  return { n: v.length, p50: quantile(v, 0.5), p95: quantile(v, 0.95), min, max, mean: sum / v.length }
}

/** Fewest uncached prompt tokens for a prefill rate to mean anything. */
export const MIN_PREFILL_TOKENS = 64
/** Fewest generated tokens for a decode rate to mean anything. */
export const MIN_DECODE_TOKENS = 16

/** Prompt tokens a generation prefilled per second, or null when the adapter does not time prefill. */
export function prefillRate(u: Usage | null): number | null {
  if (!u || u.prefillMs === undefined || u.prefillMs <= 0) return null
  const fresh = u.promptTokens - (u.cachedPromptTokens ?? 0)
  return fresh >= MIN_PREFILL_TOKENS ? (fresh * 1000) / u.prefillMs : null
}

/** Tokens a generation decoded per second (reasoning and answer), or null when it generated too few. */
export function decodeRate(u: Usage | null): number | null {
  if (!u) return null
  const generated = u.completionTokens + (u.reasoningTokens ?? 0)
  return generated >= MIN_DECODE_TOKENS && u.tokensPerSec > 0 ? u.tokensPerSec : null
}

export interface FailureGroup {
  message: string
  count: number
  /** Keys of the first few calls that failed this way. */
  keys: string[]
}

export interface CallSummary {
  calls: number
  ok: number
  failed: number
  failures: FailureGroup[]
  structured: number
  firstAttemptValid: number
  validWithinOneRepair: number
  /** Returned a valid value at all, within the repair budget. */
  validEventually: number
  extraTurns: number
  repairsPerCall: number
  truncations: number
  /** Answers that were returned and failed the fixture's deterministic checks. */
  checkFailed: number
  /** Structured calls a constrained backend had to send through prompt-and-repair. */
  constrainedMisses: number
  wallMs: Stats | null
  ttftMs: Stats | null
  prefillTps: Stats | null
  decodeTps: Stats | null
  reasoningTokens: Stats | null
  promptTokens: Stats | null
  estimatedPromptTokens: Stats | null
  completionTokens: Stats | null
  /** Generations that reused a cached prompt prefix. */
  cachedPrefixGens: number
  gens: number
}

const pct = (part: number, whole: number) => (whole > 0 ? (part * 100) / whole : NaN)

export const firstAttemptPct = (s: CallSummary) => pct(s.firstAttemptValid, s.structured)
export const oneRepairPct = (s: CallSummary) => pct(s.validWithinOneRepair, s.structured)
export const okPct = (s: CallSummary) => pct(s.ok, s.calls)

/** The message a failed call is grouped under: digits are folded so "42 words" and "57 words" count as one kind. */
export function failureKind(c: CallRecord): string {
  const raw = c.error ? `${c.error.name}: ${c.error.message}` : c.finishReason === 'cancelled' ? 'cancelled' : 'no answer'
  return raw.replace(/\d+(\.\d+)?/g, 'N').slice(0, 200)
}

export function summarize(calls: CallRecord[]): CallSummary {
  const groups = new Map<string, FailureGroup>()
  const s: CallSummary = {
    calls: calls.length,
    ok: 0,
    failed: 0,
    failures: [],
    structured: 0,
    firstAttemptValid: 0,
    validWithinOneRepair: 0,
    validEventually: 0,
    extraTurns: 0,
    repairsPerCall: 0,
    truncations: 0,
    checkFailed: 0,
    constrainedMisses: 0,
    wallMs: null,
    ttftMs: null,
    prefillTps: null,
    decodeTps: null,
    reasoningTokens: null,
    promptTokens: null,
    estimatedPromptTokens: null,
    completionTokens: null,
    cachedPrefixGens: 0,
    gens: 0,
  }
  const wall: number[] = []
  const ttft: number[] = []
  const prefill: number[] = []
  const decode: number[] = []
  const reasoning: number[] = []
  const prompt: number[] = []
  const estimated: number[] = []
  const completion: number[] = []
  for (const c of calls) {
    // Wall time is reported for every call, failed ones included: a call that timed out took that long.
    wall.push(c.wallMs)
    estimated.push(c.estimatedPromptTokens)
    if (c.ok) s.ok++
    else {
      s.failed++
      const kind = failureKind(c)
      const g = groups.get(kind) ?? { message: kind, count: 0, keys: [] }
      g.count++
      if (g.keys.length < 5) g.keys.push(c.key)
      groups.set(kind, g)
    }
    if (c.kind === 'structured') {
      s.structured++
      if (c.firstAttemptValid) s.firstAttemptValid++
      if (c.validWithinOneRepair) s.validWithinOneRepair++
      if (c.ok) s.validEventually++
      if (c.constrained === false) s.constrainedMisses++
    }
    s.extraTurns += c.extraTurns
    s.truncations += c.truncations
    if (c.ok && c.checkErrors.length > 0) s.checkFailed++
    if (c.ttftMs !== null) ttft.push(c.ttftMs)
    let reasoned = 0
    let completed = 0
    let sawUsage = false
    for (const [i, g] of c.gens.entries()) {
      s.gens++
      const u = g.usage
      if (!u) continue
      sawUsage = true
      if (i === 0) prompt.push(u.promptTokens)
      if ((u.cachedPromptTokens ?? 0) > 0) s.cachedPrefixGens++
      reasoned += u.reasoningTokens ?? 0
      completed += u.completionTokens
      const p = prefillRate(u)
      if (p !== null) prefill.push(p)
      const d = decodeRate(u)
      if (d !== null) decode.push(d)
    }
    if (sawUsage) {
      completion.push(completed)
      if (c.gens.some((g) => g.usage?.reasoningTokens !== undefined)) reasoning.push(reasoned)
    }
  }
  s.failures = [...groups.values()].sort((a, b) => b.count - a.count || a.message.localeCompare(b.message))
  s.repairsPerCall = s.calls > 0 ? s.extraTurns / s.calls : 0
  s.wallMs = stats(wall)
  s.ttftMs = stats(ttft)
  s.prefillTps = stats(prefill)
  s.decodeTps = stats(decode)
  s.reasoningTokens = stats(reasoning)
  s.promptTokens = stats(prompt)
  s.estimatedPromptTokens = stats(estimated)
  s.completionTokens = stats(completion)
  return s
}

/** One summary per fixture, in the order the fixtures first appear. */
export function summarizeByFixture(calls: CallRecord[]): Map<FixtureId, CallSummary> {
  const by = new Map<FixtureId, CallRecord[]>()
  for (const c of calls) {
    const list = by.get(c.fixture) ?? []
    list.push(c)
    by.set(c.fixture, list)
  }
  return new Map([...by].map(([id, list]) => [id, summarize(list)]))
}

export interface ArticleSummary {
  articles: number
  completed: number
  failed: number
  /** Failed articles by the stage that stopped them. */
  failedStages: Record<string, number>
  /** Over the articles that completed. */
  wallMs: Stats | null
  words: Stats | null
}

export function summarizeArticles(articles: ArticleRecord[]): ArticleSummary {
  const done = articles.filter((a) => a.ok)
  const failedStages: Record<string, number> = {}
  for (const a of articles) if (!a.ok) failedStages[a.failedStage ?? 'unknown'] = (failedStages[a.failedStage ?? 'unknown'] ?? 0) + 1
  return {
    articles: articles.length,
    completed: done.length,
    failed: articles.length - done.length,
    failedStages,
    wallMs: stats(done.map((a) => a.wallMs)),
    words: stats(done.map((a) => a.words)),
  }
}

/** At most `max` values, evenly spaced through the list (for the samples a report carries). */
export function downsample(values: number[], max: number): number[] {
  if (values.length <= max) return values.slice()
  const step = values.length / max
  return Array.from({ length: max }, (_, i) => values[Math.floor(i * step)])
}
