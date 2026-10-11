/**
 * The storage worker: the game's storage API off the render thread (ADR-0084 §3). One per
 * company session; holds the repository and the per-branch projections (sqlite-wasm, memory).
 * Repository records go back to the session for the company store after every call.
 *
 * Asset bytes and outgoing HTTP need the company lease, which the session holds: with
 * `platform` set at init, the worker asks the session for them (`platform` messages), and keeps
 * the bytes it saw in memory for the session's lifetime.
 */
import { loadSqlite } from '../store/sqlite-core'
import { GameStorage, MemoryAssets, type AssetStore, type HttpProxy } from './storage-host'
import { importStorageWasm } from './storage-wasm-load'
import type { PlatformCall, StorageRequest, StorageResponse } from './storage-protocol'

let storage: GameStorage | null = null
const post = (m: StorageResponse, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer)

let nextCall = 1
const calls = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>()
function platform<T>(call: PlatformCall): Promise<T> {
  const id = nextCall++
  return new Promise<T>((resolve, reject) => {
    calls.set(id, { resolve: resolve as (v: unknown) => void, reject })
    post({ id, kind: 'platform', call })
  })
}

/** Object storage through the session, with this session's bytes cached in memory. */
class PlatformAssets implements AssetStore {
  private readonly cache = new MemoryAssets()
  async put(sha256: string, bytes: Uint8Array, mime: string) {
    await this.cache.put(sha256, bytes)
    await platform({ op: 'asset.put', sha256, bytes, mime })
  }
  async get(sha256: string) {
    const have = await this.cache.get(sha256)
    if (have) return have
    const bytes = await platform<Uint8Array | null>({ op: 'asset.get', sha256 })
    if (bytes) await this.cache.put(sha256, bytes)
    return bytes
  }
}

const http: HttpProxy = (request) => platform({ op: 'http', request })

function flushRecords() {
  const records = storage?.takeRecords() ?? []
  if (records.length) post({ id: 0, kind: 'records', records })
}

self.addEventListener('message', async (e: MessageEvent<StorageRequest>) => {
  const m = e.data
  if (m.kind === 'platform-reply') {
    const c = calls.get(m.id)
    calls.delete(m.id)
    if (m.ok) c?.resolve(m.value)
    else c?.reject(new Error(m.error))
    return
  }
  try {
    if (m.kind === 'init') {
      const [sqlite3, wasm] = await Promise.all([loadSqlite(), importStorageWasm()])
      storage = new GameStorage({ wasm, sqlite3, records: m.records, ...(m.platform ? { assets: new PlatformAssets(), http } : {}) })
      post({ id: m.id, ok: true, value: storage.repo({ op: 'branches' }) })
      return
    }
    if (!storage) throw new Error('the storage worker was not initialised')
    const value = m.kind === 'storage' ? await storage.storage(m.payload) : storage.repo(m.msg)
    post({ id: m.id, ok: true, value })
    flushRecords()
  } catch (err) {
    post({ id: m.id, ok: false, error: String((err as Error)?.message ?? err) })
  }
})
