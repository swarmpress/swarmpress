/** Messages between SqliteWorkerDriver and sqlite-worker.ts. */
import type { SqlStatement, SqlValue } from './driver'

export type SqliteRequest = { id: number } & (
  | { op: 'open'; name: string; opfs: boolean }
  | { op: 'exec'; sql: string }
  | { op: 'run'; sql: string; params?: SqlValue[] }
  | { op: 'all'; sql: string; params?: SqlValue[] }
  | { op: 'batch'; stmts: SqlStatement[] }
  | { op: 'close' }
)

export type SqliteResponse = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string }
