/**
 * Wire formats of the central sync (FEAT-012, FEAT-060, docs/mvp.md): the
 * browser uploads immutable command-log segments to
 * `PUT /api/sync/{company}/log/{segment}` and a snapshot record to
 * `PUT /api/sync/{company}/snapshot`. The same record is what the company
 * store keeps locally.
 *
 * A snapshot record (`swarmpress.snapshot.v1`) says where a device was (the
 * scenario, seed, step, `World::hash` and the log position) and carries the
 * world itself: the bytes of client-wasm's `Sim.snapshot()`, base64. A
 * restore rebuilds the sim from those bytes and replays only the commands
 * logged after `lastSeq` (catchup/replay.ts).
 *
 * The older record without a world (`swarmpress.checkpoint.v1`) is still
 * read: such a company is restored by replaying its log from the seed to the
 * checkpoint's step, where the hash is checked. That path also remains the
 * audit of a snapshot (`?restore=replay`).
 *
 * Everything is UTF-8 JSON; command bodies stay JSON *text* so u64 brief refs
 * are never rounded by `JSON.parse`.
 */
import type { LoggedCommand } from '../catchup/replay'

export const SEGMENT_FORMAT = 'swarmpress.log.v1'
export const CHECKPOINT_FORMAT = 'swarmpress.checkpoint.v1'

export const SNAPSHOT_FORMAT = 'swarmpress.snapshot.v1'

export interface Checkpoint {
  /** `swarmpress.snapshot.v1` when the record carries the world, else `swarmpress.checkpoint.v1`. */
  format: typeof CHECKPOINT_FORMAT | typeof SNAPSHOT_FORMAT
  scenario: string
  /** The company seed, decimal text. */
  seed: string
  step: number
  /** `World::hash` at `step`, decimal text. */
  hash: string
  /** The last command-log seq included (0 = none). */
  lastSeq: number
}

interface SegmentDoc {
  format: typeof SEGMENT_FORMAT
  commands: { seq: number; step: number; kind: string; cmd: string }[]
}

const enc = new TextEncoder()
const dec = new TextDecoder()

export function encodeSegment(commands: LoggedCommand[]): Uint8Array {
  const doc: SegmentDoc = { format: SEGMENT_FORMAT, commands: commands.map((c) => ({ seq: c.seq, step: c.step, kind: c.kind, cmd: c.json })) }
  return enc.encode(JSON.stringify(doc))
}

export function decodeSegment(bytes: Uint8Array): LoggedCommand[] {
  const doc = JSON.parse(dec.decode(bytes)) as SegmentDoc
  if (doc.format !== SEGMENT_FORMAT) throw new Error(`unknown log segment format ${JSON.stringify(doc.format)}`)
  if (!Array.isArray(doc.commands)) throw new Error('log segment without a commands array')
  return doc.commands.map((c, i) => {
    if (!Number.isInteger(c?.seq) || !Number.isInteger(c?.step) || typeof c.kind !== 'string' || typeof c.cmd !== 'string') {
      throw new Error(`log segment entry ${i} is malformed`)
    }
    return { seq: c.seq, step: c.step, kind: c.kind, json: c.cmd }
  })
}

/** The fields of a record that say where the world was, in a fixed order (the encoding is byte-stable). */
const meta = (c: Omit<Checkpoint, 'format'>) => ({ scenario: c.scenario, seed: c.seed, step: c.step, hash: c.hash, lastSeq: c.lastSeq })

/** A record without the world (the legacy checkpoint: restored by replay from the seed). */
export function encodeCheckpoint(c: Omit<Checkpoint, 'format'>): Uint8Array {
  return enc.encode(JSON.stringify({ format: CHECKPOINT_FORMAT, ...meta(c) }))
}

/** A snapshot record: the checkpoint fields plus the world (`Sim.snapshot()` bytes) at exactly that step. */
export function encodeSnapshot(c: Omit<Checkpoint, 'format'>, world: Uint8Array): Uint8Array {
  if (!world.length) throw new Error('a snapshot record needs the world bytes')
  return enc.encode(JSON.stringify({ format: SNAPSHOT_FORMAT, ...meta(c), world: toBase64(world) }))
}

export interface SnapshotRecord {
  checkpoint: Checkpoint
  /** `Sim.snapshot()` bytes; null for a legacy checkpoint. */
  world: Uint8Array | null
}

/** Reads either record format. */
export function decodeSnapshot(bytes: Uint8Array): SnapshotRecord {
  const c = JSON.parse(dec.decode(bytes)) as Checkpoint & { world?: unknown }
  if (c?.format !== CHECKPOINT_FORMAT && c?.format !== SNAPSHOT_FORMAT) throw new Error(`unknown checkpoint format ${JSON.stringify(c?.format)}`)
  if (!Number.isInteger(c.step) || !Number.isInteger(c.lastSeq) || typeof c.hash !== 'string' || typeof c.seed !== 'string' || typeof c.scenario !== 'string') {
    throw new Error('malformed checkpoint')
  }
  const checkpoint: Checkpoint = { format: c.format, ...meta(c) }
  if (c.format === CHECKPOINT_FORMAT) return { checkpoint, world: null }
  if (typeof c.world !== 'string' || !c.world) throw new Error('malformed snapshot: no world')
  return { checkpoint, world: fromBase64(c.world) }
}

/** The checkpoint fields of either record format (the world, if any, is not decoded). */
export function decodeCheckpoint(bytes: Uint8Array): Checkpoint {
  const c = JSON.parse(dec.decode(bytes)) as Checkpoint
  if (c?.format !== CHECKPOINT_FORMAT && c?.format !== SNAPSHOT_FORMAT) throw new Error(`unknown checkpoint format ${JSON.stringify(c?.format)}`)
  if (!Number.isInteger(c.step) || !Number.isInteger(c.lastSeq) || typeof c.hash !== 'string' || typeof c.seed !== 'string' || typeof c.scenario !== 'string') {
    throw new Error('malformed checkpoint')
  }
  return { format: c.format, ...meta(c) }
}

/** Standard base64 (RFC 4648, padded). `btoa`/`atob` exist in browsers, workers, Node and Bun. */
export function toBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

export function fromBase64(text: string): Uint8Array {
  let bin: string
  try {
    bin = atob(text)
  } catch {
    throw new Error('malformed snapshot: the world is not base64')
  }
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Concatenates decoded segments in seq order, dropping duplicates (a re-sent segment). */
export function mergeSegments(segments: LoggedCommand[][]): LoggedCommand[] {
  const bySeq = new Map<number, LoggedCommand>()
  for (const s of segments) for (const c of s) bySeq.set(c.seq, c)
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq)
}

/** Command-log payloads are the command's JSON text as UTF-8. */
export const commandBytes = (json: string) => enc.encode(json)
export const commandText = (bytes: Uint8Array) => dec.decode(bytes)
