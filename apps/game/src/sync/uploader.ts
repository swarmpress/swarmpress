/**
 * Sealing and restoring through the central sync API (FEAT-012).
 *
 * `seal()` uploads the command-log entries not sent yet as the next immutable
 * segment, then the checkpoint. `fetchRemote()` is the other direction, for a
 * device whose store is empty. Progress lives in the store's kv
 * (`sync.sealed_seq`, `sync.next_segment`), so segments are numbered once per
 * company even across reloads.
 */
import type { LoggedCommand } from '../catchup/replay'
import type { StoredCommand } from '../store/company-store'
import { commandText, decodeCheckpoint, decodeSegment, encodeCheckpoint, encodeSegment, mergeSegments, type Checkpoint } from './segments'

export interface SyncClient {
  putLogSegment(companyId: string, segment: number, bytes: Uint8Array): Promise<{ status: number }>
  getLogSegment(companyId: string, segment: number): Promise<Uint8Array | null>
  listLogSegments(companyId: string): Promise<{ segment: number }[]>
  putSnapshot(companyId: string, step: number, bytes: Uint8Array): Promise<unknown>
  getSnapshot(companyId: string): Promise<{ step: number; bytes: Uint8Array } | null>
}

export interface SyncStore {
  commandsAfter(step: number): Promise<StoredCommand[]>
  getKv(key: string): Promise<string | null>
  setKv(key: string, value: string): Promise<void>
}

export const SEALED_SEQ_KEY = 'sync.sealed_seq'
export const NEXT_SEGMENT_KEY = 'sync.next_segment'

export const toLogged = (c: StoredCommand): LoggedCommand => ({ seq: c.seq, step: c.step, kind: c.kind, json: commandText(c.payload) })

export interface SealResult {
  /** The segment written, or null when there was nothing new. */
  segment: number | null
  commands: number
  step: number
}

export class SyncUploader {
  private chain: Promise<unknown> = Promise.resolve()

  constructor(
    private client: SyncClient,
    private store: SyncStore,
    private companyId: string,
  ) {}

  /** Seals the unsent log as one segment and uploads `checkpoint`; calls are serialized. */
  seal(checkpoint: Omit<Checkpoint, 'format' | 'lastSeq'>): Promise<SealResult> {
    const run = this.chain.then(() => this.sealNow(checkpoint))
    this.chain = run.catch(() => undefined)
    return run
  }

  private async sealNow(cp: Omit<Checkpoint, 'format' | 'lastSeq'>): Promise<SealResult> {
    const sealed = Number((await this.store.getKv(SEALED_SEQ_KEY)) ?? 0)
    const fresh = (await this.store.commandsAfter(-1)).filter((c) => c.seq > sealed)
    let segment: number | null = null
    let lastSeq = sealed
    if (fresh.length) {
      segment = Number((await this.store.getKv(NEXT_SEGMENT_KEY)) ?? 0)
      await this.client.putLogSegment(this.companyId, segment, encodeSegment(fresh.map(toLogged)))
      lastSeq = fresh[fresh.length - 1].seq
      await this.store.setKv(SEALED_SEQ_KEY, String(lastSeq))
      await this.store.setKv(NEXT_SEGMENT_KEY, String(segment + 1))
    }
    await this.client.putSnapshot(this.companyId, cp.step, encodeCheckpoint({ ...cp, lastSeq }))
    return { segment, commands: fresh.length, step: cp.step }
  }
}

export interface RemoteState {
  commands: LoggedCommand[]
  checkpoint: Checkpoint | null
  segments: number
}

/** Everything the central server holds for a company (null when it holds nothing). */
export async function fetchRemote(client: SyncClient, companyId: string): Promise<RemoteState | null> {
  const list = (await client.listLogSegments(companyId)).map((s) => s.segment).sort((a, b) => a - b)
  const snap = await client.getSnapshot(companyId)
  if (!list.length && !snap) return null
  const segments: LoggedCommand[][] = []
  for (const n of list) {
    const bytes = await client.getLogSegment(companyId, n)
    if (bytes) segments.push(decodeSegment(bytes))
  }
  const checkpoint = snap ? decodeCheckpoint(snap.bytes) : null
  return { commands: mergeSegments(segments), checkpoint, segments: list.length ? list[list.length - 1] + 1 : 0 }
}
