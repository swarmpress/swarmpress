/**
 * Synchronous statement execution over an `@sqlite.org/sqlite-wasm` oo1
 * database. Shared by the sqlite worker (OPFS SAH pool) and the in-thread
 * `memory` driver (and Node tests).
 */
import type { Database, Sqlite3Static } from '@sqlite.org/sqlite-wasm'
import type { Row, RunResult, SqlStatement, SqlValue } from './driver'

export type SqliteDb = Database

export class SqliteCore {
  constructor(readonly db: SqliteDb) {}

  exec(sql: string): void {
    this.db.exec(sql)
  }

  run(sql: string, params: SqlValue[] = []): RunResult {
    this.db.exec({ sql, bind: params.length ? (params as never) : undefined })
    return {
      changes: Number(this.db.changes()),
      lastInsertRowid: Number(this.db.selectValue('SELECT last_insert_rowid()') ?? 0),
    }
  }

  all(sql: string, params: SqlValue[] = []): Row[] {
    return this.db.exec({
      sql,
      bind: params.length ? (params as never) : undefined,
      rowMode: 'object',
      returnValue: 'resultRows',
    }) as Row[]
  }

  batch(stmts: SqlStatement[]): RunResult[] {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const out = stmts.map((s) => this.run(s.sql, s.params))
      this.db.exec('COMMIT')
      return out
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }

  close(): void {
    this.db.close()
  }
}

let module: Promise<Sqlite3Static> | null = null

/** Loads (once) the sqlite3 wasm module. */
export function loadSqlite(): Promise<Sqlite3Static> {
  module ??= import('@sqlite.org/sqlite-wasm').then((m) => m.default())
  return module
}
