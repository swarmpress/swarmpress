import { describe, expect, it } from 'vitest'
import { FakeLlm } from './fake-llm'
import { applyStop, extractJson, runStructured, StructuredOutputError, stripReasoning, validateJsonSchema, withSchemaPrompt } from './structured'

const BRIEF = {
  type: 'object',
  required: ['title', 'angle', 'words'],
  additionalProperties: false,
  properties: {
    title: { type: 'string', minLength: 3 },
    angle: { type: 'string', enum: ['guide', 'story', 'news'] },
    words: { type: 'integer', minimum: 200, maximum: 2000 },
    tags: { type: 'array', items: { type: 'string' }, maxItems: 3 },
  },
}

describe('extractJson', () => {
  const ok = (text: string) => {
    const r = extractJson(text)
    if (!r.ok) throw new Error(r.error)
    return r.value
  }

  it('parses bare JSON', () => expect(ok('{"a":1}')).toEqual({ a: 1 }))
  it('parses top-level arrays', () => expect(ok('[1, 2, {"b": [3]}]')).toEqual([1, 2, { b: [3] }]))
  it('skips leading and trailing prose', () => expect(ok('Sure! Here it is: {"a": "x"} Hope that helps.')).toEqual({ a: 'x' }))
  it('prefers a ```json fence', () => expect(ok('Example {"no": 1}\n```json\n{"yes": true}\n```')).toEqual({ yes: true }))
  it('handles a fence without a language tag', () => expect(ok('```\n{"a": 2}\n```')).toEqual({ a: 2 }))
  it('ignores braces inside strings and escaped quotes', () =>
    expect(ok('{"t": "a } b { c \\" }", "n": {"m": "]"}}')).toEqual({ t: 'a } b { c " }', n: { m: ']' } }))
  it('tolerates trailing commas', () => expect(ok('{"a": [1, 2,], "b": 3,}')).toEqual({ a: [1, 2], b: 3 }))
  it('strips <think> reasoning blocks', () => expect(ok('<think>maybe {"wrong": 1}</think>{"right": 1}')).toEqual({ right: 1 }))
  it('skips a malformed span and finds the next object', () => expect(ok('{oops} then {"a": 1}')).toEqual({ a: 1 }))
  it('does not return a nested fragment of truncated output', () => {
    const r = extractJson('{"outer": {"inner": 1}, "cut": "abc')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/incomplete/)
  })
  it('reports when there is no JSON at all', () => {
    const r = extractJson('I cannot do that.')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/no JSON/)
  })
  it('treats an unterminated <think> as no answer', () => expect(stripReasoning('<think>still thinking {"a":1}')).toBe(''))
})

describe('validateJsonSchema', () => {
  it('accepts a valid object', () => expect(validateJsonSchema({ title: 'Hi there', angle: 'guide', words: 800 }, BRIEF)).toEqual({ ok: true }))
  it('lists every problem with a path', () => {
    const r = validateJsonSchema({ title: 'x', angle: 'rant', words: 80.5, extra: 1, tags: ['a', 'b', 'c', 'd'] }, BRIEF)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors).toEqual(
        expect.arrayContaining([
          '$.title: shorter than 3 characters',
          expect.stringMatching(/^\$\.angle: must be one of/),
          '$.words: expected integer, got number',
          '$.extra: is not allowed',
          '$.tags: allows at most 3 items',
        ]),
      )
    }
  })
  it('reports missing required keys', () => {
    const r = validateJsonSchema({}, BRIEF)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors).toContain('$.title: is required')
  })
})

describe('schema prompt', () => {
  it('merges into an existing system message', () => {
    const out = withSchemaPrompt([{ role: 'system', content: 'You are Giulia.' }, { role: 'user', content: 'go' }], BRIEF)
    expect(out).toHaveLength(2)
    expect(out[0].content).toMatch(/^You are Giulia\.\n\nRespond with a single JSON value/)
    expect(out[0].content).toContain('"required":["title","angle","words"]')
  })
  it('adds a system message when there is none', () => {
    expect(withSchemaPrompt([{ role: 'user', content: 'go' }], BRIEF)[0].role).toBe('system')
  })
})

describe('runStructured', () => {
  it('returns on the first valid attempt', async () => {
    const llm = new FakeLlm({ script: ['{"title": "Sentiero Azzurro", "angle": "guide", "words": 900}'] })
    const r = await runStructured((m, o) => llm.generate(m, o), [{ role: 'user', content: 'brief' }], BRIEF)
    expect(r.value).toEqual({ title: 'Sentiero Azzurro', angle: 'guide', words: 900 })
    expect(r.repairs).toBe(0)
    expect(llm.calls).toHaveLength(1)
  })

  it('repairs invalid JSON, feeding the errors back', async () => {
    const llm = new FakeLlm({
      script: ['Here you go: {"title": "Hi", "angle": "blog"', '{"title": "Hi", "angle": "blog", "words": 900}', '{"title": "Hike", "angle": "guide", "words": 900}'],
    })
    const attempts: string[][] = []
    const r = await runStructured((m, o) => llm.generate(m, o), [{ role: 'user', content: 'brief' }], BRIEF, {
      maxRepairs: 2,
      onAttempt: (a) => attempts.push(a.errors),
    })
    expect(r.repairs).toBe(2)
    expect(r.value).toEqual({ title: 'Hike', angle: 'guide', words: 900 })
    // 2nd call sees the 1st output and an error about incomplete JSON
    const second = llm.calls[1].messages
    expect(second.at(-2)).toEqual({ role: 'assistant', content: 'Here you go: {"title": "Hi", "angle": "blog"' })
    expect(second.at(-1)!.content).toMatch(/incomplete/)
    // 3rd call sees the schema violations of the 2nd
    expect(llm.calls[2].messages.at(-1)!.content).toMatch(/\$\.title: shorter than 3/)
    expect(attempts.map((a) => a.length > 0)).toEqual([true, true, false])
    expect(r.usage.completionTokens).toBeGreaterThan(0)
  })

  it('throws StructuredOutputError when repairs are exhausted', async () => {
    const llm = new FakeLlm({ responder: () => 'no json, sorry' })
    const err = await runStructured((m, o) => llm.generate(m, o), [{ role: 'user', content: 'brief' }], BRIEF, { maxRepairs: 1 }).catch((e) => e)
    expect(err).toBeInstanceOf(StructuredOutputError)
    expect((err as StructuredOutputError).attempts).toBe(2)
    expect((err as StructuredOutputError).lastText).toBe('no json, sorry')
    expect(llm.calls).toHaveLength(2)
  })

  it('uses an injected validator', async () => {
    const llm = new FakeLlm({ script: ['{"n": 1}', '{"n": 2}'] })
    const r = await runStructured((m, o) => llm.generate(m, o), [{ role: 'user', content: 'x' }], { type: 'object' }, {
      validate: (v) => ((v as { n: number }).n === 2 ? { ok: true } : { ok: false, errors: ['n must be 2 (content-model)'] }),
    })
    expect(r.value).toEqual({ n: 2 })
    expect(llm.calls[1].messages.at(-1)!.content).toContain('content-model')
  })

  it('mentions the token limit when output was cut off', async () => {
    const llm = new FakeLlm({ script: [{ text: '{"title": "abc", "an', finishReason: 'length' }, '{"title":"abc","angle":"news","words":300}'] })
    await runStructured((m, o) => llm.generate(m, o), [{ role: 'user', content: 'x' }], BRIEF)
    expect(llm.calls[1].messages.at(-1)!.content).toMatch(/token limit/)
  })
})

describe('applyStop', () => {
  it('cuts at the earliest stop sequence', () => expect(applyStop('a END b STOP', ['STOP', 'END'])).toEqual({ text: 'a ', stopped: true }))
  it('passes through without stops', () => expect(applyStop('abc', undefined)).toEqual({ text: 'abc', stopped: false }))
})
