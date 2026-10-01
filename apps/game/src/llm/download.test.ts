import { describe, expect, it } from 'vitest'
import { cachedBytesFor, clearModelCache, estimateDownload, formatBytes, ProgressAggregator } from './download'
import { DEFAULT_REGISTRY } from './registry.default'

describe('ProgressAggregator', () => {
  it('aggregates per-file bytes and never shrinks the denominator below the registry size', () => {
    const agg = new ProgressAggregator('m', 1000)
    agg.update({ status: 'initiate', name: 'r', file: 'config.json' })
    let p = agg.update({ status: 'progress', name: 'r', file: 'config.json', progress: 100, loaded: 10, total: 10 })
    expect(p).toMatchObject({ loaded: 10, total: 1000, phase: 'download' })
    p = agg.update({ status: 'progress', name: 'r', file: 'onnx/model.onnx', progress: 50, loaded: 600, total: 1200 })
    expect(p.total).toBe(1210) // real sizes exceed the estimate → use them
    expect(p.fraction).toBeCloseTo(610 / 1210)
    expect(Object.keys(p.files)).toEqual(['config.json', 'onnx/model.onnx'])
    agg.update({ status: 'progress', name: 'r', file: 'onnx/model.onnx', progress: 100, loaded: 1200, total: 1200 })
    agg.update({ status: 'done', name: 'r', file: 'config.json' })
    p = agg.update({ status: 'done', name: 'r', file: 'onnx/model.onnx' })
    expect(p.phase).toBe('init') // all bytes in, sessions compiling
    p = agg.update({ status: 'ready', task: 'text-generation', model: 'r' })
    expect(p).toMatchObject({ phase: 'ready', fraction: 1 })
  })

  it('accepts progress_total snapshots', () => {
    const agg = new ProgressAggregator('m')
    const p = agg.update({
      status: 'progress_total',
      name: 'r',
      progress: 25,
      loaded: 25,
      total: 100,
      files: { a: { loaded: 25, total: 50 }, b: { loaded: 0, total: 50 } },
    })
    expect(p).toMatchObject({ loaded: 25, total: 100, fraction: 0.25 })
  })

  it('snapshots are copies', () => {
    const agg = new ProgressAggregator('m')
    const p = agg.update({ status: 'progress', name: 'r', file: 'a', progress: 1, loaded: 1, total: 2 })
    p.files.a.loaded = 99
    expect(agg.snapshot().files.a.loaded).toBe(1)
  })
})

describe('estimateDownload', () => {
  it('reports remaining bytes and an ETA', () => {
    const e = estimateDownload('qwen3-4b-q4f16', DEFAULT_REGISTRY, { cachedBytes: 800e6, bandwidthBytesPerSec: 10e6 })
    expect(e).toMatchObject({ totalBytes: 2.8e9, cachedBytes: 800e6, remainingBytes: 2e9, etaSeconds: 200 })
    expect(e.label).toBe('qwen3-4b-q4f16: 2.0 GB to download (800 MB cached)')
    expect(estimateDownload('qwen3-0.6b-q4f16', DEFAULT_REGISTRY, { cachedBytes: 1e12 }).label).toMatch(/installed/)
    expect(() => estimateDownload('nope', DEFAULT_REGISTRY)).toThrow(/unknown model/)
    expect(formatBytes(512)).toBe('512 B')
  })
})

describe('Cache Storage inspection', () => {
  function fakeCaches(entries: Record<string, { body: string; length?: number }>) {
    const store = new Map(Object.entries(entries))
    const cache = {
      keys: async () => [...store.keys()].map((url) => new Request(url)),
      match: async (req: Request) => {
        const e = store.get(req.url)
        if (!e) return undefined
        return new Response(e.body, { headers: e.length ? { 'content-length': String(e.length) } : {} })
      },
      delete: async (req: Request) => store.delete(req.url),
    }
    return { caches: { open: async () => cache } as unknown as CacheStorage, store }
  }

  it('sums cached bytes of one repo and clears them', async () => {
    const { caches, store } = fakeCaches({
      'https://huggingface.co/onnx-community/Qwen3-4B-ONNX/resolve/main/config.json': { body: 'x'.repeat(10) },
      'https://huggingface.co/onnx-community/Qwen3-4B-ONNX/resolve/main/onnx/model_q4f16.onnx': { body: 'y', length: 5000 },
      'https://huggingface.co/onnx-community/Qwen3-0.6B-ONNX/resolve/main/config.json': { body: 'zzz' },
    })
    expect(await cachedBytesFor('onnx-community/Qwen3-4B-ONNX', 'transformers-cache', caches)).toBe(5010)
    expect(await clearModelCache('onnx-community/Qwen3-4B-ONNX', 'transformers-cache', caches)).toBe(2)
    expect(store.size).toBe(1)
    expect(await cachedBytesFor('x/y', 'c', undefined)).toBe(0)
  })
})
