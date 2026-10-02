/**
 * The SQL driver behind CompanyStore (ADR-0041): one SQLite dialect, three
 * engines.
 *
 * - `turso`: `@tursodatabase/database-wasm` on OPFS (needs cross-origin
 *   isolation; it spawns its own OPFS worker).
 * - `sqlite`: `@sqlite.org/sqlite-wasm` in a dedicated worker on the OPFS
 *   SAH-pool VFS (no isolation needed); in-memory if OPFS is unavailable.
 * - `memory`: sqlite-wasm in-memory on the calling thread (tests, `?store=memory`).
 */

export type StoreEngine = 'turso' | 'sqlite' | 'memory'

export type SqlValue = string | number | bigint | null | Uint8Array

export type Row = Record<string, SqlValue>

export interface SqlStatement {
  sql: string
  params?: SqlValue[]
}

export interface RunResult {
  changes: number
  lastInsertRowid: number
}

export interface SqlDriver {
  readonly engine: StoreEngine
  /** Whether the data survives a reload (OPFS). */
  readonly persistent: boolean
  /** Runs one or more statements without parameters (migrations). */
  exec(sql: string): Promise<void>
  run(sql: string, params?: SqlValue[]): Promise<RunResult>
  all<T = Row>(sql: string, params?: SqlValue[]): Promise<T[]>
  /** Runs the statements in one transaction: all or nothing. */
  batch(stmts: SqlStatement[]): Promise<RunResult[]>
  close(): Promise<void>
}

/** Serialises async work (one statement or transaction at a time). */
export class AsyncQueue {
  private tail: Promise<unknown> = Promise.resolve()

  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn, fn)
    this.tail = next.catch(() => undefined)
    return next
  }
}

/** Blob columns come back as Uint8Array, ArrayBuffer, Buffer or number[] depending on the engine. */
export function toBytes(v: unknown): Uint8Array {
  if (v instanceof Uint8Array) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength)
  if (v instanceof ArrayBuffer) return new Uint8Array(v)
  if (Array.isArray(v)) return Uint8Array.from(v as number[])
  if (v == null) return new Uint8Array()
  throw new Error(`not a blob: ${typeof v}`)
}

export function toNumber(v: unknown): number {
  if (typeof v === 'number') return v
  if (typeof v === 'bigint') return Number(v)
  if (typeof v === 'string') return Number(v)
  throw new Error(`not a number: ${typeof v}`)
}
