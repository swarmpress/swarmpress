/** Messages between the game and its storage worker (`storage-worker.ts`). */
export type StorageRequest =
  | { id: number; kind: 'init'; records: unknown[] }
  | { id: number; kind: 'storage'; payload: string }
  | { id: number; kind: 'repo'; msg: Record<string, unknown> }

export type StorageResponse =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: string }
  /** Repository records written by the last call, for the company store. */
  | { id: 0; kind: 'records'; records: unknown[] }
