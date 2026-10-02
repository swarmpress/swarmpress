// Game time independent of GPU speed (ADR-0060, FEAT-080), on the real
// client-wasm sim: the orchestration loop and the clock driver wired as the
// session wires them (`sessionClockHost`), with a fake orchestrator whose jobs
// take a scripted amount of wall time.
//
//   - a draft that takes 0 s, 60 s or 12 min completes its phase at the same
//     sim step, and each run's command log replays to its hash;
//   - two drafts queued behind one model hold the clock, then both move on at
//     the same step.
//
// Needs `cargo xtask wasm`; skipped without crates/client-wasm/pkg.
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { replay, type LoggedCommand } from '../catchup/replay'
import { ClockDriver, sessionClockHost } from '../session/clock-driver'
import type { CommandRecord } from '../store/company-store'
import { commandText } from '../sync/segments'
import { DUE_MINUTES, minutesToSteps } from './due-step'
import { OrchestrationLoop, type LoopSim, type LoopStore } from './loop'

// vitest runs with apps/game as the working directory.
const PKG = resolve(process.cwd(), '../../crates/client-wasm/pkg') + '/'
const built = existsSync(`${PKG}client_wasm.js`)

type WasmModule = {
  initSync(m: { module: BufferSource }): unknown
  Sim: { scenario(name: string, seed: bigint): LoopSim }
}
let wasm: WasmModule

const SCENARIO = 'cinqueterre'
const SEED = 7n
const SHA = '0123456789abcdef0123456789abcdef01234567'
const SECOND = 1000
const MINUTE = 60 * SECOND

class MemStore implements LoopStore {
  log: CommandRecord[] = []
  kv = new Map<string, string>()
  async appendCommands(cmds: CommandRecord[]) {
    this.log.push(...cmds)
    return cmds.map((c) => c.seq ?? 0)
  }
  appendPost = async () => 'post'
  getKv = async (key: string) => this.kv.get(key) ?? null
  async setKv(key: string, value: string) {
    this.kv.set(key, value)
  }
  async deleteKv(key: string) {
    this.kv.delete(key)
  }
}

interface Job {
  job_id: number
  kind: string
  work_item: string | null
  revision: number
}

interface Brief {
  brief_ref: number
  writer: string
  editor: string
}

interface Requested extends Job {
  /** `sim.step()` when the sim asked for the job. */
  step: number
  /** Wall time then. */
  wallMs: number
}

/** Lets every promise chain of the loop run (they are all microtasks here). */
const flush = () => new Promise<void>((r) => setImmediate(r))

/**
 * One company on the real sim, driven like the game page drives it: 100 ms of
 * wall time per tick through the clock driver. A job's `run()` resolves once
 * the scripted latency has passed in wall time. While the clock is held for a
 * due job nothing changes until that job finishes, so the harness jumps the
 * wall clock there instead of ticking through minutes of hold.
 */
class Company {
  sim = wasm.Sim.scenario(SCENARIO, SEED)
  store = new MemStore()
  wallMs = 0
  requested: Requested[] = []
  /** Job ids in the order the model ran them. */
  ran: number[] = []
  private flying: { job: number; finishAt: number; finish: () => void }[] = []
  loop: OrchestrationLoop
  driver: ClockDriver

  constructor(o: { latencyMs: (job: Job) => number; briefs: Brief[]; speed?: number }) {
    const outcome = (j: Job) => {
      if (j.kind === 'standup') return { MeetingOutcome: { job_id: j.job_id, briefs: o.briefs } }
      const score = j.kind === 'review' ? 8 : 0
      return { JobCompleted: { job_id: j.job_id, digest: { ok: true, score, words: 900, qa_defects: 0, artifact_sha: j.kind === 'draft' ? SHA : null } } }
    }
    this.loop = new OrchestrationLoop({
      sim: this.sim,
      store: this.store,
      companyId: 'co',
      codec: {
        jobsFromEffects: (effects) => {
          const jobs = JSON.parse(effects) as Job[]
          // The clock holds while jobs are taken in, so this is the step the sim asked at.
          for (const j of jobs) this.requested.push({ job_id: j.job_id, kind: j.kind, work_item: j.work_item, revision: j.revision, step: Number(this.sim.step()), wallMs: this.wallMs })
          return jobs.map((j) => JSON.stringify(j))
        },
        outcomesForSim: (outcomes) => (JSON.parse(outcomes) as unknown[]).map((x) => JSON.stringify(x)),
      },
      orchestrator: {
        run: (jobJson) =>
          new Promise<string>((done) => {
            const j = JSON.parse(jobJson) as Job
            this.ran.push(j.job_id)
            this.flying.push({ job: j.job_id, finishAt: this.wallMs + o.latencyMs(j), finish: () => done(JSON.stringify([outcome(j)])) })
          }),
      },
      // The wall clock here is simulated: real timers must not give up on a job.
      jobTimeoutMs: 0,
    })
    this.driver = new ClockDriver(sessionClockHost(this.sim, this.loop, { modelReady: () => true }), { speed: o.speed ?? 1 })
  }

  get step() {
    return Number(this.sim.step())
  }

  job(kind: string, n = 0): Requested | undefined {
    return this.requested.filter((r) => r.kind === kind)[n]
  }

  /** The command log, as the store holds it. */
  get log(): LoggedCommand[] {
    return this.store.log.map((c) => ({ seq: c.seq ?? 0, step: c.step, kind: c.kind, json: commandText(c.payload) }))
  }

  /** The logged outcome of a job. */
  outcomeOf(jobId: number): LoggedCommand | undefined {
    return this.log.find((c) => (c.kind === 'JobCompleted' || c.kind === 'MeetingOutcome') && (JSON.parse(c.json) as Record<string, { job_id: number }>)[c.kind].job_id === jobId)
  }

  status(item = 'work-item-1'): string | undefined {
    return (JSON.parse(this.sim.plan_json()) as { items: { id: string; status: string }[] }).items.find((i) => i.id === item)?.status
  }

  /** Ticks until `done()`; `onTick` sees every tick (after the loop settled). */
  async run(done: () => boolean, onTick?: () => void, limit = 40_000): Promise<void> {
    for (let i = 0; i < limit; i++) {
      const finished = this.flying.filter((f) => f.finishAt <= this.wallMs)
      this.flying = this.flying.filter((f) => f.finishAt > this.wallMs)
      finished.forEach((f) => f.finish())
      await flush()
      if (done()) return
      const r = this.driver.tick(100)
      this.wallMs += 100
      await flush()
      onTick?.()
      // Held for a due job: nothing moves until the model is done with it.
      if (r.steps === 0 && this.driver.hold === 'due' && this.flying.length) {
        this.wallMs = Math.max(this.wallMs, Math.min(...this.flying.map((f) => f.finishAt)))
      }
    }
    throw new Error(`the run did not finish in ${limit} ticks (step ${this.step}, hold ${this.driver.hold})`)
  }
}

describe.skipIf(!built)('game time is independent of GPU speed (real sim)', () => {
  beforeAll(async () => {
    wasm = (await import(/* @vite-ignore */ pathToFileURL(`${PKG}client_wasm.js`).href)) as WasmModule
    wasm.initSync({ module: readFileSync(`${PKG}client_wasm_bg.wasm`) })
  })

  const ONE_BRIEF: Brief[] = [{ brief_ref: 42, writer: 'staff-1', editor: 'staff-5' }]
  const DRAFT_STEPS = 1000 // 120 game minutes of a 12,000-step day
  const REVIEW_STEPS = 500

  /** Standup → one draft of the given latency → review requested → a few steps more. */
  async function draftRun(draftMs: number, speed = 1) {
    const c = new Company({ latencyMs: (j) => (j.kind === 'draft' ? draftMs : 0), briefs: ONE_BRIEF, speed })
    await c.run(() => c.job('review') != null)
    const atReview = { step: c.step, plan: c.sim.plan_json(), status: c.status() }
    const target = atReview.step + 40
    await c.run(() => c.step >= target)
    await c.loop.idle()
    return { c, atReview, final: { step: c.step, hash: c.sim.hash().toString() } }
  }

  it('the host derives the sim’s phase minimums: draft 120, review 60, publish 15, standup 30 game minutes', () => {
    const spd = Number(wasm.Sim.scenario(SCENARIO, SEED).steps_per_day())
    expect(spd).toBe(12_000)
    expect(['draft', 'review', 'publish', 'standup'].map((k) => minutesToSteps(DUE_MINUTES[k], spd))).toEqual([DRAFT_STEPS, REVIEW_STEPS, 125, 250])
  })

  it('a draft of 0 s, 60 s or 12 min completes its phase at the same step, and each log replays to its hash', async () => {
    const runs = [await draftRun(0), await draftRun(60 * SECOND), await draftRun(12 * MINUTE)]
    const [fast, mid, slow] = runs

    // The same world up to the draft: the standup at 09:00 (step 1000), the draft right after its outcome.
    const draftAt = fast.c.job('draft')!.step
    expect(fast.c.job('standup')!.step).toBe(1000)
    for (const r of runs) {
      // The due step is the sim's own view (`Sim.next_due_step`, `plan_json` `dueStep`).
      expect(r.c.loop.dueOrigin).toBe('sim')
      expect(r.c.loop.errors).toEqual([])
      expect(r.c.job('draft')!.step).toBe(draftAt)
      expect(r.c.loop.jobs.find((j) => j.kind === 'draft')).toMatchObject({ due_step: draftAt + DRAFT_STEPS, who: 'Giulia', state: 'done' })
    }

    // The phase completes (the review is requested) at the draft's minimum, whatever the model took.
    for (const r of runs) {
      expect(r.c.job('review')!.step).toBe(draftAt + DRAFT_STEPS)
      expect(r.atReview.step).toBe(draftAt + DRAFT_STEPS)
      expect(r.atReview.status).toBe('in-review')
      expect(r.c.loop.jobs.find((j) => j.kind === 'review')).toMatchObject({ due_step: draftAt + DRAFT_STEPS + REVIEW_STEPS })
    }
    // …with the same plan at that boundary.
    expect(mid.atReview.plan).toBe(fast.atReview.plan)
    expect(slow.atReview.plan).toBe(fast.atReview.plan)

    // Wall time is what differs: where the outcome was logged, and how long the phase took.
    const loggedAt = (r: (typeof runs)[number]) => r.c.outcomeOf(r.c.job('draft')!.job_id)!.step
    expect(loggedAt(fast)).toBeLessThanOrEqual(draftAt + 2)
    expect(loggedAt(mid)).toBeGreaterThan(draftAt + 590)
    expect(loggedAt(mid)).toBeLessThan(draftAt + 610)
    // Held one step short of the due step until the outcome came.
    expect(loggedAt(slow)).toBe(draftAt + DRAFT_STEPS - 1)
    const wall = (r: (typeof runs)[number]) => r.c.job('review')!.wallMs - r.c.job('draft')!.wallMs
    expect(wall(fast)).toBeLessThan(101 * SECOND)
    expect(wall(mid)).toBeLessThan(101 * SECOND)
    expect(wall(slow)).toBeGreaterThanOrEqual(12 * MINUTE)
    expect(wall(slow)).toBeLessThan(12 * MINUTE + 2 * SECOND)

    // Replay: each run's own log, applied at its logged steps, reproduces that run's hash.
    for (const r of runs) {
      expect(r.c.log.map((l) => l.kind)).toEqual(['MeetingOutcome', 'JobCompleted', 'JobCompleted'])
      const replayed = replay(wasm.Sim.scenario(SCENARIO, SEED), r.c.log, r.final.step)
      expect(replayed.step).toBe(r.final.step)
      expect(replayed.hash).toBe(r.final.hash)
    }
  })

  it('the same holds at speed 10: the clock stops exactly one step short of the due step', async () => {
    const base = await draftRun(0, 1)
    const slow = await draftRun(12 * MINUTE, 10)
    // Ten steps a slice: the clock still stops on the step before the due step, not ten steps past it.
    const draftAt = slow.c.job('draft')!.step
    expect(slow.c.job('review')!.step).toBe(draftAt + DRAFT_STEPS)
    expect(slow.c.outcomeOf(slow.c.job('draft')!.job_id)!.step).toBe(draftAt + DRAFT_STEPS - 1)
    expect(slow.c.job('review')!.step - draftAt).toBe(base.c.job('review')!.step - base.c.job('draft')!.step)
    const replayed = replay(wasm.Sim.scenario(SCENARIO, SEED), slow.c.log, slow.final.step)
    expect(replayed.hash).toBe(slow.final.hash)
  })

  it('two drafts queued behind one model hold the clock, then both items move to review at the same step', async () => {
    const briefs: Brief[] = [
      { brief_ref: 42, writer: 'staff-1', editor: 'staff-5' },
      { brief_ref: 43, writer: 'staff-2', editor: 'staff-5' },
    ]
    const c = new Company({ latencyMs: (j) => (j.kind === 'draft' ? 11 * MINUTE : 0), briefs })
    /** The step each tick saw while a draft was in flight. */
    const heldAt = new Set<number>()
    await c.run(
      () => c.requested.filter((r) => r.kind === 'review').length === 2,
      () => {
        if (c.driver.hold === 'due') heldAt.add(c.step)
      },
    )
    const [d1, d2] = c.requested.filter((r) => r.kind === 'draft')
    const [r1, r2] = c.requested.filter((r) => r.kind === 'review')
    // Both drafts start in the same step and are due together.
    expect(d1.step).toBe(d2.step)
    expect([d1.work_item, d2.work_item]).toEqual(['work-item-1', 'work-item-2'])
    const due = d1.step + DRAFT_STEPS
    expect(c.loop.jobs.filter((j) => j.kind === 'draft').map((j) => j.due_step)).toEqual([due, due])
    // One model: they ran in turn, the tie broken by job id.
    expect(d1.job_id).toBeLessThan(d2.job_id)
    expect(c.ran.filter((id) => id === d1.job_id || id === d2.job_id)).toEqual([d1.job_id, d2.job_id])
    // The clock held at one step, one short of the due step, through both.
    expect([...heldAt]).toEqual([due - 1])
    expect(c.outcomeOf(d1.job_id)!.step).toBe(due - 1)
    expect(c.outcomeOf(d2.job_id)!.step).toBe(due - 1)
    // In game time they worked in parallel (both reviews start at the due step); in wall time serially (22 minutes).
    expect([r1.step, r2.step]).toEqual([due, due])
    expect(c.status('work-item-1')).toBe('in-review')
    expect(c.status('work-item-2')).toBe('in-review')
    expect(r1.wallMs - d1.wallMs).toBeGreaterThanOrEqual(22 * MINUTE)
    expect(r1.wallMs - d1.wallMs).toBeLessThan(22 * MINUTE + 2 * SECOND)
    expect(c.loop.errors).toEqual([])

    // A little further (the reviews come back), then the log replays to the same world.
    await c.run(() => c.step >= due + 20)
    await c.loop.idle()
    const final = { step: c.step, hash: c.sim.hash().toString() }
    expect(c.log.map((l) => l.kind)).toEqual(['MeetingOutcome', 'JobCompleted', 'JobCompleted', 'JobCompleted', 'JobCompleted'])
    expect(replay(wasm.Sim.scenario(SCENARIO, SEED), c.log, final.step).hash).toBe(final.hash)
  })

  it('a standup holds the clock thirty game minutes after it was requested', async () => {
    const c = new Company({ latencyMs: (j) => (j.kind === 'standup' ? 5 * MINUTE : 0), briefs: ONE_BRIEF })
    await c.run(() => c.job('draft') != null)
    const standup = c.job('standup')!
    // 09:00 + 30 game minutes = 250 steps; the outcome is applied one step short of that.
    expect(c.loop.jobs.find((j) => j.kind === 'standup')).toMatchObject({ due_step: standup.step + 250, who: 'Team' })
    expect(c.outcomeOf(standup.job_id)!.step).toBe(standup.step + 249)
    expect(c.job('draft')!.step).toBe(standup.step + 249)
    // The sim's own meeting timeout (60 game minutes) was never reached: the standup produced its brief.
    expect(c.status()).toBe('in-progress')
  })
})
