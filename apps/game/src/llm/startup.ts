/**
 * Starting a local model backend (docs/reference/browser-agent-studio.md §22,
 * ADR-0057, increment R8): what happens between "the company opens" and "the
 * clock may run".
 *
 *   explain   the first time on this browser: what runs where, and how much is downloaded
 *   probe     the backend's own probe, then WebGPU features and the limits the model needs
 *   storage   navigator.storage: room for what is not cached yet; persistence requested
 *   verify    the pinned engine and the weights' pinned hash (until the first byte arrives)
 *   download  the weights, with byte progress (from the network, or the browser's cache)
 *   load      upload to the GPU, compile the kernels
 *   warm-up   one short generation
 *   qualify   one small structured action that must validate
 *
 * Only then is the model ready. A failed probe is `blocked`: the backend
 * cannot run here, and no other backend is tried (ADR-0057 decision 7). Any
 * other failure stops the startup with the stage and the reason; nothing is
 * retried behind the player's back.
 *
 * Pure orchestration: every browser API comes in through `StartupDeps`, so the
 * sequence is unit-tested with fakes (startup.test.ts).
 */
import { BACKENDS, BackendUnavailableError, type BackendId, type OpenedBackend } from './backend'
import { StructuredOutputError } from './structured'
import type { ChatMessage, JsonSchema, LoadProgress, RuntimeCapabilities, Validator } from './types'

export type StartupStageId = 'explain' | 'probe' | 'storage' | 'verify' | 'download' | 'load' | 'warm-up' | 'qualify'
export type StartupStageState = 'pending' | 'active' | 'done' | 'skipped' | 'failed'

export const STARTUP_STAGES: readonly { id: StartupStageId; label: string }[] = [
  { id: 'explain', label: 'About the local model' },
  { id: 'probe', label: 'Check WebGPU' },
  { id: 'storage', label: 'Check storage' },
  { id: 'verify', label: 'Verify the runtime and the weights' },
  { id: 'download', label: 'Download the weights' },
  { id: 'load', label: 'Load onto the GPU' },
  { id: 'warm-up', label: 'Warm-up' },
  { id: 'qualify', label: 'Qualification turn' },
]

export const stageLabel = (id: StartupStageId) => STARTUP_STAGES.find((s) => s.id === id)?.label ?? id

export interface StartupEvent {
  stage: StartupStageId
  state: StartupStageState
  /** One line for the card and the HUD chip ("downloading 36% (2.1 GB of 5.9 GB)"). */
  detail?: string
}

/** `blocked`: the backend cannot run on this device. `declined`: the player did not start it. `failed`: a stage failed. */
export type StartupFailure = 'blocked' | 'declined' | 'failed'

export class StartupError extends Error {
  readonly stage: StartupStageId
  readonly kind: StartupFailure
  constructor(stage: StartupStageId, kind: StartupFailure, message: string) {
    super(message)
    this.name = 'StartupError'
    this.stage = stage
    this.kind = kind
  }
}

// ---------------------------------------------------------------- formatting

/** Decimal units, as the model card and the Hub state sizes ("5.9 GB"). */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return 'unknown'
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`
  if (n >= 1e3) return `${Math.round(n / 1e3)} kB`
  return `${n} B`
}

/** What the player is told before anything is downloaded. */
export function explainText(backend: BackendId, sizeBytes: number | null): string {
  const info = BACKENDS[backend]
  if (info.runsIn === 'server') {
    return (
      `Your staff think with ${info.label}, a model OpenAI runs. For each job the game server sends it what the job needs: the brief, the drafts, ` +
      `the site's knowledge and the meeting so far. The key and the company's daily budget stay on the server; nothing is downloaded to this computer. ` +
      `Nothing is published without your approval.`
    )
  }
  const where = 'Your staff think with a language model that runs here, in this browser, on this computer. No brief, draft or prompt is sent to an inference service.'
  if (info.runsIn === 'window') {
    return `${where} ${info.label}: Chrome downloads, stores and updates its own model; its size and version are Chrome's to choose. Starting it the first time may need this click.`
  }
  const size = sizeBytes ? `about ${formatBytes(sizeBytes)}` : 'a large file'
  return (
    `${where} ${info.label} is ${size}. It is downloaded once from the Hugging Face Hub, pinned to one revision and checked against its published hash, ` +
    `and kept in this browser's storage. Each time the page opens it is loaded onto the GPU again, which takes a while; the office stays open meanwhile and the game clock waits for the model.`
  )
}

// ---------------------------------------------------------------- GPU

export interface GpuRequirements {
  minMaxBufferSize: number
  minStorageBufferBindingSize: number
  features: string[]
}

export interface GpuFacts {
  features: string[]
  maxBufferSize: number | null
  maxStorageBufferBindingSize: number | null
}

/** The adapter's features and limits as a backend's probe reports them (BonsaiLlm puts them in `device`). */
export function gpuFactsOf(caps: RuntimeCapabilities): GpuFacts | null {
  const d = caps.device as { features?: unknown; maxBufferSize?: unknown; maxStorageBufferBindingSize?: unknown } | undefined
  if (!d || !Array.isArray(d.features)) return null
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  return { features: d.features.filter((f): f is string => typeof f === 'string'), maxBufferSize: num(d.maxBufferSize), maxStorageBufferBindingSize: num(d.maxStorageBufferBindingSize) }
}

/** Why this GPU cannot run the model, or null when it meets the requirements (unknown limits are not held against it). */
export function gpuShortfall(facts: GpuFacts, need: GpuRequirements): string | null {
  const missing = need.features.filter((f) => !facts.features.includes(f))
  if (missing.length) return `this GPU does not offer the WebGPU feature${missing.length > 1 ? 's' : ''} ${missing.join(', ')} the model needs`
  if (facts.maxBufferSize !== null && facts.maxBufferSize < need.minMaxBufferSize) {
    return `this GPU allows buffers of ${formatBytes(facts.maxBufferSize)}; the model needs ${formatBytes(need.minMaxBufferSize)}`
  }
  if (facts.maxStorageBufferBindingSize !== null && facts.maxStorageBufferBindingSize < need.minStorageBufferBindingSize) {
    return `this GPU binds storage buffers of ${formatBytes(facts.maxStorageBufferBindingSize)}; the model needs ${formatBytes(need.minStorageBufferBindingSize)}`
  }
  return null
}

// ---------------------------------------------------------------- storage

/** The part of `navigator.storage` the startup uses. */
export interface StorageLike {
  estimate(): Promise<{ quota?: number; usage?: number }>
  persisted?(): Promise<boolean>
  persist?(): Promise<boolean>
}

export interface StorageReport {
  quota: number | null
  usage: number | null
  /** quota − usage; null when the browser does not say. */
  free: number | null
  /** Bytes still to download: the model's size less what the browser has cached. */
  needed: number
  cached: number
  /** The origin's storage is persistent (not evicted under pressure); null when the browser cannot say. */
  persistent: boolean | null
}

export function storageDetail(r: StorageReport): string {
  const parts = [r.free !== null ? `${formatBytes(r.free)} free` : 'free space not reported', `${formatBytes(r.needed)} to download`]
  if (r.cached > 0) parts.push(`${formatBytes(r.cached)} cached`)
  parts.push(r.persistent === true ? 'persistent' : r.persistent === false ? 'not persistent: the browser may evict the model when space runs low' : 'persistence unknown')
  return parts.join(' · ')
}

/** Measures, requests persistence, and refuses when the download cannot fit. */
export async function checkStorage(storage: StorageLike | null | undefined, sizeBytes: number, cachedBytes: number): Promise<StorageReport> {
  const cached = Math.max(0, Math.min(sizeBytes, cachedBytes))
  const needed = Math.max(0, sizeBytes - cached)
  if (!storage) return { quota: null, usage: null, free: null, needed, cached, persistent: null }
  const est = await storage.estimate().catch(() => ({}) as { quota?: number; usage?: number })
  const quota = typeof est.quota === 'number' ? est.quota : null
  const usage = typeof est.usage === 'number' ? est.usage : null
  const free = quota !== null ? Math.max(0, quota - (usage ?? 0)) : null
  let persistent: boolean | null = null
  try {
    persistent = (await storage.persisted?.()) ?? null
    if (persistent === false && storage.persist) persistent = await storage.persist()
  } catch {
    persistent = null
  }
  const report = { quota, usage, free, needed, cached, persistent }
  if (free !== null && free < needed) {
    throw new StartupError('storage', 'failed', `not enough browser storage for the model: ${formatBytes(free)} free, ${formatBytes(needed)} needed. Free some space (or remove other sites' data) and try again.`)
  }
  return report
}

// ---------------------------------------------------------------- warm-up and qualification

const STANDUP_SYSTEM =
  'You run the morning standup of a small travel magazine about the Cinque Terre. Keep every answer short. When asked for JSON, answer with one JSON object and nothing else.'

export const WARMUP_MESSAGES: ChatMessage[] = [
  { role: 'system', content: STANDUP_SYSTEM },
  { role: 'user', content: 'Good morning. Reply with one word.' },
]

/** One small structured action of the kind the moderator takes in every standup. */
export const QUALIFY_MESSAGES: ChatMessage[] = [
  { role: 'system', content: STANDUP_SYSTEM },
  {
    role: 'user',
    content:
      'Giulia (writer) has a draft about harvest week in Manarola ready, Marco (editor) has nothing to report, Sofia (photographer) is still out on the trail. ' +
      'Who speaks next? Answer {"next": "giulia" | "marco" | "sofia", "reason": "<one short sentence>"}.',
  },
]

export const QUALIFY_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['next', 'reason'],
  properties: {
    next: { type: 'string', enum: ['giulia', 'marco', 'sofia'] },
    reason: { type: 'string', minLength: 1, maxLength: 200 },
  },
}

// ---------------------------------------------------------------- the sequence

export interface StartupDeps {
  backend: BackendId
  modelId: string
  /** Bytes the model downloads; null when the backend does not say (Chrome). */
  sizeBytes: number | null
  /** Construct and probe the adapter (backend.ts `openBackend`); it throws `BackendUnavailableError` when it cannot run. */
  open(): Promise<OpenedBackend>
  /** A reload of an adapter that was opened before (after a device loss): explain, probe and storage are not repeated. */
  reuse?: OpenedBackend | null
  requirements?: GpuRequirements | null
  /** The GPU's features and limits when the probe's capabilities do not carry them. */
  gpuFacts?(): Promise<GpuFacts | null>
  storage?: StorageLike | null
  /** Bytes of this model already in the browser's cache, when that can be told. */
  cachedBytes?(): Promise<number | null>
  /** Shows the explanation and resolves true to go on, false when the player does not start the model now. */
  explain(text: string): Promise<boolean>
  /** The player accepted the explanation on this browser before. */
  explained: { get(): boolean; set(): void }
  /** The validator the game's repair loop uses (the Rust one); default: structured.ts' own. */
  validate?: Validator
  onEvent(e: StartupEvent): void
  /** The adapter, as soon as it is open (the runtime watches its events from then on). */
  onOpened?(o: OpenedBackend): void
  now?(): number
}

export interface StartupResult {
  opened: OpenedBackend
  /** The adapter's capabilities once the model is loaded. */
  capabilities: RuntimeCapabilities
  storage: StorageReport | null
  /** Where the weights came from on this load: the browser cache (true), the network (false), or unknown. */
  fromCache: boolean | null
  /** Milliseconds per stage that ran. */
  ms: Partial<Record<StartupStageId, number>>
}

/** "downloading 36% (2.1 GB of 5.9 GB)", "reading the browser cache 50% (…)", or a bare percentage when there are no bytes (Chrome). */
export function downloadDetail(p: LoadProgress): string {
  const verb = p.fromCache ? 'reading the browser cache' : 'downloading'
  const pct = `${Math.floor(Math.max(0, Math.min(1, p.fraction)) * 100)}%`
  return p.total > 1 ? `${verb} ${pct} (${formatBytes(p.loaded)} of ${formatBytes(p.total)})` : `${verb} ${pct}`
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

export async function runStartup(d: StartupDeps): Promise<StartupResult> {
  const now = d.now ?? (() => performance.now())
  const ms: StartupResult['ms'] = {}
  const started = new Map<StartupStageId, number>()
  const emit = (stage: StartupStageId, state: StartupStageState, detail?: string) => {
    if (state === 'active' && !started.has(stage)) started.set(stage, now())
    if (state === 'done' || state === 'failed') {
      const t = started.get(stage)
      if (t !== undefined) ms[stage] = now() - t
    }
    d.onEvent(detail === undefined ? { stage, state } : { stage, state, detail })
  }
  /** Runs one stage; a failure is reported on it and rethrown as a `StartupError`. */
  const stage = async <T>(id: StartupStageId, fn: () => Promise<T>, failure: StartupFailure = 'failed', detail?: string): Promise<T> => {
    emit(id, 'active', detail)
    try {
      return await fn()
    } catch (e) {
      const err = e instanceof StartupError ? e : new StartupError(id, failure, errorText(e))
      emit(err.stage, 'failed', err.message)
      throw err
    }
  }

  let opened: OpenedBackend
  let storage: StorageReport | null = null
  if (d.reuse) {
    opened = d.reuse
    for (const id of ['explain', 'probe', 'storage'] as const) emit(id, 'skipped', 'checked when the model first started')
  } else {
    // 1. Explain: once per backend on this browser.
    if (d.explained.get()) emit('explain', 'skipped', 'explained before')
    else {
      const go = await stage('explain', () => d.explain(explainText(d.backend, d.sizeBytes)))
      if (!go) {
        const err = new StartupError('explain', 'declined', 'the local model was not started')
        emit('explain', 'failed', err.message)
        throw err
      }
      d.explained.set()
      emit('explain', 'done')
    }

    // 2. Probe: the backend's own, then the GPU against the model's needs. A failure blocks; nothing else is tried.
    opened = await stage(
      'probe',
      async () => {
        let o: OpenedBackend
        try {
          o = await d.open()
        } catch (e) {
          throw new StartupError('probe', 'blocked', e instanceof BackendUnavailableError ? e.message : `${BACKENDS[d.backend].label} cannot be used here: ${errorText(e)}`)
        }
        if (d.requirements) {
          const facts = gpuFactsOf(o.capabilities) ?? (await d.gpuFacts?.()) ?? null
          if (!facts) {
            await o.llm.dispose().catch(() => undefined)
            throw new StartupError('probe', 'blocked', `${BACKENDS[d.backend].label} cannot be used here: no WebGPU adapter could be inspected`)
          }
          const short = gpuShortfall(facts, d.requirements)
          if (short) {
            await o.llm.dispose().catch(() => undefined)
            throw new StartupError('probe', 'blocked', `${BACKENDS[d.backend].label} cannot be used here: ${short}`)
          }
        }
        return o
      },
      'blocked',
    )
    emit('probe', 'done', opened.capabilities.webgpu ? 'WebGPU ready' : opened.capabilities.label)
    d.onOpened?.(opened)

    // 3. Storage: browser-managed models (Chrome) keep their own.
    const runsIn = BACKENDS[d.backend].runsIn
    if (runsIn === 'window' || runsIn === 'server' || !d.sizeBytes) {
      emit(
        'storage',
        'skipped',
        runsIn === 'window' ? 'Chrome manages its own model storage' : runsIn === 'server' ? 'the model runs on the server' : 'the backend does not say how large the model is',
      )
    } else {
      const size = d.sizeBytes
      storage = await stage('storage', async () => checkStorage(d.storage, size, (await d.cachedBytes?.().catch(() => null)) ?? 0))
      emit('storage', 'done', storageDetail(storage))
    }
  }
  // 4–6. Verify, download, load: one `load()`, its stages told apart by the progress events.
  const llm = opened.llm
  let phase: 'verify' | 'download' | 'load' = 'verify'
  let fromCache: boolean | null = null
  let lastDetail = ''
  const toDownload = () => {
    emit('verify', 'done')
    emit('download', 'active')
    phase = 'download'
  }
  const toLoad = (message?: string) => {
    if (phase === 'verify') {
      emit('verify', 'done')
      emit('download', 'skipped', 'nothing to download')
    } else emit('download', 'done', fromCache === true ? 'read from the browser cache' : fromCache === false ? 'downloaded' : undefined)
    emit('load', 'active', message)
    phase = 'load'
  }
  const onProgress = (p: LoadProgress) => {
    // Before the first byte: what the runtime says it is doing (requesting the device, the tokenizer).
    if (p.phase === 'download' && phase === 'verify' && p.loaded === 0 && p.fromCache === undefined) {
      if (p.message && p.message !== lastDetail) {
        lastDetail = p.message
        emit('verify', 'active', p.message)
      }
      return
    }
    if (p.phase === 'download' && phase === 'verify') toDownload()
    if (p.phase === 'download' && phase === 'download') {
      if (typeof p.fromCache === 'boolean') fromCache = fromCache === null ? p.fromCache : fromCache && p.fromCache
      const detail = downloadDetail(p)
      if (detail !== lastDetail) {
        lastDetail = detail
        emit('download', 'active', detail)
      }
    }
    if (p.phase === 'init' && phase !== 'load') toLoad(p.message)
    else if (p.phase === 'init' && p.message && p.message !== lastDetail) {
      lastDetail = p.message
      emit('load', 'active', p.message)
    }
  }
  // `phase` changes inside the progress callback; read it through a function so it is not narrowed here.
  const current = (): StartupStageId => phase
  emit('verify', 'active')
  try {
    await llm.load(d.modelId, onProgress)
  } catch (e) {
    const err = new StartupError(current(), 'failed', errorText(e))
    emit(err.stage, 'failed', err.message)
    throw err
  }
  if (current() !== 'load') toLoad()
  emit('load', 'done')

  // 7. Warm-up: one short generation compiles what is left and fills the caches.
  await stage('warm-up', async () => {
    const r = await llm.generate(WARMUP_MESSAGES, { maxTokens: 8, thinking: 'off', temperature: 0 })
    if (r.finishReason === 'error' || r.finishReason === 'cancelled') throw new Error(`the warm-up turn ended with "${r.finishReason}"`)
  })
  emit('warm-up', 'done')

  // 8. Qualification: one structured action that must validate, with the game's own validator.
  const answer = await stage('qualify', async () => {
    try {
      return await llm.structured<{ next: string; reason: string }>(QUALIFY_MESSAGES, QUALIFY_SCHEMA, {
        maxTokens: 96,
        thinking: 'off',
        answerPrefix: '{',
        stopOnJsonEnd: true,
        maxRepairs: 1,
        ...(d.validate ? { validate: d.validate } : {}),
      })
    } catch (e) {
      if (e instanceof StructuredOutputError) throw new Error(`the model did not produce a valid action: ${e.errors.slice(0, 3).join('; ') || e.message}`)
      throw e
    }
  })
  emit('qualify', 'done', `a valid action (${answer.next} speaks next)`)

  const capabilities = (await llm.capabilities?.().catch(() => null)) ?? opened.capabilities
  return { opened, capabilities, storage, fromCache, ms }
}
