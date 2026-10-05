/**
 * The session's local model (ADR-0057, increment R8 of track R): which
 * backend a company session runs on, how it starts, who in this origin holds
 * it, what happens when its GPU device is lost, and how it shares the GPU
 * with the office scene.
 *
 *   backend   `?llm=` wins, else the company's stored choice, else the default
 *             (backend.ts). A backend that cannot run here blocks with a notice;
 *             no other backend is opened in its place.
 *   lock      one resident model per origin (leader.ts `electResident`): a second
 *             tab does not load a second model; it says so and offers to take over.
 *   startup   llm/startup.ts: explain → probe → storage → verify → download →
 *             load → warm-up → qualification turn. Only then is the model ready,
 *             which releases the clock's hold (`ModelStatus`).
 *   calls     the orchestrator's calls wait until the model is ready. A call the
 *             model loses (device lost, model taken to another tab) is discarded
 *             and runs again once the model is back: nothing uncommitted is kept.
 *   loss      device lost → status `lost` (the clock holds) → the player reloads
 *             the model; the hung generation does not block the reload.
 *   GPU       the `GpuScheduler` lowers the scene while a call generates
 *             (`attachRenderer`, render/quality.ts).
 *
 * `?llm=fake` is the scripted MVP model: ready at once, nothing loaded, no lock.
 * Every browser API comes in through `ModelRuntimeOptions`, so the whole of it
 * is unit-tested with fakes (model-runtime.test.ts).
 */
import { BACKENDS, chooseBackend, openBackend, storeBackend, type BackendChoice, type BackendChoiceStore, type BackendFactories, type BackendId, type OpenedBackend } from '../llm/backend'
import { GpuScheduler, type RendererHooks } from '../llm/gpu-scheduler'
import { electResident, type LeaderHandle } from '../llm/leader'
import type { RuntimeEventKind } from '../llm/protocol'
import { findModel, type ModelRegistry } from '../llm/registry'
import { DEFAULT_REGISTRY } from '../llm/registry.default'
import { bonsaiManifest } from '../llm/runtime/bonsai/manifest'
import {
  runStartup,
  stageLabel,
  STARTUP_STAGES,
  StartupError,
  type GpuFacts,
  type GpuRequirements,
  type StartupStageId,
  type StartupStageState,
  type StorageLike,
  type StorageReport,
} from '../llm/startup'
import { streamFromGenerate } from '../llm/structured'
import {
  isUnavailableError,
  LlmUnavailableError,
  type ChatMessage,
  type GenerateOptions,
  type GenerateResult,
  type JsonSchema,
  type LocalLlm,
  type ResearchResult,
  type RuntimeCapabilities,
  type StructuredOptions,
  type Validator,
} from '../llm/types'
import type { HostedLlmOptions } from '../llm/hosted-llm'
import { fakeMvpLlm } from '../orchestrator'
import type { ModelStatus } from './clock-driver'

/**
 * Where the runtime is. `scripted`: `?llm=fake`. `read-only`: this session does
 * not run the company, so no model is loaded. `blocked`: the backend cannot run
 * here. `elsewhere`: another tab of this origin holds the model. `explain`: the
 * first-time explanation waits for the player. `declined`: the player did not
 * start the model. `starting`/`ready`. `lost`: the GPU device was lost.
 * `failed`: a startup stage failed.
 */
export type RuntimePhase = 'scripted' | 'read-only' | 'blocked' | 'elsewhere' | 'explain' | 'declined' | 'starting' | 'ready' | 'lost' | 'failed'

export interface StageView {
  state: StartupStageState
  detail: string | null
}

export interface ModelRuntimeInfo {
  backend: BackendId | null
  label: string | null
  source: BackendChoice['source'] | null
  phase: RuntimePhase
  /** The stage in progress (or the one that failed). */
  stage: StartupStageId | null
  stages: Record<StartupStageId, StageView>
  /** Why the runtime is blocked, failed or lost. */
  error: string | null
  /** The explanation shown while `phase` is `explain`. */
  explain: string | null
  /** Another tab holds the model and this one may take it over. */
  canTakeOver: boolean
  /** Other local backends the player may switch this company to (only offered when this one is blocked). */
  alternatives: BackendId[]
  storage: StorageReport | null
  /** Where this load's weights came from: the browser cache (true), the network (false), unknown (null). */
  fromCache: boolean | null
  /** Successful loads (a reload after a loss counts). */
  loads: number
  /** Device losses seen. */
  losses: number
  /** Calls discarded because the model was lost while they ran (each ran again). */
  discarded: number
  /** Milliseconds of each stage of the last startup. */
  ms: Partial<Record<StartupStageId, number>>
}

/** The parts of the browser the runtime uses, all replaceable in tests. */
export interface ModelRuntimeOptions {
  search: string
  companyId: string
  /** The company store's kv (the stored backend choice). */
  store: BackendChoiceStore
  /** This session does not run the company: nothing is loaded. */
  readOnly?: boolean
  /** How each backend's adapter is made; `onEvent` carries the worker's device-loss events. */
  factories?: (events: { onEvent(e: { kind: RuntimeEventKind; message: string }): void }) => BackendFactories
  /** The origin-wide resident lock (default `electResident()`); null: no lock (tests of one tab). */
  lock?: (() => LeaderHandle) | null
  storage?: StorageLike | null
  /** Bytes of the backend's model already cached in this browser. */
  cachedBytes?: (backend: BackendId) => Promise<number | null>
  /** The GPU's features and limits when the backend's probe does not report them. */
  gpuFacts?: () => Promise<GpuFacts | null>
  /** Per-origin flags ("explained"); default localStorage, guarded. */
  prefs?: { get(key: string): string | null; set(key: string, value: string): void }
  /** The validator the qualification turn uses (the game's Rust one). */
  validate?: () => Promise<Validator | undefined>
  registry?: ModelRegistry
  /** `?llmdebug=1`: the worker's test hooks are on (`destroyDevice`). */
  debug?: boolean
  /** The hosted backend's line to the server (ADR-0067): one turn with the current lease. */
  hosted?: HostedLlmOptions['send']
  log?: (line: string) => void
}

export interface ModelRuntime {
  /** What the orchestrator's bridge calls: waits for the ready model, re-runs a call the model lost. */
  readonly llm: LocalLlm
  readonly choice: BackendChoice | null
  info(): ModelRuntimeInfo
  /** What the clock and the HUD chip are told. */
  status(): ModelStatus
  onChange(fn: (info: ModelRuntimeInfo) => void): () => void
  /** Runs the startup in the background; resolves when it ended (ready, blocked, declined, failed or waiting for another tab). */
  start(): Promise<void>
  /** The explanation's "start" button. */
  accept(): void
  /** The explanation's "not now" button. */
  decline(): void
  /** After a failure, a loss or a decline: start (or reload) again. */
  retry(): Promise<void>
  /** After a device loss: load the model again on the same adapter. */
  reload(): Promise<void>
  /** Take the model from the tab that holds it. */
  takeOver(): Promise<void>
  /** The player's explicit choice of another backend for this company (stored; takes effect on the next page load). */
  switchBackend(id: BackendId): Promise<void>
  /** The scene's hooks: the scheduler lowers the scene while calls generate. */
  attachRenderer(hooks: RendererHooks): void
  /** Test hook (`?llmdebug=1`): the worker destroys the model's GPU device as a loss would. */
  destroyDevice(): Promise<void>
  dispose(): Promise<void>
}

/** A call lost to the model going away runs again at most this often; then it fails as unavailable. */
export const MAX_REISSUES = 2

const AWAY = Symbol('the model went away')

const explainedKey = (backend: BackendId) => `swarmpress.llm.explained.${backend}`

const localPrefs: NonNullable<ModelRuntimeOptions['prefs']> = {
  get(key) {
    try {
      return globalThis.localStorage?.getItem(key) ?? null
    } catch {
      return null
    }
  },
  set(key, value) {
    try {
      globalThis.localStorage?.setItem(key, value)
    } catch {
      /* private window or blocked storage: the explanation is shown again next time */
    }
  },
}

/** The registry model a backend loads (Chrome's is its own). */
function modelIdOf(id: BackendId): string {
  return BACKENDS[id].modelId ?? 'chrome-built-in'
}

/** What the model needs from the GPU: the registry's limits, and shader-f16 for the f16 and ternary kernels. */
function requirementsOf(id: BackendId, registry: ModelRegistry): GpuRequirements | null {
  const modelId = BACKENDS[id].modelId
  const m = modelId ? findModel(registry, modelId) : undefined
  if (!m || BACKENDS[id].runsIn !== 'worker') return null
  const f16 = /f16/i.test(m.dtype) || id === 'bonsai'
  return { minMaxBufferSize: m.minMaxBufferSize, minStorageBufferBindingSize: m.minStorageBufferBindingSize, features: f16 ? ['shader-f16'] : [] }
}

/** The adapters of the real page: worker backends spawn the LLM worker, Chrome's runs in the window. Imported lazily. */
export function browserFactories(debug: boolean, registry: ModelRegistry, hosted?: HostedLlmOptions['send']): NonNullable<ModelRuntimeOptions['factories']> {
  return ({ onEvent }) => ({
    // Without the central server there is nobody to call the hosted model: no factory, so the backend blocks with that reason.
    ...(hosted ? { luna: async () => new (await import('../llm/hosted-llm')).HostedLlm({ send: hosted }) } : {}),
    gemma: async () => (await import('../llm/client')).LlmClient.spawn({ registry, onEvent, debug }),
    bonsai: async () => (await import('../llm/client')).LlmClient.spawn({ registry, onEvent, debug }),
    transformers: async () => (await import('../llm/client')).LlmClient.spawn({ registry, onEvent, debug }),
    chrome: async () => new (await import('../llm/chrome-prompt-llm')).ChromePromptLlm(),
  })
}

const emptyStages = (): Record<StartupStageId, StageView> =>
  Object.fromEntries(STARTUP_STAGES.map((s) => [s.id, { state: 'pending', detail: null }])) as Record<StartupStageId, StageView>

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * Chooses the backend (it does not load anything yet; `start()` does). A
 * choice that cannot be read (an unknown `?llm=`, a stored value from another
 * build) is a blocked runtime, not a failed session: the office opens and the
 * notice says why the clock waits.
 */
export async function openModelRuntime(o: ModelRuntimeOptions): Promise<ModelRuntime> {
  let choice: BackendChoice | null = null
  let choiceError: string | null = null
  try {
    choice = await chooseBackend({ search: o.search, companyId: o.companyId, store: o.store })
  } catch (e) {
    choiceError = errorText(e)
  }
  return new SessionModelRuntime(o, choice, choiceError)
}

class SessionModelRuntime implements ModelRuntime {
  readonly llm: LocalLlm
  private phase: RuntimePhase
  private stages = emptyStages()
  private stage: StartupStageId | null = null
  private error: string | null
  private explainText: string | null = null
  private consent: ((go: boolean) => void) | null = null
  private opened: OpenedBackend | null = null
  private lock: LeaderHandle | null = null
  /** Bumped whenever the model goes away (loss, takeover, reload): a call of an older epoch is discarded. */
  private epoch = 0
  /** Calls in flight, woken when the epoch moves on. */
  private epochWatchers = new Set<() => void>()
  private readyWaiters: Array<() => void> = []
  private listeners = new Set<(i: ModelRuntimeInfo) => void>()
  private scheduler: GpuScheduler | null = null
  private storage: StorageReport | null = null
  private fromCache: boolean | null = null
  private loads = 0
  private losses = 0
  private discarded = 0
  private ms: ModelRuntimeInfo['ms'] = {}
  private running: Promise<void> | null = null
  private calls = 0
  private disposed = false
  private readonly registry: ModelRegistry
  private readonly prefs: NonNullable<ModelRuntimeOptions['prefs']>
  private readonly log: (line: string) => void

  constructor(
    private o: ModelRuntimeOptions,
    readonly choice: BackendChoice | null,
    choiceError: string | null,
  ) {
    this.registry = o.registry ?? DEFAULT_REGISTRY
    this.prefs = o.prefs ?? localPrefs
    this.log = o.log ?? ((line) => console.info(`[model] ${line}`))
    this.error = choiceError
    if (choice?.id === 'fake') {
      // The scripted model of the e2e suites: the bridge calls it directly, exactly as before R8.
      this.phase = 'scripted'
      this.llm = fakeMvpLlm()
      return
    }
    this.phase = choiceError ? 'blocked' : o.readOnly ? 'read-only' : 'starting'
    this.llm = new GatedLlm(this)
  }

  // ------------------------------------------------------------ what the page sees

  info(): ModelRuntimeInfo {
    const id = this.choice?.id ?? null
    return {
      backend: id,
      label: id ? BACKENDS[id].label : null,
      source: this.choice?.source ?? null,
      phase: this.phase,
      stage: this.stage,
      stages: Object.fromEntries(Object.entries(this.stages).map(([k, v]) => [k, { ...v }])) as Record<StartupStageId, StageView>,
      error: this.error,
      explain: this.phase === 'explain' ? this.explainText : null,
      canTakeOver: this.phase === 'elsewhere' && !!this.lock?.canTakeOver,
      alternatives: this.phase === 'blocked' && id ? (['luna', 'gemma', 'bonsai', 'chrome', 'transformers'] as BackendId[]).filter((b) => b !== id) : [],
      storage: this.storage ? { ...this.storage } : null,
      fromCache: this.fromCache,
      loads: this.loads,
      losses: this.losses,
      discarded: this.discarded,
      ms: { ...this.ms },
    }
  }

  status(): ModelStatus {
    switch (this.phase) {
      case 'scripted':
        return { state: 'ready', detail: 'scripted model' }
      case 'ready':
        return { state: 'ready' }
      case 'read-only':
        return { state: 'none', detail: 'read-only: this session does not run the company' }
      case 'blocked':
        return { state: 'none', detail: this.error ?? 'the model backend cannot be used here' }
      case 'elsewhere':
        return { state: 'none', detail: 'the model is running in another tab' }
      case 'explain':
        return { state: 'none', detail: 'waiting for you to start the local model' }
      case 'declined':
        return { state: 'none', detail: 'the local model was not started' }
      case 'failed':
        return { state: 'none', detail: `${this.stage ? stageLabel(this.stage).toLowerCase() : 'startup'} failed: ${this.error ?? 'unknown error'}` }
      case 'lost':
        return { state: 'lost', detail: 'GPU device lost: reload the model' }
      case 'starting': {
        const s = this.stage
        const detail = s ? this.stages[s].detail : null
        const what: Record<StartupStageId, string> = {
          explain: 'starting',
          probe: 'checking WebGPU',
          storage: 'checking storage',
          verify: 'verifying the runtime',
          download: 'downloading the weights',
          load: 'loading onto the GPU',
          'warm-up': 'warming up',
          qualify: 'qualification turn',
        }
        if (!s) return { state: 'loading', detail: 'starting' }
        // Byte progress is the line itself; other stages say what they do, then the runtime's own message.
        return { state: 'loading', detail: s === 'download' && detail ? detail : detail && s === 'load' ? `${what[s]}: ${detail}` : what[s] }
      }
    }
  }

  onChange(fn: (i: ModelRuntimeInfo) => void) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit() {
    const i = this.info()
    for (const l of this.listeners) l(i)
  }

  /** The model this epoch stood for is gone: every call in flight is woken, to be discarded and run again. */
  private bumpEpoch(): number {
    this.epoch++
    const watchers = [...this.epochWatchers]
    this.epochWatchers.clear()
    for (const w of watchers) w()
    return this.epoch
  }

  private setPhase(phase: RuntimePhase, error: string | null = this.error) {
    this.phase = phase
    this.error = error
    if (phase === 'ready') this.readyWaiters.splice(0).forEach((r) => r())
    this.emit()
  }

  // ------------------------------------------------------------ the gate

  /** The ready model and its epoch, once there is one. */
  async whenReady(): Promise<{ llm: LocalLlm; epoch: number }> {
    for (;;) {
      const opened = this.opened
      if (this.phase === 'ready' && opened) return { llm: opened.llm, epoch: this.epoch }
      if (this.disposed) throw new LlmUnavailableError('the model runtime was closed')
      await new Promise<void>((r) => this.readyWaiters.push(r))
    }
  }

  /**
   * One call through the gate (GatedLlm). It waits for the ready model; if
   * the model goes away while the call runs (a device loss, a takeover, a
   * reload), the call is not waited for any longer, whatever it may still
   * return is dropped, and it runs again once the model is back.
   */
  async call<T>(fn: (llm: LocalLlm) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const { llm, epoch } = await this.whenReady()
      const id = `call-${++this.calls}`
      this.scheduler?.begin(id)
      let lostWith: string | null = null
      let wake = () => undefined as void
      const away = new Promise<typeof AWAY>((r) => (wake = () => r(AWAY)))
      this.epochWatchers.add(wake)
      try {
        const inner = fn(llm)
        // A hung generation on a lost device may never settle; nobody waits for it, and its late rejection is nobody's.
        inner.catch(() => undefined)
        const out = await Promise.race([inner, away])
        if (out !== AWAY && this.epoch === epoch) return out as T
        lostWith = 'the model went away while the call ran'
      } catch (e) {
        if (this.epoch === epoch && !isUnavailableError(e)) throw e
        lostWith = errorText(e)
        // An unavailable answer the runtime has not heard of yet (no event came first): the model is lost.
        if (this.epoch === epoch) this.markLost(lostWith)
      } finally {
        this.epochWatchers.delete(wake)
        this.scheduler?.end(id)
      }
      this.discarded++
      if (attempt >= MAX_REISSUES) throw new LlmUnavailableError(`the model was lost ${attempt + 1} times during one call; giving up on it (${lostWith})`)
      this.log(`a call was discarded (${lostWith}); it runs again once the model is back`)
    }
  }

  // ------------------------------------------------------------ startup

  start(): Promise<void> {
    this.running ??= this.startNow().finally(() => (this.running = null))
    return this.running
  }

  private async startNow(): Promise<void> {
    if (this.phase === 'scripted' || this.phase === 'read-only') return
    // No backend could be chosen (an unknown `?llm=`, a stored value of another build): nothing to start.
    if (!this.choice) return this.setPhase('blocked', this.error)
    const id = this.choice.id
    if (BACKENDS[id].runsIn === 'worker' && this.o.lock !== null && !this.lock) {
      // One resident model per origin: ask before anything is loaded.
      this.lock = (this.o.lock ?? electResident)()
      this.lock.onChange((e) => {
        if (e.stolen) void this.lostToAnotherTab()
        else if (e.isLeader) void this.resumeAsLeader()
      })
      const free = await this.lock.settled()
      if (!free && !this.lock.isLeader) {
        this.stage = null
        this.setPhase('elsewhere', null)
        this.log('the model is running in another tab; this tab waits')
        return
      }
    }
    if (this.lock && !this.lock.isLeader) {
      this.setPhase('elsewhere', null)
      return
    }
    await this.runStartup(null)
  }

  private async runStartup(reuse: OpenedBackend | null): Promise<void> {
    const id = this.choice!.id
    const epoch = this.bumpEpoch()
    this.stages = emptyStages()
    this.stage = null
    this.fromCache = null
    this.setPhase('starting', null)
    const factories = (this.o.factories ?? browserFactories(!!this.o.debug, this.registry, this.o.hosted))({ onEvent: (e) => this.onBackendEvent(e) })
    const model = findModel(this.registry, modelIdOf(id))
    try {
      const validate = await this.o.validate?.().catch(() => undefined)
      const r = await runStartup({
        backend: id,
        modelId: modelIdOf(id),
        sizeBytes: model?.sizeBytes ?? null,
        reuse,
        open: () => openBackend(id, factories),
        requirements: requirementsOf(id, this.registry),
        gpuFacts: this.o.gpuFacts ?? (async () => (await import('../llm/capabilities')).detectCapabilities().then(factsFromCapabilities)),
        storage: this.o.storage === undefined ? ((globalThis.navigator as Navigator | undefined)?.storage ?? null) : this.o.storage,
        cachedBytes: () => (this.o.cachedBytes ?? defaultCachedBytes)(id),
        explain: (text) => this.ask(text),
        explained: { get: () => this.prefs.get(explainedKey(id)) === '1', set: () => this.prefs.set(explainedKey(id), '1') },
        validate,
        onOpened: (opened) => {
          // Lost or taken over while the probe ran: this adapter is nobody's.
          if (epoch !== this.epoch) void opened.llm.dispose().catch(() => undefined)
          else this.opened = opened
        },
        onEvent: (e) => {
          if (epoch !== this.epoch) return
          this.stages[e.stage] = { state: e.state, detail: e.detail ?? this.stages[e.stage].detail }
          if (e.state === 'active' || e.state === 'failed') this.stage = e.stage
          this.emit()
        },
      })
      // The model was lost or taken while it started: that path owns the state now.
      if (epoch !== this.epoch) return
      this.opened = r.opened
      this.storage = r.storage ?? this.storage
      this.fromCache = r.fromCache
      this.ms = r.ms
      this.loads++
      this.stage = null
      this.log(`${BACKENDS[id].label} is ready (${this.loads === 1 ? 'first load' : `load ${this.loads}`}${r.fromCache === true ? ', weights from the browser cache' : r.fromCache === false ? ', weights downloaded' : ''})`)
      this.setPhase('ready', null)
    } catch (e) {
      if (epoch !== this.epoch) return
      const err = e instanceof StartupError ? e : new StartupError(this.stage ?? 'probe', 'failed', errorText(e))
      this.stage = err.stage
      if (err.stage === 'storage' && this.stages.storage.state === 'failed') this.storage = null
      this.log(`startup stopped at "${stageLabel(err.stage)}": ${err.message}`)
      this.setPhase(err.kind === 'blocked' ? 'blocked' : err.kind === 'declined' ? 'declined' : 'failed', err.message)
    }
  }

  private ask(text: string): Promise<boolean> {
    this.explainText = text
    this.setPhase('explain', null)
    return new Promise<boolean>((resolve) => {
      this.consent = (go) => {
        this.consent = null
        this.explainText = null
        this.phase = 'starting'
        resolve(go)
      }
    })
  }

  accept() {
    if (this.consent) this.consent(true)
    else if (this.phase === 'declined') void this.retry()
  }

  decline() {
    this.consent?.(false)
  }

  async retry(): Promise<void> {
    if (this.running) return this.running
    if (this.phase === 'lost') return this.reload()
    const after = this.stage ? STARTUP_STAGES.findIndex((s) => s.id === this.stage) > STARTUP_STAGES.findIndex((s) => s.id === 'storage') : false
    if (this.phase === 'failed' && this.opened && after) {
      // Probe and storage passed already: the adapter loads again.
      return this.reloadWith(this.opened)
    }
    if (this.phase === 'failed' || this.phase === 'declined' || this.phase === 'blocked') {
      await this.closeAdapter()
      this.phase = 'starting'
      return this.start()
    }
  }

  async reload(): Promise<void> {
    if (this.running) return this.running
    if (!this.opened) return this.start()
    return this.reloadWith(this.opened)
  }

  private reloadWith(opened: OpenedBackend): Promise<void> {
    this.running ??= this.runStartup(opened).finally(() => (this.running = null))
    return this.running
  }

  // ------------------------------------------------------------ loss and the other tab

  private onBackendEvent(e: { kind: RuntimeEventKind; message: string }) {
    if (e.kind === 'device-lost') this.markLost(e.message)
    else this.log(`GPU error: ${e.message}`)
  }

  /** The GPU device is gone: the clock holds, calls wait (the one in flight is discarded), the player reloads. */
  private markLost(message: string) {
    if (this.phase === 'lost' || this.phase === 'scripted') return
    this.bumpEpoch()
    this.losses++
    this.stage = null
    this.log(`the GPU device was lost (${message}); the model must be reloaded`)
    this.setPhase('lost', message)
  }

  /** The lock came (back) to this tab: start here, after a startup that was cut short has wound down. */
  private async resumeAsLeader() {
    await this.running?.catch(() => undefined)
    if (this.phase === 'elsewhere' && this.lock?.isLeader && !this.disposed) await this.start()
  }

  /** Another tab took the model over: free it here and wait in line. */
  private async lostToAnotherTab() {
    this.bumpEpoch()
    const opened = this.opened
    this.opened = null
    this.stage = null
    this.setPhase('elsewhere', null)
    this.log('the model was taken over by another tab; it was freed here')
    await opened?.llm.dispose().catch(() => undefined)
  }

  async takeOver(): Promise<void> {
    if (!this.lock || this.phase !== 'elsewhere') return
    await this.lock.takeOver()
    // The lock's change starts the model here.
  }

  async switchBackend(id: BackendId): Promise<void> {
    if (id === 'fake') throw new Error('the scripted model is not a backend a company can choose')
    await storeBackend(this.o.store, this.o.companyId, id)
    this.log(`this company will use ${BACKENDS[id].label} from the next page load`)
  }

  // ------------------------------------------------------------ the rest

  attachRenderer(hooks: RendererHooks) {
    this.scheduler?.dispose()
    // A hidden tab keeps generating: work in flight must finish (ADR-0060), so the scheduler never pauses calls.
    this.scheduler = new GpuScheduler(hooks, { pauseWhenHidden: false })
  }

  async destroyDevice(): Promise<void> {
    if (!this.o.debug) throw new Error('destroyDevice is a test hook; open the page with ?llmdebug=1')
    const llm = this.opened?.llm as (LocalLlm & { destroyDevice?: () => Promise<void> }) | undefined
    if (!llm?.destroyDevice) throw new Error('this backend has no GPU device to destroy')
    await llm.destroyDevice()
  }

  private async closeAdapter() {
    const opened = this.opened
    this.opened = null
    await opened?.llm.dispose().catch(() => undefined)
  }

  async dispose(): Promise<void> {
    this.disposed = true
    this.bumpEpoch()
    this.readyWaiters.splice(0).forEach((r) => r())
    this.scheduler?.dispose()
    await this.closeAdapter()
    await this.lock?.release()
  }

  /** The model of the opened adapter, for the gate's `modelId` and `capabilities`. */
  get adapter(): OpenedBackend | null {
    return this.opened
  }
}

function factsFromCapabilities(c: { webgpu: boolean; features?: string[]; limits?: { maxBufferSize: number; maxStorageBufferBindingSize: number } }): GpuFacts | null {
  if (!c.webgpu) return null
  return { features: c.features ?? [], maxBufferSize: c.limits?.maxBufferSize ?? null, maxStorageBufferBindingSize: c.limits?.maxStorageBufferBindingSize ?? null }
}

/** Cached bytes of the model's weights: Gemma's files in OPFS, Bonsai's engine cache in IndexedDB; other backends cannot tell. */
async function defaultCachedBytes(id: BackendId): Promise<number | null> {
  if (id === 'gemma') {
    const [{ storedBytes }, lock] = await Promise.all([import('../llm/runtime/llama/weights'), import('../llm/runtime/llama/runtime.lock.json')])
    return (await storedBytes(lock.default.model.target)) + (await storedBytes(lock.default.model.draft))
  }
  const manifest = id === 'bonsai' ? bonsaiManifest(BACKENDS.bonsai.modelId!) : undefined
  if (!manifest) return null
  const r = await (await import('../llm/runtime/bonsai/weight-cache')).cachedWeightBytes(manifest.revision)
  return r && Number.isFinite(r.bytes) ? r.bytes : null
}

/**
 * The `LocalLlm` the orchestrator's bridge holds: every call waits for the
 * ready model and goes through the runtime's gate (`SessionModelRuntime.call`).
 * Loading is the runtime's business, not the bridge's.
 */
class GatedLlm implements LocalLlm {
  constructor(private rt: SessionModelRuntime) {}

  get modelId(): string | null {
    return this.rt.adapter?.llm.modelId ?? null
  }

  async load(): Promise<void> {
    /* the runtime loads the model (startup); the bridge never does */
  }

  generate(messages: ChatMessage[], opts: GenerateOptions = {}): Promise<GenerateResult> {
    return this.rt.call((llm) => llm.generate(messages, opts))
  }

  stream(messages: ChatMessage[], opts: Omit<GenerateOptions, 'onDelta'> = {}): AsyncIterable<string> {
    return streamFromGenerate((m, o) => this.generate(m, o), messages, opts)
  }

  structured<T>(messages: ChatMessage[], schema: JsonSchema, opts: StructuredOptions = {}): Promise<T> {
    return this.rt.call((llm) => llm.structured<T>(messages, schema, opts))
  }

  research<T>(messages: ChatMessage[], schema: JsonSchema, opts: StructuredOptions = {}): Promise<ResearchResult<T>> {
    return this.rt.call((llm) => {
      if (!llm.research) throw new LlmUnavailableError('this model backend cannot search the web (ADR-0068)')
      return llm.research<T>(messages, schema, opts)
    })
  }

  async capabilities(): Promise<RuntimeCapabilities> {
    const a = this.rt.adapter
    if (!a) throw new LlmUnavailableError('no model is loaded')
    return a.capabilities
  }

  async dispose(): Promise<void> {
    await this.rt.dispose()
  }
}
