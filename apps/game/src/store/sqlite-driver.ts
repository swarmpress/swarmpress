/**
 * `sqlite` and `memory` drivers over `@sqlite.org/sqlite-wasm`.
 *
 * - SqliteWorkerDriver: the OPFS SAH-pool database in sqlite-worker.ts.
 * - MemorySqliteDriver: an in-memory database on the calling thread (tests,
 *   `?store=memory`, Node).
 */
import type { Row, RunResult, SqlDriver, SqlStatement, SqlValue } from './driver'
import { loadSqlite, SqliteCore } from './sqlite-core'
import type { SqliteRequest, SqliteResponse } from './sqlite-protocol'

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

export class SqliteWorkerDriver implements SqlDriver {
  readonly engine = 'sqlite' as const
  private next = 1
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()

  private _persistent = false
  private _reason: string | null = null

  private constructor(private worker: Worker) {
    worker.onmessage = (ev: MessageEvent<SqliteResponse>) => this.settle(ev.data)
    worker.onerror = (ev) => this.failAll(new Error(`sqlite worker: ${ev.message}`))
  }

  get persistent(): boolean {
    return this._persistent
  }

  /** Why OPFS was not used, if it was not. */
  get reason(): string | null {
    return this._reason
  }

  /** Starts the worker and opens `name` on the OPFS SAH pool (or in memory). */
  static async open(name: string): Promise<SqliteWorkerDriver> {
    const worker = new Worker(new URL('./sqlite-worker.ts', import.meta.url), { type: 'module', name: 'simpress-sqlite' })
    const d = new SqliteWorkerDriver(worker)
    try {
      const r = (await d.call({ op: 'open', name, opfs: true })) as { persistent: boolean; reason: string | null }
      d._persistent = r.persistent
      d._reason = r.reason
      return d
    } catch (e) {
      worker.terminate()
      throw e
    }
  }

  private settle(msg: SqliteResponse) {
    const p = this.pending.get(msg.id)
    if (!p) return
    this.pending.delete(msg.id)
    if (msg.ok) p.resolve(msg.result)
    else p.reject(new Error(msg.error))
  }

  private failAll(e: Error) {
    for (const p of this.pending.values()) p.reject(e)
    this.pending.clear()
  }

  private call(req: DistributiveOmit<SqliteRequest, 'id'>): Promise<unknown> {
    const id = this.next++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker.postMessage({ ...req, id })
    })
  }

  async exec(sql: string): Promise<void> {
    await this.call({ op: 'exec', sql })
  }

  run(sql: string, params?: SqlValue[]): Promise<RunResult> {
    return this.call({ op: 'run', sql, params }) as Promise<RunResult>
  }

  all<T = Row>(sql: string, params?: SqlValue[]): Promise<T[]> {
    return this.call({ op: 'all', sql, params }) as Promise<T[]>
  }

  batch(stmts: SqlStatement[]): Promise<RunResult[]> {
    return this.call({ op: 'batch', stmts }) as Promise<RunResult[]>
  }

  async close(): Promise<void> {
    try {
      await this.call({ op: 'close' })
    } finally {
      this.worker.terminate()
    }
  }
}

export class MemorySqliteDriver implements SqlDriver {
  readonly engine = 'memory' as const
  readonly persistent = false

  private constructor(private core: SqliteCore) {}

  static async open(): Promise<MemorySqliteDriver> {
    const sqlite3 = await loadSqlite()
    return new MemorySqliteDriver(new SqliteCore(new sqlite3.oo1.DB(':memory:', 'c')))
  }

  async exec(sql: string): Promise<void> {
    this.core.exec(sql)
  }

  async run(sql: string, params?: SqlValue[]): Promise<RunResult> {
    return this.core.run(sql, params)
  }

  async all<T = Row>(sql: string, params?: SqlValue[]): Promise<T[]> {
    return this.core.all(sql, params) as T[]
  }

  async batch(stmts: SqlStatement[]): Promise<RunResult[]> {
    return this.core.batch(stmts)
  }

  async close(): Promise<void> {
    this.core.close()
  }
}
