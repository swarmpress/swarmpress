/**
 * Model download / cache manager ("installing the newsroom's brains").
 *
 * Storage: Transformers.js stores every fetched model file in Cache Storage
 * under `env.cacheKey` (default "transformers-cache"), keyed by the file's
 * Hub URL. Nothing else is needed for caching; this module adds progress
 * aggregation, size estimates and cache inspection for the in-game UI.
 *
 * Resumable semantics: resume granularity is ONE FILE. A file enters the
 * cache only after it downloaded completely; on reload, cached files are
 * served from Cache Storage and only missing files are fetched again. A file
 * interrupted mid-download restarts from byte 0 (Transformers.js does not
 * issue Range requests). Large models are split into several external-data
 * files (`model_q4f16.onnx_data`, `_data_1` ...), so a multi-GB install
 * resumes in chunks, not from scratch. Call `requestPersistentStorage()`
 * before a big install so the browser does not evict the cache under pressure.
 *
 * Integrity: the registry's `sha256` is not wired to per-file checks yet
 * (Transformers.js does not expose the bytes before caching). `sha256Hex`
 * is here for the server-side manifest check once the registry lists
 * per-file hashes.
 */
import { findModel, type ModelRegistry } from './registry'
import type { LoadProgress } from './types'

export const DEFAULT_CACHE_NAME = 'transformers-cache'

/** Subset of Transformers.js ProgressInfo we consume (see types/utils/core.d.ts). */
export type TjsProgressInfo =
  | { status: 'initiate' | 'download' | 'done'; name: string; file: string }
  | { status: 'progress'; name: string; file: string; progress: number; loaded: number; total: number }
  | { status: 'progress_total'; name: string; progress: number; loaded: number; total: number; files: Record<string, { loaded: number; total: number }> }
  | { status: 'ready'; task: string; model: string }

/**
 * Folds Transformers.js progress events into one LoadProgress per model.
 * `expectedBytes` (from the registry) is used as the denominator until the
 * real Content-Length of every file is known, so the bar never jumps back.
 */
export class ProgressAggregator {
  private files: Record<string, { loaded: number; total: number }> = {}
  private phase: LoadProgress['phase'] = 'download'

  constructor(
    readonly modelId: string,
    private expectedBytes = 0,
  ) {}

  update(info: TjsProgressInfo): LoadProgress {
    switch (info.status) {
      case 'initiate':
      case 'download':
        this.files[info.file] ??= { loaded: 0, total: 0 }
        break
      case 'progress':
        this.files[info.file] = { loaded: info.loaded, total: info.total }
        break
      case 'progress_total':
        for (const [f, p] of Object.entries(info.files)) this.files[f] = { ...p }
        break
      case 'done': {
        const f = this.files[info.file]
        if (f) f.loaded = Math.max(f.loaded, f.total)
        // Every known file finished → session creation / shader compilation.
        if (Object.values(this.files).every((x) => x.total > 0 && x.loaded >= x.total)) this.phase = 'init'
        break
      }
      case 'ready':
        this.phase = 'ready'
        break
    }
    return this.snapshot()
  }

  markReady(): LoadProgress {
    this.phase = 'ready'
    return this.snapshot()
  }

  snapshot(): LoadProgress {
    let loaded = 0
    let known = 0
    for (const f of Object.values(this.files)) {
      loaded += f.loaded
      known += f.total
    }
    const total = Math.max(known, this.expectedBytes, loaded)
    const fraction = this.phase === 'ready' ? 1 : total > 0 ? Math.min(loaded / total, 1) : 0
    return { modelId: this.modelId, phase: this.phase, files: structuredClone(this.files), loaded, total, fraction }
  }
}

export interface DownloadEstimate {
  modelId: string
  totalBytes: number
  cachedBytes: number
  remainingBytes: number
  /** At `bandwidthBytesPerSec` (default 50 Mbit/s). */
  etaSeconds: number
  label: string
}

export function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`
  if (n >= 1e6) return `${(n / 1e6).toFixed(0)} MB`
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)} kB`
  return `${n} B`
}

export function estimateDownload(
  modelId: string,
  registry: ModelRegistry,
  opts: { cachedBytes?: number; bandwidthBytesPerSec?: number } = {},
): DownloadEstimate {
  const m = findModel(registry, modelId)
  if (!m) throw new Error(`unknown model "${modelId}"`)
  const cachedBytes = Math.min(opts.cachedBytes ?? 0, m.sizeBytes)
  const remainingBytes = m.sizeBytes - cachedBytes
  const bw = opts.bandwidthBytesPerSec ?? 50e6 / 8
  const etaSeconds = Math.ceil(remainingBytes / bw)
  const label =
    remainingBytes === 0
      ? `${m.id}: installed (${formatBytes(m.sizeBytes)})`
      : `${m.id}: ${formatBytes(remainingBytes)} to download${cachedBytes ? ` (${formatBytes(cachedBytes)} cached)` : ''}`
  return { modelId, totalBytes: m.sizeBytes, cachedBytes, remainingBytes, etaSeconds, label }
}

/** Bytes of `hfRepo` already in Cache Storage (sums Content-Length, falls back to body size). */
export async function cachedBytesFor(hfRepo: string, cacheName = DEFAULT_CACHE_NAME, cacheStorage: CacheStorage | undefined = globalThis.caches): Promise<number> {
  if (!cacheStorage) return 0
  const cache = await cacheStorage.open(cacheName)
  let sum = 0
  for (const req of await cache.keys()) {
    if (!req.url.includes(`/${hfRepo}/`)) continue
    const res = await cache.match(req)
    if (!res) continue
    const len = Number(res.headers.get('content-length'))
    sum += Number.isFinite(len) && len > 0 ? len : (await res.blob()).size
  }
  return sum
}

/** Delete every cached file of `hfRepo`. Returns the number of entries removed. */
export async function clearModelCache(hfRepo: string, cacheName = DEFAULT_CACHE_NAME, cacheStorage: CacheStorage | undefined = globalThis.caches): Promise<number> {
  if (!cacheStorage) return 0
  const cache = await cacheStorage.open(cacheName)
  let n = 0
  for (const req of await cache.keys()) {
    if (req.url.includes(`/${hfRepo}/`) && (await cache.delete(req))) n++
  }
  return n
}

/** Ask the browser not to evict our caches under storage pressure. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false
  } catch {
    return false
  }
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.()
    return e ? { usage: e.usage ?? 0, quota: e.quota ?? 0 } : null
  } catch {
    return null
  }
}

export async function sha256Hex(bytes: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
