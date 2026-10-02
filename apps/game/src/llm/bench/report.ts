/**
 * Reports of a qualification run (ADR-0057, FEAT-037, FEAT-038):
 *
 * - `cockpit.benchmark.v1` documents for Cockpit (docs/guides/testing.md):
 *   `model-eval-<backend>.<machine>.json` (evidence source `bench/model-eval`)
 *   and `frame-time-llm-<tier>.json` (`bench/frame-time`);
 * - the go/no-go table of docs/design/mvp-runtime.md section 7, filled with
 *   what was measured, one verdict per row;
 * - a Markdown report for docs/qualification/.
 *
 * Pure functions over `BenchResults`: they run in the page, under vitest, and
 * in Node (e2e/bonsai-bench.spec.ts writes the files). Nothing here imports
 * JSON or browser code. A value that was not measured is written as "not
 * measured" and is left out of the Cockpit document; it is never filled in.
 */
import {
  firstAttemptPct,
  oneRepairPct,
  stats,
  summarize,
  summarizeArticles,
  summarizeByFixture,
  type BenchResults,
  type CallRecord,
  type CallSummary,
  type FixtureInfo,
  type FramePhase,
  type LoadRecord,
  type LoadStageName,
  type Stats,
} from './metrics'

// ---------------------------------------------------------------- cockpit.benchmark.v1

export const BENCHMARK_SCHEMA = 'cockpit.benchmark.v1'
export const TOOL = { name: 'swarmpress-bench', version: '1' }

export type Determinism = 'deterministic' | 'semi-deterministic' | 'environment-sensitive'
export type Direction = 'lower_is_better' | 'higher_is_better' | 'informational'

export interface BenchmarkMetric {
  name: string
  subject?: string
  unit: string
  value: number
  determinism: Determinism
  direction: Direction
  budget?: { max?: number; min?: number }
  samples?: number[]
  statistics?: { n?: number; mean?: number; p50?: number; p95?: number; min?: number; max?: number }
  status?: 'ok' | 'inconclusive' | 'skipped'
  reason?: string
}

export interface BenchmarkDoc {
  schema: typeof BENCHMARK_SCHEMA
  name: string
  feature_ids: string[]
  component: string
  provenance: { commit?: string; branch?: string; dirty?: boolean; generated_at: string; tool: { name: string; version: string } }
  build: { profile: string }
  machine: { os: string; arch: string; cpus: number; cpu_model: string; runner: string }
  workload: Record<string, string | number | boolean | null>
  metrics: BenchmarkMetric[]
}

export interface Provenance {
  commit: string | null
  branch: string | null
  dirty: boolean | null
  /** ISO 8601, UTC. */
  generatedAt: string
}

export interface Machine {
  /** File-name part: lowercase letters, digits and dashes, e.g. `apple-m3-max-128gb`. */
  slug: string
  os: string
  arch: string
  cpus: number
  cpuModel: string
  memoryGb: number
  osVersion?: string
}

export interface ReportContext {
  provenance: Provenance
  machine: Machine
}

/** `Apple M3 Max`, 128 GB → `apple-m3-max-128gb`. */
export function machineSlug(cpuModel: string, memoryBytes: number): string {
  const cpu = cpuModel
    .toLowerCase()
    .replace(/\(r\)|\(tm\)|cpu|processor|@.*$/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${cpu || 'unknown'}-${Math.round(memoryBytes / 1024 ** 3)}gb`
}

/** What kind of run this was, as a file-name part: `full`, `soak`, `load-cold`, `load-warm`, `device-loss`, `frames-low`. */
export function runLabel(r: BenchResults): string {
  if (r.config.suite === 'load') return r.config.deviceLoss !== 'none' ? 'device-loss' : `load-${r.loads[0]?.kind ?? r.config.start}`
  if (r.config.suite === 'frames') return `frames-${r.config.quality ?? 'off'}`
  return r.config.repeat > 1 ? 'soak' : 'full'
}

/** `model-eval-<backend>.<machine>.json`; runs other than the full one carry their label. */
export function modelEvalFile(backend: string, machine: string, label = 'full'): string {
  return label === 'full' ? `model-eval-${backend}.${machine}.json` : `model-eval-${backend}.${machine}.${label}.json`
}

/** `frame-time-llm-<tier>.json` for the resident model; other backends carry their name so they never overwrite it. */
export function frameTimeFile(tier: string, backend: string): string {
  return backend === 'bonsai' ? `frame-time-llm-${tier}.json` : `frame-time-llm-${tier}.${backend}.json`
}

export const rawFile = (backend: string, machine: string, label: string) => `bench-${backend}.${machine}.${label}.json`

export const qualificationFile = (date: string, backend: string, machine: string) => `${date}-${backend}-${machine}.md`

const SCRIPTED_REASON = 'scripted backend: no model ran, the timing says nothing about one'

const round = (x: number, digits = 2) => {
  const f = 10 ** digits
  return Math.round(x * f) / f
}

function statistics(s: Stats): BenchmarkMetric['statistics'] {
  return { n: s.n, mean: round(s.mean), p50: round(s.p50), p95: round(s.p95), min: round(s.min), max: round(s.max) }
}

function docBase(r: BenchResults, ctx: ReportContext, name: string, component: string, featureIds: string[], workload: BenchmarkDoc['workload']): BenchmarkDoc {
  const p = ctx.provenance
  return {
    schema: BENCHMARK_SCHEMA,
    name,
    feature_ids: featureIds,
    component,
    provenance: {
      ...(p.commit ? { commit: p.commit } : {}),
      ...(p.branch ? { branch: p.branch } : {}),
      ...(p.dirty !== null ? { dirty: p.dirty } : {}),
      generated_at: p.generatedAt,
      tool: TOOL,
    },
    build: { profile: 'harness' },
    machine: { os: ctx.machine.os, arch: ctx.machine.arch, cpus: ctx.machine.cpus, cpu_model: ctx.machine.cpuModel, runner: 'local' },
    workload: { backend: r.backend, model: r.modelId, browser: r.env.browser, ...workload },
    metrics: [],
  }
}

/** Adds metrics to a document; a value that is missing or not finite is skipped, never written as zero. */
class Metrics {
  readonly list: BenchmarkMetric[] = []
  constructor(private readonly scripted: boolean) {}

  /** A count the run produces exactly: calls, failures, mismatches. */
  count(name: string, subject: string, unit: string, value: number, direction: Direction = 'informational', budget?: BenchmarkMetric['budget']): void {
    if (!Number.isFinite(value)) return
    this.list.push({ name, subject, unit, value, determinism: this.scripted ? 'deterministic' : 'semi-deterministic', direction, ...(budget ? { budget } : {}) })
  }

  /** A share of calls, in percent. */
  pct(name: string, subject: string, value: number): void {
    if (!Number.isFinite(value)) return
    this.list.push({ name, subject, unit: '%', value: round(value), determinism: this.scripted ? 'deterministic' : 'semi-deterministic', direction: 'higher_is_better' })
  }

  /** A measurement that depends on the machine: time, rate, memory. From a scripted backend it is recorded as inconclusive. */
  measured(name: string, subject: string, unit: string, value: number | null | undefined, direction: Direction, extra: Partial<BenchmarkMetric> = {}): void {
    if (value === null || value === undefined || !Number.isFinite(value)) return
    this.list.push({
      name,
      subject,
      unit,
      value: round(value),
      determinism: 'environment-sensitive',
      direction,
      ...extra,
      ...(this.scripted ? { status: 'inconclusive' as const, reason: SCRIPTED_REASON } : {}),
    })
  }

  /** p50 and p95 of a summary under `<name>.p50_<unit>` and `<name>.p95_<unit>`. */
  spread(name: string, subject: string, s: Stats | null, direction: Direction = 'lower_is_better'): void {
    if (!s) return
    this.measured(`${name}.p50_ms`, subject, 'ms', s.p50, direction, { statistics: statistics(s) })
    this.measured(`${name}.p95_ms`, subject, 'ms', s.p95, direction)
  }
}

const loadStage = (l: LoadRecord, stage: LoadStageName) => l.stages.find((s) => s.stage === stage)?.ms ?? NaN

/** Time from the start of `load()` to the end of the warm-up turn. */
export const readyMs = (l: LoadRecord) => l.loadMs + (l.warmupMs ?? 0)

const maxOf = (values: (number | null | undefined)[]): number | null => {
  const v = values.filter((x): x is number => typeof x === 'number' && Number.isFinite(x))
  return v.length ? Math.max(...v) : null
}

export const gpuPeakBytes = (r: BenchResults) => maxOf(r.memory.map((m) => m.gpuPeakBytes))

/** The `bench/model-eval` document of one run. */
export function modelEvalDoc(r: BenchResults, ctx: ReportContext): BenchmarkDoc {
  const label = runLabel(r)
  const scripted = r.backend === 'fake'
  const doc = docBase(r, ctx, label === 'full' ? `model-eval-${r.backend}` : `model-eval-${r.backend}-${label}`, 'inference', scripted ? ['FEAT-037'] : ['FEAT-037', 'FEAT-038'], {
    suite: r.config.suite,
    scale: r.config.scale,
    passes: r.config.repeat,
    scene: r.config.quality ?? 'off',
    thinking: r.config.thinking ?? 'per fixture',
    context: r.capabilities.loaded?.contextTokens ?? r.config.context,
    pipeline_depth: r.config.pipelineDepth,
    complete: r.complete,
  })
  const m = new Metrics(scripted)

  for (const kind of ['cold', 'warm'] as const) {
    const loads = r.loads.filter((l) => l.kind === kind && l.ok)
    if (loads.length === 0) continue
    const ready = stats(loads.map(readyMs))
    m.measured('load.ready_ms', kind, 'ms', ready?.p50, 'lower_is_better', ready ? { statistics: statistics(ready) } : {})
    m.measured('load.total_ms', kind, 'ms', stats(loads.map((l) => l.loadMs))?.p50, 'lower_is_better')
    for (const stage of ['verify', 'weights', 'init', 'warm-up'] as const) {
      m.measured(`load.${stage.replace('-', '')}_ms`, kind, 'ms', stats(loads.map((l) => loadStage(l, stage)))?.p50, 'lower_is_better')
    }
  }
  m.count('load.failures', 'all', 'loads', r.loads.filter((l) => !l.ok).length, 'lower_is_better')

  const perFixture = (subject: string, s: CallSummary) => {
    m.count('calls', subject, 'calls', s.calls)
    m.count('failures', subject, 'calls', s.failed, 'lower_is_better')
    m.spread('wall', subject, s.wallMs)
    m.spread('ttft', subject, s.ttftMs)
    m.measured('prefill.tokens_per_sec', subject, 'tokens/s', s.prefillTps?.p50, 'higher_is_better', s.prefillTps ? { statistics: statistics(s.prefillTps) } : {})
    m.measured('decode.tokens_per_sec', subject, 'tokens/s', s.decodeTps?.p50, 'higher_is_better', s.decodeTps ? { statistics: statistics(s.decodeTps) } : {})
    if (s.reasoningTokens) m.count('reasoning.tokens_p50', subject, 'tokens', round(s.reasoningTokens.p50))
    if (s.structured > 0) {
      m.pct('valid.first_attempt_pct', subject, firstAttemptPct(s))
      m.pct('valid.one_repair_pct', subject, oneRepairPct(s))
      m.count('repairs.turns', subject, 'turns', s.extraTurns, 'lower_is_better')
      if (s.constrainedMisses > 0) m.count('constrained.misses', subject, 'calls', s.constrainedMisses, 'lower_is_better')
    }
    m.count('truncations', subject, 'calls', s.truncations, 'lower_is_better')
    m.count('checks.failed', subject, 'calls', s.checkFailed, 'lower_is_better')
  }
  for (const [id, s] of summarizeByFixture(r.calls)) perFixture(id, s)
  if (r.calls.length > 0) {
    const all = summarize(r.calls)
    perFixture('all', all)
    // The metric name the planned model-eval reporter uses (docs/guides/testing.md).
    if (r.modelId) m.measured('tokens_per_sec', r.modelId, 'tokens/s', all.decodeTps?.p50, 'higher_is_better')
  }

  if (r.articles.length > 0) {
    const a = summarizeArticles(r.articles)
    m.count('article.completed', 'staged-article', 'articles', a.completed, 'higher_is_better')
    m.count('article.failed', 'staged-article', 'articles', a.failed, 'lower_is_better')
    m.spread('article.wall', 'staged-article', a.wallMs)
  }

  m.measured('gpu.peak_bytes', 'memory', 'bytes', gpuPeakBytes(r), 'lower_is_better')
  m.measured('gpu.live_bytes', 'memory', 'bytes', maxOf(r.memory.map((x) => x.gpuLiveBytes)), 'lower_is_better')
  m.measured('ua.bytes', 'memory', 'bytes', maxOf(r.memory.map((x) => x.uaBytes)), 'lower_is_better')

  if (r.passes.length > 0) {
    m.count('passes', 'device-loss', 'passes', r.passes.length)
    m.count('passes.device_lost', 'device-loss', 'passes', r.passes.filter((p) => p.deviceLost).length, 'lower_is_better')
  }
  if (r.deviceLoss?.recoveryMs != null) m.measured('device_loss.recovery_ms', 'device-loss', 'ms', r.deviceLoss.recoveryMs, 'lower_is_better')
  if (r.equivalence) m.count('equivalence.mismatches', 'equivalence', 'prompts', r.equivalence.mismatches.length, 'lower_is_better', { max: 0 })

  doc.metrics = m.list
  return doc
}

const PHASE_SUBJECT: Record<FramePhase, string> = { 'idle-unloaded': 'idle-unloaded', loading: 'loading', idle: 'idle', generating: 'generating' }

/** The `bench/frame-time` document of one run, or null when the scene was off or drew nothing. */
export function frameTimeDoc(r: BenchResults, ctx: ReportContext): BenchmarkDoc | null {
  const f = r.frames
  if (!f || Object.keys(f.phases).length === 0) return null
  const scripted = r.backend === 'fake'
  const name = r.backend === 'bonsai' ? `frame-time-llm-${f.quality}` : `frame-time-llm-${f.quality}-${r.backend}`
  const doc = docBase(r, ctx, name, 'render', ['FEAT-022', 'FEAT-040'], { quality: f.quality, renderer: f.renderer, pipeline_depth: r.config.pipelineDepth, hidden_ms: f.hiddenMs })
  const m = new Metrics(scripted)
  for (const phase of ['idle-unloaded', 'loading', 'idle', 'generating'] as const) {
    const s = f.phases[phase]
    if (!s) continue
    const subject = PHASE_SUBJECT[phase]
    m.measured('frame.p50_ms', subject, 'ms', s.p50, 'lower_is_better')
    m.measured('frame.p95_ms', subject, 'ms', s.p95, 'lower_is_better', { statistics: statistics(s), samples: s.samples })
    // The number of frames is whatever the display and the run length made it.
    m.measured('frames', subject, 'frames', s.n, 'informational')
  }
  doc.metrics = m.list
  return doc
}

const DETERMINISM = ['deterministic', 'semi-deterministic', 'environment-sensitive']
const DIRECTION = ['lower_is_better', 'higher_is_better', 'informational']
const STATUS = ['ok', 'inconclusive', 'skipped']
const STAT_KEYS = ['n', 'mean', 'median', 'p50', 'p95', 'p99', 'std_dev', 'min', 'max']
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * Checks a document against the `cockpit.benchmark.v1` format as Cockpit
 * reads it (its docs/formats/cockpit.benchmark.v1.md): the required fields,
 * the value sets of `determinism`, `direction` and `status`, and the things
 * Cockpit would silently drop (a metric without a finite value) or misread (a
 * repeated series). Returns the problems; empty when the document is good.
 */
export function validateBenchmarkDoc(doc: unknown): string[] {
  const out: string[] = []
  if (!isObject(doc)) return ['the document is not an object']
  if (doc.schema !== BENCHMARK_SCHEMA) out.push(`schema must be "${BENCHMARK_SCHEMA}"`)
  if (typeof doc.name !== 'string' || !doc.name) out.push('name is required')
  if (doc.feature_ids !== undefined) {
    if (!Array.isArray(doc.feature_ids) || doc.feature_ids.some((f) => typeof f !== 'string' || !/^FEAT-\d{3}$/.test(f))) out.push('feature_ids must be a list of FEAT-nnn ids')
  }
  if (doc.component !== undefined && typeof doc.component !== 'string') out.push('component must be a string')
  if (doc.provenance !== undefined) {
    if (!isObject(doc.provenance)) out.push('provenance must be an object')
    else {
      const p = doc.provenance
      if (p.commit !== undefined && (typeof p.commit !== 'string' || !/^[0-9a-f]{7,40}$/.test(p.commit))) out.push('provenance.commit must be a git sha')
      if (p.generated_at !== undefined && (typeof p.generated_at !== 'string' || Number.isNaN(Date.parse(p.generated_at)))) out.push('provenance.generated_at must be a timestamp')
      if (p.dirty !== undefined && typeof p.dirty !== 'boolean') out.push('provenance.dirty must be a boolean')
    }
  }
  if (doc.machine !== undefined) {
    if (!isObject(doc.machine)) out.push('machine must be an object')
    else if (doc.machine.cpus !== undefined && !(Number.isInteger(doc.machine.cpus) && (doc.machine.cpus as number) >= 0)) out.push('machine.cpus must be a non-negative integer')
  }
  if (!Array.isArray(doc.metrics) || doc.metrics.length === 0) {
    out.push('metrics must be a non-empty list')
    return out
  }
  const seen = new Set<string>()
  doc.metrics.forEach((raw, i) => {
    const at = `metrics[${i}]`
    if (!isObject(raw)) {
      out.push(`${at} is not an object`)
      return
    }
    if (typeof raw.name !== 'string' || !raw.name) out.push(`${at}.name is required`)
    if (typeof raw.unit !== 'string' || !raw.unit) out.push(`${at}.unit is required`)
    if (!isFiniteNumber(raw.value)) out.push(`${at}.value must be a finite number`)
    if (raw.subject !== undefined && typeof raw.subject !== 'string') out.push(`${at}.subject must be a string`)
    if (raw.determinism !== undefined && !DETERMINISM.includes(raw.determinism as string)) out.push(`${at}.determinism is not one of ${DETERMINISM.join(', ')}`)
    if (raw.direction !== undefined && !DIRECTION.includes(raw.direction as string)) out.push(`${at}.direction is not one of ${DIRECTION.join(', ')}`)
    if (raw.status !== undefined && !STATUS.includes(raw.status as string)) out.push(`${at}.status is not one of ${STATUS.join(', ')}`)
    if (raw.budget !== undefined) {
      const b = raw.budget
      const ok = isFiniteNumber(b) || (isObject(b) && ['max', 'min', 'max_relative_pct'].some((k) => isFiniteNumber(b[k])))
      if (!ok) out.push(`${at}.budget must be a number or { max | min | max_relative_pct }`)
    }
    if (raw.samples !== undefined && (!Array.isArray(raw.samples) || raw.samples.some((s) => !isFiniteNumber(s)) || raw.samples.length > 10_000)) out.push(`${at}.samples must be at most 10000 finite numbers`)
    if (raw.statistics !== undefined) {
      if (!isObject(raw.statistics)) out.push(`${at}.statistics must be an object`)
      else {
        for (const [k, v] of Object.entries(raw.statistics)) {
          if (!STAT_KEYS.includes(k)) out.push(`${at}.statistics.${k} is not a known statistic`)
          else if (!isFiniteNumber(v)) out.push(`${at}.statistics.${k} must be a finite number`)
        }
      }
    }
    const series = `${String(raw.subject ?? '')}/${String(raw.name)}`
    if (seen.has(series)) out.push(`${at} repeats the series ${series}`)
    seen.add(series)
  })
  return out
}

// ---------------------------------------------------------------- go / no-go

/** The thresholds of docs/design/mvp-runtime.md section 7. Proposals until the first measurement. */
export const THRESHOLDS = {
  warmStartMs: { go: 60_000, noGo: 120_000 },
  prefillTps: { go: 300, noGo: 100 },
  decodeTps: { go: 20, noGo: 10 },
  shortActionMs: { goP50: 10_000, goP95: 20_000, noGoP50: 20_000 },
  validPct: { go: 98, goFirst: 90, noGo: 90, prompts: 50 },
  section: { goP50Ms: 60_000, goValidPct: 95 },
  articleMs: { go: 8 * 60_000, noGo: 15 * 60_000 },
  meetingMs: { goTtft: 3000, goTotal: 8000 },
  frameP95Ms: { go: 33, noGoAtLow: 50 },
  deviceLoss: { goPct: 95, noGoPct: 80, runs: 20 },
  /** 12 GB, decimal, like the model sizes in the design. */
  gpuPeakBytes: { go: 12e9 },
} as const

export type Verdict = 'go' | 'conditional' | 'no-go' | 'insufficient' | 'not-measured' | 'n/a'

export interface Row {
  id: string
  metric: string
  go: string
  noGo: string
  measured: string
  verdict: Verdict
  note?: string
}

/** Lower is better: at or under `go` is a go, over `noGo` is a no-go, between them it is conditional. */
export function lowerVerdict(value: number, go: number, noGo: number | null): Verdict {
  if (value <= go) return 'go'
  if (noGo !== null && value > noGo) return 'no-go'
  return 'conditional'
}

/** Higher is better: at or over `go` is a go, under `noGo` is a no-go, between them it is conditional. */
export function higherVerdict(value: number, go: number, noGo: number | null): Verdict {
  if (value >= go) return 'go'
  if (noGo !== null && value < noGo) return 'no-go'
  return 'conditional'
}

export function fmtMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return 'not measured'
  if (ms >= 120_000) return `${(ms / 60_000).toFixed(1)} min`
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)} s`
  return `${ms.toFixed(0)} ms`
}

export function fmtBytes(b: number | null | undefined): string {
  if (b === null || b === undefined || !Number.isFinite(b)) return 'not measured'
  if (b >= 1e9) return `${(b / 1e9).toFixed(2)} GB`
  if (b >= 1e6) return `${(b / 1e6).toFixed(1)} MB`
  return `${Math.round(b)} bytes`
}

const fmtPct = (p: number) => (Number.isFinite(p) ? `${p.toFixed(1)}%` : 'not measured')
const fmtRate = (r: number | null | undefined) => (r === null || r === undefined || !Number.isFinite(r) ? 'not measured' : `${r.toFixed(1)} tok/s`)
const fmtNum = (x: number | null | undefined, digits = 0) => (x === null || x === undefined || !Number.isFinite(x) ? '–' : x.toFixed(digits))

const startedAt = (r: BenchResults) => Date.parse(r.startedAt) || 0
const latest = (runs: BenchResults[]) => runs.slice().sort((a, b) => startedAt(b) - startedAt(a))[0] as BenchResults | undefined

/** The run the per-fixture rows are read from: the latest single-pass full run, else the latest full run. */
export function primaryRun(runs: BenchResults[]): BenchResults | undefined {
  const full = runs.filter((r) => r.config.suite === 'full')
  return latest(full.filter((r) => r.config.repeat === 1)) ?? latest(full)
}

/** Latest frame summary per quality tier, over every run that drew the scene. */
export function framesByTier(runs: BenchResults[]): Map<string, { run: BenchResults; frames: NonNullable<BenchResults['frames']> }> {
  const out = new Map<string, { run: BenchResults; frames: NonNullable<BenchResults['frames']> }>()
  for (const r of runs.slice().sort((a, b) => startedAt(a) - startedAt(b))) {
    if (r.frames?.phases.generating) out.set(r.frames.quality, { run: r, frames: r.frames })
  }
  return out
}

export interface QualificationExtras {
  /** How the adapter's token ids compare with the golden recorded for this device, when the runner checked. */
  golden?: { status: 'match' | 'mismatch' | 'none' | 'stale'; mismatches: number }
  /** Peak resident memory of Chrome's GPU process, sampled from Node. */
  gpuProcessPeakRssBytes?: number | null
}

/**
 * The go/no-go table for one backend on one machine, from every run kept for
 * it (full, soak, load, frames). Distinct prompts decide validity, so that
 * row reads the first pass of the primary run only.
 */
export function qualify(runs: BenchResults[], extras: QualificationExtras = {}): Row[] {
  const T = THRESHOLDS
  const primary = primaryRun(runs)
  const calls = primary?.calls ?? []
  const firstPass = calls.filter((c) => c.pass === 0)
  const by = (id: string, list: CallRecord[] = calls) => summarize(list.filter((c) => c.fixture === id))
  const rows: Row[] = []
  function unmeasured(id: string, metric: string, go: string, noGo: string, note: string, verdict: Verdict = 'not-measured'): Row {
    return { id, metric, go, noGo, measured: 'not measured', verdict, note }
  }

  // Warm start: load() plus the warm-up turn, over every warm load of every run.
  {
    const go = '60 s p50 or less'
    const noGo = 'over 120 s'
    const warm = runs.flatMap((r) => r.loads.filter((l) => l.kind === 'warm' && l.ok))
    const s = stats(warm.map(readyMs))
    rows.push(
      s
        ? { id: 'warm-start', metric: 'Warm start to ready', go, noGo, measured: `p50 ${fmtMs(s.p50)} (n=${s.n}, max ${fmtMs(s.max)})`, verdict: lowerVerdict(s.p50, T.warmStartMs.go, T.warmStartMs.noGo), note: 'load() plus the warm-up turn' }
        : unmeasured('warm-start', 'Warm start to ready', go, noGo, 'no warm load in these runs'),
    )
  }

  const all = summarize(calls)
  {
    const go = '300 tok/s or more'
    const noGo = 'under 100 tok/s'
    const s = all.prefillTps
    rows.push(
      s
        ? {
            id: 'prefill',
            metric: 'Prefill rate',
            go,
            noGo,
            measured: `p50 ${fmtRate(s.p50)} (n=${s.n}, min ${fmtRate(s.min)})`,
            verdict: higherVerdict(s.p50, T.prefillTps.go, T.prefillTps.noGo),
            note: s.p50 < T.prefillTps.go && s.p50 >= T.prefillTps.noGo ? 'conditional: requires prefix snapshots and contexts of 4K or less' : undefined,
          }
        : unmeasured('prefill', 'Prefill rate', go, noGo, primary ? 'the backend does not time prefill' : 'no full run'),
    )
  }
  {
    const go = '20 tok/s or more'
    const noGo = 'under 10 tok/s'
    const atMedium = runs.filter((r) => r.config.suite !== 'load' && r.frames?.quality === 'medium')
    const s = latest(atMedium) ? summarize(latest(atMedium)!.calls).decodeTps : null
    rows.push(
      s
        ? { id: 'decode', metric: 'Decode rate, scene at medium', go, noGo, measured: `p50 ${fmtRate(s.p50)} (n=${s.n}, min ${fmtRate(s.min)})`, verdict: higherVerdict(s.p50, T.decodeTps.go, T.decodeTps.noGo) }
        : unmeasured('decode', 'Decode rate, scene at medium', go, noGo, all.decodeTps ? `no run with the scene at medium; without it p50 ${fmtRate(all.decodeTps.p50)}` : 'no run with the scene at medium'),
    )
  }
  {
    const go = 'p50 under 10 s, p95 under 20 s'
    const noGo = 'p50 over 20 s'
    const s = by('short-action')
    const w = s.wallMs
    let verdict: Verdict = 'not-measured'
    if (w) verdict = w.p50 > T.shortActionMs.noGoP50 ? 'no-go' : w.p50 < T.shortActionMs.goP50 && w.p95 < T.shortActionMs.goP95 ? 'go' : 'conditional'
    rows.push(w ? { id: 'short-action', metric: 'Short action', go, noGo, measured: `p50 ${fmtMs(w.p50)}, p95 ${fmtMs(w.p95)} (n=${w.n}, ${s.failed} failed)`, verdict } : unmeasured('short-action', 'Short action', go, noGo, 'fixture a did not run'))
  }
  {
    const go = '98% or more, with 90% or more first attempt'
    const noGo = 'under 90%'
    const structured = summarize(firstPass.filter((c) => c.kind === 'structured'))
    if (structured.structured === 0) rows.push(unmeasured('validity', 'Valid after one repair or fewer', go, noGo, 'no structured fixture ran'))
    else {
      const one = oneRepairPct(structured)
      const first = firstAttemptPct(structured)
      const thin = (primary?.fixtures ?? []).filter((f) => f.kind !== 'generate').filter((f) => firstPass.filter((c) => c.fixture === f.id && c.kind === 'structured').length < T.validPct.prompts)
      let verdict: Verdict = one < T.validPct.noGo ? 'no-go' : one >= T.validPct.go && first >= T.validPct.goFirst ? 'go' : 'conditional'
      // Fewer than 50 distinct prompts in a fixture cannot establish a rate; a no-go stands, with its n.
      if (thin.length > 0 && verdict !== 'no-go') verdict = 'insufficient'
      rows.push({
        id: 'validity',
        metric: 'Valid after one repair or fewer',
        go,
        noGo,
        measured: `${fmtPct(one)} after one repair or fewer, ${fmtPct(first)} first attempt (${structured.validWithinOneRepair} and ${structured.firstAttemptValid} of ${structured.structured} distinct prompts)`,
        verdict,
        note: thin.length > 0 ? `fewer than ${T.validPct.prompts} distinct prompts in: ${thin.map((f) => f.id).join(', ')}` : undefined,
      })
    }
  }
  {
    const go = 'p50 60 s or less, 95% valid'
    const section = calls.filter((c) => c.fixture === 'section')
    const s = summarize(section)
    const w = s.wallMs
    if (!w) rows.push(unmeasured('section', 'Section, about 300 words', go, '–', 'fixture d did not run'))
    else {
      const usable = section.filter((c) => c.validWithinOneRepair && c.checkErrors.length === 0).length
      const valid = (usable * 100) / section.length
      rows.push({
        id: 'section',
        metric: 'Section, about 300 words',
        go,
        noGo: '–',
        measured: `p50 ${fmtMs(w.p50)}, ${fmtPct(valid)} valid (${usable} of ${section.length})`,
        verdict: w.p50 <= T.section.goP50Ms && valid >= T.section.goValidPct ? 'go' : 'conditional',
        note: 'valid = the schema after one repair or fewer and the mirrored section checks (shape, length band, plain text)',
      })
    }
  }
  {
    const go = 'p50 8 min or less'
    const noGo = 'over 15 min'
    const a = summarizeArticles(primary?.articles ?? [])
    if (a.articles === 0) rows.push(unmeasured('article', 'Staged article', go, noGo, 'fixture e did not run'))
    else if (!a.wallMs) rows.push({ id: 'article', metric: 'Staged article', go, noGo, measured: `0 of ${a.articles} articles completed`, verdict: 'no-go', note: 'no article reached its review' })
    else
      rows.push({
        id: 'article',
        metric: 'Staged article',
        go,
        noGo,
        measured: `p50 ${fmtMs(a.wallMs.p50)} (${a.completed} of ${a.articles} completed, max ${fmtMs(a.wallMs.max)})`,
        verdict: lowerVerdict(a.wallMs.p50, T.articleMs.go, T.articleMs.noGo),
        note: a.failed > 0 ? `${a.failed} article(s) did not complete and are not in the p50` : undefined,
      })
  }
  {
    const go = 'TTFT 3 s or less, total 8 s or less'
    const s = by('meeting-turn')
    if (!s.wallMs) rows.push(unmeasured('meeting', 'Meeting turn', go, '–', 'fixture f did not run'))
    else {
      const ttft = s.ttftMs
      const ok = ttft !== null && ttft.p50 <= T.meetingMs.goTtft && s.wallMs.p50 <= T.meetingMs.goTotal
      rows.push({
        id: 'meeting',
        metric: 'Meeting turn',
        go,
        noGo: '–',
        measured: `TTFT p50 ${fmtMs(ttft?.p50)} (p95 ${fmtMs(ttft?.p95)}), total p50 ${fmtMs(s.wallMs.p50)} (p95 ${fmtMs(s.wallMs.p95)}), n=${s.wallMs.n}, ${s.failed} failed`,
        verdict: ttft === null ? 'not-measured' : ok ? 'go' : 'conditional',
        note: 'the threshold names no percentile; judged on p50',
      })
    }
  }
  {
    const go = '33 ms or less at the scheduler\'s tier'
    const noGo = 'over 50 ms at low'
    const tiers = framesByTier(runs)
    const own = primary?.frames?.phases.generating ? primary.frames : (latest([...tiers.values()].map((t) => t.run))?.frames ?? null)
    const g = own?.phases.generating
    if (!own || !g) rows.push(unmeasured('frames', 'Frame p95 while generating', go, noGo, 'no run drew the scene while generating'))
    else {
      const low = tiers.get('low')?.frames.phases.generating
      const verdict: Verdict = low && low.p95 > T.frameP95Ms.noGoAtLow ? 'no-go' : g.p95 <= T.frameP95Ms.go ? 'go' : 'conditional'
      const others = [...tiers].filter(([tier]) => tier !== own.quality).map(([tier, t]) => `${tier} ${fmtNum(t.frames.phases.generating?.p95, 1)} ms`)
      rows.push({
        id: 'frames',
        metric: 'Frame p95 while generating',
        go,
        noGo,
        measured: `${fmtNum(g.p95, 1)} ms at ${own.quality} (idle ${fmtNum(own.phases.idle?.p95, 1)} ms, ${g.n} frames)${others.length ? `; ${others.join(', ')}` : ''}`,
        verdict,
        note: `${low ? '' : 'the low tier was not measured, so the no-go threshold was not tested; '}the GPU scheduler has no renderer hook yet, so "its tier" is the tier of the run`,
      })
    }
  }
  {
    const go = '95% or more of 20'
    const noGo = 'under 80%'
    const passes = runs.filter((r) => r.config.suite === 'full').flatMap((r) => r.passes)
    if (passes.length === 0) rows.push(unmeasured('device-loss', 'Full-suite runs without device loss', go, noGo, 'no pass over the suite'))
    else {
      const lost = passes.filter((p) => p.deviceLost).length
      const n = passes.length
      const rate = ((n - lost) * 100) / n
      const need = T.deviceLoss.runs
      let verdict: Verdict
      if (n >= need) verdict = higherVerdict(rate, T.deviceLoss.goPct, T.deviceLoss.noGoPct)
      // With fewer than 20 passes the rate is open, unless the losses so far already rule out 80% of 20.
      else verdict = ((need - lost) * 100) / need < T.deviceLoss.noGoPct ? 'no-go' : 'insufficient'
      rows.push({
        id: 'device-loss',
        metric: 'Full-suite runs without device loss',
        go,
        noGo,
        measured: `${n - lost} of ${n} passes (${fmtPct(rate)})`,
        verdict,
        note: n < need ? `${need} passes are needed; run the soak (BENCH_REPEAT=${need})` : undefined,
      })
    }
  }
  {
    const go = '12 GB or less'
    const peak = maxOf(runs.map(gpuPeakBytes))
    const rss = extras.gpuProcessPeakRssBytes
    const context = primary?.capabilities.loaded?.contextTokens
    rows.push(
      peak !== null
        ? {
            id: 'gpu-memory',
            metric: 'GPU peak at 16K context',
            go,
            noGo: '–',
            measured: `${fmtBytes(peak)}${context ? ` at ${context} tokens of context` : ''}${rss ? `; GPU process RSS peak ${fmtBytes(rss)}` : ''}`,
            verdict: peak <= T.gpuPeakBytes.go ? 'go' : 'conditional',
            note: 'GPU buffer bytes the runtime allocated (runtime.host.memory.peakBytes), not the whole process',
          }
        : unmeasured('gpu-memory', 'GPU peak at 16K context', go, '–', rss ? `the backend does not report GPU bytes; GPU process RSS peak ${fmtBytes(rss)}` : 'the backend does not report GPU bytes'),
    )
  }
  {
    const eq = primary?.equivalence ?? latest(runs.filter((r) => r.equivalence))?.equivalence ?? null
    const applies = runs.some((r) => r.backend === 'bonsai')
    if (!eq) rows.push(unmeasured('equivalence', 'Equivalence mismatches', '0', 'any', applies ? 'the equivalence step did not run' : 'only the Bonsai backend has an upstream to be equivalent to', applies ? 'not-measured' : 'n/a'))
    else {
      const golden = extras.golden
      const bad = eq.mismatches.length + (golden?.status === 'mismatch' ? golden.mismatches : 0)
      rows.push({
        id: 'equivalence',
        metric: 'Equivalence mismatches',
        go: '0',
        noGo: 'any',
        measured: `${eq.mismatches.length} of ${eq.prompts} prompts differ between the adapter and upstream in the worker${golden ? `; recorded golden: ${golden.status}` : ''}`,
        verdict: bad === 0 ? 'go' : 'no-go',
        note: 'the main-thread reference is checked by e2e/bonsai-equivalence.spec.ts; run it too',
      })
    }
  }
  return rows
}

export type Overall = 'go' | 'conditional' | 'no-go' | 'incomplete'

/** One no-go decides; an unmeasured or under-sampled row leaves the decision open. */
export function overallVerdict(rows: Row[]): Overall {
  if (rows.some((r) => r.verdict === 'no-go')) return 'no-go'
  if (rows.some((r) => r.verdict === 'not-measured' || r.verdict === 'insufficient')) return 'incomplete'
  if (rows.some((r) => r.verdict === 'conditional')) return 'conditional'
  return 'go'
}

// ---------------------------------------------------------------- Markdown

const VERDICT_TEXT: Record<Verdict, string> = {
  go: '**go**',
  conditional: '**conditional**',
  'no-go': '**NO-GO**',
  insufficient: 'insufficient data',
  'not-measured': 'not measured',
  'n/a': 'n/a',
}

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ')

function table(header: string[], rows: string[][]): string[] {
  return [`| ${header.join(' | ')} |`, `|${header.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)]
}

const budgetText = (f: FixtureInfo) => {
  const b = f.budget
  return `${b.thinking}${b.reasoningBudget ? ` (cap ${b.reasoningBudget})` : ''}, ${b.maxTokens} out`
}

export interface QualificationInput {
  runs: BenchResults[]
  context: ReportContext
  extras?: QualificationExtras
  /** Files the runs were read from, shown in the report. */
  sources?: string[]
}

/** The qualification report for docs/qualification/: the go/no-go table first, then what it was read from. */
export function qualificationMarkdown(input: QualificationInput): string {
  const { runs, context: ctx } = input
  const rows = qualify(runs, input.extras)
  const overall = overallVerdict(rows)
  const primary = primaryRun(runs) ?? latest(runs)
  const backend = primary?.backend ?? 'unknown'
  const date = ctx.provenance.generatedAt.slice(0, 10)
  const scripted = backend === 'fake'
  const out: string[] = []
  out.push(`# Model qualification: ${primary?.backendLabel ?? backend} on ${ctx.machine.cpuModel}, ${ctx.machine.memoryGb} GB`)
  out.push('')
  out.push(`> **Date:** ${date} · **Verdict:** ${overall.toUpperCase()}`)
  out.push('> Written by `apps/game/src/llm/bench/report.ts` from the raw results listed below. Do not edit the numbers; run the benchmark again (`docs/runbooks/model-qualification.md`).')
  out.push('> Thresholds are the proposals of `docs/design/mvp-runtime.md` section 7 (ADR-0057).')
  if (scripted) out.push('> **This is the scripted backend.** No model ran. The report proves the harness; its timings mean nothing.')
  if (runs.some((r) => !r.complete)) out.push(`> **Incomplete runs:** ${runs.filter((r) => !r.complete).map((r) => `${runLabel(r)} (${r.fatal ?? 'stopped early'})`).join('; ')}`)
  out.push('')

  out.push('## Go / no-go', '')
  out.push(...table(['Metric', 'Go', 'No-go', 'Measured', 'Verdict'], rows.map((r) => [r.metric, r.go, r.noGo, r.measured, VERDICT_TEXT[r.verdict]])))
  const notes = rows.filter((r) => r.note)
  if (notes.length) {
    out.push('')
    for (const r of notes) out.push(`- **${r.metric}:** ${r.note}`)
  }
  out.push('')
  out.push('How to read it: one **NO-GO** row decides against this backend on this machine. A row that is not measured or has too little data leaves the decision open (INCOMPLETE). **Conditional** rows miss the go threshold without reaching the no-go one. On a no-go, take the next step of the fallback ladder (`docs/design/mvp-runtime.md` section 7) and run again.', '')

  out.push('## Environment', '')
  const device = (primary?.capabilities.loaded?.device ?? primary?.capabilities.probe?.device ?? {}) as Record<string, unknown>
  const pins = primary?.model
  const envRows: string[][] = [
    ['Machine', `${ctx.machine.cpuModel}, ${ctx.machine.memoryGb} GB, ${ctx.machine.os}${ctx.machine.osVersion ? ` ${ctx.machine.osVersion}` : ''} ${ctx.machine.arch}, ${ctx.machine.cpus} cores`],
    ['Browser', `${primary?.env.browser ?? 'unknown'}; cross-origin isolated: ${primary?.env.crossOriginIsolated ? 'yes' : 'no'}`],
    ['Backend', `${primary?.backendLabel ?? backend} (\`${backend}\`)`],
    ['Model', pins ? `${pins.repo} \`${pins.file}\` at ${pins.revision.slice(0, 12)}, sha256 ${pins.sha256.slice(0, 12)}…, ${fmtBytes(pins.bytes)}` : (primary?.modelId ?? 'chosen by the backend')],
    ['Engine', pins ? `sha256 ${pins.engineSha256.slice(0, 12)}…` : 'not pinned by this repository'],
    ['Context', `${primary?.capabilities.loaded?.contextTokens ?? 'not reported'} tokens`],
    ['Model GPU device', Object.keys(device).length ? `\`${JSON.stringify(device)}\`` : 'not reported'],
    ['Commit', `${ctx.provenance.commit ?? 'unknown'}${ctx.provenance.dirty ? ' (dirty tree)' : ''}${ctx.provenance.branch ? ` on ${ctx.provenance.branch}` : ''}`],
  ]
  out.push(...table(['', ''], envRows), '')
  out.push(
    ...table(
      ['Run', 'Started', 'Start', 'Scene', 'Scale', 'Passes', 'Calls', 'Complete'],
      runs
        .slice()
        .sort((a, b) => startedAt(a) - startedAt(b))
        .map((r) => [
          runLabel(r),
          r.startedAt,
          `${r.loads[0]?.kind ?? 'unknown'}${r.start.declared !== 'unknown' && r.start.inferred !== 'unknown' && r.start.declared !== r.start.inferred ? ` (declared ${r.start.declared}, the cache says ${r.start.inferred})` : ''}`,
          r.frames ? `${r.frames.quality} (${r.frames.renderer})` : 'off',
          String(r.config.scale),
          String(r.passes.length),
          String(r.calls.length),
          r.complete ? 'yes' : `no: ${r.fatal ?? 'stopped early'}`,
        ]),
    ),
    '',
  )
  if (input.sources?.length) out.push(`Raw results: ${input.sources.map((s) => `\`${s}\``).join(', ')} (git-ignored).`, '')

  out.push('## Load stages', '')
  const loadRows: string[][] = []
  for (const kind of ['cold', 'warm', 'unknown'] as const) {
    const loads = runs.flatMap((r) => r.loads.filter((l) => l.kind === kind && l.ok))
    if (loads.length === 0) continue
    const p50 = (values: number[]) => fmtMs(stats(values)?.p50)
    const bytes = loads.map((l) => l.stages.find((s) => s.stage === 'weights')).find((s) => s?.bytesTotal)
    loadRows.push([
      kind,
      String(loads.length),
      p50(loads.map((l) => loadStage(l, 'verify'))),
      `${p50(loads.map((l) => loadStage(l, 'weights')))}${bytes ? ` (${fmtBytes(bytes.bytesLoaded)} of ${fmtBytes(bytes.bytesTotal)})` : ''}`,
      p50(loads.map((l) => loadStage(l, 'init'))),
      p50(loads.map((l) => l.loadMs)),
      p50(loads.map((l) => l.warmupMs ?? NaN)),
      p50(loads.map(readyMs)),
    ])
  }
  if (loadRows.length) out.push(...table(['Start', 'n', 'Verify', 'Weights', 'GPU init', 'load() total', 'Warm-up turn', 'Ready'], loadRows))
  else out.push('No load completed.')
  const failedLoads = runs.flatMap((r) => r.loads.filter((l) => !l.ok))
  if (failedLoads.length) out.push('', ...failedLoads.map((l) => `- Failed ${l.kind} load: ${l.error ?? 'unknown error'}`))
  out.push('', 'Times are p50 over the loads of that kind. Verify is the time before the first progress event (the engine fetch and hash checks for Bonsai). Weights is download on a cold start and the read from the browser cache on a warm one.', '')

  if (primary && primary.calls.length > 0) {
    out.push('## Fixtures', '')
    const summaries = summarizeByFixture(primary.calls)
    const fx = primary.fixtures
    out.push(
      ...table(
        ['Fixture', 'Reasoning, budget', 'Calls', 'Failed', 'Wall p50', 'Wall p95', 'TTFT p50', 'Prefill p50', 'Decode p50', 'Reasoning tok p50', 'First attempt', 'One repair or fewer', 'Extra turns', 'Cut off', 'Checks failed', 'Prompt tok est. / counted'],
        [...summaries].map(([id, s]) => {
          const f = fx.find((x) => x.id === id)
          return [
            `${f?.letter ?? '?'} ${id}`,
            f ? (f.kind === 'staged' ? 'per stage' : budgetText(f)) : '–',
            String(s.calls),
            String(s.failed),
            fmtMs(s.wallMs?.p50),
            fmtMs(s.wallMs?.p95),
            fmtMs(s.ttftMs?.p50),
            fmtRate(s.prefillTps?.p50),
            fmtRate(s.decodeTps?.p50),
            fmtNum(s.reasoningTokens?.p50),
            s.structured ? fmtPct(firstAttemptPct(s)) : '–',
            s.structured ? fmtPct(oneRepairPct(s)) : '–',
            String(s.extraTurns),
            String(s.truncations),
            String(s.checkFailed),
            `${fmtNum(s.estimatedPromptTokens?.p50)} / ${fmtNum(s.promptTokens?.p50)}`,
          ]
        }),
      ),
      '',
    )
    out.push('Wall time covers the whole call, repair turns included, and counts failed calls too. Rates are per generation; a prefill rate needs at least 64 uncached prompt tokens and a decode rate at least 16 generated tokens.', '')

    if (primary.articles.length > 0) {
      const a = summarizeArticles(primary.articles)
      out.push('### Staged articles', '')
      out.push(`${a.completed} of ${a.articles} completed. Wall p50 ${fmtMs(a.wallMs?.p50)}, max ${fmtMs(a.wallMs?.max)}; words p50 ${fmtNum(a.words?.p50)}.`)
      if (a.failed > 0) out.push(`Failed at: ${Object.entries(a.failedStages).map(([stage, n]) => `${stage} (${n})`).join(', ')}.`)
      const stages = new Map<string, CallRecord[]>()
      for (const c of primary.calls) {
        if (c.fixture !== 'staged-article' || !c.stage) continue
        const name = c.stage.startsWith('section') ? 'section' : c.stage
        stages.set(name, [...(stages.get(name) ?? []), c])
      }
      out.push('', ...table(['Stage', 'Calls', 'Failed', 'Wall p50', 'Wall p95', 'First attempt', 'Checks failed'], [...stages].map(([name, list]) => {
        const s = summarize(list)
        return [name, String(s.calls), String(s.failed), fmtMs(s.wallMs?.p50), fmtMs(s.wallMs?.p95), fmtPct(firstAttemptPct(s)), String(s.checkFailed)]
      })), '')
    }

    const failures = [...summaries].filter(([, s]) => s.failed > 0)
    out.push('### Failures', '')
    if (failures.length === 0) out.push('No call failed.', '')
    else {
      for (const [id, s] of failures) {
        out.push(`- **${id}:** ${s.failed} of ${s.calls}`)
        for (const g of s.failures) out.push(`  - ${g.count} × ${g.message} (${g.keys.join(', ')})`)
      }
      out.push('')
    }
    const checks = primary.calls.filter((c) => c.ok && c.checkErrors.length > 0)
    if (checks.length > 0) {
      out.push('### Answers that failed a deterministic check', '')
      for (const c of checks.slice(0, 30)) out.push(`- \`${c.key}\`: ${c.checkErrors.slice(0, 2).join('; ')}`)
      if (checks.length > 30) out.push(`- and ${checks.length - 30} more`)
      out.push('')
    }
  }

  out.push('## Frame times', '')
  const frameRuns = runs.filter((r) => r.frames && Object.keys(r.frames.phases).length > 0)
  if (frameRuns.length === 0) out.push('The scene was not drawn in these runs.', '')
  else {
    const fr: string[][] = []
    for (const r of frameRuns) {
      for (const phase of ['idle-unloaded', 'loading', 'idle', 'generating'] as const) {
        const s = r.frames!.phases[phase]
        if (s) fr.push([runLabel(r), r.frames!.quality, r.frames!.renderer, phase, String(s.n), fmtNum(s.p50, 1), fmtNum(s.p95, 1), fmtNum(s.max, 1)])
      }
    }
    out.push(...table(['Run', 'Tier', 'Renderer', 'Model is', 'Frames', 'p50 ms', 'p95 ms', 'Max ms'], fr), '')
    const hidden = frameRuns.filter((r) => r.frames!.hiddenMs > 0)
    if (hidden.length) out.push(`The tab was hidden for ${hidden.map((r) => `${fmtMs(r.frames!.hiddenMs)} (${runLabel(r)})`).join(', ')}; frames do not run then and those gaps are left out.`, '')
    out.push('The scene alone, without the HUD and the overlay. Intervals are between rendered frames, so the display refresh rate is the floor.', '')
  }

  out.push('## Memory', '')
  const mem = runs.flatMap((r) => r.memory.map((m) => ({ run: runLabel(r), ...m })))
  if (mem.length === 0) out.push('No sample.', '')
  else {
    out.push(...table(['Run', 'When', 'GPU live', 'GPU peak', 'Page and workers (measureUserAgentSpecificMemory)'], mem.map((m) => [m.run, m.label, fmtBytes(m.gpuLiveBytes), fmtBytes(m.gpuPeakBytes), m.uaBytes === null ? 'not measured' : `${fmtBytes(m.uaBytes)}${m.uaWorkerBytes ? ` (workers ${fmtBytes(m.uaWorkerBytes)})` : ''}`])), '')
    if (input.extras?.gpuProcessPeakRssBytes) out.push(`Chrome's GPU process, resident memory peak sampled from outside the browser: ${fmtBytes(input.extras.gpuProcessPeakRssBytes)}.`, '')
  }

  out.push('## Device loss', '')
  const losses = runs.filter((r) => r.deviceLoss)
  if (losses.length === 0) out.push('The device-loss step did not run.', '')
  else {
    for (const r of losses) {
      const l = r.deviceLoss!
      out.push(
        l.observed
          ? `- ${runLabel(r)} (${l.mode}): the call in flight ${l.inFlightFailed ? 'failed, as it should' : 'did not fail'}; reload ${fmtMs(l.reloadMs)}, first turn ${fmtMs(l.firstTurnMs)}, recovered ${fmtMs(l.recoveryMs)} after the loss${l.detectMs !== null ? ` (the page knew after ${fmtMs(l.detectMs)})` : ''}${l.error ? `; error: ${l.error}` : ''}.`
          : `- ${runLabel(r)} (${l.mode}): no loss was observed${l.error ? ` (${l.error})` : ''}.`,
      )
    }
    out.push('')
  }
  const events = runs.flatMap((r) => r.events.map((e) => ({ run: runLabel(r), ...e })))
  if (events.length > 0) {
    out.push('### Runtime events', '')
    for (const e of events.slice(0, 40)) out.push(`- ${e.run} at ${fmtMs(e.atMs)}: ${e.kind}: ${e.message}`)
    if (events.length > 40) out.push(`- and ${events.length - 40} more`)
    out.push('')
  }

  out.push('## What this report does not establish', '')
  out.push('- Prompt sizes are set with an estimate of four characters per token; the table above shows the estimate next to what the tokenizer counted.')
  out.push('- The section checks are a mirror of the Rust checks without banned phrases, near-duplicates and markup stripping. The schemas are the Rust ones.')
  out.push('- Whether the text is good. This measures speed, validity and stability; the eval harness (track E of `docs/mvp.md`) reads the articles.')
  if (backend !== 'bonsai') out.push('- Upstream equivalence and GPU bytes exist only for the Bonsai backend.')
  out.push('')
  return `${out.join('\n')}`
}
