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
 *
 * Segments also carry the company's text (ADR-0075): the store's text journal
 * after `sync.sealed_text`, at most `TEXT_BYTES_PER_SEGMENT` per segment, so a
 * seal may add segments that hold only text. A device restored from central
 * replays them into its empty store (`RemoteState.texts`).
 */
import type { LoggedCommand } from '../catchup/replay'
import type { StoredCommand, TextRecord } from '../store/company-store'
import { commandText, decodeSegmentDoc, decodeSnapshot, encodeCheckpoint, encodeSegment, encodeSnapshot, mergeSegments, type Checkpoint } from './segments'

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
  /** The text journal after `after`, up to about `maxBytes` (ADR-0075). */
  textsAfter(after: number, maxBytes?: number): Promise<TextRecord[]>
  textsBetween(from: number, to: number): Promise<TextRecord[]>
}

export const SEALED_SEQ_KEY = 'sync.sealed_seq'
export const NEXT_SEGMENT_KEY = 'sync.next_segment'
/** The last text journal number sealed (ADR-0075). */
export const SEALED_TEXT_KEY = 'sync.sealed_text'
/** `{segment, from, to, textFrom?, textTo?}` (inclusive) of a segment whose upload may not have been recorded; '' when none. */
export const PENDING_SEGMENT_KEY = 'sync.pending_segment'
/** Text per segment, bytes: well under the server's segment limit. */
export const TEXT_BYTES_PER_SEGMENT = 2 * 1024 * 1024

/** A planned segment. `from > to` when it holds no commands; `textFrom`/`textTo` absent when it holds no text. */
interface PendingSegment {
  segment: number
  from: number
  to: number
  textFrom?: number
  textTo?: number
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
      const texts = await this.store.textsAfter(Number(await this.store.getKv(SEALED_TEXT_KEY)) || 0, TEXT_BYTES_PER_SEGMENT)
      if (!fresh.length && !texts.length) break
      const p: PendingSegment = {
        segment: Number(await this.store.getKv(NEXT_SEGMENT_KEY)) || 0,
        from: fresh.length ? fresh[0].seq : sealed + 1,
        to: fresh.length ? fresh[fresh.length - 1].seq : sealed,
        ...(texts.length ? { textFrom: texts[0].n, textTo: texts[texts.length - 1].n } : {}),
      }
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
    const want = Math.max(0, p.to - p.from + 1)
    if (mine.length !== want || (want && (mine[0].seq !== p.from || mine[mine.length - 1].seq !== p.to))) {
      throw new Error(`sync: the log no longer holds commands #${p.from}..#${p.to} planned for segment ${p.segment}`)
    }
    const texts = p.textFrom != null && p.textTo != null ? await this.store.textsBetween(p.textFrom, p.textTo) : []
    if (p.textFrom != null && (!texts.length || texts[0].n !== p.textFrom || texts[texts.length - 1].n !== p.textTo)) {
      throw new Error(`sync: the text journal no longer holds #${p.textFrom}..#${p.textTo} planned for segment ${p.segment}`)
    }
    let to = p.to
    let textTo = p.textTo ?? null
    try {
      await this.client.putLogSegment(this.companyId, p.segment, encodeSegment(mine, texts))
    } catch (e) {
      if ((e as { status?: unknown }).status !== 409) throw e
      // Not this device's commands on the server: the 409 stands (nothing is recorded, no checkpoint is sent).
      const adopted = await this.adopt(p, log, texts)
      if (adopted == null) throw e
      to = adopted.to
      textTo = adopted.textTo
    }
    await this.store.setKv(SEALED_SEQ_KEY, String(to))
    if (textTo != null) await this.store.setKv(SEALED_TEXT_KEY, String(textTo))
    await this.store.setKv(NEXT_SEGMENT_KEY, String(p.segment + 1))
    await this.store.setKv(PENDING_SEGMENT_KEY, '')
    return Math.max(0, to - p.from + 1)
  }

  /**
   * The server holds other bytes for segment `p.segment`. They are accepted
   * when they are this log's own commands from `p.from` on (an earlier seal
   * of this device that was cut off): returns their last seq, else null.
   */
  private async adopt(p: PendingSegment, log: StoredCommand[], texts: TextRecord[]): Promise<{ to: number; textTo: number | null } | null> {
    const bytes = await this.client.getLogSegment(this.companyId, p.segment)
    if (!bytes) return null
    const remote = decodeSegmentDoc(bytes)
    const bySeq = new Map(log.map((c) => [c.seq, toLogged(c)]))
    const commandsSame = remote.commands.every((r, i) => {
      const l = bySeq.get(r.seq)
      return r.seq === p.from + i && !!l && l.step === r.step && l.json === r.json
    })
    if (!commandsSame) return null
    // The remote texts count as sealed only when they are this journal's own, from `textFrom` on.
    const byN = new Map(texts.map((t) => [t.n, t]))
    const textsSame =
      remote.texts.length > 0 &&
      remote.texts.every((r, i) => {
        const l = byN.get(r.n)
        return r.n === p.textFrom! + i && !!l && l.kind === r.kind && l.key === r.key && l.value === r.value
      })
    if (!remote.commands.length && !textsSame) return null
    return {
      to: remote.commands.length ? remote.commands[remote.commands.length - 1].seq : p.from - 1,
      textTo: textsSame ? remote.texts[remote.texts.length - 1].n : null,
    }
  }
}

export interface RemoteState {
  commands: LoggedCommand[]
  /** The company text of every segment, in segment order (ADR-0075). */
  texts: TextRecord[]
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
  const texts: TextRecord[] = []
  for (const n of list) {
    const bytes = await client.getLogSegment(companyId, n)
    // A listed segment that cannot be read would leave a hole in the log: fail rather than replay around it.
    if (!bytes) throw new Error(`sync: log segment ${n} is listed by the server but missing`)
    const doc = decodeSegmentDoc(bytes)
    segments.push(doc.commands)
    texts.push(...doc.texts)
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
  return { commands, texts, checkpoint, world: record?.world ?? null, record: snap?.bytes ?? null, segments: list.length ? list[list.length - 1] + 1 : 0 }
}
