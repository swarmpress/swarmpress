// Wire formats of the central sync (FEAT-012, FEAT-060): command-log segments,
// the snapshot record and the legacy replay checkpoint. Segments are immutable
// on the server (an identical PUT answers 200, different bytes 409), so the
// encoding must be byte-stable.
import { describe, expect, it } from 'vitest'
import type { LoggedCommand } from '../catchup/replay'
import {
  CHECKPOINT_FORMAT,
  commandBytes,
  commandText,
  decodeCheckpoint,
  decodeSegment,
  decodeSnapshot,
  encodeCheckpoint,
  encodeSegment,
  encodeSnapshot,
  fromBase64,
  mergeSegments,
  SEGMENT_FORMAT,
  SNAPSHOT_FORMAT,
  toBase64,
  type Checkpoint,
} from './segments'

const text = (b: Uint8Array) => new TextDecoder().decode(b)
const bytes = (s: string) => new TextEncoder().encode(s)

const BIG_REF = '18446744073709551615' // u64::MAX: far beyond Number.MAX_SAFE_INTEGER

const PRAISE: LoggedCommand = { seq: 1, step: 540, kind: 'Praise', json: '{"Praise":{"staff":"staff-1"}}' }
const OUTCOME: LoggedCommand = {
  seq: 2,
  step: 540,
  kind: 'MeetingOutcome',
  json: `{"MeetingOutcome":{"job_id":1,"briefs":[{"brief_ref":${BIG_REF},"writer":"staff-1","editor":"staff-5"}]}}`,
}
const TRIAGE: LoggedCommand = { seq: 3, step: 600, kind: 'TriageInbox', json: '"TriageInbox"' }
const LANDED: LoggedCommand = { seq: 4, step: 912, kind: 'DeployLanded', json: '{"DeployLanded":{"work_item":"work-item-1"}}' }

describe('log segments', () => {
  it('round-trips commands in order', () => {
    const log = [PRAISE, OUTCOME, TRIAGE, LANDED]
    expect(decodeSegment(encodeSegment(log))).toEqual(log)
  })

  it('round-trips an empty and a single-command segment', () => {
    expect(decodeSegment(encodeSegment([]))).toEqual([])
    expect(decodeSegment(encodeSegment([TRIAGE]))).toEqual([TRIAGE])
  })

  it('has a stable, documented encoding (swarmpress.log.v1, UTF-8 JSON)', () => {
    expect(SEGMENT_FORMAT).toBe('swarmpress.log.v1')
    expect(text(encodeSegment([]))).toBe('{"format":"swarmpress.log.v1","commands":[]}')
    expect(text(encodeSegment([PRAISE]))).toBe(
      '{"format":"swarmpress.log.v1","commands":[{"seq":1,"step":540,"kind":"Praise","cmd":"{\\"Praise\\":{\\"staff\\":\\"staff-1\\"}}"}]}',
    )
  })

  it('encodes the same commands to the same bytes, whatever the property order or extra fields', () => {
    const a = encodeSegment([PRAISE, OUTCOME])
    const shuffled = [
      { json: PRAISE.json, kind: PRAISE.kind, step: PRAISE.step, seq: PRAISE.seq },
      { ...OUTCOME, payload: new Uint8Array([1]) } as LoggedCommand,
    ]
    expect(Array.from(encodeSegment(shuffled))).toEqual(Array.from(a))
    expect(Array.from(encodeSegment([PRAISE, OUTCOME]))).toEqual(Array.from(a))
  })

  it('re-encodes a decoded segment to identical bytes (a re-sent segment answers 200, not 409)', () => {
    const first = encodeSegment([PRAISE, OUTCOME, TRIAGE, LANDED])
    expect(Array.from(encodeSegment(decodeSegment(first)))).toEqual(Array.from(first))
  })

  it('keeps command bodies as text: u64 brief refs are never rounded', () => {
    const [back] = decodeSegment(encodeSegment([OUTCOME]))
    expect(back.json).toBe(OUTCOME.json)
    expect(back.json).toContain(BIG_REF)
    // The whole document parses without touching the command body.
    const doc = JSON.parse(text(encodeSegment([OUTCOME])))
    expect(typeof doc.commands[0].cmd).toBe('string')
  })

  it('keeps the command text verbatim (whitespace, key order, non-ASCII)', () => {
    const odd: LoggedCommand = { seq: 9, step: 3, kind: 'CreateProject', json: '{ "CreateProject" : {"name":"Caffè «Ünïcode» 🍋","slug":"c","domain":"c.travel"} }\n' }
    expect(decodeSegment(encodeSegment([odd]))[0].json).toBe(odd.json)
  })

  it('does not mutate its input', () => {
    const log = [{ ...PRAISE }, { ...OUTCOME }]
    const copy = structuredClone(log)
    encodeSegment(log)
    expect(log).toEqual(copy)
  })

  it('rejects an unknown format, a checkpoint blob and non-JSON bytes', () => {
    expect(() => decodeSegment(bytes('{"format":"swarmpress.log.v2","commands":[]}'))).toThrow(/unknown log segment format "swarmpress.log.v2"/)
    expect(() => decodeSegment(bytes('{"commands":[]}'))).toThrow(/unknown log segment format/)
    expect(() => decodeSegment(encodeCheckpoint({ scenario: 'cinqueterre', seed: '7', step: 1, hash: '2', lastSeq: 0 }))).toThrow(/unknown log segment format/)
    expect(() => decodeSegment(new Uint8Array([0xff, 0x00, 0x01]))).toThrow()
    expect(() => decodeSegment(new Uint8Array())).toThrow()
  })
})

describe('checkpoints', () => {
  const CP: Omit<Checkpoint, 'format'> = { scenario: 'cinqueterre', seed: BIG_REF, step: 1440, hash: '9223372036854775809', lastSeq: 12 }

  it('round-trips and stamps the format', () => {
    expect(decodeCheckpoint(encodeCheckpoint(CP))).toEqual({ format: CHECKPOINT_FORMAT, ...CP })
  })

  it('keeps the seed and the world hash as decimal text (u64)', () => {
    const back = decodeCheckpoint(encodeCheckpoint(CP))
    expect(back.seed).toBe(BIG_REF)
    expect(back.hash).toBe('9223372036854775809')
    expect(BigInt(back.hash)).toBe(9223372036854775809n)
  })

  it('has a stable encoding (swarmpress.checkpoint.v1)', () => {
    expect(CHECKPOINT_FORMAT).toBe('swarmpress.checkpoint.v1')
    expect(text(encodeCheckpoint({ scenario: 'cinqueterre', seed: '7', step: 60, hash: '42', lastSeq: 0 }))).toBe(
      '{"format":"swarmpress.checkpoint.v1","scenario":"cinqueterre","seed":"7","step":60,"hash":"42","lastSeq":0}',
    )
  })

  it('re-encodes a decoded checkpoint to identical bytes', () => {
    const again = encodeCheckpoint(decodeCheckpoint(encodeCheckpoint(CP)))
    expect(Array.from(again)).toEqual(Array.from(encodeCheckpoint(CP)))
  })

  it('rejects an unknown format, a segment blob and non-JSON bytes', () => {
    expect(() => decodeCheckpoint(bytes('{"format":"swarmpress.checkpoint.v0","step":1}'))).toThrow(/unknown checkpoint format "swarmpress.checkpoint.v0"/)
    expect(() => decodeCheckpoint(encodeSegment([PRAISE]))).toThrow(/unknown checkpoint format/)
    expect(() => decodeCheckpoint(bytes('not json'))).toThrow()
  })
})

describe('snapshot records', () => {
  const CP: Omit<Checkpoint, 'format'> = { scenario: 'cinqueterre', seed: BIG_REF, step: 36000, hash: '9223372036854775809', lastSeq: 7 }
  // Every byte value, and more than one base64 chunk (0x8000 bytes).
  const WORLD = Uint8Array.from({ length: 70_000 }, (_, i) => (i * 31 + (i >> 8)) & 0xff)

  it('carries the world bytes with the checkpoint fields, and round-trips both', () => {
    const back = decodeSnapshot(encodeSnapshot(CP, WORLD))
    expect(back.checkpoint).toEqual({ format: SNAPSHOT_FORMAT, ...CP })
    expect(back.world).toBeInstanceOf(Uint8Array)
    expect(back.world!.length).toBe(WORLD.length)
    expect(Array.from(back.world!)).toEqual(Array.from(WORLD))
  })

  it('has a stable encoding (swarmpress.snapshot.v1): the checkpoint fields, then the world as base64', () => {
    expect(SNAPSHOT_FORMAT).toBe('swarmpress.snapshot.v1')
    expect(text(encodeSnapshot({ scenario: 'cinqueterre', seed: '7', step: 60, hash: '42', lastSeq: 3 }, Uint8Array.of(0x53, 0x50, 0x57, 0x53, 0xff)))).toBe(
      '{"format":"swarmpress.snapshot.v1","scenario":"cinqueterre","seed":"7","step":60,"hash":"42","lastSeq":3,"world":"U1BXU/8="}',
    )
  })

  it('encodes the same snapshot to the same bytes, whatever extra fields the caller object carries', () => {
    const a = encodeSnapshot(CP, WORLD)
    const noisy = { lastSeq: CP.lastSeq, hash: CP.hash, step: CP.step, seed: CP.seed, scenario: CP.scenario, world: WORLD, format: 'x' } as unknown as Omit<Checkpoint, 'format'>
    expect(Array.from(encodeSnapshot(noisy, WORLD))).toEqual(Array.from(a))
    expect(Array.from(encodeCheckpoint(noisy))).toEqual(Array.from(encodeCheckpoint(CP)))
  })

  it('reads a legacy checkpoint as a record without a world', () => {
    expect(decodeSnapshot(encodeCheckpoint(CP))).toEqual({ checkpoint: { format: CHECKPOINT_FORMAT, ...CP }, world: null })
  })

  it('decodeCheckpoint reads the checkpoint fields of a snapshot record too', () => {
    expect(decodeCheckpoint(encodeSnapshot(CP, WORLD))).toEqual({ format: SNAPSHOT_FORMAT, ...CP })
  })

  it('a snapshot record stays readable as plain JSON (step, hash, lastSeq)', () => {
    const doc = JSON.parse(text(encodeSnapshot(CP, WORLD)))
    expect(doc).toMatchObject({ step: 36000, hash: '9223372036854775809', lastSeq: 7 })
    expect(typeof doc.world).toBe('string')
  })

  it('refuses a snapshot record without a world, with a damaged world, and an empty world', () => {
    expect(() => decodeSnapshot(bytes('{"format":"swarmpress.snapshot.v1","scenario":"c","seed":"7","step":1,"hash":"2","lastSeq":0}'))).toThrow(/malformed snapshot: no world/)
    expect(() => decodeSnapshot(bytes('{"format":"swarmpress.snapshot.v1","scenario":"c","seed":"7","step":1,"hash":"2","lastSeq":0,"world":""}'))).toThrow(/no world/)
    expect(() => decodeSnapshot(bytes('{"format":"swarmpress.snapshot.v1","scenario":"c","seed":"7","step":1,"hash":"2","lastSeq":0,"world":"%%%"}'))).toThrow(/not base64/)
    expect(() => encodeSnapshot(CP, new Uint8Array())).toThrow(/needs the world bytes/)
  })

  it('refuses unknown formats and malformed fields like a checkpoint does', () => {
    expect(() => decodeSnapshot(bytes('{"format":"swarmpress.snapshot.v2","world":"AA=="}'))).toThrow(/unknown checkpoint format "swarmpress.snapshot.v2"/)
    expect(() => decodeSnapshot(encodeSegment([PRAISE]))).toThrow(/unknown checkpoint format/)
    expect(() => decodeSnapshot(bytes('{"format":"swarmpress.snapshot.v1","scenario":"c","seed":7,"step":1,"hash":"2","lastSeq":0,"world":"AA=="}'))).toThrow(/malformed checkpoint/)
    expect(() => decodeSnapshot(bytes('null'))).toThrow(/unknown checkpoint format/)
    expect(() => decodeSnapshot(bytes('not json'))).toThrow()
  })

  it('base64 is the standard padded alphabet, both ways', () => {
    expect(toBase64(new Uint8Array())).toBe('')
    expect(toBase64(Uint8Array.of(0xfb, 0xff))).toBe('+/8=')
    expect(Array.from(fromBase64('+/8='))).toEqual([0xfb, 0xff])
    expect(Array.from(fromBase64(toBase64(WORLD)))).toEqual(Array.from(WORLD))
  })
})

describe('mergeSegments', () => {
  it('concatenates consecutive segments in seq order', () => {
    expect(mergeSegments([[PRAISE, OUTCOME], [TRIAGE], [LANDED]])).toEqual([PRAISE, OUTCOME, TRIAGE, LANDED])
  })

  it('orders by seq even when segments arrive out of order', () => {
    expect(mergeSegments([[LANDED], [TRIAGE], [PRAISE, OUTCOME]]).map((c) => c.seq)).toEqual([1, 2, 3, 4])
  })

  it('drops duplicates of a re-sent segment', () => {
    const merged = mergeSegments([[PRAISE, OUTCOME], [PRAISE, OUTCOME], [OUTCOME, TRIAGE]])
    expect(merged).toEqual([PRAISE, OUTCOME, TRIAGE])
  })

  it('handles no segments and empty segments', () => {
    expect(mergeSegments([])).toEqual([])
    expect(mergeSegments([[], []])).toEqual([])
    expect(mergeSegments([[], [TRIAGE], []])).toEqual([TRIAGE])
  })

  it('does not mutate the segments', () => {
    const a = [LANDED, PRAISE]
    mergeSegments([a])
    expect(a).toEqual([LANDED, PRAISE])
  })

  it('survives a split anywhere: encode → decode → merge gives back the log', () => {
    const log = [PRAISE, OUTCOME, TRIAGE, LANDED]
    for (let cut = 0; cut <= log.length; cut++) {
      const parts = [log.slice(0, cut), log.slice(cut)].map((p) => decodeSegment(encodeSegment(p)))
      expect(mergeSegments(parts)).toEqual(log)
    }
  })
})

describe('command payloads', () => {
  it('are the command JSON text as UTF-8, both ways', () => {
    expect(Array.from(commandBytes('"TriageInbox"'))).toEqual(Array.from(bytes('"TriageInbox"')))
    for (const c of [PRAISE, OUTCOME, TRIAGE, LANDED]) expect(commandText(commandBytes(c.json))).toBe(c.json)
    expect(commandText(commandBytes('{"FollowUp":{"topic":"Caffè 🍋"}}'))).toBe('{"FollowUp":{"topic":"Caffè 🍋"}}')
  })
})
