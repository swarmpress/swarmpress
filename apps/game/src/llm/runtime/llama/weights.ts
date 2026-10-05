/**
 * The GGUF files of the llama.cpp runtime (ADR-0066), kept in OPFS. A download
 * resumes from the bytes already on disk (Hugging Face's CDN drops long
 * streams), so it runs in a Worker: only there are OPFS sync access handles
 * available. Files are checked by size against the lock; the sha256 check is
 * not wired yet.
 */

export interface WeightFile {
  file: string
  size: number
  sha256: string
}

export interface WeightProgress {
  file: string
  loaded: number
  total: number
  /** The file was already complete in OPFS. */
  cached: boolean
}

const MAX_ATTEMPTS = 20

/** The complete file in OPFS, or null. */
export async function cachedWeight(f: WeightFile): Promise<File | null> {
  const dir = await navigator.storage.getDirectory()
  try {
    const file = await (await dir.getFileHandle(f.file)).getFile()
    return file.size === f.size ? file : null
  } catch {
    return null
  }
}

/** Bytes already in OPFS for `f` (complete or partial). */
export async function storedBytes(f: WeightFile): Promise<number> {
  const dir = await navigator.storage.getDirectory()
  try {
    return (await (await dir.getFileHandle(f.file)).getFile()).size
  } catch {
    return 0
  }
}

/**
 * Makes sure `f` is complete in OPFS and returns it. `url` is the pinned Hub
 * address; `fetch` is the worker's guarded fetch.
 */
export async function ensureWeight(
  f: WeightFile,
  url: string,
  fetchFn: typeof fetch,
  onProgress?: (p: WeightProgress) => void,
  onRetry?: (message: string) => void,
): Promise<File> {
  const done = await cachedWeight(f)
  if (done) {
    onProgress?.({ file: f.file, loaded: f.size, total: f.size, cached: true })
    return done
  }
  await navigator.storage.persist?.().catch(() => false)
  const dir = await navigator.storage.getDirectory()
  const fileHandle = await dir.getFileHandle(f.file, { create: true })
  const handle = await (fileHandle as unknown as { createSyncAccessHandle(): Promise<SyncHandle> }).createSyncAccessHandle()
  try {
    let at = handle.getSize()
    if (at > f.size) {
      handle.truncate(0)
      at = 0
    }
    let lastPost = 0
    for (let attempt = 1; at < f.size; attempt++) {
      try {
        const res = await fetchFn(url, at > 0 ? { headers: { Range: `bytes=${at}-` } } : {})
        if (!res.body || (at > 0 ? res.status !== 206 : !res.ok)) throw new Error(`HTTP ${res.status}`)
        const reader = res.body.getReader()
        for (;;) {
          const { done: end, value } = await reader.read()
          if (end) break
          handle.write(value, { at })
          at += value.byteLength
          if (performance.now() - lastPost > 250) {
            lastPost = performance.now()
            onProgress?.({ file: f.file, loaded: at, total: f.size, cached: false })
          }
        }
      } catch (err) {
        handle.flush()
        if (attempt >= MAX_ATTEMPTS) throw err
        onRetry?.(`${f.file}: ${err instanceof Error ? err.message : String(err)} at ${(at / 1e9).toFixed(2)} GB, resuming (attempt ${attempt + 1})`)
        await new Promise((r) => setTimeout(r, Math.min(30_000, 1000 * attempt)))
      }
    }
    handle.flush()
    if (at !== f.size) throw new Error(`${f.file}: ${at} bytes, the lock says ${f.size}`)
    onProgress?.({ file: f.file, loaded: at, total: f.size, cached: false })
  } finally {
    handle.close()
  }
  const file = await cachedWeight(f)
  if (!file) throw new Error(`${f.file}: the downloaded file is not complete`)
  return file
}

interface SyncHandle {
  getSize(): number
  truncate(size: number): void
  write(data: Uint8Array, opts: { at: number }): number
  flush(): void
  close(): void
}
