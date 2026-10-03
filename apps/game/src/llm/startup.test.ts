// The startup of a local model backend (§22 of the concept document, ADR-0057,
// increment R8), with fakes for the adapter, the GPU and navigator.storage.
import { describe, expect, it } from 'vitest'
import { BACKENDS, BackendUnavailableError, type BackendId, type OpenedBackend } from './backend'
import { FakeLlm, type FakeResponse } from './fake-llm'
import {
  checkStorage,
  downloadDetail,
  explainText,
  formatBytes,
  gpuShortfall,
  runStartup,
  StartupError,
  type StartupDeps,
  type StartupEvent,
  type StorageLike,
} from './startup'
import type { LoadProgress, RuntimeCapabilities } from './types'

const GB = 1e9
const SIZE = 5_946_648_928
const NEED = { minMaxBufferSize: 2 * 1024 ** 3, minStorageBufferBindingSize: 2 * 1024 ** 3, features: ['shader-f16'] }
const GOOD_GPU = { features: ['shader-f16', 'subgroups'], maxBufferSize: 4 * 1024 ** 3, maxStorageBufferBindingSize: 4 * 1024 ** 3 }
const VALID = '{"next": "giulia", "reason": "Her draft is ready."}'

/** A scripted adapter whose load reports the given progress events. */
class LoadingLlm extends FakeLlm {
  constructor(
    private events: Omit<LoadProgress, 'modelId' | 'files'>[],
    script: FakeResponse[],
    private caps: Partial<RuntimeCapabilities> = {},
  ) {
    super({ script })
  }
  override async load(modelId: string, onProgress?: (p: LoadProgress) => void) {
    this.loads.push(modelId)
    for (const e of this.events) onProgress?.({ modelId, files: {}, ...e })
    this.modelId = modelId
  }
  async capabilities(): Promise<RuntimeCapabilities> {
    return { backend: 'bonsai-kernels', label: 'x', webgpu: true, supportsConstrainedOutput: false, supportsPrefixReuse: true, supportsVision: false, reasoningModes: ['off'], contextTokens: null, ...this.caps }
  }
}

const cold: Omit<LoadProgress, 'modelId' | 'files'>[] = [
  { phase: 'download', loaded: 0, total: SIZE, fraction: 0, message: 'Requesting WebGPU device' },
  { phase: 'download', loaded: SIZE / 4, total: SIZE, fraction: 0.25, fromCache: false },
  { phase: 'download', loaded: SIZE, total: SIZE, fraction: 1, fromCache: false },
  { phase: 'init', loaded: SIZE, total: SIZE, fraction: 1, message: 'Compiling kernels' },
  { phase: 'ready', loaded: SIZE, total: SIZE, fraction: 1 },
]
const warm = cold.map((e) => (e.phase === 'download' && e.loaded > 0 ? { ...e, fromCache: true } : e))

function storage(free: number, o: { persisted?: boolean; grant?: boolean } = {}): StorageLike & { asked: number } {
  const s = {
    asked: 0,
    estimate: async () => ({ quota: 100 * GB, usage: 100 * GB - free }),
    persisted: async () => o.persisted ?? false,
    persist: async () => {
      s.asked++
      return o.grant ?? true
    },
  }
  return s
}

function deps(over: Partial<StartupDeps> & { llm?: FakeLlm; backend?: BackendId } = {}) {
  const backend = over.backend ?? 'bonsai'
  const llm = over.llm ?? new LoadingLlm(cold, ['ready', VALID], { device: GOOD_GPU })
  const events: StartupEvent[] = []
  let explained = false
  const asked: string[] = []
  let opens = 0
  const d: StartupDeps = {
    backend,
    modelId: BACKENDS[backend].modelId ?? 'chrome-built-in',
    sizeBytes: backend === 'chrome' ? null : SIZE,
    open: async (): Promise<OpenedBackend> => {
      opens++
      return { info: BACKENDS[backend], llm, capabilities: await (llm as LoadingLlm).capabilities() }
    },
    requirements: backend === 'chrome' ? null : NEED,
    storage: storage(50 * GB),
    cachedBytes: async () => 0,
    explain: async (text) => {
      asked.push(text)
      return true
    },
    explained: { get: () => explained, set: () => (explained = true) },
    onEvent: (e) => events.push(e),
    ...over,
  }
  return { d, llm, events, asked, opens: () => opens, explained: () => explained }
}

/** `stage:state` pairs, in order, without the progress repeats of an active stage. */
const sequence = (events: StartupEvent[]) => events.map((e) => `${e.stage}:${e.state}`).filter((s, i, a) => s !== a[i - 1])

describe('runStartup', () => {
  it('runs every stage in order the first time, and only then is the model ready', async () => {
    const t = deps()
    const r = await runStartup(t.d)
    expect(sequence(t.events)).toEqual([
      'explain:active',
      'explain:done',
      'probe:active',
      'probe:done',
      'storage:active',
      'storage:done',
      'verify:active',
      'verify:done',
      'download:active',
      'download:done',
      'load:active',
      'load:done',
      'warm-up:active',
      'warm-up:done',
      'qualify:active',
      'qualify:done',
    ])
    // The explanation names the local runtime and the download size, once.
    expect(t.asked).toHaveLength(1)
    expect(t.asked[0]).toMatch(/in this browser/)
    expect(t.asked[0]).toContain('5.9 GB')
    expect(t.explained()).toBe(true)
    // Byte progress, and the engine's message while the GPU loads.
    const details = t.events.filter((e) => e.stage === 'download' && e.state === 'active' && e.detail).map((e) => e.detail)
    expect(details).toEqual(['downloading 25% (1.5 GB of 5.9 GB)', 'downloading 100% (5.9 GB of 5.9 GB)'])
    expect(t.events.find((e) => e.stage === 'verify' && e.detail)?.detail).toBe('Requesting WebGPU device')
    expect(t.events.find((e) => e.stage === 'load' && e.state === 'active')?.detail).toBe('Compiling kernels')
    expect(r.fromCache).toBe(false)
    expect(r.storage).toMatchObject({ free: 50 * GB, needed: SIZE, cached: 0, persistent: true })
    // Warm-up: one short turn with thinking off; the qualification: one structured action, forced to start at `{`.
    expect(t.llm.calls.map((c) => c.opts.maxTokens)).toEqual([8, 96])
    expect(t.llm.calls[1].opts).toMatchObject({ thinking: 'off', answerPrefix: '{', stopOnJsonEnd: true })
    expect(t.events.at(-1)).toEqual({ stage: 'qualify', state: 'done', detail: 'a valid action (giulia speaks next)' })
  })

  it('a warm start skips the explanation and says the weights came from the browser cache', async () => {
    const t = deps({ llm: new LoadingLlm(warm, ['ready', VALID], { device: GOOD_GPU }) })
    t.d.explained.set()
    const r = await runStartup(t.d)
    expect(t.events[0]).toEqual({ stage: 'explain', state: 'skipped', detail: 'explained before' })
    expect(t.asked).toEqual([])
    expect(r.fromCache).toBe(true)
    expect(t.events.some((e) => e.detail === 'reading the browser cache 25% (1.5 GB of 5.9 GB)')).toBe(true)
    expect(t.events.find((e) => e.stage === 'download' && e.state === 'done')?.detail).toBe('read from the browser cache')
  })

  it('stops at the explanation when the player does not start the model, before anything is opened', async () => {
    const t = deps({ explain: async () => false })
    const err = await runStartup(t.d).catch((e) => e)
    expect(err).toBeInstanceOf(StartupError)
    expect(err).toMatchObject({ stage: 'explain', kind: 'declined' })
    expect(t.opens()).toBe(0)
    expect(t.explained()).toBe(false)
  })

  it('a failed probe blocks: the reason is shown and nothing else is tried', async () => {
    const t = deps({
      open: async () => {
        throw new BackendUnavailableError('bonsai', 'WebGPU is not available in this browser', null)
      },
    })
    const err = await runStartup(t.d).catch((e) => e)
    expect(err).toMatchObject({ stage: 'probe', kind: 'blocked', message: 'Ternary Bonsai 2 (in-browser WebGPU) cannot be used here: WebGPU is not available in this browser' })
    expect(sequence(t.events)).toEqual(['explain:active', 'explain:done', 'probe:active', 'probe:failed'])
  })

  it('a GPU without what the model needs blocks too, and the adapter is closed', async () => {
    const llm = new LoadingLlm(cold, [], { device: { ...GOOD_GPU, features: ['subgroups'] } })
    const t = deps({ llm })
    const err = await runStartup(t.d).catch((e) => e)
    expect(err).toMatchObject({ stage: 'probe', kind: 'blocked' })
    expect(err.message).toMatch(/does not offer the WebGPU feature shader-f16/)
    expect(llm.disposed).toBe(true)
    expect(gpuShortfall({ ...GOOD_GPU, maxBufferSize: 1024 ** 3 }, NEED)).toMatch(/allows buffers of 1.1 GB; the model needs 2.1 GB/)
    expect(gpuShortfall({ ...GOOD_GPU, maxBufferSize: null }, NEED)).toBeNull()
  })

  it('refuses to download into storage that cannot hold the model, before any byte is fetched', async () => {
    const llm = new LoadingLlm(cold, [], { device: GOOD_GPU })
    const t = deps({ llm, storage: storage(2 * GB) })
    const err = await runStartup(t.d).catch((e) => e)
    expect(err).toMatchObject({ stage: 'storage', kind: 'failed' })
    expect(err.message).toBe(`not enough browser storage for the model: 2.0 GB free, 5.9 GB needed. Free some space (or remove other sites' data) and try again.`)
    expect(llm.loads).toEqual([])
    expect(sequence(t.events).slice(-2)).toEqual(['storage:active', 'storage:failed'])
  })

  it('counts what is cached, and says so honestly when persistence is refused', async () => {
    const s = storage(3 * GB, { grant: false })
    const t = deps({ storage: s, cachedBytes: async () => 4 * GB })
    const r = await runStartup(t.d)
    expect(s.asked).toBe(1)
    expect(r.storage).toMatchObject({ needed: SIZE - 4 * GB, cached: 4 * GB, persistent: false })
    expect(t.events.find((e) => e.stage === 'storage' && e.state === 'done')?.detail).toBe(
      '3.0 GB free · 1.9 GB to download · 4.0 GB cached · not persistent: the browser may evict the model when space runs low',
    )
    // No storage API at all: measured as unknown, not refused.
    expect(await checkStorage(null, SIZE, 0)).toMatchObject({ free: null, persistent: null, needed: SIZE })
  })

  it('a model that loads but cannot produce a valid action is not ready', async () => {
    const t = deps({ llm: new LoadingLlm(cold, ['ready', 'I think Giulia.', '{"next": "everyone"}'], { device: GOOD_GPU }) })
    const err = await runStartup(t.d).catch((e) => e)
    expect(err).toMatchObject({ stage: 'qualify', kind: 'failed' })
    expect(err.message).toMatch(/^the model did not produce a valid action: /)
    expect(sequence(t.events).slice(-2)).toEqual(['qualify:active', 'qualify:failed'])
  })

  it('a load that fails is reported on the stage it was in', async () => {
    const llm = new LoadingLlm(cold.slice(0, 2), [], { device: GOOD_GPU })
    llm.load = async (_id, onProgress) => {
      for (const e of cold.slice(0, 2)) onProgress?.({ modelId: 'm', files: {}, ...e })
      throw new Error('HTTP 503 from the Hub')
    }
    const t = deps({ llm })
    const err = await runStartup(t.d).catch((e) => e)
    expect(err).toMatchObject({ stage: 'download', kind: 'failed', message: 'HTTP 503 from the Hub' })
  })

  it('Chrome manages its own storage; a reload after a loss skips explain, probe and storage', async () => {
    const chrome = deps({ backend: 'chrome', llm: new LoadingLlm([{ phase: 'ready', loaded: 1, total: 1, fraction: 1 }], ['ready', VALID]) })
    await runStartup(chrome.d)
    expect(chrome.events.find((e) => e.stage === 'storage')).toEqual({ stage: 'storage', state: 'skipped', detail: 'Chrome manages its own model storage' })
    expect(chrome.events.find((e) => e.stage === 'download')).toEqual({ stage: 'download', state: 'skipped', detail: 'nothing to download' })
    expect(chrome.asked[0]).toMatch(/Chrome downloads, stores and updates its own model/)

    const t = deps()
    const first = await runStartup(t.d)
    ;(t.llm as FakeLlm).push('ready', VALID)
    const again = deps({ reuse: first.opened, llm: t.llm, explained: { get: () => true, set: () => undefined } })
    await runStartup(again.d)
    expect(again.opens()).toBe(0)
    expect(sequence(again.events).slice(0, 3)).toEqual(['explain:skipped', 'probe:skipped', 'storage:skipped'])
    expect((t.llm as FakeLlm).loads).toHaveLength(2)
  })

  it('formats sizes and progress the way the card shows them', () => {
    expect(formatBytes(SIZE)).toBe('5.9 GB')
    expect(formatBytes(2_800_000_000)).toBe('2.8 GB')
    expect(formatBytes(160_000)).toBe('160 kB')
    expect(downloadDetail({ modelId: 'm', phase: 'download', files: {}, loaded: 0.4, total: 1, fraction: 0.4 })).toBe('downloading 40%')
    expect(explainText('transformers', 2_800_000_000)).toMatch(/Transformers\.js .* is about 2\.8 GB/)
  })
})
