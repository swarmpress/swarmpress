/**
 * Dedicated worker for the `sqlite` engine: `@sqlite.org/sqlite-wasm` on the
 * OPFS SAH-pool VFS (sync access handles exist only in workers, and the pool
 * needs no cross-origin isolation). Falls back to an in-memory database when
 * OPFS is unavailable. One request at a time, in arrival order.
 */
/// <reference lib="webworker" />
import { loadSqlite, SqliteCore } from './sqlite-core'
import type { SqliteRequest, SqliteResponse } from './sqlite-protocol'

let core: SqliteCore | null = null

async function open(name: string, opfs: boolean): Promise<{ persistent: boolean; reason: string | null }> {
  const sqlite3 = await loadSqlite()
  if (opfs) {
    try {
      const pool = await sqlite3.installOpfsSAHPoolVfs({ name: 'swarmpress-sahpool', directory: '.swarmpress-sahpool' })
      core = new SqliteCore(new pool.OpfsSAHPoolDb(`/${name}`))
      return { persistent: true, reason: null }
    } catch (e) {
      core = new SqliteCore(new sqlite3.oo1.DB(':memory:', 'c'))
      return { persistent: false, reason: `OPFS SAH pool unavailable: ${e instanceof Error ? e.message : String(e)}` }
    }
  }
  core = new SqliteCore(new sqlite3.oo1.DB(':memory:', 'c'))
  return { persistent: false, reason: null }
}

function need(): SqliteCore {
  if (!core) throw new Error('sqlite worker: database not open')
  return core
}

async function handle(req: SqliteRequest): Promise<unknown> {
  switch (req.op) {
    case 'open':
      return open(req.name, req.opfs)
    case 'exec':
      return need().exec(req.sql)
    case 'run':
      return need().run(req.sql, req.params)
    case 'all':
      return need().all(req.sql, req.params)
    case 'batch':
      return need().batch(req.stmts)
    case 'close':
      core?.close()
      core = null
      return null
  }
}

let chain: Promise<void> = Promise.resolve()

self.onmessage = (ev: MessageEvent<SqliteRequest>) => {
  const req = ev.data
  chain = chain.then(async () => {
    let msg: SqliteResponse
    try {
      msg = { id: req.id, ok: true, result: await handle(req) }
    } catch (e) {
      msg = { id: req.id, ok: false, error: e instanceof Error ? e.message : String(e) }
    }
    ;(self as unknown as DedicatedWorkerGlobalScope).postMessage(msg)
  })
}
