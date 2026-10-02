/**
 * Runs the REAL Transformers.js adapter (node build → onnxruntime-node CPU)
 * on the offline tiny fixture model: proves the ONNX graph, tokenizer, chat
 * template, KV cache, streaming, stop sequences and cancellation plumbing
 * without network or GPU. The browser path (worker + WebGPU/wasm) is covered
 * by e2e/llm.spec.ts.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { env } from '@huggingface/transformers'
import { beforeAll, describe, expect, it } from 'vitest'
import { TINY_MODEL_ENTRY, tinyModelFetch, tinyModelFiles, tinyVocab } from './testing/tiny-model'
import { TransformersJsLlm } from './transformers-llm'
import type { DeviceKind, LoadProgress } from './types'

describe('tiny fixture model', () => {
  it('is small and deterministic', () => {
    const a = tinyModelFiles(1)
    const b = tinyModelFiles(1)
    expect(Buffer.from(a['onnx/model.onnx']).equals(Buffer.from(b['onnx/model.onnx']))).toBe(true)
    const total = Object.values(a).reduce((n, f) => n + f.length, 0)
    expect(total).toBeLessThan(400_000)
    expect(new Set(tinyVocab()).size).toBe(tinyVocab().length)
  })
})

describe('TransformersJsLlm on the tiny fixture (node, cpu)', () => {
  let llm: TransformersJsLlm
  const progress: LoadProgress[] = []

  beforeAll(async () => {
    // Node's ONNX loader wants a file path, so give it a throwaway FS cache.
    env.useFSCache = true
    env.cacheDir = mkdtempSync(join(tmpdir(), 'swarmpress-tiny-llm-'))
    llm = new TransformersJsLlm({
      resolve: () => ({ hfRepo: TINY_MODEL_ENTRY.hfRepo, dtype: 'fp32', device: 'cpu' as DeviceKind, sizeBytes: TINY_MODEL_ENTRY.sizeBytes }),
      fetch: tinyModelFetch(() => Promise.reject(new Error('network disabled in test'))),
    })
    await llm.load(TINY_MODEL_ENTRY.id, (p) => progress.push(p))
  }, 60_000)

  it('reports load progress ending in ready', () => {
    expect(progress.length).toBeGreaterThan(0)
    const last = progress.at(-1)!
    expect(last.phase).toBe('ready')
    expect(last.fraction).toBe(1)
    expect(Object.keys(last.files)).toContain('onnx/model.onnx')
  })

  it('generates and streams tokens', async () => {
    const deltas: string[] = []
    const res = await llm.generate([{ role: 'user', content: 'Write a headline about the harbor.' }], {
      maxTokens: 12,
      temperature: 0,
      onDelta: (d) => deltas.push(d),
    })
    expect(res.usage.promptTokens).toBeGreaterThan(5)
    expect(res.usage.completionTokens).toBeGreaterThan(0)
    expect(res.usage.completionTokens).toBeLessThanOrEqual(12)
    expect(deltas.join('').trim()).toBe(res.text.trim())
    expect(['stop', 'length']).toContain(res.finishReason)
  })

  it('is deterministic with temperature 0', async () => {
    const msgs = [{ role: 'user' as const, content: 'hello newsroom' }]
    const a = await llm.generate(msgs, { maxTokens: 8, temperature: 0 })
    const b = await llm.generate(msgs, { maxTokens: 8, temperature: 0 })
    expect(a.text).toBe(b.text)
  })

  it('honours stop sequences (trimmed, finishReason stop)', async () => {
    const msgs = [{ role: 'user' as const, content: 'the editor checks the draft' }]
    const full = await llm.generate(msgs, { maxTokens: 16, temperature: 0 })
    const words = full.text.split(/\s+/).filter(Boolean)
    expect(words.length).toBeGreaterThan(2)
    const stopWord = words[2]
    const deltas: string[] = []
    const cut = await llm.generate(msgs, { maxTokens: 16, temperature: 0, stop: [stopWord], onDelta: (d) => deltas.push(d) })
    expect(cut.finishReason).toBe('stop')
    expect(cut.text).toBe(full.text.slice(0, full.text.indexOf(stopWord)))
    expect(deltas.join('')).toBe(cut.text)
  })

  it('cancels via AbortSignal', async () => {
    const ac = new AbortController()
    ac.abort()
    const res = await llm.generate([{ role: 'user', content: 'go' }], { maxTokens: 50, temperature: 0, signal: ac.signal })
    expect(res.finishReason).toBe('cancelled')
    expect(res.usage.completionTokens).toBeLessThanOrEqual(1)
  })

  it('streams through the AsyncIterable API', async () => {
    let s = ''
    for await (const d of llm.stream([{ role: 'user', content: 'tell a story' }], { maxTokens: 6, temperature: 0.8 })) s += d
    expect(s.length).toBeGreaterThan(0)
  })
})
