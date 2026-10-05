/**
 * bench.html: the model qualification harness (ADR-0057, FEAT-037;
 * docs/runbooks/model-qualification.md). It opens one backend through
 * backend.ts, loads its model, runs the fixtures, optionally with the office
 * scene drawing beside it, and exposes everything on `window.__bench`.
 *
 * URL parameters:
 *   llm=gemma|bonsai|chrome|transformers|fake   the backend (required; never switched)
 *   quality=low|medium|high               draw the office scene at this tier (absent: no scene)
 *   suite=full|frames|load                 all fixtures; the short frame-time set; load and warm-up only
 *   scale=0..1                             share of each fixture's prompts (validity needs 1)
 *   fixtures=a,c,section                   only these fixtures (letters or ids)
 *   thinking=off|medium|xhigh              one reasoning mode for every call (fallback ladder)
 *   context=N, depth=N                     Bonsai: context length and decode pipeline depth (fallback ladder)
 *   mtp=1                                  Gemma on llama.cpp: load the MTP drafter and use it (default off)
 *   repeat=N                               passes over the suite (the device-loss soak uses 20)
 *   reloads=N                              warm reloads after the suite
 *   start=cold|warm                        what the runner says this start is (else inferred)
 *   loss=hook|manual                       device loss: the backend's test hook, or wait for chrome://gpucrash
 *   memory=0|1                             performance.measureUserAgentSpecificMemory() (default 1, 0 for fake)
 *   timeout=S                              per call, seconds
 *   idle=S                                 idle frame window before and after the load, seconds
 *   fakems=N                               scripted backend only: delay before each answer, ms (default 5)
 *   office=bricks                          draw the brick office spike (FEAT-081) instead of the box office
 *   autostart=1                           start without the button (not for a cold Chrome start: that needs a click)
 */
import { BACKENDS, BackendUnavailableError, backendFromQuery, openBackend, type BackendFactories, type BackendId } from '../backend'
import { ChromePromptLlm, CHROME_MODEL_ID } from '../chrome-prompt-llm'
import { LlmClient } from '../client'
import type { Endpoint, ModelSpec } from '../protocol'
import { DEFAULT_REGISTRY } from '../registry.default'
import { bonsaiManifest } from '../runtime/bonsai/manifest'
import { compareIds, EQUIVALENCE_PROMPTS, EQUIVALENCE_TOKENS, goldenKey } from '../runtime/bonsai/equivalence'
import type { UpstreamDeviceInfo } from '../runtime/bonsai/upstream'
import { cachedWeightBytes } from '../runtime/bonsai/weight-cache'
import LLAMA_LOCK from '../runtime/llama/runtime.lock.json'
import { storedBytes } from '../runtime/llama/weights'
import type { LocalLlm, RuntimeCapabilities, ThinkingMode, Validator } from '../types'
import { loadRustValidator } from '../../orchestrator'
import { BENCH_FAKE_MODEL, BenchFakeLlm } from './fake'
import { FRAMES_COUNTS, buildSuite, parseFixtureList, type FixtureId, type Suite } from './fixtures'
import { FrameRecorder } from './frames'
import type { BenchConfig, BenchResults, EquivalenceRecord, ModelPins } from './metrics'
import { fmtBytes, fmtMs, overallVerdict, qualificationMarkdown, qualify } from './report'
import { startBench, type BenchRun, type BenchState } from './runner'
import { startScene, type BenchScene, type SceneCounts } from './scene'

const $ = (id: string) => document.getElementById(id) as HTMLElement
const params = new URLSearchParams(location.search)

function num(name: string, fallback: number, min: number, max: number): number {
  const raw = params.get(name)
  if (raw === null || raw === '') return fallback
  const v = Number(raw)
  if (!Number.isFinite(v) || v < min || v > max) throw new Error(`?${name}=${raw}: expected a number from ${min} to ${max}`)
  return v
}

function oneOf<T extends string>(name: string, values: readonly T[], fallback: T | null): T | null {
  const raw = params.get(name)
  if (raw === null || raw === '') return fallback
  if (!(values as readonly string[]).includes(raw)) throw new Error(`?${name}=${raw}: use ${values.join(', ')}`)
  return raw as T
}

function readConfig(): { config: BenchConfig; backend: BackendId; memory: boolean; autostart: boolean; office: 'boxes' | 'bricks' } {
  const backend = backendFromQuery(location.search)
  if (!backend) throw new Error(`choose a backend with ?llm= (${Object.keys(BACKENDS).join(', ')})`)
  const suite = oneOf('suite', ['full', 'frames', 'load'] as const, 'full')!
  const quality = oneOf('quality', ['low', 'medium', 'high'] as const, null)
  const deviceLoss = oneOf('loss', ['none', 'hook', 'manual'] as const, 'none')!
  const config: BenchConfig = {
    backend,
    quality,
    suite,
    scale: num('scale', 1, 0.001, 1),
    fixtures: [],
    thinking: oneOf('thinking', ['off', 'medium', 'xhigh'] as const, null),
    context: params.has('context') ? num('context', 16384, 512, 262144) : null,
    pipelineDepth: params.has('depth') ? num('depth', 4, 1, 64) : null,
    ...(backend === 'gemma' ? { mtp: params.get('mtp') === '1' } : {}),
    repeat: Math.floor(num('repeat', 1, 1, 100)),
    reloads: Math.floor(num('reloads', 0, 0, 20)),
    start: oneOf('start', ['cold', 'warm', 'unknown'] as const, 'unknown')!,
    deviceLoss,
    callTimeoutMs: num('timeout', backend === 'fake' ? 30 : 900, 1, 7200) * 1000,
    idleMs: num('idle', quality ? (backend === 'fake' ? 1 : 15) : 0, 0, 600) * 1000,
  }
  return {
    config,
    backend,
    memory: num('memory', backend === 'fake' ? 0 : 1, 0, 1) === 1,
    autostart: params.get('autostart') === '1',
    office: oneOf('office', ['boxes', 'bricks'] as const, 'boxes')!,
  }
}

// ---------------------------------------------------------------- backends

/** The client's own spec resolution (registry plus pinned manifest), without a worker. */
const resolver = new LlmClient({ postMessage() {}, addEventListener() {}, removeEventListener() {} } as Endpoint, { registry: DEFAULT_REGISTRY })

function bonsaiPins(modelId: string): ModelPins | null {
  const m = bonsaiManifest(modelId)
  return m ? { repo: m.repo, file: m.file, revision: m.revision, sha256: m.sha256, bytes: m.bytes, engineSha256: m.runtime.sha256, context: m.context } : null
}

interface Wiring {
  factories: BackendFactories
  modelId: string
  model: ModelPins | null
  /** The backend's device-loss test hook, when it has one (the scripted backend; Bonsai with `loss=hook`). */
  loseDevice?: () => void
  /** Upstream equivalence in the worker. */
  equivalence?: (llm: LocalLlm) => Promise<EquivalenceRecord | null>
  inferStart: (probe: RuntimeCapabilities | null) => Promise<'cold' | 'warm' | 'unknown'>
}

function wire(backend: BackendId, onEvent: (kind: string, message: string) => void, config: BenchConfig, getFake: () => BenchFakeLlm | null, setFake: (f: BenchFakeLlm) => void, suite: ReturnType<typeof buildSuite>): Wiring {
  switch (backend) {
    case 'fake':
      return {
        modelId: BENCH_FAKE_MODEL,
        model: null,
        factories: {
          fake: () => {
            // A few milliseconds per generation, so the page renders frames while the scripted backend "generates".
            const f = new BenchFakeLlm(suite, { onEvent: (e) => onEvent(e.kind, e.message), firstTokenMs: num('fakems', 5, 0, 10_000) })
            setFake(f)
            return f
          },
        },
        loseDevice: () => getFake()?.loseDevice(),
        // The scripted backend caches nothing: its first load is a cold one.
        inferStart: async () => 'cold',
      }
    case 'chrome':
      return {
        modelId: CHROME_MODEL_ID,
        model: null,
        factories: { chrome: () => new ChromePromptLlm() },
        inferStart: async (probe) => {
          const a = (probe?.device as { availability?: string } | undefined)?.availability
          return a === 'available' ? 'warm' : a === 'downloadable' || a === 'downloading' ? 'cold' : 'unknown'
        },
      }
    case 'luna':
      // Step 2 of the migration (ADR-0067): the harness needs a signed-in server session with the lease first.
      return {
        modelId: 'gpt-6-luna',
        model: null,
        factories: {
          luna: () => {
            throw new Error('the qualification harness cannot run the hosted model yet (it has no server session); run it through the game with ?central=1')
          },
        },
        inferStart: async () => 'unknown',
      }
    case 'gemma': {
      const l = LLAMA_LOCK.model
      const spawn = () =>
        LlmClient.spawn({
          registry: DEFAULT_REGISTRY,
          onEvent: (e) => onEvent(e.kind, e.message),
          resolveSpec: (id: string): ModelSpec | undefined => {
            const base = resolver.resolveSpec(id)
            return { ...base, mtp: config.mtp === true, ...(config.context !== null ? { context: config.context } : {}) }
          },
        })
      return {
        modelId: l.id,
        model: {
          repo: l.repo,
          file: l.target.file,
          revision: l.revision,
          sha256: l.target.sha256,
          bytes: l.target.size,
          engineSha256: '',
          engine: `llama.cpp ${LLAMA_LOCK.llamaCpp.commit.slice(0, 12)} (WebGPU, wasm64)`,
          context: config.context ?? l.context,
        },
        factories: { gemma: spawn },
        inferStart: async () => {
          const have = await storedBytes(l.target).catch(() => null)
          if (have === null) return 'unknown'
          return have === 0 ? 'cold' : have >= l.target.size ? 'warm' : 'unknown'
        },
      }
    }
    case 'transformers':
    case 'bonsai': {
      const modelId = BACKENDS[backend].modelId!
      const overrides = config.context !== null || config.pipelineDepth !== null
      // `loss=hook`: the worker runs with its test hooks, so the run can destroy the model's device from the page.
      const hook = config.deviceLoss === 'hook'
      let client: LlmClient | null = null
      const spawn = () =>
        (client = LlmClient.spawn({
          registry: DEFAULT_REGISTRY,
          onEvent: (e) => onEvent(e.kind, e.message),
          debug: hook,
          ...(overrides
            ? {
                resolveSpec: (id: string): ModelSpec | undefined => {
                  const base = resolver.resolveSpec(id)
                  return {
                    ...base,
                    ...(config.context !== null ? { context: Math.min(config.context, base.context ?? config.context) } : {}),
                    ...(config.pipelineDepth !== null ? { decodePipelineDepth: config.pipelineDepth } : {}),
                  }
                },
              }
            : {}),
        }))
      const pins = backend === 'bonsai' ? bonsaiPins(modelId) : null
      return {
        modelId,
        model: pins ? { ...pins, context: config.context ?? pins.context } : null,
        factories: { [backend]: spawn },
        // The Bonsai adapter destroys its GPU device on the worker's debug command (the other adapters have none).
        ...(hook && backend === 'bonsai'
          ? {
              loseDevice: () => {
                void (client as LlmClient | null)?.destroyDevice().catch((e: unknown) => onEvent('gpu-error', `the device-loss hook failed: ${(e as Error)?.message ?? String(e)}`))
              },
            }
          : {}),
        ...(backend === 'bonsai'
          ? {
              equivalence: async (llm: LocalLlm): Promise<EquivalenceRecord | null> => {
                const client = llm as LlmClient
                const adapter: number[][] = []
                const upstream: number[][] = []
                for (const messages of EQUIVALENCE_PROMPTS) {
                  adapter.push((await client.bench({ messages, maxNewTokens: EQUIVALENCE_TOKENS, mode: 'adapter' })).ids)
                  upstream.push((await client.bench({ messages, maxNewTokens: EQUIVALENCE_TOKENS, mode: 'upstream' })).ids)
                }
                const caps = await client.capabilities()
                const device = caps.device as unknown as UpstreamDeviceInfo | undefined
                return {
                  prompts: EQUIVALENCE_PROMPTS.length,
                  tokens: EQUIVALENCE_TOKENS,
                  mismatches: compareIds(upstream, adapter),
                  ids: adapter,
                  deviceKey: device?.features ? goldenKey(device) : null,
                }
              },
              inferStart: async () => {
                if (!pins) return 'unknown'
                const cached = await cachedWeightBytes(pins.revision).catch(() => null)
                if (!cached) return 'unknown'
                if (cached.chunks === 0) return 'cold'
                return cached.bytes >= pins.bytes * 0.99 ? 'warm' : 'unknown'
              },
            }
          : { inferStart: async () => 'unknown' as const }),
      }
    }
  }
}

// ---------------------------------------------------------------- memory

/** `performance.measureUserAgentSpecificMemory()`: cross-origin isolated pages only; it can wait for a GC, so it is bounded. */
async function measureMemory(): Promise<{ bytes: number; windowBytes: number | null; workerBytes: number | null }> {
  type Breakdown = { bytes: number; types: string[] }
  const perf = performance as Performance & { measureUserAgentSpecificMemory?: () => Promise<{ bytes: number; breakdown: Breakdown[] }> }
  if (!globalThis.crossOriginIsolated) throw new Error('the page is not cross-origin isolated')
  if (typeof perf.measureUserAgentSpecificMemory !== 'function') throw new Error('this browser has no performance.measureUserAgentSpecificMemory()')
  const r = await Promise.race([perf.measureUserAgentSpecificMemory(), new Promise<null>((resolve) => setTimeout(() => resolve(null), 25_000))])
  if (!r) throw new Error('performance.measureUserAgentSpecificMemory() did not answer within 25 s')
  const sum = (type: string) => r.breakdown.filter((b) => b.types.includes(type)).reduce((a, b) => a + b.bytes, 0)
  return { bytes: r.bytes, windowBytes: sum('Window') || null, workerBytes: sum('DedicatedWorkerGlobalScope') || null }
}

// ---------------------------------------------------------------- the page

function browserVersion(): string | null {
  const ua = navigator.userAgent
  const m = /(Chrome|Chromium|Firefox|Version)\/([\d.]+)/.exec(ua)
  return m ? `${m[1] === 'Version' ? 'Safari' : m[1]} ${m[2]}` : null
}

async function pageGpu(): Promise<Record<string, unknown> | null> {
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(o?: unknown): Promise<{ info?: Record<string, unknown>; features?: Iterable<string> } | null> } }).gpu
  if (!gpu) return null
  const a = await gpu.requestAdapter({ powerPreference: 'high-performance' }).catch(() => null)
  if (!a) return null
  const i = a.info ?? {}
  return { vendor: i.vendor, architecture: i.architecture, device: i.device, description: i.description, features: [...(a.features ?? [])].sort() }
}

function renderState(s: BenchState): void {
  const stages = s.stages
    .map((v) => {
      const mark = { pending: '·', active: '▶', done: '✓', failed: '✗', skipped: '–' }[v.status]
      const parts = [`${mark} ${v.label}`]
      if (v.ms !== null && v.status !== 'skipped' && v.status !== 'pending') parts.push(fmtMs(v.ms))
      if (v.bytesTotal) parts.push(`${fmtBytes(v.bytesLoaded)} of ${fmtBytes(v.bytesTotal)}`)
      else if (v.bytesLoaded) parts.push(fmtBytes(v.bytesLoaded))
      if (v.message && v.status === 'active') parts.push(v.message)
      return parts.join(' · ')
    })
    .join('\n')
  const fixtures = s.fixtures.map((f) => `${f.label}: ${f.done} of ${f.total} calls${f.failed ? `, ${f.failed} failed` : ''}`).join('\n')
  $('stages').textContent = stages
  $('fixtures').textContent = `${s.passes > 1 ? `pass ${s.pass} of ${s.passes}\n` : ''}${fixtures}`
  $('status').textContent = s.status === 'failed' ? `failed: ${s.fatal ?? 'unknown error'}` : `${s.status}: ${s.stage}`
  document.body.dataset.bench = s.status
}

const PLACEHOLDER_CONTEXT = {
  provenance: { commit: null, branch: null, dirty: null, generatedAt: new Date().toISOString() },
  machine: { slug: 'this-machine', os: navigator.platform, arch: 'unknown', cpus: navigator.hardwareConcurrency ?? 0, cpuModel: 'this machine', memoryGb: 0 },
}

declare global {
  interface Window {
    __bench?: {
      config: BenchConfig | null
      error: string | null
      start(): Promise<void>
      state(): BenchState | null
      results(): BenchResults | null
      /** Resolves with the results when the run ends, failed or not. */
      done(): Promise<BenchResults>
      /** The scene's draw calls and the brick rooms' counts (null without a scene). */
      scene(): SceneCounts | null
    }
  }
}

function boot(): void {
  let run: BenchRun | null = null
  let done: Promise<BenchResults> | null = null
  let waiting: ((r: BenchResults) => void) | null = null
  const ready = new Promise<BenchResults>((resolve) => (waiting = resolve))
  let parsed: ReturnType<typeof readConfig> | null = null
  let error: string | null = null
  try {
    parsed = readConfig()
  } catch (e) {
    error = (e as Error).message
  }

  /**
   * Everything slow happens before Start is enabled: the validator, the scene
   * and its idle window with no model loaded. A cold Chrome start needs the
   * click's user activation to reach `LanguageModel.create()`, and that lasts
   * seconds, not as long as a scene takes to boot.
   */
  interface Prepared {
    suite: Suite
    frames: FrameRecorder | null
    scene: BenchScene | null
    validate: Validator
  }
  let prepared: Promise<Prepared> | null = null
  let sceneRef: BenchScene | null = null
  const prepare = (): Promise<Prepared> =>
    (prepared ??= (async () => {
      if (!parsed) throw new Error(error ?? 'no configuration')
      const { config, office } = parsed
      const only = parseFixtureList(params.get('fixtures'))
      const suite = buildSuite({
        scale: config.scale,
        only,
        thinking: (config.thinking ?? undefined) as ThinkingMode | undefined,
        counts: config.suite === 'frames' && !only && !params.has('scale') ? FRAMES_COUNTS : undefined,
      })
      config.fixtures = suite.fixtures.map((f) => f.id as FixtureId)
      // The validator the game's repair loop uses; without it the run would measure a different path.
      $('status').textContent = 'loading the validator'
      const validate = await loadRustValidator()
      const frames = config.quality ? new FrameRecorder() : null
      let scene: BenchScene | null = null
      if (frames && config.quality) {
        $('status').textContent = 'starting the scene'
        scene = await startScene($('scene'), config.quality, frames, office)
        if (config.idleMs > 0) {
          $('status').textContent = `measuring idle frames (${Math.round(config.idleMs / 1000)} s, no model loaded)`
          await new Promise((r) => setTimeout(r, config.idleMs))
        }
      }
      sceneRef = scene
      return { suite, frames, scene, validate }
    })())

  const start = async () => {
    if (done) return
    if (!parsed) throw new Error(error ?? 'no configuration')
    const { config, backend, memory } = parsed
    ;($('start') as HTMLButtonElement).disabled = true
    const { suite, frames, scene, validate } = await prepare()
    let fake: BenchFakeLlm | null = null
    const events: [string, string][] = []
    const onEvent = (kind: string, message: string) => (run ? run.event(kind, message) : events.push([kind, message]))
    const w = wire(backend, onEvent, config, () => fake, (f) => (fake = f), suite)
    let probe: RuntimeCapabilities | null = null
    run = startBench({
      config,
      suite,
      modelId: w.modelId,
      model: w.model,
      open: async () => {
        try {
          const opened = await openBackend(backend, w.factories)
          probe ??= opened.capabilities
          return opened
        } catch (e) {
          if (e instanceof BackendUnavailableError) throw new Error(`${e.message} (the harness never switches to another backend)`)
          throw e
        }
      },
      validate,
      env: {
        userAgent: navigator.userAgent,
        browser: browserVersion(),
        crossOriginIsolated: globalThis.crossOriginIsolated === true,
        hardwareConcurrency: navigator.hardwareConcurrency ?? null,
        deviceMemoryGb: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
        gpu: scene?.gpu ?? (await pageGpu()),
      },
      frames,
      // The idle frames without a model were taken while preparing.
      idleBeforeLoad: false,
      frameInfo: () => ({ renderer: scene?.renderer ?? 'none', quality: config.quality ?? 'off' }),
      inferStart: () => w.inferStart(probe),
      measureMemory: memory ? measureMemory : undefined,
      loseDevice: w.loseDevice,
      equivalence: w.equivalence,
      onState: renderState,
    })
    for (const [kind, message] of events) run.event(kind, message)
    done = run.done.then((r) => {
      scene?.stop()
      $('report').textContent = qualificationMarkdown({ runs: [r], context: PLACEHOLDER_CONTEXT })
      $('verdict').textContent = `This run alone: ${overallVerdict(qualify([r])).toUpperCase()}. The qualification report combines every run of the backend (docs/runbooks/model-qualification.md).`
      const blob = new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' })
      const a = $('download') as HTMLAnchorElement
      a.href = URL.createObjectURL(blob)
      a.download = `bench-${r.backend}.${config.suite}.json`
      a.hidden = false
      waiting?.(r)
      return r
    })
    await done
  }

  window.__bench = {
    config: parsed?.config ?? null,
    error,
    start,
    state: () => run?.state() ?? null,
    results: () => run?.results ?? null,
    done: () => ready,
    scene: () => sceneRef?.counts() ?? null,
  }

  $('start').addEventListener('click', () => void start().catch((e) => console.error(e)))
  if (error) {
    $('status').textContent = error
    document.body.dataset.bench = 'failed'
    ;($('start') as HTMLButtonElement).disabled = true
    return
  }
  const c = parsed!.config
  $('config').textContent = [
    `backend: ${BACKENDS[c.backend as BackendId].label}`,
    `suite: ${c.suite}, scale ${c.scale}, ${c.repeat} pass(es), ${c.reloads} warm reload(s)`,
    `scene: ${c.quality ?? 'off'}, office: ${parsed!.office}`,
    `reasoning: ${c.thinking ?? 'per fixture'}${c.context ? `, context ${c.context}` : ''}${c.pipelineDepth ? `, pipeline depth ${c.pipelineDepth}` : ''}${c.mtp !== undefined ? `, MTP ${c.mtp ? 'on' : 'off'}` : ''}`,
    `device loss: ${c.deviceLoss}`,
    `cross-origin isolated: ${globalThis.crossOriginIsolated === true}`,
  ].join('\n')
  const button = $('start') as HTMLButtonElement
  button.disabled = true
  document.body.dataset.bench = 'preparing'
  prepare().then(
    () => {
      $('status').textContent = 'ready'
      button.disabled = false
      document.body.dataset.bench = 'idle'
      if (parsed!.autostart) void start().catch((e) => console.error(e))
    },
    (e) => {
      error = `could not start: ${(e as Error).message}`
      window.__bench!.error = error
      $('status').textContent = error
      document.body.dataset.bench = 'failed'
    },
  )
}

boot()
