/** Messages between the game and its storage worker (`storage-worker.ts`). */
export type StorageRequest =
  | { id: number; kind: 'init'; records: unknown[]; platform?: boolean }
  | { id: number; kind: 'storage'; payload: string }
  | { id: number; kind: 'repo'; msg: Record<string, unknown> }
  /** The game's answer to a platform call the worker made. */
  | { id: number; kind: 'platform-reply'; ok: true; value: unknown }
  | { id: number; kind: 'platform-reply'; ok: false; error: string }

/** What the worker asks the game for: object storage and the fetch proxy need the lease. */
export type PlatformCall =
  | { op: 'asset.put'; sha256: string; bytes: Uint8Array; mime: string }
  | { op: 'asset.get'; sha256: string }
  | { op: 'http'; request: { method: string; url: string; headers: Record<string, string>; body: string; timeout: number } }

export type StorageResponse =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: string }
  /** Repository records written by the last call, for the company store. */
  | { id: 0; kind: 'records'; records: unknown[] }
  /** A platform call (answered with `platform-reply` and the same id). */
  | { id: number; kind: 'platform'; call: PlatformCall }
