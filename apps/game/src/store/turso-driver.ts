/**
 * `turso` driver: `@tursodatabase/database-wasm` on OPFS (ADR-0041).
 *
 * The package runs the engine on the calling thread and spawns its own
 * worker for OPFS I/O; its threads need SharedArrayBuffer, so the page must
 * be cross-origin isolated. The module (and its ~11 MB wasm, ~3.9 MB gzip) is
 * loaded lazily on first open. Imported through the `/vite` export, which
 * inlines the wasm in the dev server (Vite cannot serve the worker + wasm
 * pair from node_modules) and uses the plain build otherwise.
 */
import type { Row, RunResult, SqlDriver, SqlStatement, SqlValue } from './driver'
import { AsyncQueue } from './driver'

type TursoDb = Awaited<ReturnType<(typeof import('@tursodatabase/database-wasm/vite'))['connect']>>

function args(params?: SqlValue[]): SqlValue[] {
  return params ?? []
}

export class TursoDriver implements SqlDriver {
  readonly engine = 'turso' as const
  readonly persistent = true
  private queue = new AsyncQueue()

  private constructor(private db: TursoDb) {}

  static async open(name: string): Promise<TursoDriver> {
    const { connect } = await import('@tursodatabase/database-wasm/vite')
    return new TursoDriver(await connect(name))
  }

  exec(sql: string): Promise<void> {
    return this.queue.run(() => this.db.exec(sql))
  }

  run(sql: string, params?: SqlValue[]): Promise<RunResult> {
    return this.queue.run(async () => {
      const r = await this.db.run(sql, ...args(params))
      return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) }
    })
  }

  all<T = Row>(sql: string, params?: SqlValue[]): Promise<T[]> {
    return this.queue.run(() => this.db.all(sql, ...args(params)) as Promise<T[]>)
  }

  batch(stmts: SqlStatement[]): Promise<RunResult[]> {
    return this.queue.run(async () => {
      await this.db.exec('BEGIN IMMEDIATE')
      try {
        const out: RunResult[] = []
        for (const s of stmts) {
          const r = await this.db.run(s.sql, ...args(s.params))
          out.push({ changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) })
        }
        await this.db.exec('COMMIT')
        return out
      } catch (e) {
        await this.db.exec('ROLLBACK').catch(() => undefined)
        throw e
      }
    })
  }

  close(): Promise<void> {
    return this.queue.run(() => this.db.close())
  }
}
