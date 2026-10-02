import { describe, expect, it } from 'vitest'
import { FakeTokenizer, THINK_CLOSE } from './testing/fake-session'
import { IncrementalDecoder, JsonBalance, mergeSystem, systemPrefix, systemPrefixIds, templateArgs, thinkCloseIds } from './think'
import type { UpstreamTokenizer } from './upstream'

describe('templateArgs', () => {
  it('off is a hard switch; off and medium share the effort so the system block is identical', () => {
    expect(templateArgs('off')).toEqual({ enable_thinking: false, reasoning_effort: 'medium' })
    expect(templateArgs('medium')).toEqual({ enable_thinking: true, reasoning_effort: 'medium' })
    // xhigh is the template default; "high" is never sent (upstream raises on it).
    expect(templateArgs('xhigh')).toEqual({ enable_thinking: true })
  })
})

describe('mergeSystem', () => {
  it('joins every system message into one, first', () => {
    expect(
      mergeSystem([
        { role: 'system', content: 'company' },
        { role: 'user', content: 'hi' },
        { role: 'system', content: 'persona' },
        { role: 'assistant', content: 'yes' },
        { role: 'user', content: 'again' },
      ]),
    ).toEqual([
      { role: 'system', content: 'company\n\npersona' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'yes' },
      { role: 'user', content: 'again' },
    ])
  })

  it('leaves a conversation without a system message alone and needs a user message', () => {
    expect(mergeSystem([{ role: 'user', content: 'hi' }])).toEqual([{ role: 'user', content: 'hi' }])
    expect(() => mergeSystem([{ role: 'system', content: 's' }])).toThrow(/user message/)
  })
})

describe('system prefix', () => {
  const tok = new FakeTokenizer()
  const prompt = '<|im_start|>system\nYou are Giulia.<|im_end|>\n<|im_start|>user\nWrite.<|im_end|>\n<|im_start|>assistant\n'

  it('is the rendered prompt up to the first user turn', () => {
    expect(systemPrefix(prompt)).toBe('<|im_start|>system\nYou are Giulia.<|im_end|>\n')
    expect(systemPrefix('<|im_start|>user\nhi<|im_end|>\n')).toBe('')
  })

  it('gives the ids only when they are a strict prefix of the prompt ids', () => {
    const ids = tok.encode(prompt).ids
    const prefix = systemPrefixIds(tok, prompt, ids)
    expect(prefix.length).toBeGreaterThan(0)
    expect(ids.slice(0, prefix.length)).toEqual(prefix)
    expect(tok.decode(prefix)).toBe(systemPrefix(prompt))
    // A tokenizer that splits the prefix differently: nothing is reused.
    const other: UpstreamTokenizer = { encode: () => ({ ids: [999, 998] }), decode: () => '' }
    expect(systemPrefixIds(other, prompt, ids)).toEqual([])
  })
})

describe('thinkCloseIds', () => {
  it('closes the reasoning block and adds the blank line before the answer', () => {
    const tok = new FakeTokenizer()
    const close = tok.token_to_id(THINK_CLOSE)!
    const ids = thinkCloseIds(tok, close)
    expect(ids).toContain(close)
    expect(tok.decode(ids)).toBe('\n</think>\n\n')
  })

  it('falls back to the token id when the tokenizer does not parse the tag', () => {
    const tok: UpstreamTokenizer = { encode: (t) => ({ ids: t === '\n\n' ? [7] : [1, 2, 3] }), decode: () => '' }
    expect(thinkCloseIds(tok, 42)).toEqual([42, 7])
  })
})

describe('IncrementalDecoder', () => {
  it('emits text as tokens complete and restarts its window at newlines', () => {
    const tok = new FakeTokenizer()
    const dec = new IncrementalDecoder(tok)
    const deltas = tok.encode('One two.\nThree four.').ids.map((id) => dec.push(id))
    expect(deltas.join('')).toBe('One two.\nThree four.')
    expect(dec.text).toBe('One two.\nThree four.')
  })

  it('holds back a token that ends inside a multi-byte character', () => {
    // Token 1 decodes to a replacement character until token 2 completes it.
    const tok: UpstreamTokenizer = {
      encode: () => ({ ids: [] }),
      decode: (ids) => (ids.length === 1 ? 'caf�' : 'café'),
    }
    const dec = new IncrementalDecoder(tok)
    expect(dec.push(1)).toBe('')
    expect(dec.push(2)).toBe('café')
    expect(dec.text).toBe('café')
  })
})

describe('JsonBalance', () => {
  const feed = (chunks: string[]) => {
    const b = new JsonBalance()
    const done = chunks.map((c) => b.push(c))
    return { b, done }
  }

  it('reports the moment the root object closes', () => {
    const { b, done } = feed(['{"a": ', '{"b": [1, 2]}', ', "c": "x"', '}', ' trailing'])
    expect(done).toEqual([false, false, false, true, true])
    expect(b.complete).toBe(true)
  })

  it('ignores brackets inside strings and escaped quotes', () => {
    expect(feed(['{"t": "a } b \\" ] {"', '}']).done).toEqual([false, true])
  })

  it('skips prose and a code fence before the value, and handles arrays', () => {
    expect(feed(['Here it is:\n```json\n', '[1, {"a": 2}', ']']).done).toEqual([false, false, true])
  })

  it('records where the value ended', () => {
    const b = new JsonBalance()
    b.push('x {"a":1} y')
    expect(b.end).toBe('x {"a":1}'.length)
  })

  it('never completes on truncated output', () => {
    expect(feed(['{"a": {"b": 1}, "cut": "abc']).b.complete).toBe(false)
  })
})
