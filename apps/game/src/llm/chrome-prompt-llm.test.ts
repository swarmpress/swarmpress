// ChromePromptLlm against a fake `LanguageModel` that follows the Prompt API
// as documented (availability, create with initialPrompts and a download
// monitor, clone, prompt with responseConstraint, promptStreaming, destroy,
// quota accounting). The real API needs Chrome and a user gesture; it is
// exercised by hand and by the qualification harness.
import { describe, expect, it } from 'vitest'
import {
  CHROME_BACKEND,
  CHROME_LABEL,
  CHROME_MODEL_ID,
  ChromePromptLlm,
  type LanguageModelApi,
  type PromptAvailability,
  type PromptCreateOptions,
  type PromptMessage,
  type PromptOptions,
  type PromptSession,
} from './chrome-prompt-llm'
import { StructuredOutputError } from './structured'
import type { ChatMessage, LoadProgress } from './types'

type Reply = string | { error: string; message?: string } | { chunks: string[] }

interface FakeApiOptions {
  availability?: PromptAvailability
  replies?: Reply[]
  /** Use the newer property names (contextWindow / measureContextUsage). */
  newNames?: boolean
  quota?: number
  streaming?: boolean
}

function fakeApi(o: FakeApiOptions = {}) {
  const replies = [...(o.replies ?? [])]
  const log = {
    created: [] as PromptCreateOptions[],
    prompts: [] as { system: string; input: PromptMessage[]; opts?: PromptOptions }[],
    clones: 0,
    destroyed: 0,
    live: 0,
  }
  const tokens = (input: string | PromptMessage[]) =>
    (typeof input === 'string' ? input : input.map((m) => m.content).join(' ')).split(/\s+/).filter(Boolean).length

  const session = (system: string): PromptSession => {
    log.live++
    let dead = false
    const quota = o.quota ?? 1000
    const next = (input: string | PromptMessage[], opts?: PromptOptions): Reply => {
      if (dead) throw Object.assign(new Error('session destroyed'), { name: 'InvalidStateError' })
      if (opts?.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
      log.prompts.push({ system, input: input as PromptMessage[], opts })
      const r = replies.shift()
      if (r === undefined) throw new Error('fake LanguageModel: no reply scripted')
      if (typeof r === 'object' && 'error' in r) throw Object.assign(new Error(r.message ?? r.error), { name: r.error })
      return r
    }
    const s: PromptSession = {
      async prompt(input, opts) {
        const r = next(input, opts)
        return typeof r === 'string' ? r : (r as { chunks: string[] }).chunks.join('')
      },
      async clone() {
        log.clones++
        return session(system)
      },
      destroy() {
        if (!dead) {
          dead = true
          log.destroyed++
          log.live--
        }
      },
    }
    if (o.streaming !== false) {
      s.promptStreaming = async function* (input, opts) {
        const r = next(input, opts)
        const chunks = typeof r === 'string' ? r.match(/\S+\s*/g) ?? [] : (r as { chunks: string[] }).chunks
        for (const c of chunks) {
          if (opts?.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
          yield c
        }
      }
    }
    if (o.newNames) {
      s.contextWindow = quota
      s.contextUsage = tokens(system)
      s.measureContextUsage = async (input) => tokens(input)
    } else {
      s.inputQuota = quota
      s.inputUsage = tokens(system)
      s.measureInputUsage = async (input) => tokens(input)
    }
    return s
  }

  const api: LanguageModelApi = {
    async availability() {
      return o.availability ?? 'available'
    },
    async create(opts = {}) {
      log.created.push(opts)
      opts.monitor?.({
        addEventListener: (_type, fn) => {
          fn({ loaded: 0.5 })
          fn({ loaded: 1 })
        },
      })
      return session(opts.initialPrompts?.[0]?.content ?? '')
    },
  }
  return { api, log }
}

const ask = (text: string, system = 'You are Marco, the editor.'): ChatMessage[] => [
  { role: 'system', content: system },
  { role: 'user', content: text },
]

async function loaded(o: FakeApiOptions = {}) {
  const f = fakeApi(o)
  const llm = new ChromePromptLlm({ languageModel: f.api, userAgent: 'Mozilla/5.0 Chrome/154.0.8037.95 Safari/537.36' })
  await llm.load(CHROME_MODEL_ID)
  return { llm, ...f }
}

describe('ChromePromptLlm load and capabilities', () => {
  it('is labelled as browser-managed and never claims application-controlled WebGPU', async () => {
    const { llm } = await loaded()
    const caps = await llm.capabilities()
    expect(caps).toMatchObject({
      backend: CHROME_BACKEND,
      label: CHROME_LABEL,
      webgpu: false,
      supportsConstrainedOutput: true,
      reasoningModes: ['off'],
      contextTokens: 1000,
      device: { browser: '154.0.8037.95' },
    })
    expect(CHROME_LABEL).toMatch(/browser-managed/)
  })

  it('reports download progress while Chrome fetches its model', async () => {
    const { api } = fakeApi({ availability: 'downloadable' })
    const llm = new ChromePromptLlm({ languageModel: api })
    const progress: LoadProgress[] = []
    await llm.load(CHROME_MODEL_ID, (p) => progress.push(p))
    expect(progress.map((p) => [p.phase, p.fraction])).toEqual([
      ['download', 0],
      ['download', 0.5],
      ['download', 1],
      ['ready', 1],
    ])
    expect(llm.modelId).toBe(CHROME_MODEL_ID)
  })

  it('says why it is unavailable instead of loading something else', async () => {
    const none = new ChromePromptLlm({ languageModel: undefined })
    // No API object at all (not Chrome, or the feature is off).
    if (!(globalThis as { LanguageModel?: unknown }).LanguageModel) {
      expect((await none.capabilities()).unavailable).toMatch(/not available in this browser/)
      await expect(none.load(CHROME_MODEL_ID)).rejects.toThrow(/not available in this browser/)
    }
    const { api } = fakeApi({ availability: 'unavailable' })
    const llm = new ChromePromptLlm({ languageModel: api })
    expect((await llm.capabilities()).unavailable).toMatch(/cannot run on this device/)
    await expect(llm.load(CHROME_MODEL_ID)).rejects.toThrow(/cannot run on this device/)
    await expect(llm.generate(ask('hi'))).rejects.toThrow(/no model loaded/)
  })
})

describe('ChromePromptLlm.generate', () => {
  it('streams a completion from a clone of the system-prompt session', async () => {
    const { llm, log } = await loaded({ replies: ['Tighten the lede and cut the last paragraph.'] })
    const deltas: string[] = []
    const res = await llm.generate(ask('Review this.'), { onDelta: (d) => deltas.push(d) })
    expect(res.text).toBe('Tighten the lede and cut the last paragraph.')
    expect(deltas.join('')).toBe(res.text)
    expect(res.finishReason).toBe('stop')
    // The system prompt went into a base session; the call saw only the conversation.
    expect(log.created.at(-1)!.initialPrompts).toEqual([{ role: 'system', content: 'You are Marco, the editor.' }])
    expect(log.prompts[0]).toMatchObject({ system: 'You are Marco, the editor.', input: [{ role: 'user', content: 'Review this.' }] })
    // The clone is destroyed after the call; the base sessions stay (the loaded one and Marco's).
    expect(log.live).toBe(2)
  })

  it('reuses one base session per system prompt and keeps at most three', async () => {
    const { llm, log } = await loaded({ replies: ['a', 'b', 'c', 'd', 'e'] })
    await llm.generate(ask('q1', 'S1'))
    await llm.generate(ask('q2', 'S1'))
    const afterTwo = log.created.length
    await llm.generate(ask('q3', 'S2'))
    await llm.generate(ask('q4', 'S3'))
    await llm.generate(ask('q5', 'S4'))
    // load created the system-less base; S1 was created once for two calls.
    expect(afterTwo).toBe(2)
    expect(log.created.length).toBe(5)
    expect(log.clones).toBe(5)
    expect(log.live).toBe(3)
  })

  it('enforces the output cap by aborting and reports length', async () => {
    const { llm } = await loaded({ replies: [{ chunks: ['aaaa ', 'bbbb ', 'cccc ', 'dddd ', 'eeee '] }] })
    const res = await llm.generate(ask('Go on.'), { maxTokens: 3 })
    expect(res.finishReason).toBe('length')
    // 3 tokens at 4 characters each: the stream is cut once 12 characters are in.
    expect(res.text).toBe('aaaa bbbb cccc ')
  })

  it('stops at a stop sequence and honours cancellation', async () => {
    const { llm } = await loaded({ replies: ['alpha beta STOP gamma', 'w1 w2 w3 w4 w5 w6'] })
    expect((await llm.generate(ask('x'), { stop: ['STOP'] })).text).toBe('alpha beta ')
    const ac = new AbortController()
    const res = await llm.generate(ask('long'), { signal: ac.signal, onDelta: () => ac.abort() })
    expect(res.finishReason).toBe('cancelled')
    expect(res.text.length).toBeLessThan('w1 w2 w3 w4 w5 w6'.length)
  })

  it('fails loudly when the prompt does not fit the context, under both spellings of the quota API', async () => {
    for (const newNames of [false, true]) {
      const { llm, log } = await loaded({ replies: ['never used'], quota: 8, newNames })
      await expect(llm.generate(ask('one two three four five six seven eight nine ten'))).rejects.toThrow(/context window exceeded.*allows 8/)
      expect(log.prompts).toHaveLength(0)
      expect((await llm.capabilities()).contextTokens).toBe(8)
    }
  })

  it('falls back to prompt() when the session cannot stream', async () => {
    const { llm } = await loaded({ replies: ['whole answer'], streaming: false })
    expect((await llm.generate(ask('x'))).text).toBe('whole answer')
  })
})

describe('ChromePromptLlm.structured', () => {
  const schema = { type: 'object', required: ['score'], additionalProperties: false, properties: { score: { type: 'integer', minimum: 1, maximum: 10 } } }

  it('passes the schema as responseConstraint and validates the answer', async () => {
    const { llm, log } = await loaded({ replies: ['{"score": 8}'] })
    expect(await llm.structured(ask('Score it.'), schema)).toEqual({ score: 8 })
    expect(log.prompts[0].opts?.responseConstraint).toEqual(schema)
  })

  it('a constraint does not make an answer right: an invalid value goes to the repair loop', async () => {
    const { llm, log } = await loaded({ replies: ['{"score": 12}', '{"score": 12}', '{"score": 7}'] })
    expect(await llm.structured(ask('Score it.'), schema)).toEqual({ score: 7 })
    // One constrained call, then prompt-and-repair turns without the constraint.
    expect(log.prompts.map((p) => Boolean(p.opts?.responseConstraint))).toEqual([true, false, false])
    expect(log.prompts[2].input.at(-1)!.content).toMatch(/must be <= 10/)
  })

  it('uses the injected validator (the Rust one in the session)', async () => {
    const { llm } = await loaded({ replies: ['{"score": 8}', '{"score": 8}', '{"score": 9}'] })
    const value = await llm.structured(ask('Score it.'), schema, {
      validate: (v) => ((v as { score: number }).score === 9 ? { ok: true } : { ok: false, errors: ['score must be 9'] }),
    })
    expect(value).toEqual({ score: 9 })
  })

  it('falls back to prompt-and-repair when the API refuses the schema', async () => {
    const { llm, log } = await loaded({ replies: [{ error: 'NotSupportedError', message: 'unsupported schema keyword' }, '{"score": 5}'] })
    expect(await llm.structured(ask('Score it.'), schema)).toEqual({ score: 5 })
    expect(log.prompts.map((p) => Boolean(p.opts?.responseConstraint))).toEqual([true, false])
  })

  it('gives up with StructuredOutputError; other API errors propagate', async () => {
    const { llm } = await loaded({ replies: ['nope', 'nope', 'nope', 'nope'] })
    await expect(llm.structured(ask('Score it.'), schema)).rejects.toBeInstanceOf(StructuredOutputError)
    const broken = await loaded({ replies: [{ error: 'UnknownError', message: 'the model process crashed' }] })
    await expect(broken.llm.structured(ask('Score it.'), schema)).rejects.toThrow(/model process crashed/)
  })
})

describe('ChromePromptLlm lifecycle', () => {
  it('resetSession drops the per-prompt sessions; dispose destroys everything', async () => {
    const { llm, log } = await loaded({ replies: ['a', 'b'] })
    await llm.generate(ask('q1', 'S1'))
    await llm.generate(ask('q2', 'S2'))
    expect(log.live).toBe(3)
    await llm.resetSession()
    expect(log.live).toBe(1)
    await llm.dispose()
    expect(log.live).toBe(0)
    expect(llm.modelId).toBeNull()
  })
})
