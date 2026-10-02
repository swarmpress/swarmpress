/**
 * Wire formats of the central sync (FEAT-012, docs/mvp.md): the browser
 * uploads immutable command-log segments and a checkpoint to
 * `PUT /api/sync/{company}/log/{segment}` and `PUT /api/sync/{company}/snapshot`.
 *
 * client-wasm has no world snapshot export yet, so the "snapshot" is a
 * replay checkpoint: the scenario, seed, step and `World::hash` a device
 * reached. A fresh device replays the segments from the seed to that step
 * and checks the hash (catchup/replay.ts). Both are UTF-8 JSON; command
 * bodies stay JSON *text* so u64 brief refs are never rounded by `JSON.parse`.
 */
import type { LoggedCommand } from '../catchup/replay'

export const SEGMENT_FORMAT = 'simpress.log.v1'
export const CHECKPOINT_FORMAT = 'simpress.checkpoint.v1'

export interface Checkpoint {
  format: typeof CHECKPOINT_FORMAT
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

export function encodeCheckpoint(c: Omit<Checkpoint, 'format'>): Uint8Array {
  return enc.encode(JSON.stringify({ format: CHECKPOINT_FORMAT, ...c }))
}

export function decodeCheckpoint(bytes: Uint8Array): Checkpoint {
  const c = JSON.parse(dec.decode(bytes)) as Checkpoint
  if (c.format !== CHECKPOINT_FORMAT) throw new Error(`unknown checkpoint format ${JSON.stringify(c.format)}`)
  if (!Number.isInteger(c.step) || !Number.isInteger(c.lastSeq) || typeof c.hash !== 'string' || typeof c.seed !== 'string' || typeof c.scenario !== 'string') {
    throw new Error('malformed checkpoint')
  }
  return c
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
