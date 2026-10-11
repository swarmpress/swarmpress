/**
 * The game's storage API (ADR-0084 §3): the governed side of the sandbox's storage channel, in
 * the browser. `crates/storage-api-wasm` holds the repository and the per-branch projections on
 * sqlite-wasm; this module gives it SQLite and answers the ops that need `crypto.subtle` or the
 * network:
 *   - `asset.put`: the bytes' SHA-256, then the asset store (object storage, ADR-0050);
 *   - `asset.get`: the digest from the repository, the bytes from the asset store;
 *   - `http`: the platform's fetch proxy, through an explicit grant (refused without one).
 * Runs in the storage worker (`storage-worker.ts`) and, with a module handed in, in tests.
 */
import type { Database, Sqlite3Static } from '@sqlite.org/sqlite-wasm'

/** The subset of `storage-api-wasm`'s `StorageHost` the game calls. */
export interface StorageHostApi {
  storage(msg: string): string
  repo(msg: string): string
  put_asset(path: string, sha256: string, mime: string, size: number): string
  asset_sha(path: string): string | undefined
  take_records(): string
  take_outbox(): string
  free?(): void
}

export interface StorageWasm {
  StorageHost: new (prefix: string, open: () => unknown, records: string) => StorageHostApi
}

/** Where asset bytes live (object storage; an in-memory store in tests and before upload). */
export interface AssetStore {
  put(sha256: string, bytes: Uint8Array, mime: string): Promise<void>
  get(sha256: string): Promise<Uint8Array | null>
}

export class MemoryAssets implements AssetStore {
  readonly bytes = new Map<string, Uint8Array>()
  async put(sha: string, b: Uint8Array) {
    this.bytes.set(sha, b)
  }
  async get(sha: string) {
    return this.bytes.get(sha) ?? null
  }
}

/** Outgoing HTTP from WordPress; `null` refuses (rule 11: fail loudly, never fake a response). */
export type HttpProxy = ((request: { method: string; url: string; headers: Record<string, string>; body: string; timeout: number }) => Promise<{ status: number; headers: Record<string, string>; body: string }>) | null

/** A sqlite-wasm database as the facade's executor: JSON rows, `[changes, lastInsertRowid]`. */
export function sqliteExecutor(sqlite3: Sqlite3Static): () => unknown {
  return () => {
    const db: Database = new sqlite3.oo1.DB(':memory:', 'c')
    // MySQL's REGEXP as a literal-substring match (anchors trimmed), as the native projection does.
    db.createFunction('regexp', (_ctx: number, pattern: unknown, text: unknown) => (text != null && String(text).includes(String(pattern).replace(/^\^|\$$/g, '')) ? 1 : 0), { arity: 2, deterministic: true })
    return {
      query(sql: string): string {
        const columns: string[] = []
        const rows = db.exec({ sql, rowMode: 'array', returnValue: 'resultRows', columnNames: columns }) as unknown[][]
        return JSON.stringify({ columns, rows: rows.map((r) => r.map((v) => (typeof v === 'bigint' ? Number(v) : v))) })
      },
      execute(sql: string): [number, number] {
        db.exec(sql)
        return [Number(db.changes()), Number(db.selectValue('SELECT last_insert_rowid()') ?? 0)]
      },
      batch(sql: string): void {
        // sqlite-wasm refuses an empty string (a new company's projection has no schema yet).
        if (sql.trim()) db.exec(sql)
      },
    }
  }
}

const b64 = {
  decode: (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)),
  encode(b: Uint8Array) {
    let s = ''
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
    return btoa(s)
  },
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer))
  return [...d].map((x) => x.toString(16).padStart(2, '0')).join('')
}

export interface GameStorageOptions {
  wasm: StorageWasm
  sqlite3: Sqlite3Static
  /** The repository's records so far (a restore); `[]` for a new company. */
  records?: unknown[]
  assets?: AssetStore
  http?: HttpProxy
  prefix?: string
}

export class GameStorage {
  readonly host: StorageHostApi
  readonly assets: AssetStore
  private readonly http: HttpProxy

  constructor(opts: GameStorageOptions) {
    this.host = new opts.wasm.StorageHost(opts.prefix ?? 'wp_', sqliteExecutor(opts.sqlite3), JSON.stringify(opts.records ?? []))
    this.assets = opts.assets ?? new MemoryAssets()
    this.http = opts.http ?? null
  }

  /** One storage-channel message from the sandbox. */
  async storage(payload: string): Promise<string> {
    let msg: { op?: string; path?: string; mime?: string; data?: string; [k: string]: unknown }
    try {
      msg = JSON.parse(payload)
    } catch {
      return JSON.stringify({ error: 'storage: the message is not JSON' })
    }
    switch (msg.op) {
      case 'asset.put': {
        const bytes = b64.decode(msg.data ?? '')
        const sha = await sha256Hex(bytes)
        await this.assets.put(sha, bytes, msg.mime ?? '')
        return this.host.put_asset(msg.path ?? '', sha, msg.mime ?? '', bytes.length)
      }
      case 'asset.get': {
        const sha = this.host.asset_sha(msg.path ?? '')
        const bytes = sha ? await this.assets.get(sha) : null
        return JSON.stringify(bytes ? { sha256: sha, data: b64.encode(bytes) } : { error: `asset.get: no asset at ${msg.path}` })
      }
      case 'http': {
        if (!this.http) return JSON.stringify({ error: `outgoing HTTP to ${String(msg.url)} needs a grant for the platform's fetch proxy` })
        try {
          return JSON.stringify(await this.http({ method: String(msg.method ?? 'GET'), url: String(msg.url), headers: (msg.headers ?? {}) as Record<string, string>, body: String(msg.body ?? ''), timeout: Number(msg.timeout ?? 10) }))
        } catch (e) {
          return JSON.stringify({ error: `http: ${String((e as Error)?.message ?? e)}` })
        }
      }
      default:
        return this.host.storage(payload)
    }
  }

  /** One governed-API message. */
  repo<T = unknown>(msg: Record<string, unknown>): T {
    return JSON.parse(this.host.repo(JSON.stringify(msg))) as T
  }

  /** The repository records written since the last call (for the company store and sync). */
  takeRecords(): unknown[] {
    return JSON.parse(this.host.take_records()) as unknown[]
  }

  takeOutbox(): unknown[] {
    return JSON.parse(this.host.take_outbox()) as unknown[]
  }
}
