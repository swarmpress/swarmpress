import { describe, expect, it } from 'vitest'
import {
  BACKENDS,
  BACKEND_IDS,
  BackendUnavailableError,
  DEFAULT_BACKEND,
  backendFromQuery,
  backendKey,
  chooseBackend,
  openBackend,
  storeBackend,
  type BackendChoiceStore,
} from './backend'
import { ChromePromptLlm, CHROME_LABEL } from './chrome-prompt-llm'
import { FakeLlm } from './fake-llm'
import { DEFAULT_REGISTRY } from './registry.default'
import { findModel } from './registry'
import type { RuntimeCapabilities } from './types'

function memoryStore(): BackendChoiceStore & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getKv: async (k) => data.get(k) ?? null,
    setKv: async (k, v) => {
      data.set(k, v)
    },
  }
}

const caps = (over: Partial<RuntimeCapabilities> = {}): RuntimeCapabilities => ({
  backend: 'x',
  label: 'x',
  webgpu: true,
  supportsConstrainedOutput: false,
  supportsPrefixReuse: false,
  supportsVision: false,
  reasoningModes: ['off'],
  contextTokens: null,
  ...over,
})

describe('backend choice', () => {
  it('reads ?llm= and rejects a value it does not know', () => {
    expect(backendFromQuery('?llm=bonsai')).toBe('bonsai')
    expect(backendFromQuery('?central=1&llm=chrome')).toBe('chrome')
    expect(backendFromQuery('?llm=fake')).toBe('fake')
    expect(backendFromQuery('?llm=transformers')).toBe('transformers')
    expect(backendFromQuery('?central=1')).toBeNull()
    expect(backendFromQuery('?llm=')).toBeNull()
    expect(() => backendFromQuery('?llm=claude')).toThrow(/unknown backend/)
  })

  it('the URL wins, then the stored choice, then the default', async () => {
    const store = memoryStore()
    expect(await chooseBackend({ search: '', companyId: 'c1', store })).toEqual({ id: DEFAULT_BACKEND, source: 'default' })
    expect(DEFAULT_BACKEND).toBe('gemma')
    await storeBackend(store, 'c1', 'chrome')
    expect(store.data.get(backendKey('c1'))).toBe('chrome')
    expect(await chooseBackend({ search: '', companyId: 'c1', store })).toEqual({ id: 'chrome', source: 'stored' })
    // Another company has its own choice.
    expect(await chooseBackend({ search: '', companyId: 'c2', store })).toEqual({ id: 'gemma', source: 'default' })
    // ?llm= is a one-off: it wins and is not written back.
    expect(await chooseBackend({ search: '?llm=fake', companyId: 'c1', store })).toEqual({ id: 'fake', source: 'query' })
    expect(store.data.get(backendKey('c1'))).toBe('chrome')
  })

  it('a stored value from another build is an error, not a silent default', async () => {
    const store = memoryStore()
    store.data.set(backendKey('c1'), 'cloud')
    await expect(chooseBackend({ search: '', companyId: 'c1', store })).rejects.toThrow(/not one this build knows/)
  })

  it('every backend is local, and its registry model exists', () => {
    expect(Object.keys(BACKENDS).sort()).toEqual([...BACKEND_IDS].sort())
    for (const b of Object.values(BACKENDS)) {
      if (b.modelId) expect(findModel(DEFAULT_REGISTRY, b.modelId), b.id).toBeDefined()
      expect(b.label).not.toMatch(/cloud|api/i)
    }
    expect(BACKENDS.chrome.label).toBe(CHROME_LABEL)
    expect(BACKENDS.chrome.runsIn).toBe('window')
    expect(BACKENDS.bonsai.runsIn).toBe('worker')
  })
})

describe('openBackend', () => {
  it('opens the chosen backend and returns its capabilities', async () => {
    const llm = Object.assign(new FakeLlm(), { capabilities: async () => caps({ backend: 'fake', contextTokens: 16384 }) })
    const opened = await openBackend('fake', { fake: () => llm })
    expect(opened.llm).toBe(llm)
    expect(opened.info.id).toBe('fake')
    expect(opened.capabilities.contextTokens).toBe(16384)
  })

  it('gives an adapter without a probe the minimum capabilities', async () => {
    const opened = await openBackend('fake', { fake: () => new FakeLlm() })
    expect(opened.capabilities).toMatchObject({ backend: 'fake', supportsConstrainedOutput: false, reasoningModes: ['off'] })
  })

  it('a backend that cannot run fails; no other backend is opened in its place', async () => {
    let chromeOpened = false
    let disposed = false
    const bonsai = Object.assign(new FakeLlm(), {
      capabilities: async () => caps({ webgpu: false, unavailable: 'WebGPU is not available in this browser' }),
      dispose: async () => {
        disposed = true
      },
    })
    const err = await openBackend('bonsai', {
      bonsai: () => bonsai,
      chrome: () => {
        chromeOpened = true
        return new FakeLlm()
      },
    }).catch((e) => e)
    expect(err).toBeInstanceOf(BackendUnavailableError)
    expect(err.message).toBe('Ternary Bonsai 2 (in-browser WebGPU) cannot be used here: WebGPU is not available in this browser')
    expect(err.backend).toBe('bonsai')
    expect(err.capabilities.webgpu).toBe(false)
    expect(chromeOpened).toBe(false)
    expect(disposed).toBe(true)
  })

  it('a probe that throws and a missing adapter are both unavailable', async () => {
    const throwing = Object.assign(new FakeLlm(), {
      capabilities: async () => {
        throw new Error('worker crashed')
      },
    })
    await expect(openBackend('transformers', { transformers: () => throwing })).rejects.toThrow(/cannot be used here: worker crashed/)
    await expect(openBackend('chrome', {})).rejects.toThrow(/no adapter/)
  })

  it('the Chrome backend without the Prompt API is unavailable', async () => {
    if ((globalThis as { LanguageModel?: unknown }).LanguageModel) return
    const err = await openBackend('chrome', { chrome: () => new ChromePromptLlm() }).catch((e) => e)
    expect(err).toBeInstanceOf(BackendUnavailableError)
    expect(err.message).toMatch(/Chrome built-in AI \(browser-managed\) cannot be used here/)
  })

  it('passes the backend\'s registry model to a worker client probe', async () => {
    const seen: (string | undefined)[] = []
    const llm = Object.assign(new FakeLlm(), {
      capabilities: async (modelId?: string) => {
        seen.push(modelId)
        return caps()
      },
    })
    await openBackend('bonsai', { bonsai: () => llm })
    expect(seen).toEqual(['ternary-bonsai-2-27b'])
  })
})
