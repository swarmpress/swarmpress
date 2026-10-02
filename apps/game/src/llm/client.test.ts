/**
 * LlmClient ↔ worker host RPC over a real MessageChannel (structured clone),
 * with FakeLlm behind the host. Exercises request ids, progress, streaming
 * deltas, cancellation, errors, structured output on the client side and
 * the LocalLlm adapter contract shared by every implementation.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { LlmClient } from './client'
import { FakeLlm } from './fake-llm'
import type { Endpoint, ModelSpec } from './protocol'
import { DEFAULT_REGISTRY } from './registry.default'
import type { LoadProgress, LocalLlm } from './types'
import { createWorkerHost } from './worker-host'

const channels: MessageChannel[] = []
afterEach(() => {
  for (const c of channels.splice(0)) {
    c.port1.close()
    c.port2.close()
  }
})

function connect(fake: FakeLlm, onSpec?: (s: ModelSpec) => void) {
  const ch = new MessageChannel()
  channels.push(ch)
  const specs: ModelSpec[] = []
  createWorkerHost(ch.port2 as unknown as Endpoint, () => fake, (s) => {
    specs.push(s)
    onSpec?.(s)
  })
  const client = new LlmClient(ch.port1 as unknown as Endpoint, { registry: DEFAULT_REGISTRY })
  return { client, specs }
}

/** The adapter contract every LocalLlm must satisfy. */
function contract(name: string, make: () => { llm: LocalLlm; fake: FakeLlm }) {
  describe(`LocalLlm contract: ${name}`, () => {
    it('load → generate → stream → structured → dispose', async () => {
      const { llm, fake } = make()
      const progress: LoadProgress[] = []
      await llm.load('qwen3-0.6b-q4f16', (p) => progress.push(p))
      expect(llm.modelId).toBe('qwen3-0.6b-q4f16')
      expect(progress.at(-1)).toMatchObject({ phase: 'ready', fraction: 1 })

      fake.push('Buongiorno from Manarola!')
      const deltas: string[] = []
      const res = await llm.generate([{ role: 'user', content: 'hi' }], { maxTokens: 50, onDelta: (d) => deltas.push(d) })
      expect(res.text).toBe('Buongiorno from Manarola!')
      expect(deltas.join('')).toBe(res.text)
      expect(res.finishReason).toBe('stop')
      expect(res.usage.completionTokens).toBe(3)

      fake.push('one two three')
      const streamed: string[] = []
      for await (const d of llm.stream([{ role: 'user', content: 'count' }])) streamed.push(d)
      expect(streamed).toEqual(['one ', 'two ', 'three'])

      fake.push('{"oops": ', '{"title": "Riomaggiore at dusk"}')
      const v = await llm.structured<{ title: string }>([{ role: 'user', content: 'title' }], {
        type: 'object',
        required: ['title'],
        properties: { title: { type: 'string' } },
      })
      expect(v).toEqual({ title: 'Riomaggiore at dusk' })

      fake.push('a b c d e f')
      const short = await llm.generate([{ role: 'user', content: 'x' }], { maxTokens: 2 })
      expect(short).toMatchObject({ text: 'a b ', finishReason: 'length' })

      fake.push('alpha beta STOP gamma')
      const stopped = await llm.generate([{ role: 'user', content: 'x' }], { stop: ['STOP'] })
      expect(stopped.text).toBe('alpha beta ')

      await llm.dispose()
    })
  })
}

contract('FakeLlm (in-process)', () => {
  const fake = new FakeLlm()
  return { llm: fake, fake }
})

contract('LlmClient over MessageChannel', () => {
  const fake = new FakeLlm()
  return { llm: connect(fake).client, fake }
})

describe('LlmClient RPC specifics', () => {
  it('resolves registry ids into worker specs (repo, dtype, device)', async () => {
    const { client, specs } = connect(new FakeLlm())
    await client.load('qwen3-4b-q4f16')
    expect(specs[0]).toMatchObject({ id: 'qwen3-4b-q4f16', hfRepo: 'onnx-community/Qwen3-4B-ONNX', dtype: 'q4f16', device: 'webgpu' })
    await client.load('qwen3-4b-q4f16', undefined, { device: 'wasm' })
    expect(specs[1].device).toBe('wasm')
    await client.load('tiny-random-llama')
    expect(specs[2]).toMatchObject({ fixture: 'tiny-random-llama', hfRepo: 'swarmpress/tiny-random-llama' })
    await expect(client.load('nope')).rejects.toThrow(/unknown model/)
  })

  it('cancels a generation in the worker', async () => {
    const fake = new FakeLlm({ perTokenMs: 10 })
    const { client } = connect(fake)
    await client.load('qwen3-0.6b-q4f16')
    fake.push('w1 w2 w3 w4 w5 w6 w7 w8 w9 w10 w11 w12')
    const ac = new AbortController()
    const res = await client.generate([{ role: 'user', content: 'go' }], {
      signal: ac.signal,
      onDelta: () => ac.abort(),
    })
    expect(res.finishReason).toBe('cancelled')
    expect(res.usage.completionTokens).toBeLessThan(12)
  })

  it('propagates worker errors and keeps serving afterwards', async () => {
    const fake = new FakeLlm({ script: [new Error('device lost'), 'still here'] })
    const { client } = connect(fake)
    await expect(client.generate([{ role: 'user', content: 'x' }])).rejects.toThrow(/no model loaded/)
    await client.load('qwen3-0.6b-q4f16')
    await expect(client.generate([{ role: 'user', content: 'x' }])).rejects.toThrow('device lost')
    expect((await client.generate([{ role: 'user', content: 'x' }])).text).toBe('still here')
  })

  it('multiplexes concurrent requests by id', async () => {
    const fake = new FakeLlm({ responder: (m) => `echo ${m[0].content}`, perTokenMs: 1 })
    const { client } = connect(fake)
    await client.load('qwen3-0.6b-q4f16')
    const outs = await Promise.all(['a', 'b', 'c'].map((c) => client.generate([{ role: 'user', content: c }])))
    expect(outs.map((o) => o.text)).toEqual(['echo a', 'echo b', 'echo c'])
  })

  it('rejects calls after dispose', async () => {
    const { client } = connect(new FakeLlm())
    await client.dispose()
    await expect(client.generate([{ role: 'user', content: 'x' }])).rejects.toThrow(/disposed/)
  })
})
