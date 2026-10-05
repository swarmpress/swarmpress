import { describe, expect, it } from 'vitest'
import { LlamaCppLlm, type LlamaModelSpec, type LlamaModule } from './llama-llm'
import type { WeightFile } from './weights'

const SPEC: LlamaModelSpec = {
  repo: 'unsloth/gemma-4-E4B-it-qat-GGUF',
  revision: 'rev',
  target: { file: 'target.gguf', size: 100, sha256: 'a' },
  draft: { file: 'draft.gguf', size: 10, sha256: 'b' },
  context: 8192,
  runtimeUrl: 'http://localhost/vendor/llama/llama.mjs',
  mtp: false,
  draftMax: 4,
}

/** A scripted stand-in for the shim: sp_generate emits `pieces` one by one and stops when asked. */
function fakeModule(pieces: string[], over: { loadError?: string } = {}) {
  const calls: { name: string; args: unknown[] }[] = []
  const chat: [string, string][] = []
  const mod: LlamaModule = {
    FS: { mkdir() {}, mount() {}, unmount() {} },
    WORKERFS: {},
    ccall(name, _ret, _types, args) {
      calls.push({ name, args })
      if (name === 'sp_load') return Promise.resolve(JSON.stringify(over.loadError ? { ok: false, error: over.loadError } : { ok: true, n_ctx: 8192 }))
      if (name === 'sp_chat_reset') chat.length = 0
      if (name === 'sp_chat_add') chat.push([args[0] as string, args[1] as string])
      if (name === 'sp_generate') {
        const max = args[0] as number
        let n = 0
        let stopped = false
        let eog = true
        for (const p of pieces) {
          if (n >= max) {
            eog = false
            break
          }
          n++
          mod.onPiece?.(p)
          if (mod.stopRequested) {
            stopped = true
            eog = false
            break
          }
        }
        return Promise.resolve(
          JSON.stringify({ ok: true, promptTokens: 12, tokens: n, targetSteps: n, drafted: 0, accepted: 0, ttftMs: 50, decodeMs: 100 * Math.max(n - 1, 0), totalMs: 50 + 100 * n, stopped, eog }),
        )
      }
      if (name === 'sp_free') return Promise.resolve(undefined)
      return undefined
    },
  }
  return { mod, calls, chat }
}

function adapter(mod: LlamaModule, spec: LlamaModelSpec = SPEC) {
  const ensured: string[] = []
  const llm = new LlamaCppLlm({
    resolve: () => spec,
    fetch: (() => Promise.reject(new Error('no network in tests'))) as typeof fetch,
    openRuntime: async () => mod,
    weights: {
      stored: async (f: WeightFile) => f.size,
      ensure: async (f: WeightFile, _url, _fetch, onProgress) => {
        ensured.push(f.file)
        onProgress?.({ file: f.file, loaded: f.size, total: f.size, cached: true })
        return new File([], f.file)
      },
    },
  })
  return { llm, ensured }
}

describe('LlamaCppLlm', () => {
  it('loads the target only when MTP is off, and passes the conversation to the shim', async () => {
    const f = fakeModule(['Hello', ' world'])
    const { llm, ensured } = adapter(f.mod)
    const progress: string[] = []
    await llm.load('gemma-4-e4b-it-qat', (p) => progress.push(p.phase))
    expect(ensured).toEqual(['target.gguf'])
    expect(f.calls.find((c) => c.name === 'sp_load')?.args).toEqual(['/models/target.gguf', '', 8192, 4])
    expect(progress.at(-1)).toBe('ready')
    const deltas: string[] = []
    const r = await llm.generate(
      [
        { role: 'system', content: 'be brief' },
        { role: 'user', content: 'hi' },
      ],
      { onDelta: (d) => deltas.push(d), maxTokens: 10 },
    )
    expect(f.chat).toEqual([
      ['system', 'be brief'],
      ['user', 'hi'],
    ])
    expect(r.text).toBe('Hello world')
    expect(deltas.join('')).toBe('Hello world')
    expect(r.finishReason).toBe('stop')
    expect(r.usage).toMatchObject({ promptTokens: 12, completionTokens: 2, ttftMs: 50, tokensPerSec: 10 })
  })

  it('loads the drafter when the spec asks for MTP and drafts with it', async () => {
    const f = fakeModule(['x'])
    const { llm, ensured } = adapter(f.mod, { ...SPEC, mtp: true, draftMax: 3 })
    await llm.load('m')
    expect(ensured).toEqual(['target.gguf', 'draft.gguf'])
    expect(f.calls.find((c) => c.name === 'sp_load')?.args).toEqual(['/models/target.gguf', '/models/draft.gguf', 8192, 3])
    await llm.generate([{ role: 'user', content: 'go' }])
    expect(f.calls.find((c) => c.name === 'sp_generate')?.args[1]).toBe(1)
  })

  it('cuts at a stop sequence, never emits it, and stops the runtime', async () => {
    const f = fakeModule(['one ', 'two', ' EN', 'D three', ' four'])
    const { llm } = adapter(f.mod)
    await llm.load('m')
    const deltas: string[] = []
    const r = await llm.generate([{ role: 'user', content: 'count' }], { stop: [' END'], onDelta: (d) => deltas.push(d) })
    expect(r.text).toBe('one two')
    expect(deltas.join('')).toBe('one two')
    expect(r.finishReason).toBe('stop')
    expect(r.usage.completionTokens).toBe(4)
  })

  it('starts the answer with the prefix and stops when the JSON value is complete', async () => {
    const f = fakeModule(['"a": 1', '}', ' and more'])
    const { llm } = adapter(f.mod)
    await llm.load('m')
    const r = await llm.generate([{ role: 'user', content: 'json' }], { answerPrefix: '{', stopOnJsonEnd: true })
    expect(f.calls.find((c) => c.name === 'sp_generate')?.args[3]).toBe('{')
    expect(r.text).toBe('{"a": 1}')
    expect(r.finishReason).toBe('stop')
  })

  it('reports length when the token budget ends the turn, and cancelled on abort', async () => {
    const f = fakeModule(['a', 'b', 'c', 'd'])
    const { llm } = adapter(f.mod)
    await llm.load('m')
    expect((await llm.generate([{ role: 'user', content: 'x' }], { maxTokens: 2 })).finishReason).toBe('length')
    const ac = new AbortController()
    ac.abort()
    const r = await llm.generate([{ role: 'user', content: 'x' }], { signal: ac.signal })
    expect(r.finishReason).toBe('cancelled')
  })

  it('structured output parses and validates through the shared repair loop', async () => {
    const f = fakeModule(['{"title": "Vernazza"}'])
    const { llm } = adapter(f.mod)
    await llm.load('m')
    const v = await llm.structured<{ title: string }>([{ role: 'user', content: 'title' }], { type: 'object', required: ['title'], properties: { title: { type: 'string' } } })
    expect(v).toEqual({ title: 'Vernazza' })
  })

  it('a failed load says why, and nothing counts as loaded', async () => {
    const f = fakeModule([], { loadError: 'failed to load the target model' })
    const { llm } = adapter(f.mod)
    await expect(llm.load('m')).rejects.toThrow(/failed to load the target model/)
    expect(llm.modelId).toBeNull()
    await expect(llm.generate([{ role: 'user', content: 'x' }])).rejects.toThrow(/no model loaded/)
  })
})
