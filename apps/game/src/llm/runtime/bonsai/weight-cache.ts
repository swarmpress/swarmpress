/**
 * What the engine already holds in its weight cache: IndexedDB `gguf-cache-v1`,
 * store `chunks`, Blobs keyed `[url, begin, end]` (read from the engine's code,
 * see docs/design/mvp-runtime.md "Weights"). The startup's storage check and
 * the qualification harness both read it; neither creates the database when it
 * is absent.
 */

/**
 * Sum of the cached weight bytes whose URL names `revision`. `bytes` is NaN
 * when some keys have another shape (only the chunk count can be said), and
 * the result is null when the browser cannot list its databases.
 */
export async function cachedWeightBytes(revision: string): Promise<{ bytes: number; chunks: number } | null> {
  const idb = globalThis.indexedDB as (IDBFactory & { databases?: () => Promise<{ name?: string }[]> }) | undefined
  if (!idb?.databases) return null
  const names = (await idb.databases()).map((d) => d.name)
  if (!names.includes('gguf-cache-v1')) return { bytes: 0, chunks: 0 }
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = idb.open('gguf-cache-v1')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  try {
    if (!db.objectStoreNames.contains('chunks')) return { bytes: 0, chunks: 0 }
    const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
      const req = db.transaction('chunks', 'readonly').objectStore('chunks').getAllKeys()
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    let bytes = 0
    let parsed = 0
    for (const k of keys) {
      if (Array.isArray(k) && typeof k[0] === 'string' && typeof k[1] === 'number' && typeof k[2] === 'number') {
        parsed++
        if (k[0].includes(revision)) bytes += k[2] - k[1]
      }
    }
    // Keys of another shape: the count is all that can be said.
    return parsed === keys.length ? { bytes, chunks: keys.length } : { bytes: NaN, chunks: keys.length }
  } finally {
    db.close()
  }
}
