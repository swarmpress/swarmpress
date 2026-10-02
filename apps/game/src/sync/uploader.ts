/**
 * Sealing and restoring through the central sync API (FEAT-012).
 *
 * `seal()` uploads the command-log entries not sent yet as the next immutable
 * segment, then the snapshot record (the world bytes when the caller has
 * them, FEAT-060; else a checkpoint). `fetchRemote()` is the other direction,
 * for a device whose store is empty. Progress lives in the store's kv
 * (`sync.sealed_seq`, `sync.next_segment`), so segments are numbered once per
 * company even across reloads.
 *
 * Segments are immutable on the server (same bytes 200, other bytes 409), so
 * a seal must survive being cut off between the upload and the kv writes (a
 * page closing): the planned range is written to `sync.pending_segment`
 * before the upload, and the next seal sends exactly that range again before
 * anything new. If the server already holds other bytes for that segment
 * number, the remote segment is read back: when it is the same commands up to
 * some seq, sealing continues after it; anything else is a diverged log and
 * an error.
 */
import type { LoggedCommand } from '../catchup/replay'
import type { StoredCommand } from '../store/company-store'
import { commandText, decodeSegment, decodeSnapshot, encodeCheckpoint, encodeSegment, encodeSnapshot, mergeSegments, type Checkpoint } from './segments'

/** What a seal is given: where the world is, and (to make it a snapshot) the world itself. */
export type SealPoint = Omit<Checkpoint, 'format' | 'lastSeq'> & {
  lastSeq?: number
  /** `Sim.snapshot()` bytes captured at exactly `step`; without them a legacy checkpoint is uploaded. */
  world?: Uint8Array | null
}

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
/** `{segment, from, to}` (seqs, inclusive) of a segment whose upload may not have been recorded; '' when none. */
export const PENDING_SEGMENT_KEY = 'sync.pending_segment'

interface PendingSegment {
  segment: number
  from: number
  to: number
}

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

  /**
   * Seals the unsent log as one segment and uploads `checkpoint`; calls are
   * serialized. With `checkpoint.lastSeq` (the log position of the world the
   * checkpoint captured) only commands up to that seq are sealed, so a restore
   * ends exactly at the checkpoint's step and its hash can be checked. Without
   * it, everything in the log is sealed.
   */
  seal(checkpoint: SealPoint): Promise<SealResult> {
    const run = this.chain.then(() => this.sealNow(checkpoint))
    this.chain = run.catch(() => undefined)
    return run
  }

  private async sealNow(cp: SealPoint): Promise<SealResult> {
    // A world is only the world at `lastSeq` when the caller said which seq that is.
    if (cp.world && cp.lastSeq == null) throw new Error('sync: a snapshot needs the log position (lastSeq) it was captured at')
    const log = await this.store.commandsAfter(-1)
    let segment: number | null = null
    let commands = 0
    // A segment planned by an earlier seal that may not have been recorded goes first, byte for byte.
    const raw = await this.store.getKv(PENDING_SEGMENT_KEY)
    if (raw) {
      const p = JSON.parse(raw) as PendingSegment
      commands += await this.upload(p, log)
      segment = p.segment
    }
    // Then what is new. A 409 can accept fewer commands than planned (the
    // server's segment ends earlier), so this repeats until nothing is left.
    for (;;) {
      const sealed = (Number(await this.store.getKv(SEALED_SEQ_KEY)) || 0)
      const upTo = cp.lastSeq ?? Number.MAX_SAFE_INTEGER
      const fresh = log.filter((c) => c.seq > sealed && c.seq <= upTo)
      if (!fresh.length) break
      const p: PendingSegment = { segment: Number(await this.store.getKv(NEXT_SEGMENT_KEY)) || 0, from: fresh[0].seq, to: fresh[fresh.length - 1].seq }
      await this.store.setKv(PENDING_SEGMENT_KEY, JSON.stringify(p))
      commands += await this.upload(p, log)
      segment = p.segment
    }
    const sealed = (Number(await this.store.getKv(SEALED_SEQ_KEY)) || 0)
    const point = { scenario: cp.scenario, seed: cp.seed, step: cp.step, hash: cp.hash, lastSeq: cp.lastSeq ?? sealed }
    await this.client.putSnapshot(this.companyId, cp.step, cp.world ? encodeSnapshot(point, cp.world) : encodeCheckpoint(point))
    return { segment, commands, step: cp.step }
  }

  /** Uploads the planned segment and records it; returns how many commands it sealed. */
  private async upload(p: PendingSegment, log: StoredCommand[]): Promise<number> {
    const mine = log.filter((c) => c.seq >= p.from && c.seq <= p.to).map(toLogged)
    if (!mine.length || mine[0].seq !== p.from || mine[mine.length - 1].seq !== p.to) {
      throw new Error(`sync: the log no longer holds commands #${p.from}..#${p.to} planned for segment ${p.segment}`)
    }
    let to = p.to
    try {
      await this.client.putLogSegment(this.companyId, p.segment, encodeSegment(mine))
    } catch (e) {
      if ((e as { status?: unknown }).status !== 409) throw e
      // Not this device's commands on the server: the 409 stands (nothing is recorded, no checkpoint is sent).
      const adopted = await this.adopt(p, log)
      if (adopted == null) throw e
      to = adopted
    }
    await this.store.setKv(SEALED_SEQ_KEY, String(to))
    await this.store.setKv(NEXT_SEGMENT_KEY, String(p.segment + 1))
    await this.store.setKv(PENDING_SEGMENT_KEY, '')
    return to - p.from + 1
  }

  /**
   * The server holds other bytes for segment `p.segment`. They are accepted
   * when they are this log's own commands from `p.from` on (an earlier seal
   * of this device that was cut off): returns their last seq, else null.
   */
  private async adopt(p: PendingSegment, log: StoredCommand[]): Promise<number | null> {
    const bytes = await this.client.getLogSegment(this.companyId, p.segment)
    const remote = bytes ? decodeSegment(bytes) : []
    const bySeq = new Map(log.map((c) => [c.seq, toLogged(c)]))
    const same =
      remote.length > 0 &&
      remote.every((r, i) => {
        const l = bySeq.get(r.seq)
        return r.seq === p.from + i && !!l && l.step === r.step && l.json === r.json
      })
    return same ? remote[remote.length - 1].seq : null
  }
}

export interface RemoteState {
  commands: LoggedCommand[]
  checkpoint: Checkpoint | null
  /** The world bytes of the remote snapshot record (null for a legacy checkpoint, or without a record). */
  world: Uint8Array | null
  /** The record as the server holds it, to keep as this device's local snapshot. */
  record: Uint8Array | null
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
    // A listed segment that cannot be read would leave a hole in the log: fail rather than replay around it.
    if (!bytes) throw new Error(`sync: log segment ${n} is listed by the server but missing`)
    segments.push(decodeSegment(bytes))
  }
  const record = snap ? decodeSnapshot(snap.bytes) : null
  const checkpoint = record?.checkpoint ?? null
  const commands = mergeSegments(segments)
  commands.forEach((c, i) => {
    if (c.seq !== i + 1) throw new Error(`sync: the remote log has a gap (command #${i + 1} is missing, found #${c.seq})`)
  })
  if (checkpoint && commands.length < checkpoint.lastSeq) {
    throw new Error(`sync: the remote log ends at command #${commands.length}, the checkpoint needs #${checkpoint.lastSeq}`)
  }
  return { commands, checkpoint, world: record?.world ?? null, record: snap?.bytes ?? null, segments: list.length ? list[list.length - 1] + 1 : 0 }
}
