/**
 * The storage worker: the game's storage API off the render thread (ADR-0084 §3). One per
 * company session; holds the repository and the per-branch projections (sqlite-wasm, memory).
 * Repository records go back to the session for the company store after every call.
 */
import { loadSqlite } from '../store/sqlite-core'
import { GameStorage } from './storage-host'
import { importStorageWasm } from './storage-wasm-load'
import type { StorageRequest, StorageResponse } from './storage-protocol'

let storage: GameStorage | null = null
const post = (m: StorageResponse) => (self as unknown as Worker).postMessage(m)

function flushRecords() {
  const records = storage?.takeRecords() ?? []
  if (records.length) post({ id: 0, kind: 'records', records })
}

self.addEventListener('message', async (e: MessageEvent<StorageRequest>) => {
  const m = e.data
  try {
    if (m.kind === 'init') {
      const [sqlite3, wasm] = await Promise.all([loadSqlite(), importStorageWasm()])
      storage = new GameStorage({ wasm, sqlite3, records: m.records })
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
