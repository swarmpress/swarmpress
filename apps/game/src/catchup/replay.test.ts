// Restore by replay (FEAT-014, ADR-0038). Two layers:
// - the replay driver against a small deterministic fake sim (always runs);
// - the real client-wasm sim: the same seed plus the same command log gives
//   the same `World::hash` (CLAUDE.md rule 1). Needs `cargo xtask wasm`;
//   skipped without crates/client-wasm/pkg.
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { decodeSegment, encodeSegment, mergeSegments } from '../sync/segments'
import { commandKind, parseClock, replay, settles, stepsUntil, type LoggedCommand, type ReplayResult, type ReplaySim } from './replay'

// ------------------------------------------------------------------ fake sim

const MASK = (1n << 64n) - 1n
const mix = (h: bigint, x: bigint) => ((h ^ x) * 1099511628211n) & MASK
const textHash = (s: string) => [...s].reduce((h, ch) => mix(h, BigInt(ch.codePointAt(0)!)), 14695981039346656037n)

/**
 * A deterministic stand-in for client-wasm's `Sim`: the hash folds in every
 * tick and every command at the step it was applied, so a command applied one
 * step early or late, dropped or reordered gives a different hash.
 */
class FakeSim implements ReplaySim {
  s = 0
  h = 17n
  queue: string[] = []
  applied: { step: number; json: string }[] = []
  advances: number[] = []
  drains = 0
  /** step → effect JSON emitted when the sim reaches that step. */
  emitAt: Record<number, string> = {}
  minute = 0
  spd = 1440

  step() {
    return BigInt(this.s)
  }
  hash() {
    return this.h
  }
  advance(n: number) {
    if (!Number.isInteger(n) || n <= 0) throw new Error(`advance(${n})`)
    this.advances.push(n)
    for (let i = 0; i < n; i++) {
      this.s++
      this.h = mix(this.h, 1n)
      if (this.emitAt[this.s]) this.queue.push(this.emitAt[this.s])
    }
  }
  apply_command_json(json: string) {
    // wasm-bindgen throws the Rust `Err(String)` as a plain string.
    if (json.includes('Reject')) throw 'not allowed right now'
    this.h = mix(this.h, textHash(json))
    this.applied.push({ step: this.s, json })
    if (json.includes('MeetingOutcome')) this.queue.push('{"job_id":2,"kind":"draft"}')
  }
  drain_effects_json() {
    this.drains++
    const out = `[${this.queue.join(',')}]`
    this.queue = []
    return out
  }
  day() {
    return 0
  }
  minute_of_day() {
    return this.minute
  }
  steps_per_day() {
    return BigInt(this.spd)
  }
}

const PRAISE = '{"Praise":{"staff":"staff-1"}}'
const OUTCOME = '{"MeetingOutcome":{"job_id":1,"briefs":[{"brief_ref":18446744073709551615,"writer":"staff-1","editor":"staff-5"}]}}'
const DONE = (job: number) => `{"JobCompleted":{"job_id":${job},"digest":{"ok":true,"score":8,"words":900,"qa_defects":0,"artifact_sha":null}}}`
const LANDED = '{"DeployLanded":{"work_item":"work-item-1"}}'
const TRIAGE = '"TriageInbox"'

const logOf = (...cmds: [step: number, json: string][]): LoggedCommand[] => cmds.map(([step, json], i) => ({ seq: i + 1, step, kind: commandKind(json), json }))
const flat = (effects: string[]) => effects.flatMap((e) => JSON.parse(e) as { job_id: number; kind: string }[])

/** The original run: advance tick by tick, apply each command at its step. */
function original(log: LoggedCommand[], until: number): FakeSim {
  const sim = new FakeSim()
  for (const c of log) {
    while (sim.s < c.step) sim.advance(1)
    sim.apply_command_json(c.json)
  }
  while (sim.s < until) sim.advance(1)
  return sim
}

describe('commandKind', () => {
  it('reads the variant of an externally tagged command', () => {
    expect(commandKind(PRAISE)).toBe('Praise')
    expect(commandKind(OUTCOME)).toBe('MeetingOutcome')
    expect(commandKind(TRIAGE)).toBe('TriageInbox')
    expect(commandKind('  \n{ "DeployLanded" : {"work_item":"work-item-1"}}')).toBe('DeployLanded')
  })

  it('throws on anything that is not a command', () => {
    for (const bad of ['', '{}', '[]', '42', 'null', '{"":{}}', 'Praise']) expect(() => commandKind(bad), bad).toThrow(/bad command JSON/)
  })
})

describe('settles', () => {
  it('names the job an outcome completes and the work item a deploy lands', () => {
    expect(settles(OUTCOME)).toEqual({ job: 1 })
    expect(settles(DONE(7))).toEqual({ job: 7 })
    expect(settles(LANDED)).toEqual({ landed: 'work-item-1' })
  })

  it('is empty for CEO commands and unit variants', () => {
    expect(settles(PRAISE)).toEqual({})
    expect(settles(TRIAGE)).toEqual({})
    expect(settles('{"AnswerTicket":{"ticket":"ticket-3","option":"retry"}}')).toEqual({})
  })
})

describe('replay (driver)', () => {
  it('an empty log leaves a fresh sim untouched', () => {
    const sim = new FakeSim()
    const r = replay(sim, [])
    expect(r).toEqual({ step: 0, hash: '17', applied: 0, effects: [], completedJobs: new Set(), landed: new Set() })
    expect(sim.advances).toEqual([])
  })

  it('an empty log with a target step fast-forwards to exactly that step', () => {
    const sim = new FakeSim()
    const r = replay(sim, [], 2500)
    expect(r.step).toBe(2500)
    expect(r.hash).toBe(original([], 2500).hash().toString())
    expect(r.applied).toBe(0)
  })

  it('applies every command at the step it was logged at, in log order', () => {
    const log = logOf([0, TRIAGE], [540, PRAISE], [540, OUTCOME], [541, DONE(2)], [3000, LANDED])
    const sim = new FakeSim()
    const r = replay(sim, log)
    expect(sim.applied).toEqual(log.map((c) => ({ step: c.step, json: c.json })))
    expect(r.applied).toBe(5)
    expect(r.step).toBe(3000)
  })

  it('reaches the hash of the original run', () => {
    const log = logOf([0, TRIAGE], [540, PRAISE], [540, OUTCOME], [541, DONE(2)], [3000, LANDED])
    const want = original(log, 4321)
    const r = replay(new FakeSim(), log, 4321)
    expect(r.step).toBe(4321)
    expect(r.hash).toBe(want.hash().toString())
  })

  it('the hash is decimal text of the full u64', () => {
    const log = logOf([5, PRAISE])
    const r = replay(new FakeSim(), log, 9)
    expect(r.hash).toMatch(/^\d+$/)
    expect(BigInt(r.hash)).toBe(original(log, 9).hash())
    expect(BigInt(r.hash) > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true)
  })

  it('stops at the target step, or at the last command when that is later', () => {
    const log = logOf([10, PRAISE], [50, TRIAGE])
    expect(replay(new FakeSim(), log, 80).step).toBe(80)
    expect(replay(new FakeSim(), log, 50).step).toBe(50)
    expect(replay(new FakeSim(), log, 20).step).toBe(50)
    expect(replay(new FakeSim(), log).step).toBe(50)
  })

  it('gives the same result for every chunk size and never steps past a command', () => {
    const log = logOf([3, PRAISE], [1000, OUTCOME], [1001, DONE(2)], [2999, LANDED])
    const want = original(log, 3500).hash().toString()
    for (const chunk of [1, 7, 999, 1000, 1001, 100_000]) {
      const sim = new FakeSim()
      const r = replay(sim, log, 3500, { chunk })
      expect(r.hash, `chunk ${chunk}`).toBe(want)
      expect(r.step).toBe(3500)
      expect(Math.max(...sim.advances)).toBeLessThanOrEqual(chunk)
      expect(sim.applied.map((a) => a.step)).toEqual([3, 1000, 1001, 2999])
    }
  })

  it('clamps a non-positive chunk to one step', () => {
    const sim = new FakeSim()
    expect(replay(sim, logOf([4, PRAISE]), 6, { chunk: 0 }).step).toBe(6)
    expect(sim.advances).toEqual([1, 1, 1, 1, 1, 1])
  })

  it('hands the command text to the sim untouched (u64 refs are not re-serialized)', () => {
    const sim = new FakeSim()
    replay(sim, logOf([540, OUTCOME]))
    expect(sim.applied[0].json).toBe(OUTCOME)
    expect(sim.applied[0].json).toContain('18446744073709551615')
  })

  it('collects the effects re-emitted during the replay, in order, skipping empty drains', () => {
    const sim = new FakeSim()
    sim.queue.push('{"job_id":0,"kind":"scenario"}') // queued by the scenario itself
    sim.emitAt = { 540: '{"job_id":1,"kind":"standup"}', 700: '{"job_id":3,"kind":"review"}' }
    const r = replay(sim, logOf([540, OUTCOME], [600, DONE(2)]), 800, { chunk: 100 })
    expect(r.effects.every((e) => e !== '[]')).toBe(true)
    expect(flat(r.effects).map((e) => e.kind)).toEqual(['scenario', 'standup', 'draft', 'review'])
    expect(sim.queue).toEqual([]) // nothing left undrained for the caller to trip over
  })

  it('reports the jobs and deploys the log already settles, so the caller re-runs only the rest', () => {
    const sim = new FakeSim()
    sim.emitAt = { 540: '{"job_id":1,"kind":"standup"}', 700: '{"job_id":3,"kind":"review"}' }
    const r = replay(sim, logOf([540, OUTCOME], [600, DONE(2)], [900, LANDED]), 900)
    expect(r.completedJobs).toEqual(new Set([1, 2]))
    expect(r.landed).toEqual(new Set(['work-item-1']))
    const outstanding = flat(r.effects).filter((e) => !r.completedJobs.has(e.job_id))
    expect(outstanding.map((e) => e.job_id)).toEqual([3])
  })

  it('throws when a command is behind the replay (a log out of step order)', () => {
    const sim = new FakeSim()
    expect(() => replay(sim, [
      { seq: 1, step: 50, kind: 'Praise', json: PRAISE },
      { seq: 2, step: 49, kind: 'TriageInbox', json: TRIAGE },
    ])).toThrow(/command #2 at step 49 is behind the replay \(step 50\)/)
    expect(sim.applied).toHaveLength(1)
  })

  it('throws on a sim that is already past the first command (replay needs a fresh sim)', () => {
    const sim = new FakeSim()
    sim.advance(10)
    expect(() => replay(sim, logOf([5, PRAISE]))).toThrow(/behind the replay/)
  })

  it('throws with the seq, kind, step and the sim reason when a command is rejected', () => {
    const log = logOf([10, PRAISE], [20, '{"Reject":{}}'], [30, TRIAGE])
    const sim = new FakeSim()
    expect(() => replay(sim, log)).toThrow(/replay: command #2 \(Reject\) at step 20 was rejected: not allowed right now/)
    expect(sim.applied).toHaveLength(1) // nothing after the corrupt entry is applied
  })
})

describe('parseClock', () => {
  it('parses HH:MM into the minute of the day', () => {
    expect(parseClock('00:00')).toBe(0)
    expect(parseClock('09:00')).toBe(540)
    expect(parseClock('9:05')).toBe(545)
    expect(parseClock(' 23:59 ')).toBe(1439)
  })

  it('is null for missing or malformed input', () => {
    for (const bad of [null, '', '24:00', '12:60', '9', '9:5', '09:00:00', 'noon', '-1:00', '1e1:00']) expect(parseClock(bad), String(bad)).toBeNull()
  })
})

describe('stepsUntil', () => {
  const at = (minute: number, spd: number) => Object.assign(new FakeSim(), { minute, spd })

  it('is the number of steps to a later time the same day', () => {
    expect(stepsUntil(at(480, 1440), 540)).toBe(60)
    expect(stepsUntil(at(480, 2880), 540)).toBe(120)
    expect(stepsUntil(at(0, 86_400), 1439)).toBe(1439 * 60)
  })

  it('rounds up when a minute is not a whole number of steps', () => {
    expect(stepsUntil(at(480, 1000), 540)).toBe(42) // 41.67
    expect(stepsUntil(at(0, 720), 1)).toBe(1)
  })

  it('is 0 when that time is now or already passed (never skips a day)', () => {
    expect(stepsUntil(at(540, 1440), 540)).toBe(0)
    expect(stepsUntil(at(900, 1440), 540)).toBe(0)
  })
})

// ------------------------------------------------------------------ real sim

// vitest runs with apps/game as the working directory.
const PKG = resolve(process.cwd(), '../../crates/client-wasm/pkg') + '/'
const built = existsSync(`${PKG}client_wasm.js`)

type RealSim = ReplaySim & {
  pending_effects(): number
  plan_json(project?: string): string
  validate_command_json(json: string): string | undefined
}
type WasmModule = {
  initSync(m: { module: BufferSource }): unknown
  Sim: { scenario(name: string, seed: bigint): RealSim }
}
let wasm: WasmModule

interface Effect {
  job_id: number
  kind: string
  work_item: string | null
}
interface Mark {
  name: string
  step: number
  hash: string
  /** Log length when the mark was taken. */
  seq: number
}
interface Recording {
  log: LoggedCommand[]
  marks: Record<string, Mark>
  jobs: Record<string, number>
  final: Mark
}

const SCENARIO = 'cinqueterre'
const SEED = 7n
const SHA = '0123456789abcdef0123456789abcdef01234567'

/**
 * Plays one article through the pipeline the way the orchestration loop does
 * (crates/client-wasm `job_contract_through_json`): standup → brief → draft →
 * review 6 → redraft → review 8 → publish → DeployLanded, with a CEO command
 * on the way, logging every command with the step it was applied at.
 */
function record(seed = SEED): Recording {
  const sim = wasm.Sim.scenario(SCENARIO, seed)
  const log: LoggedCommand[] = []
  const marks: Record<string, Mark> = {}
  const jobs: Record<string, number> = {}
  const apply = (json: string) => {
    sim.apply_command_json(json)
    log.push({ seq: log.length + 1, step: Number(sim.step()), kind: commandKind(json), json })
  }
  const mark = (name: string): Mark => (marks[name] = { name, step: Number(sim.step()), hash: sim.hash().toString(), seq: log.length })
  const drain = () => JSON.parse(sim.drain_effects_json()) as Effect[]
  const next = (kind: string, name = kind): Effect => {
    for (let i = 0; i < 20_000; i++) {
      sim.advance(1)
      if (sim.pending_effects() > 0) {
        const [e] = drain()
        if (e.kind !== kind) throw new Error(`expected a ${kind} job, got ${e.kind}`)
        jobs[name] = e.job_id
        return e
      }
    }
    throw new Error(`no ${kind} job`)
  }
  const done = (e: Effect, score: number, sha: string | null = null) =>
    JSON.stringify({ JobCompleted: { job_id: e.job_id, digest: { ok: true, score, words: 900, qa_defects: 0, artifact_sha: sha } } })

  mark('start')
  const standup = next('standup')
  apply(PRAISE) // a CEO command and an outcome at the same step boundary
  apply(JSON.stringify({ MeetingOutcome: { job_id: standup.job_id, briefs: [{ brief_ref: 42, writer: 'staff-1', editor: 'staff-5' }] } }))
  mark('briefed')
  const [draft] = drain()
  jobs.draft = draft.job_id
  apply(done(draft, 0, SHA))
  sim.advance(37)
  mark('drafting') // between two commands
  apply(done(next('review', 'review1'), 6))
  apply(done(next('draft', 'redraft'), 0))
  apply(done(next('review', 'review2'), 8))
  const publish = next('publish')
  mark('publishRequested')
  apply(done(publish, 0))
  sim.advance(200)
  mark('scheduled')
  apply(LANDED)
  mark('landed')
  sim.advance(300)
  return { log, marks, jobs, final: mark('final') }
}

/** session.ts restore(): true / false when the replay stopped at the checkpoint's step, null otherwise. */
const verify = (r: ReplayResult, cp: { step: number; hash: string }) => (r.step === cp.step ? r.hash === cp.hash : null)
const upTo = (rec: Recording, m: Mark) => rec.log.filter((c) => c.seq <= m.seq)
const fresh = (seed = SEED) => wasm.Sim.scenario(SCENARIO, seed)
const status = (sim: RealSim) => (JSON.parse(sim.plan_json()) as { items: { id: string; status: string }[] }).items.find((i) => i.id === 'work-item-1')?.status
const requested = (r: ReplayResult) => r.effects.flatMap((e) => JSON.parse(e) as Effect[])

describe.skipIf(!built)('replay over the real sim (client-wasm)', () => {
  let rec: Recording

  beforeAll(async () => {
    wasm = (await import(/* @vite-ignore */ pathToFileURL(`${PKG}client_wasm.js`).href)) as WasmModule
    wasm.initSync({ module: readFileSync(`${PKG}client_wasm_bg.wasm`) })
    rec = record()
  })

  it('the recorded run is a real one: eight commands, the article ends up published', () => {
    expect(rec.log.map((c) => c.kind)).toEqual(['Praise', 'MeetingOutcome', 'JobCompleted', 'JobCompleted', 'JobCompleted', 'JobCompleted', 'JobCompleted', 'DeployLanded'])
    expect(rec.log[0].step).toBe(rec.log[1].step)
    expect(rec.final.hash).not.toBe(rec.marks.start.hash)
  })

  it('recording the same seed twice gives the same log and hash (the sim is deterministic)', () => {
    const again = record()
    expect(again.log).toEqual(rec.log)
    expect(again.final).toEqual(rec.final)
  })

  it('replaying the log from the seed reaches the hash of the original run', () => {
    const sim = fresh()
    const r = replay(sim, rec.log, rec.final.step)
    expect(r.step).toBe(rec.final.step)
    expect(r.hash).toBe(rec.final.hash)
    expect(r.applied).toBe(rec.log.length)
    expect(verify(r, rec.final)).toBe(true)
    expect(status(sim)).toBe('published')
    expect(Number(sim.step())).toBe(rec.final.step)
  })

  it('reaches the original hash at every checkpoint on the way', () => {
    for (const m of Object.values(rec.marks)) {
      const r = replay(fresh(), upTo(rec, m), m.step)
      expect(r.step, m.name).toBe(m.step)
      expect(r.hash, m.name).toBe(m.hash)
      expect(verify(r, m), m.name).toBe(true)
    }
  })

  it('the result does not depend on the chunk size', () => {
    for (const chunk of [1, 13, 1000, 1_000_000]) expect(replay(fresh(), rec.log, rec.final.step, { chunk }).hash, `chunk ${chunk}`).toBe(rec.final.hash)
  })

  it('an empty log restores a new company: step 0, the scenario hash', () => {
    const r = replay(fresh(), [])
    expect(r).toMatchObject({ step: 0, hash: rec.marks.start.hash, applied: 0 })
    expect(verify(r, rec.marks.start)).toBe(true)
  })

  it('an empty log fast-forwards like the plain sim', () => {
    const plain = fresh()
    plain.advance(1234)
    const r = replay(fresh(), [], 1234, { chunk: 100 })
    expect(r.hash).toBe(plain.hash().toString())
  })

  it('survives the sync wire format: log → segments → merge → replay gives the same hash (FEAT-012)', () => {
    const cut = 3
    const segments = [rec.log.slice(0, cut), rec.log.slice(cut)].map((s) => decodeSegment(encodeSegment(s)))
    const r = replay(fresh(), mergeSegments(segments.reverse()), rec.final.step)
    expect(r.hash).toBe(rec.final.hash)
  })

  describe('checkpoint verification', () => {
    it('is false when the log misses a command (desync)', () => {
      const withoutDeploy = rec.log.filter((c) => c.kind !== 'DeployLanded')
      const r = replay(fresh(), withoutDeploy, rec.final.step)
      expect(r.step).toBe(rec.final.step)
      expect(verify(r, rec.final)).toBe(false)
    })

    it('is false when the log is replayed onto another seed', () => {
      let r: ReplayResult
      try {
        r = replay(fresh(SEED + 1n), rec.log, rec.final.step)
      } catch (e) {
        expect(String(e)).toMatch(/replay: command #\d+ .* was rejected/) // also a loud failure
        return
      }
      expect(verify(r, rec.final)).toBe(false)
    })

    it('is null when the log goes on past the checkpoint (the replay stops later)', () => {
      const cp = rec.marks.drafting
      const r = replay(fresh(), rec.log, cp.step)
      expect(r.step).toBeGreaterThan(cp.step)
      expect(verify(r, cp)).toBeNull()
      // …and it still ends where the original run was at that later step.
      expect(r.step).toBe(rec.marks.landed.step)
      expect(r.hash).toBe(rec.marks.landed.hash)
    })
  })

  it('re-emits the job requests, and the log tells which of them are settled', () => {
    const r = replay(fresh(), rec.log, rec.final.step)
    const asked = requested(r).map((e) => e.job_id)
    for (const id of Object.values(rec.jobs)) expect(asked).toContain(id)
    expect([...r.completedJobs].sort((a, b) => a - b)).toEqual(Object.values(rec.jobs).sort((a, b) => a - b))
    expect(r.landed).toEqual(new Set(['work-item-1']))
  })

  it('a job requested but not answered before the reload is left for the caller to re-run', () => {
    const m = rec.marks.publishRequested
    const r = replay(fresh(), upTo(rec, m), m.step)
    expect(r.hash).toBe(m.hash)
    const outstanding = requested(r).filter((e) => !r.completedJobs.has(e.job_id))
    expect(outstanding.map((e) => [e.job_id, e.kind, e.work_item])).toEqual([[rec.jobs.publish, 'publish', 'work-item-1']])
    expect(r.landed.size).toBe(0)
  })

  it('a DeployLanded that queued centrally while the browser was closed lands in step order', () => {
    // The device closed at `scheduled` (merged, awaiting the deploy); the inbox event is applied at the
    // step the device reopened at, and the item becomes published exactly as in the uninterrupted run.
    const m = rec.marks.scheduled
    const closed = replay(fresh(), upTo(rec, m), m.step)
    expect(verify(closed, m)).toBe(true)
    expect(closed.landed.size).toBe(0)

    const sim = fresh()
    const reopened = replay(sim, [...upTo(rec, m), { seq: m.seq + 1, step: m.step, kind: 'DeployLanded', json: LANDED }], rec.final.step)
    expect(status(sim)).toBe('published')
    expect(reopened.landed).toEqual(new Set(['work-item-1']))
    expect(reopened.hash).toBe(rec.final.hash)
  })

  it('a DeployLanded ahead of its publish is rejected by the sim, and the replay says which command', () => {
    const approved = rec.log.filter((c) => c.seq <= rec.marks.publishRequested.seq)
    const early: LoggedCommand = { seq: approved.length + 1, step: rec.marks.publishRequested.step, kind: 'DeployLanded', json: LANDED }
    expect(() => replay(fresh(), [...approved, early])).toThrow(new RegExp(`replay: command #${early.seq} \\(DeployLanded\\) at step ${early.step} was rejected: .+`))
  })

  it('a command moved to another step changes the hash', () => {
    const shifted = rec.log.map((c) => (c.kind === 'DeployLanded' ? { ...c, step: c.step + 100 } : c))
    const r = replay(fresh(), shifted, rec.final.step)
    expect(r.step).toBe(rec.final.step)
    expect(r.hash).not.toBe(rec.final.hash)
  })

  it('stepsUntil fast-forwards the real clock to the asked time', () => {
    const sim = fresh()
    const target = parseClock('09:00')!
    const n = stepsUntil(sim, target)
    expect(n).toBeGreaterThan(0)
    sim.advance(n)
    expect(sim.minute_of_day()).toBe(target)
    expect(sim.day()).toBe(wasm.Sim.scenario(SCENARIO, SEED).day())
    expect(stepsUntil(sim, target)).toBe(0)
    expect(stepsUntil(sim, target - 1)).toBe(0)
  })
})
