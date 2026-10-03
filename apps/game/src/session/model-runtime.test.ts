// The session's local model (ADR-0057, increment R8) with fakes for the
// adapters, the resident lock (two tabs), storage and the GPU. No model runs.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { backendKey, type BackendChoiceStore, type BackendFactories } from '../llm/backend'
import { FakeLlm, type FakeResponse } from '../llm/fake-llm'
import type { RendererHooks } from '../llm/gpu-scheduler'
import { electResident } from '../llm/leader'
import type { RuntimeEventKind } from '../llm/protocol'
import { channelHub, FakeLocks, flushMicrotasks } from '../llm/testing/fake-locks'
import { LlmUnavailableError, type GenerateOptions, type GenerateResult, type LoadProgress, type ChatMessage, type RuntimeCapabilities } from '../llm/types'
import { MAX_REISSUES, openModelRuntime, type ModelRuntime, type ModelRuntimeOptions } from './model-runtime'

const GB = 1e9
const GOOD_GPU = { features: ['shader-f16'], maxBufferSize: 4 * 1024 ** 3, maxStorageBufferBindingSize: 4 * 1024 ** 3 }
const VALID = '{"next": "giulia", "reason": "Her draft is ready."}'
/** Warm-up, qualification turn, then what the game asks. */
const script = (...game: FakeResponse[]): FakeResponse[] => ['ready', VALID, ...game]
const ask: ChatMessage[] = [{ role: 'user', content: 'Write the standup minutes.' }]

type Emit = (e: { kind: RuntimeEventKind; message: string }) => void

/** An adapter like LlmClient over the Bonsai worker: byte progress, a probe with GPU facts, device-loss events. */
class TestAdapter extends FakeLlm {
  hold = false
  private held: { resolve(): void; reject(e: Error): void }[] = []
  constructor(
    private emitEvent: Emit,
    responses: FakeResponse[],
    private caps: Partial<RuntimeCapabilities> = {},
  ) {
    super({ script: responses })
  }
  override async load(modelId: string, onProgress?: (p: LoadProgress) => void) {
    this.loads.push(modelId)
    this.disposed = false
    onProgress?.({ modelId, phase: 'download', files: {}, loaded: 50, total: 100, fraction: 0.5, fromCache: this.loads.length > 1 })
    onProgress?.({ modelId, phase: 'init', files: {}, loaded: 100, total: 100, fraction: 1, message: 'Compiling kernels' })
    this.modelId = modelId
  }
  override async generate(m: ChatMessage[], o: GenerateOptions = {}): Promise<GenerateResult> {
    if (this.hold) await new Promise<void>((resolve, reject) => this.held.push({ resolve, reject }))
    return super.generate(m, o)
  }
  async capabilities(): Promise<RuntimeCapabilities> {
    return { backend: 'bonsai-kernels', label: 'Bonsai', webgpu: true, supportsConstrainedOutput: false, supportsPrefixReuse: true, supportsVision: false, reasoningModes: ['off'], contextTokens: 16384, device: GOOD_GPU, ...this.caps }
  }
  /** The worker's device-loss event; with `hang`, the call in flight never settles (the GPU work is gone). */
  loseDevice(message: string, o: { hang?: boolean } = {}) {
    this.emitEvent({ kind: 'device-lost', message })
    if (!o.hang) for (const h of this.held.splice(0)) h.reject(new LlmUnavailableError('the GPU device was lost; the call was discarded'))
  }
  release() {
    this.hold = false
    for (const h of this.held.splice(0)) h.resolve()
  }
  get waiting() {
    return this.held.length
  }
}

function memoryStore(): BackendChoiceStore & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return { data, getKv: async (k) => data.get(k) ?? null, setKv: async (k, v) => void data.set(k, v) }
}

function prefs() {
  const m = new Map<string, string>()
  return { get: (k: string) => m.get(k) ?? null, set: (k: string, v: string) => void m.set(k, v) }
}

function setup(over: Partial<ModelRuntimeOptions> & { responses?: FakeResponse[]; caps?: Partial<RuntimeCapabilities> } = {}) {
  const made: TestAdapter[] = []
  const opened: string[] = []
  const factories = ({ onEvent }: { onEvent: Emit }): BackendFactories => ({
    bonsai: () => {
      opened.push('bonsai')
      const a = new TestAdapter(onEvent, over.responses ?? script('minutes'), over.caps)
      made.push(a)
      return a
    },
    chrome: () => {
      opened.push('chrome')
      return new FakeLlm()
    },
    transformers: () => {
      opened.push('transformers')
      return new FakeLlm()
    },
  })
  const p = prefs()
  // The explanation was accepted on this browser before, unless a test says otherwise.
  p.set('swarmpress.llm.explained.bonsai', '1')
  const options: ModelRuntimeOptions = {
    search: '?central=1&llm=bonsai',
    companyId: 'c1',
    store: memoryStore(),
    factories,
    lock: null,
    storage: { estimate: async () => ({ quota: 100 * GB, usage: 10 * GB }), persisted: async () => true },
    cachedBytes: async () => 0,
    gpuFacts: async () => GOOD_GPU,
    prefs: p,
    log: () => undefined,
    ...over,
  }
  return { options, made, opened, prefs: p }
}

const runtimes: ModelRuntime[] = []
async function open(options: ModelRuntimeOptions) {
  const rt = await openModelRuntime(options)
  runtimes.push(rt)
  return rt
}
afterEach(async () => {
  vi.useRealTimers()
  for (const rt of runtimes.splice(0)) await rt.dispose()
})

describe('backend selection', () => {
  it('the URL wins, then the company’s stored choice, then the default', async () => {
    const store = memoryStore()
    store.data.set(backendKey('c1'), 'chrome')
    const s = setup({ store })
    expect((await open({ ...s.options, search: '?central=1&llm=bonsai' })).choice).toEqual({ id: 'bonsai', source: 'query' })
    expect((await open({ ...s.options, search: '?central=1' })).choice).toEqual({ id: 'chrome', source: 'stored' })
    expect((await open({ ...s.options, search: '?central=1', store: memoryStore() })).choice).toEqual({ id: 'bonsai', source: 'default' })
    // Choosing loads nothing.
    expect(s.opened).toEqual([])
  })

  it('?llm=fake is the scripted model: ready at once, nothing opened, no lock', async () => {
    const s = setup({ search: '?central=1&llm=fake', lock: () => electResident({ locks: new FakeLocks(), createChannel: null }) })
    const rt = await open(s.options)
    await rt.start()
    expect(rt.info().phase).toBe('scripted')
    expect(rt.status()).toEqual({ state: 'ready', detail: 'scripted model' })
    expect(rt.llm).toBeInstanceOf(FakeLlm)
    expect(s.opened).toEqual([])
  })

  it('an unknown ?llm= or a stored backend this build does not know blocks the model, not the session', async () => {
    const s = setup({ search: '?llm=claude' })
    const rt = await open(s.options)
    await rt.start()
    expect(rt.info()).toMatchObject({ phase: 'blocked', backend: null })
    expect(rt.status()).toEqual({ state: 'none', detail: '?llm=claude: unknown backend (use fake, bonsai, chrome, transformers)' })
    expect(s.opened).toEqual([])
  })

  it('a failed probe blocks with the reason; no other backend is opened, and a switch is the player’s explicit choice', async () => {
    const s = setup({ caps: { webgpu: false, unavailable: 'WebGPU is not available in this browser' } })
    const rt = await open(s.options)
    await rt.start()
    const info = rt.info()
    expect(info).toMatchObject({ phase: 'blocked', stage: 'probe', error: 'Ternary Bonsai 2 (in-browser WebGPU) cannot be used here: WebGPU is not available in this browser' })
    expect(info.stages.probe.state).toBe('failed')
    expect(rt.status()).toMatchObject({ state: 'none', detail: info.error })
    // Only the chosen backend was ever constructed.
    expect(s.opened).toEqual(['bonsai'])
    expect(s.made[0].disposed).toBe(true)
    // The notice offers the other local backends; choosing one stores it for the next page load.
    expect(info.alternatives).toEqual(['chrome', 'transformers'])
    await rt.switchBackend('chrome')
    expect((s.options.store as ReturnType<typeof memoryStore>).data.get(backendKey('c1'))).toBe('chrome')
    expect(s.opened).toEqual(['bonsai'])
    await expect(rt.switchBackend('fake')).rejects.toThrow(/not a backend a company can choose/)
  })
})

describe('startup', () => {
  it('runs the stages, holds the clock until the qualification turn passed, then lets calls through', async () => {
    const s = setup()
    const rt = await open(s.options)
    const states: string[] = []
    rt.onChange(() => states.push(rt.status().state + (rt.status().detail ? `:${rt.status().detail}` : '')))
    // A call made before the model is ready waits for it.
    const early = rt.llm.generate(ask, { maxTokens: 64 })
    await rt.start()
    const info = rt.info()
    expect(info.phase).toBe('ready')
    expect(rt.status()).toEqual({ state: 'ready' })
    expect(Object.fromEntries(Object.entries(info.stages).map(([k, v]) => [k, v.state]))).toEqual({
      explain: 'skipped',
      probe: 'done',
      storage: 'done',
      verify: 'done',
      download: 'done',
      load: 'done',
      'warm-up': 'done',
      qualify: 'done',
    })
    expect(info.fromCache).toBe(false)
    expect(info.loads).toBe(1)
    // What the chip said on the way, in order, until ready.
    expect(states).toContain('loading:checking WebGPU')
    expect(states).toContain('loading:downloading 50% (50 B of 100 B)')
    expect(states).toContain('loading:loading onto the GPU: Compiling kernels')
    expect(states).toContain('loading:qualification turn')
    expect(states.indexOf('ready')).toBe(states.length - 1)
    expect((await early).text).toBe('minutes')
    // The warm-up and the qualification turn ran before the game's call.
    expect(s.made[0].calls.map((c) => c.messages.at(-1)!.content)).toEqual([expect.stringMatching(/one word/), expect.stringMatching(/Who speaks next/), 'Write the standup minutes.'])
  })

  it('the first time it explains and waits; "not now" leaves the clock held, "start" goes on', async () => {
    const s = setup()
    s.prefs.set('swarmpress.llm.explained.bonsai', '0')
    const rt = await open(s.options)
    const started = rt.start()
    await flushMicrotasks()
    expect(rt.info().phase).toBe('explain')
    expect(rt.info().explain).toMatch(/about 5\.9 GB/)
    expect(rt.status()).toEqual({ state: 'none', detail: 'waiting for you to start the local model' })
    expect(s.opened).toEqual([])
    rt.decline()
    await started
    expect(rt.info().phase).toBe('declined')
    rt.accept()
    await flushMicrotasks()
    expect(rt.info().phase).toBe('explain')
    rt.accept()
    await vi.waitFor(() => expect(rt.info().phase).toBe('ready'))
    expect(s.prefs.get('swarmpress.llm.explained.bonsai')).toBe('1')
  })

  it('a storage refusal stops before any download; a retry checks storage again', async () => {
    let free = 1 * GB
    const s = setup({ storage: { estimate: async () => ({ quota: 100 * GB, usage: 100 * GB - free }), persisted: async () => true } })
    const rt = await open(s.options)
    await rt.start()
    expect(rt.info()).toMatchObject({ phase: 'failed', stage: 'storage' })
    expect(rt.status().detail).toMatch(/^check storage failed: not enough browser storage for the model: 1\.0 GB free, 5\.9 GB needed/)
    expect(s.made[0].loads).toEqual([])
    free = 20 * GB
    await rt.retry()
    expect(rt.info().phase).toBe('ready')
    // The retry started over from the probe: the first adapter was closed, a new one opened.
    expect(s.opened).toEqual(['bonsai', 'bonsai'])
  })

  it('a failed qualification turn keeps the model from the game; a retry loads again on the same adapter', async () => {
    const s = setup({ responses: ['ready', 'Giulia, I suppose.', '{"next": "everyone"}', 'ready', VALID, 'minutes'] })
    const rt = await open(s.options)
    await rt.start()
    expect(rt.info()).toMatchObject({ phase: 'failed', stage: 'qualify' })
    expect(rt.status()).toMatchObject({ state: 'none', detail: expect.stringMatching(/^qualification turn failed: the model did not produce a valid action/) })
    await rt.retry()
    expect(rt.info().phase).toBe('ready')
    expect(s.opened).toEqual(['bonsai'])
    expect(s.made[0].loads).toHaveLength(2)
    expect(rt.info().fromCache).toBe(true)
  })

  it('a read-only session loads nothing', async () => {
    const s = setup({ readOnly: true })
    const rt = await open(s.options)
    await rt.start()
    expect(rt.info().phase).toBe('read-only')
    expect(rt.status()).toEqual({ state: 'none', detail: 'read-only: this session does not run the company' })
    expect(s.opened).toEqual([])
  })
})

describe('one resident model per origin (two tabs, one lock)', () => {
  it('the second tab does not load a second model; it says where the model is, and can take it over', async () => {
    const locks = new FakeLocks()
    const hub = channelHub()
    const a = setup({ lock: () => electResident({ tabId: 'A', locks, createChannel: hub }), responses: script('a-1', 'a-2', 'a-3') })
    const b = setup({ lock: () => electResident({ tabId: 'B', locks, createChannel: hub }), responses: script('b-1') })
    const tabA = await open(a.options)
    await tabA.start()
    expect(tabA.info().phase).toBe('ready')

    const tabB = await open(b.options)
    await tabB.start()
    expect(tabB.info()).toMatchObject({ phase: 'elsewhere', canTakeOver: true })
    expect(tabB.status()).toEqual({ state: 'none', detail: 'the model is running in another tab' })
    // No second model: B never constructed an adapter.
    expect(b.opened).toEqual([])

    // A call in flight in tab A when B takes the model over is discarded there…
    a.made[0].hold = true
    const inFlight = tabA.llm.generate(ask)
    await flushMicrotasks()
    expect(a.made[0].waiting).toBe(1)
    await tabB.takeOver()
    await vi.waitFor(() => expect(tabB.info().phase).toBe('ready'))
    expect(b.opened).toEqual(['bonsai'])
    expect(tabA.info().phase).toBe('elsewhere')
    expect(a.made[0].disposed).toBe(true)
    expect((await tabB.llm.generate(ask)).text).toBe('b-1')

    // …and runs again once the model is back in A (B closed: A was waiting in line).
    a.made[0].release()
    await tabB.dispose()
    expect((await inFlight).text).toBe('a-1')
    expect(tabA.info()).toMatchObject({ phase: 'ready', discarded: 1 })
    expect(a.opened).toEqual(['bonsai', 'bonsai'])
  })
})

describe('device loss', () => {
  it('stops the call, holds the clock, and a reload succeeds although the lost call never returns', async () => {
    const s = setup({ responses: script('never used', 'ready', VALID, 'after the reload') })
    const rt = await open(s.options)
    await rt.start()
    const adapter = s.made[0]
    adapter.hold = true
    const call = rt.llm.generate(ask)
    await flushMicrotasks()
    // The device goes, and the generation in flight hangs for good.
    adapter.loseDevice('GPU process crashed', { hang: true })
    expect(rt.info()).toMatchObject({ phase: 'lost', error: 'GPU process crashed', losses: 1 })
    expect(rt.status()).toEqual({ state: 'lost', detail: 'GPU device lost: reload the model' })
    // The player reloads: the same adapter loads again (the stand-in for a fresh device), the hung call is not waited for.
    adapter.hold = false
    await rt.reload()
    expect(rt.info()).toMatchObject({ phase: 'ready', loads: 2, discarded: 1 })
    expect(adapter.loads).toHaveLength(2)
    expect(rt.info().stages.probe.state).toBe('skipped')
    // The discarded call ran again on the reloaded model: nothing of the lost one was kept.
    expect((await call).text).toBe('after the reload')
  })

  it('an unavailable answer without an event is a loss too; a call lost again and again gives up', async () => {
    // Each reload's warm-up and qualification pass, and the call is lost again every time.
    const lost = () => new LlmUnavailableError('the GPU device was lost; the call was discarded')
    const s = setup({ responses: [...script(lost()), ...script(lost()), ...script(lost())] })
    const rt = await open(s.options)
    await rt.start()
    const call = rt.llm.generate(ask).catch((e) => e)
    for (let i = 0; i <= MAX_REISSUES; i++) {
      await vi.waitFor(() => expect(rt.info().phase).toBe('lost'))
      if (i < MAX_REISSUES) await rt.reload()
    }
    const err = await call
    expect(err).toBeInstanceOf(LlmUnavailableError)
    expect(err.message).toMatch(/lost 3 times during one call/)
  })

  it('the debug hook is refused without ?llmdebug=1', async () => {
    const rt = await open(setup().options)
    await rt.start()
    await expect(rt.destroyDevice()).rejects.toThrow(/test hook/)
  })
})

describe('the GPU scheduler around generation', () => {
  it('lowers the scene while a call generates and restores it after the cooldown', async () => {
    vi.useFakeTimers()
    const s = setup({ responses: script('minutes') })
    const rt = await open(s.options)
    const calls: string[] = []
    const hooks: RendererHooks = { setQualityDrop: (n) => calls.push(`drop:${n}`), setFpsCap: (f) => calls.push(`cap:${f}`) }
    rt.attachRenderer(hooks)
    await rt.start()
    // The startup's own turns go to the adapter directly; the game's go through the gate.
    expect(calls).toEqual([])
    s.made[0].hold = true
    const call = rt.llm.generate(ask)
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toEqual(['drop:1', 'cap:30'])
    s.made[0].release()
    expect((await call).text).toBe('minutes')
    await vi.advanceTimersByTimeAsync(1000)
    expect(calls).toEqual(['drop:1', 'cap:30'])
    await vi.advanceTimersByTimeAsync(600)
    expect(calls).toEqual(['drop:1', 'cap:30', 'drop:0', 'cap:null'])
  })
})
