// BonsaiLlm against a fake upstream session (testing/fake-session.ts), which
// models the engine's cache and stream semantics as read from its code. No
// GPU and no engine: the real engine is exercised by e2e/bonsai*.spec.ts
// (gated by BONSAI_E2E=1).
import { describe, expect, it } from 'vitest'
import { BonsaiLlm, importVerifiedEngine, mapProgress, partialStop, shimEngineGlobals, verifyRemoteFile, type BonsaiModel, type RuntimeEvent } from './bonsai-llm'
import { sha256Hex } from './extract'
import { fakeEngine, FakeSession, IM_START, THINK_CLOSE, type FakeResponse, type FakeSessionOptions } from './testing/fake-session'
import { StructuredOutputError } from '../../structured'
import { isUnavailableError, LlmUnavailableError, type ChatMessage, type LoadProgress } from '../../types'

const MODEL: BonsaiModel = {
  hfRepo: 'prism-ml/Ternary-Bonsai-2-27B-gguf',
  file: 'Ternary-Bonsai-2-27B-PTQ1_0.gguf',
  revision: 'b072e1d3b35a0a630cece372c2127528e0994386',
  sha256: 'a'.repeat(64),
  sizeBytes: 100,
  context: 4096,
  runtime: { url: 'https://game.test/vendor/bonsai/engine.mjs', sha256: 'b'.repeat(64) },
}

const SYSTEM = 'You are Giulia, a writer at the Dispatch.'
const ask = (text: string, system = SYSTEM): ChatMessage[] => [
  { role: 'system', content: system },
  { role: 'user', content: text },
]

async function setup(script: FakeResponse[], o: FakeSessionOptions = {}) {
  const session = new FakeSession({ script, ...o })
  const engine = fakeEngine(session)
  const events: RuntimeEvent[] = []
  const llm = new BonsaiLlm({ resolve: () => MODEL, importEngine: async () => engine, skipRemoteCheck: true, onEvent: (e) => events.push(e) })
  const progress: LoadProgress[] = []
  await llm.load('ternary-bonsai-2-27b', (p) => progress.push(p))
  return { llm, session, engine, events, progress }
}

/** What the adapter believes the cache holds must be what it holds. */
function expectLedgerMatchesCache(llm: BonsaiLlm, session: FakeSession) {
  expect(llm.ledgerStats().held).toBe(session.cache.get_seq_length())
  expect((llm as unknown as { ledger: { held(): number[] } }).ledger.held()).toEqual(session.cache.ids)
}

describe('BonsaiLlm.load', () => {
  it('loads the pinned file and revision with its own prefix store turned off', async () => {
    const { llm, engine, progress } = await setup([])
    expect(llm.modelId).toBe('ternary-bonsai-2-27b')
    expect(engine.loads).toHaveLength(1)
    expect(engine.loads[0].modelId).toBe(MODEL.hfRepo)
    expect(engine.loads[0].opts).toMatchObject({
      file: MODEL.file,
      revision: MODEL.revision,
      maxLength: MODEL.context,
      prefixSnapshotStore: null,
      chatTemplateArgs: { enable_thinking: false, reasoning_effort: 'medium' },
    })
    expect(progress.map((p) => p.phase)).toEqual(['download', 'download', 'init', 'ready'])
    expect(progress[1]).toMatchObject({ loaded: 50, total: 100, fraction: 0.5, message: 'Streaming weights' })
    expect(progress.at(-1)).toMatchObject({ phase: 'ready', fraction: 1 })
    // Loading the same model again does nothing.
    await llm.load('ternary-bonsai-2-27b')
    expect(engine.loads).toHaveLength(1)
  })

  it("carries the engine's fromCache flag through to the progress events", async () => {
    // A cold start downloads; the fake engine of setup() says so.
    const { progress } = await setup([])
    expect(progress[1]).toMatchObject({ phase: 'download', fromCache: false })
    // A warm start reads the bytes from the browser cache.
    const warm = new BonsaiLlm({ resolve: () => MODEL, importEngine: async () => fakeEngine(new FakeSession(), { fromCache: true }), skipRemoteCheck: true })
    const seen: LoadProgress[] = []
    await warm.load('ternary-bonsai-2-27b', (p) => seen.push(p))
    expect(seen.filter((p) => p.phase === 'download' && p.loaded > 0).map((p) => p.fromCache)).toEqual([true])
    // Events that do not say leave it out rather than guessing.
    expect(mapProgress('m', 100, { status: 'weights', kind: 'bytes', loaded: 10, total: 100 }, null)).not.toHaveProperty('fromCache')
    expect(mapProgress('m', 100, { status: 'weights', kind: 'bytes', loaded: 10, total: 100, fromCache: true }, null)).toMatchObject({ loaded: 10, fraction: 0.1, fromCache: true })
  })

  it('reports capabilities: WebGPU, no constrained output, prefix reuse, the context', async () => {
    const { llm } = await setup([])
    const caps = await llm.capabilities()
    expect(caps).toMatchObject({
      backend: 'bonsai-kernels',
      webgpu: true,
      supportsConstrainedOutput: false,
      supportsPrefixReuse: true,
      reasoningModes: ['off', 'medium', 'xhigh'],
      contextTokens: 4096,
      device: { device: 'fake-gpu', decodePipelineDepth: 8, gpuBytes: { live: 1, peak: 2 } },
    })
    // It crosses the worker boundary: plain data only.
    expect(structuredClone(caps)).toEqual(caps)
  })

  it('before a load it probes the device and says when WebGPU is missing', async () => {
    const llm = new BonsaiLlm({ resolve: () => MODEL })
    // vitest runs under Node: there is no navigator.gpu.
    expect(await llm.capabilities()).toMatchObject({ webgpu: false, contextTokens: null, unavailable: expect.stringMatching(/WebGPU/) })
    await expect(llm.generate(ask('hi'))).rejects.toThrow(/no model loaded/)
  })
})

describe('BonsaiLlm.generate', () => {
  it('answers a prompt that has a system message, through the low-level stream', async () => {
    const { llm, session } = await setup([{ answer: 'Buongiorno from Manarola!' }])
    const deltas: string[] = []
    const res = await llm.generate(ask('Say hello.'), { maxTokens: 50, onDelta: (d) => deltas.push(d) })
    expect(res.text).toBe('Buongiorno from Manarola!')
    expect(deltas.join('')).toBe(res.text)
    expect(res.finishReason).toBe('stop')
    // The upstream high-level generate() would have thrown on this prompt.
    expect(() => session.generate(ask('x'))).toThrow(/No user query/)
    // One merged system message first; thinking off renders the empty think block.
    const prompt = session.rendered.at(-1)!
    expect(prompt.startsWith(`${IM_START}system\n${SYSTEM}`)).toBe(true)
    expect(prompt.endsWith(`<think>\n\n${THINK_CLOSE}\n\n`)).toBe(true)
    expect(session.chatTemplateArgs).toEqual({ enable_thinking: false, reasoning_effort: 'medium' })
    expect(res.usage).toMatchObject({ reasoningTokens: 0, cachedPromptTokens: expect.any(Number) })
    expect(res.usage.completionTokens).toBe(session.tokenizer.encode('Buongiorno from Manarola!').ids.length)
    expectLedgerMatchesCache(llm, session)
  })

  it('merges several system layers into one first message', async () => {
    const { llm, session } = await setup([{ answer: 'ok' }])
    await llm.generate([
      { role: 'system', content: 'Company voice.' },
      { role: 'system', content: 'Persona: Marco.' },
      { role: 'user', content: 'go' },
    ])
    expect(session.rendered.at(-1)).toContain(`${IM_START}system\nCompany voice.\n\nPersona: Marco.`)
    expect(session.rendered.at(-1)!.match(/<\|im_start\|>system/g)).toHaveLength(1)
  })

  it('splits reasoning from the answer on the think-close token', async () => {
    const { llm, session } = await setup([{ reasoning: 'The user wants a greeting. Keep it short.\n', answer: 'Ciao!' }])
    const deltas: string[] = []
    const res = await llm.generate(ask('Greet.'), { thinking: 'medium', maxTokens: 20, onDelta: (d) => deltas.push(d) })
    expect(res.text).toBe('Ciao!')
    // No reasoning and no blank line leaks into the answer or its deltas.
    expect(deltas.join('')).toBe('Ciao!')
    expect(res.usage.reasoningTokens).toBe(session.tokenizer.encode('The user wants a greeting. Keep it short.\n').ids.length)
    expect(res.usage.completionTokens).toBeGreaterThan(0)
    expect(session.chatTemplateArgs).toEqual({ enable_thinking: true, reasoning_effort: 'medium' })
    expect(session.rendered.at(-1)!.endsWith('<think>\n')).toBe(true)
    expect(res.finishReason).toBe('stop')
    expectLedgerMatchesCache(llm, session)
  })

  it('closes the reasoning block itself at the reasoning cap, and the model then answers', async () => {
    const long = 'one two three four five six seven eight nine ten eleven twelve'
    const { llm, session } = await setup([{ reasoning: long, answer: 'Done.' }])
    const res = await llm.generate(ask('Think hard.'), { thinking: 'medium', reasoningBudget: 5, maxTokens: 20 })
    expect(res.text).toBe('Done.')
    expect(res.usage.reasoningTokens).toBe(5)
    expect(res.finishReason).toBe('stop')
    // Three stream calls: the system prefix, the capped reasoning, then the forced close plus the answer.
    expect(session.streams).toHaveLength(3)
    expect(session.streams[1].yielded).toBe(5)
    // The last reasoning token had not been fed back; the resume prefills it before the close.
    expect(session.streams[2].suffix).toBe(`three\n${THINK_CLOSE}\n\n`)
    expectLedgerMatchesCache(llm, session)
  })

  it('stops as soon as the root JSON value is complete', async () => {
    const { llm, session } = await setup([{ answer: '{"next": "staff-2", "done": false} and then a lot more text nobody asked for' }])
    const res = await llm.generate(ask('Who speaks next?'), { stopOnJsonEnd: true, maxTokens: 100 })
    expect(JSON.parse(res.text.slice(0, res.text.indexOf('}') + 1))).toEqual({ next: 'staff-2', done: false })
    expect(res.text).not.toContain('nobody asked')
    expect(res.finishReason).toBe('stop')
    expect(session.streams.at(-1)!.yielded).toBeLessThan(10)
    expectLedgerMatchesCache(llm, session)
  })

  it('forces an answer prefix when thinking is off', async () => {
    const { llm, session } = await setup([{ answer: '{"a": 1}' }])
    const deltas: string[] = []
    const res = await llm.generate(ask('JSON please.'), { answerPrefix: '{', stopOnJsonEnd: true, onDelta: (d) => deltas.push(d) })
    expect(res.text).toBe('{"a": 1}')
    expect(deltas.join('')).toBe('{"a": 1}')
    // The prefix is prefilled after the prompt, not generated.
    expect(session.streams.at(-1)!.suffix.endsWith('{')).toBe(true)
    // With thinking on the prefix cannot precede the reasoning block, so it is not applied.
    session.push({ reasoning: 'hm', answer: '{"b": 2}' })
    const thought = await llm.generate(ask('JSON again.'), { thinking: 'medium', answerPrefix: '{', stopOnJsonEnd: true })
    expect(thought.text).toBe('{"b": 2}')
  })

  it('reports length when the answer budget runs out', async () => {
    const { llm, session } = await setup([{ answer: 'a b c d e f' }])
    const res = await llm.generate(ask('Count.'), { maxTokens: 3 })
    expect(res.finishReason).toBe('length')
    expect(res.usage.completionTokens).toBe(3)
    expect(res.text).toBe('a b')
    expectLedgerMatchesCache(llm, session)
  })

  it('cuts at a stop sequence and never streams part of it', async () => {
    const { llm } = await setup([{ answer: 'alpha beta STOP gamma' }])
    const deltas: string[] = []
    const res = await llm.generate(ask('Go.'), { stop: ['STOP gamma'], onDelta: (d) => deltas.push(d) })
    expect(res.text).toBe('alpha beta ')
    expect(deltas.join('')).toBe('alpha beta ')
    expect(res.finishReason).toBe('stop')
    expect(partialStop('abc ST', ['STOP'])).toBe(2)
    expect(partialStop('abc', ['STOP'])).toBe(0)
    expect(partialStop('abc', undefined)).toBe(0)
  })

  it('cancels between tokens and keeps the cache usable', async () => {
    const ac = new AbortController()
    const { llm, session } = await setup([{ answer: 'w1 w2 w3 w4 w5 w6 w7 w8' }, { answer: 'second answer' }])
    const res = await llm.generate(ask('Long.'), { signal: ac.signal, onDelta: () => ac.abort() })
    expect(res.finishReason).toBe('cancelled')
    expect(res.usage.completionTokens).toBeLessThan(8)
    expectLedgerMatchesCache(llm, session)
    const next = await llm.generate(ask('Again.'))
    expect(next.text).toBe('second answer')
    // An already aborted signal does not touch the model.
    const before = session.streams.length
    const aborted = new AbortController()
    aborted.abort()
    expect((await llm.generate(ask('x'), { signal: aborted.signal })).finishReason).toBe('cancelled')
    expect(session.streams.length).toBe(before)
  })

  it('refuses a prompt that does not fit the context window', async () => {
    const { llm } = await setup([{ answer: 'x' }], { context: 24 })
    await expect(llm.generate(ask('word '.repeat(40)))).rejects.toThrow(/too long for the context window/)
  })

  it('serialises concurrent calls: one resident model, one turn at a time', async () => {
    const { llm } = await setup([{ answer: 'first' }, { answer: 'second' }, { answer: 'third' }])
    const out = await Promise.all(['a', 'b', 'c'].map((q) => llm.generate(ask(q))))
    expect(out.map((r) => r.text)).toEqual(['first', 'second', 'third'])
  })
})

describe('BonsaiLlm prefix reuse', () => {
  it('prefills the system prefix once and rewinds to it for later calls', async () => {
    const { llm, session } = await setup([{ answer: 'one' }, { answer: 'two' }, { answer: 'three' }])
    const first = await llm.generate(ask('First question.'))
    const prefix = session.tokenizer.encode(`${IM_START}system\n${SYSTEM}<|im_end|>\n`).ids.length
    expect(first.usage.cachedPromptTokens).toBe(prefix)
    // This call prefilled the prefix itself: reported apart from the prefill of the rest.
    expect(first.usage.primedTokens).toBe(prefix)
    expect(first.usage.primeMs).toBeGreaterThanOrEqual(0)
    expect(llm.ledgerStats()).toMatchObject({ primes: 1, rewinds: 0, snapshots: 1, rewind: prefix })
    const second = await llm.generate(ask('Second question.'))
    expect(second.text).toBe('two')
    expect(second.usage.cachedPromptTokens).toBe(prefix)
    expect(second.usage).toMatchObject({ primedTokens: 0, primeMs: 0 })
    expect(llm.ledgerStats()).toMatchObject({ primes: 1, rewinds: 1 })
    // The second call prefilled only what follows the system block.
    expect(session.streams.at(-1)!.suffix.startsWith(`${IM_START}user\nSecond question.`)).toBe(true)
    // Thinking on shares the same system prefix (same reasoning_effort).
    const third = await llm.generate(ask('Third question.'), { thinking: 'medium' })
    expect(third.usage.cachedPromptTokens).toBe(prefix)
    expect(session.cache.captures).toBe(1)
    expectLedgerMatchesCache(llm, session)
  })

  it('restores a remembered snapshot when a system prompt comes back', async () => {
    const { llm, session } = await setup([{ answer: 'a' }, { answer: 'b' }, { answer: 'c' }])
    await llm.generate(ask('q1', 'System A.'))
    await llm.generate(ask('q2', 'System B.'))
    expect(llm.ledgerStats()).toMatchObject({ primes: 2, snapshots: 2 })
    const back = await llm.generate(ask('q3', 'System A.'))
    expect(back.text).toBe('c')
    expect(llm.ledgerStats()).toMatchObject({ primes: 2, imports: 1 })
    expect(session.cache.imports).toBe(1)
    expectLedgerMatchesCache(llm, session)
  })

  it('continues from the cache when the next prompt extends the last turn', async () => {
    const { llm, session } = await setup([{ answer: 'draft one' }, { answer: 'draft two' }])
    const first = ask('Write.')
    await llm.generate(first)
    // The same conversation with the previous answer and a follow-up: the cache is a prefix of it.
    const res = await llm.generate([...first, { role: 'assistant', content: 'draft one' }, { role: 'user', content: 'Shorter.' }])
    expect(res.text).toBe('draft two')
    expect(llm.ledgerStats().continues).toBe(1)
    expect(res.usage.cachedPromptTokens).toBeGreaterThan(first.length)
    // Only the unseen tail was prefilled. The first turn ended on EOS, so its whole answer is in the cache.
    expect(session.streams.at(-1)!.suffix.startsWith('<|im_end|>\n<|im_start|>user\nShorter.')).toBe(true)
    expectLedgerMatchesCache(llm, session)
  })

  it('without rewind support every call starts from an empty cache', async () => {
    const { llm, session } = await setup([{ answer: 'a' }, { answer: 'b' }], { canRewind: false })
    expect((await llm.capabilities()).supportsPrefixReuse).toBe(false)
    await llm.generate(ask('q1'))
    const second = await llm.generate(ask('q2'))
    expect(second.usage.cachedPromptTokens).toBe(0)
    expect(llm.ledgerStats()).toMatchObject({ primes: 0, resets: 2 })
    expectLedgerMatchesCache(llm, session)
  })

  it('after an abandoned stream on a cache that cannot roll back, it returns to the rewind point', async () => {
    const { llm, session } = await setup([{ answer: '{"a": 1} extra extra extra' }, { answer: 'next' }], { checkpoints: false })
    const res = await llm.generate(ask('JSON.'), { stopOnJsonEnd: true })
    expect(res.text.startsWith('{"a": 1}')).toBe(true)
    // The stream was abandoned mid-decode: nothing after the system prefix is trusted.
    expect(session.cache.get_seq_length()).toBe(llm.ledgerStats().rewind)
    expectLedgerMatchesCache(llm, session)
    expect((await llm.generate(ask('Then?'))).text).toBe('next')
  })

  it('resetSession empties the cache and forgets the snapshots', async () => {
    const { llm, session } = await setup([{ answer: 'a' }, { answer: 'b' }])
    await llm.generate(ask('q1'))
    await llm.resetSession()
    expect(session.cache.get_seq_length()).toBe(0)
    expect(llm.ledgerStats()).toMatchObject({ snapshots: 0, held: 0, rewind: -1 })
    expect((await llm.generate(ask('q2'))).text).toBe('b')
    expect(llm.ledgerStats().primes).toBe(2)
  })
})

describe('BonsaiLlm.structured', () => {
  const schema = { type: 'object', required: ['title'], additionalProperties: false, properties: { title: { type: 'string', minLength: 3 } } }

  it('repairs invalid output with reasoning off and returns the valid value', async () => {
    const { llm, session } = await setup([
      { reasoning: 'thinking about titles', answer: '{"title": "x"}' },
      { answer: '{"title": "Harvest week"}' },
    ])
    const value = await llm.structured<{ title: string }>(ask('Title?'), schema, { thinking: 'medium', maxTokens: 50 })
    expect(value).toEqual({ title: 'Harvest week' })
    // The repair turn quotes the answer only (no reasoning) and runs without thinking.
    const repair = session.rendered.at(-1)!
    expect(repair).toContain('{"title": "x"}')
    expect(repair).not.toContain('thinking about titles')
    expect(repair).toContain('shorter than 3 characters')
    expect(repair.endsWith(`<think>\n\n${THINK_CLOSE}\n\n`)).toBe(true)
  })

  it('gives up with StructuredOutputError when the repairs are exhausted', async () => {
    const { llm } = await setup([{ answer: 'no json' }, { answer: 'still none' }])
    await expect(llm.structured(ask('Title?'), schema, { maxRepairs: 1 })).rejects.toBeInstanceOf(StructuredOutputError)
  })
})

describe('BonsaiLlm.bench', () => {
  it("returns the same token ids through the adapter's path as through the engine's own benchmark", async () => {
    const { llm, session } = await setup([{ answer: 'the quick brown fox jumps' }, { answer: 'the quick brown fox jumps' }])
    const messages: ChatMessage[] = [{ role: 'user', content: 'Complete the sentence.' }]
    const upstream = await llm.bench({ messages, maxNewTokens: 6, mode: 'upstream' })
    const adapter = await llm.bench({ messages, maxNewTokens: 6, mode: 'adapter' })
    expect(adapter.ids).toEqual(upstream.ids)
    expect(adapter.tokens).toBe(6)
    expect(adapter.promptTokens).toBe(upstream.promptTokens)
    expect(adapter.depth).toBe(8)
    // Both leave an empty cache behind.
    expect(session.cache.get_seq_length()).toBe(0)
    await expect(llm.bench({ maxNewTokens: 4, mode: 'adapter' })).rejects.toThrow(/messages or ids/)
  })
})

describe('BonsaiLlm device loss', () => {
  it('reports a lost device and refuses to generate until the model is loaded again', async () => {
    const { llm, session, events } = await setup([{ answer: 'x' }])
    session.loseDevice('GPU process crashed')
    await new Promise((r) => setTimeout(r, 0))
    expect(events).toEqual([{ kind: 'device-lost', message: 'GPU process crashed' }])
    await expect(llm.generate(ask('hi'))).rejects.toThrow(/GPU device was lost.*reload/)
    expect(await llm.capabilities()).toMatchObject({ contextTokens: null })
  })

  it('a device destroyed by our own dispose is not a loss; uncaptured GPU errors are events', async () => {
    const { llm, session, engine, events } = await setup([{ answer: 'x' }])
    engine.loads[0].opts.runtimeOptions!.diagnosticSink!({ stage: 'execute', message: 'WebGPU uncaptured error: out of memory' })
    expect(events).toEqual([{ kind: 'gpu-error', message: 'WebGPU uncaptured error: out of memory' }])
    session.loseDevice('', 'destroyed')
    await new Promise((r) => setTimeout(r, 0))
    expect(events).toHaveLength(1)
    expect((await llm.generate(ask('still there?'))).text).toBe('x')
    await llm.dispose()
    expect(session.destroyed).toBe(true)
    expect(llm.modelId).toBeNull()
  })

  it('a lost device with a hung generation: every call is rejected as unavailable, and the reload does not wait for the hung one', async () => {
    // The first session's GPU work stops returning once the device is gone: its stream never yields again.
    let hang = false
    const never = new Promise<void>(() => undefined)
    const first = new FakeSession({ script: [{ answer: 'never seen' }], perToken: async () => (hang ? never : undefined) })
    const second = new FakeSession({ script: [{ answer: 'back again' }] })
    const sessions = [first, second]
    const engine = fakeEngine(() => sessions.shift()!)
    const events: RuntimeEvent[] = []
    const llm = new BonsaiLlm({ resolve: () => MODEL, importEngine: async () => engine, skipRemoteCheck: true, onEvent: (e) => events.push(e) })
    await llm.load('ternary-bonsai-2-27b')

    hang = true
    const running = llm.generate(ask('A long draft.')).catch((e) => e)
    const queued = llm.generate(ask('Next in line.')).catch((e) => e)
    const benchQueued = llm.bench({ messages: ask('ids'), maxNewTokens: 2, mode: 'adapter' }).catch((e) => e)
    await new Promise((r) => setTimeout(r, 0))
    first.loseDevice('GPU process crashed')
    // The in-flight call is discarded, the queued ones never run.
    for (const e of [await running, await queued, await benchQueued]) {
      expect(isUnavailableError(e)).toBe(true)
      expect(e).toBeInstanceOf(LlmUnavailableError)
    }
    expect(events).toEqual([{ kind: 'device-lost', message: 'GPU process crashed' }])
    await expect(llm.generate(ask('during the loss'))).rejects.toThrow(/GPU device was lost.*reload/)

    // The reload disposes the lost session without waiting for the hung generation, and the model answers again.
    await llm.load('ternary-bonsai-2-27b')
    expect(first.destroyed).toBe(true)
    expect(engine.loads).toHaveLength(2)
    expect((await llm.generate(ask('Are you back?'))).text).toBe('back again')
    expectLedgerMatchesCache(llm, second)
  })

  it('the destroyDevice test hook is reported as a device loss, unlike our own dispose', async () => {
    const { llm, session, events } = await setup([{ answer: 'x' }])
    await llm.destroyDevice()
    await new Promise((r) => setTimeout(r, 0))
    expect(session.deviceDestroyed).toBe(true)
    expect(events).toEqual([{ kind: 'device-lost', message: 'Device was destroyed.' }])
    await expect(llm.generate(ask('hi'))).rejects.toBeInstanceOf(LlmUnavailableError)
    // The engine's own dispose destroys the device too (reason "destroyed"); that is not a loss.
    const other = await setup([{ answer: 'still here' }])
    other.session.runtime.host.device.destroy()
    await new Promise((r) => setTimeout(r, 0))
    expect(other.events).toEqual([])
    expect((await other.llm.generate(ask('there?'))).text).toBe('still here')
    await other.llm.dispose()
    await expect(other.llm.destroyDevice()).rejects.toThrow(/no GPU device to destroy/)
  })

  it('resets the cache when a stream throws, and the next call works', async () => {
    let fail = true
    const { llm, session } = await setup([{ answer: 'a b c' }, { answer: 'recovered' }], {
      perToken: async () => {
        if (fail && session.cache.get_seq_length() > 0 && session.streams.length > 1) {
          fail = false
          throw new Error('kernel failed')
        }
      },
    })
    await expect(llm.generate(ask('q1'))).rejects.toThrow('kernel failed')
    expect(session.cache.get_seq_length()).toBe(0)
    expectLedgerMatchesCache(llm, session)
    // The failed turn consumed its scripted response; the next one is served normally.
    expect((await llm.generate(ask('q2'))).text).toBe('recovered')
  })
})

describe('engine import and remote verification', () => {
  const headFetch = (headers: Record<string, string>, status = 200) =>
    (async () => new Response(null, { status, headers })) as unknown as typeof fetch

  it('accepts the Hub metadata that matches the manifest', async () => {
    await expect(verifyRemoteFile(MODEL, headFetch({ 'x-linked-etag': `"${MODEL.sha256}"`, 'x-linked-size': '100' }))).resolves.toBeUndefined()
  })

  it('refuses a different hash, a different size or missing metadata', async () => {
    await expect(verifyRemoteFile(MODEL, headFetch({ 'x-linked-etag': `"${'c'.repeat(64)}"`, 'x-linked-size': '100' }))).rejects.toThrow(/does not match the manifest/)
    await expect(verifyRemoteFile(MODEL, headFetch({ 'x-linked-etag': `"${MODEL.sha256}"`, 'x-linked-size': '99' }))).rejects.toThrow(/does not match the manifest/)
    await expect(verifyRemoteFile(MODEL, headFetch({}))).rejects.toThrow(/refusing to load unverified weights/)
    await expect(verifyRemoteFile(MODEL, headFetch({}, 404))).rejects.toThrow(/HTTP 404/)
  })

  it('load checks the Hub before handing the file to the engine', async () => {
    const session = new FakeSession()
    const engine = fakeEngine(session)
    const llm = new BonsaiLlm({ resolve: () => MODEL, importEngine: async () => engine, fetch: headFetch({ 'x-linked-etag': 'wrong', 'x-linked-size': '100' }) })
    await expect(llm.load('ternary-bonsai-2-27b')).rejects.toThrow(/does not match the manifest/)
    expect(engine.loads).toHaveLength(0)
  })

  it('refuses an engine that is missing or is not the pinned build', async () => {
    const missing = (async () => new Response('not found', { status: 404 })) as unknown as typeof fetch
    await expect(importVerifiedEngine(MODEL.runtime, missing)).rejects.toThrow(/not installed.*bonsai:runtime/)
    // A dev server answers a missing file with its index page: 200, wrong hash.
    const other = (async () => new Response('<!doctype html>')) as unknown as typeof fetch
    await expect(importVerifiedEngine(MODEL.runtime, other)).rejects.toThrow(/not the pinned build/)
    expect(await sha256Hex('<!doctype html>')).not.toBe(MODEL.runtime.sha256)
  })

  it('shims the globals the engine reads, in a worker scope only', () => {
    const worker: Record<string, unknown> = { requestAnimationFrame: () => 0 }
    shimEngineGlobals(worker)
    expect(worker.requestAnimationFrame).toBeUndefined()
    expect(worker.process).toEqual({ env: {} })
    // A window keeps its requestAnimationFrame and an existing process object.
    const raf = () => 0
    const win: Record<string, unknown> = { requestAnimationFrame: raf, document: {}, process: { env: { A: '1' } } }
    shimEngineGlobals(win)
    expect(win.requestAnimationFrame).toBe(raf)
    expect(win.process).toEqual({ env: { A: '1' } })
  })
})
