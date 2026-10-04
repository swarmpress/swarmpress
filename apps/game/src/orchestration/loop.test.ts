import { describe, expect, it } from 'vitest'
import type { CommandRecord } from '../store/company-store'
import { commandText } from '../sync/segments'
import type { DueStepSource } from './due-step'
import { jobOutcomeKey, KEEP_ERRORS, KEEP_JOBS, OrchestrationLoop, PENDING_DEPLOYS_KEY, type LoopOptions, type LoopSim, type LoopStore } from './loop'

/** The part of the sim the loop touches, scripted. */
class StubSim implements LoopSim {
  now = 100
  minute = 540
  applied: string[] = []
  /** The sim's pending jobs (`plan_json().jobs`). */
  pending: { id: number; kind: string; requestedMinute: number }[] = []
  items: { id: string; status: string }[] = []
  effects: string[] = []
  reject: (json: string) => string | undefined = () => undefined
  /** `plan_json()` calls so far. */
  plans = 0

  step = () => BigInt(this.now)
  hash = () => 1n
  advance(steps: number) {
    this.now += steps
  }
  apply_command_json(json: string) {
    const why = this.reject(json)
    if (why) throw why
    this.applied.push(json)
  }
  validate_command_json = (json: string) => this.reject(json)
  drain_effects_json() {
    return this.effects.shift() ?? '[]'
  }
  pending_effects = () => this.effects.length
  day = () => 0
  minute_of_day = () => this.minute
  steps_per_day = () => 12_000n
  plan_json = () => {
    this.plans++
    return JSON.stringify({ items: this.items, jobs: this.pending })
  }
}

class MemStore implements LoopStore {
  log: CommandRecord[] = []
  kv = new Map<string, string>()
  posts: string[] = []
  failAppend = false
  failKv: string | null = null

  async appendCommands(cmds: CommandRecord[]) {
    if (this.failAppend) throw new Error('disk full')
    this.log.push(...cmds)
    return cmds.map((c) => c.seq ?? 0)
  }
  async appendPost(_company: string, _item: string, postJson: string) {
    this.posts.push(postJson)
    return `post-${this.posts.length}`
  }
  getKv = async (key: string) => this.kv.get(key) ?? null
  async setKv(key: string, value: string) {
    if (this.failKv === key) throw new Error('kv write failed')
    this.kv.set(key, value)
  }
  async deleteKv(key: string) {
    this.kv.delete(key)
  }
}

const codec = {
  jobsFromEffects: (effects: string) => (JSON.parse(effects) as unknown[]).map((j) => JSON.stringify(j)),
  outcomesForSim: (outcomes: string) => (JSON.parse(outcomes) as unknown[]).map((o) => JSON.stringify(o)),
}

const job = (job_id: number, kind: string, revision = 0, work_item: string | null = 'work-item-1') => ({ job_id, kind, revision, work_item })
const completed = (job_id: number, ok = true, score = 0) => ({ JobCompleted: { job_id, digest: { ok, score, words: 0, qa_defects: 0, artifact_sha: null } } })
const failed = (job_id: number, reason: string) => ({ JobFailed: { job_id, reason } })

function setup(run: (jobJson: string) => Promise<string>, opts: Partial<LoopOptions> = {}) {
  const sim = new StubSim()
  const store = new MemStore()
  const ran: number[] = []
  const reported: string[] = []
  const loop = new OrchestrationLoop({
    sim,
    store,
    companyId: 'co',
    orchestrator: {
      run: (jobJson: string) => {
        ran.push((JSON.parse(jobJson) as { job_id: number }).job_id)
        return run(jobJson)
      },
    },
    codec,
    retries: 1,
    retryMs: 0,
    // No wall-clock limit unless a test sets one (a limit is a real timer).
    jobTimeoutMs: 0,
    onError: (m) => reported.push(m),
    ...opts,
  })
  return { sim, store, loop, ran, reported }
}

/** Due steps scripted per job id (the sim's view, or the host's derivation, stands behind this interface). */
function scriptedDue(due: Record<number, number>): DueStepSource {
  const open = new Map<number, number>()
  return {
    origin: 'host',
    track: (jobs) =>
      jobs.map((j) => {
        open.set(j.job_id, due[j.job_id])
        return due[j.job_id]
      }),
    settle: (id) => void open.delete(id),
    next: () => (open.size ? Math.min(...open.values()) : null),
  }
}

/** A `run()` the test finishes by hand, job by job. */
function manual() {
  const finish = new Map<number, (out: string) => void>()
  const run = (jobJson: string) => new Promise<string>((r) => finish.set((JSON.parse(jobJson) as { job_id: number }).job_id, r))
  const done = async (id: number, out: unknown[] = [completed(id)]) => {
    finish.get(id)!(JSON.stringify(out))
    await tick()
  }
  return { run, done }
}

/** Lets the loop's promise chains run. */
const tick = () => new Promise<void>((r) => setTimeout(r, 0))

/** The render loop steps the sim to `step` one step at a time: the loop looked at the effects at `step - 1`. */
function stepTo(sim: StubSim, loop: OrchestrationLoop, step: number) {
  sim.now = step - 1
  loop.afterAdvance()
  sim.now = step
}

describe('OrchestrationLoop', () => {
  it('applies outcomes at the next boundary and logs them with a seq and the step', async () => {
    const { sim, store, loop } = setup(async (j) => JSON.stringify([completed((JSON.parse(j) as { job_id: number }).job_id, true, 8)]))
    loop.seed([], [], 4)
    await loop.enqueueEffects(JSON.stringify([job(2, 'review')]))
    await loop.settled()
    expect(sim.applied).toEqual([]) // not before a boundary
    expect(loop.pendingCommands).toBe(1)
    sim.now = 250
    loop.boundary()
    await loop.idle()
    expect(sim.applied).toEqual([JSON.stringify(completed(2, true, 8))])
    expect(store.log.map((c) => [c.seq, c.step, c.kind, commandText(c.payload)])).toEqual([[5, 250, 'JobCompleted', JSON.stringify(completed(2, true, 8))]])
    expect(loop.lastSeq).toBe(5)
    expect(loop.jobs).toMatchObject([{ job_id: 2, kind: 'review', state: 'done', ok: true, score: 8 }])
  })

  it('reports a job that keeps failing to the sim as JobFailed{Infrastructure} (rule 11)', async () => {
    const { sim, loop, ran } = setup(async () => {
      throw new Error('gateway down')
    })
    await loop.enqueueEffects(JSON.stringify([job(3, 'draft')]))
    await loop.settled()
    loop.boundary()
    await loop.idle()
    expect(ran).toEqual([3, 3]) // one retry
    expect(sim.applied).toEqual([JSON.stringify(failed(3, 'Infrastructure'))])
    expect(loop.jobs).toMatchObject([{ job_id: 3, state: 'failed', ok: false, error: 'gateway down' }])
    expect(loop.errors.join('\n')).toMatch(/draft job 3 failed: gateway down/)
  })

  it('sends nothing for a failed standup (the sim ends the meeting itself)', async () => {
    const { sim, loop } = setup(async () => {
      throw new Error('model crashed')
    })
    await loop.enqueueEffects(JSON.stringify([job(1, 'standup', 0, null)]))
    await loop.settled()
    loop.boundary()
    expect(sim.applied).toEqual([])
    expect(loop.pendingCommands).toBe(0)
    expect(loop.errors).toHaveLength(1)
  })

  it('keeps a finished run in the kv until its outcome is logged, and reuses it instead of running again', async () => {
    const first = setup(async () => JSON.stringify([completed(2)]))
    await first.loop.enqueueEffects(JSON.stringify([job(2, 'draft')]))
    await first.loop.settled()
    expect(first.store.kv.get(jobOutcomeKey(2))).toBe(JSON.stringify([completed(2)]))

    // The page reloads before the boundary: a new loop on the same store.
    const second = setup(async () => {
      throw new Error('must not run again')
    })
    second.store.kv = first.store.kv
    await second.loop.enqueueEffects(JSON.stringify([job(2, 'draft')]))
    await second.loop.settled()
    second.loop.boundary()
    await second.loop.idle()
    expect(second.ran).toEqual([])
    expect(second.sim.applied).toEqual([JSON.stringify(completed(2))])
    expect(second.store.kv.has(jobOutcomeKey(2))).toBe(false)
  })

  it('queues replayed effects only for jobs the sim still waits for', async () => {
    const { sim, loop } = setup(async (j) => JSON.stringify([completed((JSON.parse(j) as { job_id: number }).job_id)]))
    loop.seed([2], [])
    sim.pending = [{ id: 4, kind: 'draft', requestedMinute: 600 }]
    // 1: a standup that timed out, 2: settled in the log, 3: its item was cancelled, 4: still pending.
    await loop.enqueueEffects(JSON.stringify([job(1, 'standup', 0, null), job(2, 'draft'), job(3, 'review'), job(4, 'draft', 1)]), { pendingOnly: true })
    expect(loop.jobs.map((j) => j.job_id)).toEqual([4])
  })

  it('halts when a command cannot be written to the log', async () => {
    const { sim, store, loop } = setup(async () => '[]')
    store.failAppend = true
    expect(loop.apply('"TriageInbox"')).toEqual({ ok: true })
    await loop.flush()
    expect(loop.halted).toMatch(/command #1 \(TriageInbox\) could not be written to the log/)
    expect(loop.holdClock).toBe(true)
    expect(loop.apply('"TriageInbox"')).toMatchObject({ ok: false })
    expect(sim.applied).toHaveLength(1)
  })

  it('halt() (the lease is lost) stops everything: no job starts, no outcome is applied, no failure is reported', async () => {
    let release!: (out: string) => void
    let reject!: (e: Error) => void
    const { sim, store, loop, ran } = setup(
      () =>
        new Promise<string>((res, rej) => {
          release = res
          reject = rej
        }),
    )
    // Job 1 finished before the loss: its outcome is ready, not yet applied.
    await loop.enqueueEffects(JSON.stringify([job(1, 'draft')]))
    release(JSON.stringify([completed(1)]))
    await loop.settled()
    expect(loop.pendingCommands).toBe(1)
    // Job 2 is in flight and job 3 queued when the lease goes.
    // (Two reviews: with different kinds the one due sooner would run first.)
    await loop.enqueueEffects(JSON.stringify([job(2, 'review'), job(3, 'review', 1)]))
    await Promise.resolve()
    expect(ran).toEqual([1, 2])
    loop.halt('the company lease was lost')
    loop.halt('a second reason is ignored')
    expect(loop.halted).toBe('the company lease was lost')
    expect(loop.holdClock).toBe(true)

    // The in-flight job fails (its gateway call was fenced out): no retry, and
    // the sim is not told it failed, because the next holder runs it.
    reject(new Error('409 company lease not held'))
    await loop.idle()
    expect(ran).toEqual([1, 2])
    expect(loop.jobs.map((j) => j.state)).toEqual(['done', 'queued', 'queued'])
    expect(loop.errors).toEqual([])
    loop.boundary()
    expect(sim.applied).toEqual([])
    expect(store.log).toEqual([])
    expect(loop.pendingCommands).toBe(1)
    expect(loop.apply('"TriageInbox"')).toEqual({ ok: false, reason: 'the session is halted: the company lease was lost' })
  })

  it('rejects a DeployLanded event it could not persist, so the event cursor stays behind it', async () => {
    const { store, loop } = setup(async () => '[]')
    store.failKv = PENDING_DEPLOYS_KEY
    await expect(loop.deployLanded('work-item-1')).rejects.toThrow(/kv write failed/)
  })

  it('applies a held DeployLanded once the sim accepts it, posts the status and reports it', async () => {
    const sim = new StubSim()
    const store = new MemStore()
    const landed: string[] = []
    const loop = new OrchestrationLoop({ sim, store, companyId: 'co', orchestrator: { run: async () => '[]' }, codec, onLanded: (w) => landed.push(w) })
    sim.items = [{ id: 'work-item-1', status: 'approved' }]
    sim.reject = (json) => (json.includes('DeployLanded') && sim.items[0].status !== 'scheduled' ? 'not scheduled' : undefined)
    await loop.deployLanded('work-item-1', { mergedSha: 'abcdef0123', source: 'simulated' })
    loop.boundary()
    expect(sim.applied).toEqual([])
    expect(loop.pendingDeploys).toEqual(['work-item-1'])
    sim.items[0].status = 'scheduled'
    loop.boundary()
    await loop.flush()
    expect(sim.applied).toEqual(['{"DeployLanded":{"work_item":"work-item-1"}}'])
    expect(landed).toEqual(['work-item-1'])
    expect(loop.pendingDeploys).toEqual([])
    expect(JSON.parse(store.posts[0])).toMatchObject({ type: 'status', from: 'scheduled', toStatus: 'published', payload: { merged_sha: 'abcdef0123', source: 'simulated' } })
    // A second delivery of the same event is ignored.
    await loop.deployLanded('work-item-1')
    expect(loop.pendingDeploys).toEqual([])
  })

  describe('game time (ADR-0060)', () => {
    it('holds the clock one step short of a pending job’s due step, until its outcome is applied', async () => {
      const m = manual()
      const { sim, loop } = setup(m.run)
      // The render loop stepped to 2000 and drained the effect there: the request step is exact.
      stepTo(sim, loop, 2000)
      sim.effects = [JSON.stringify([job(7, 'draft')])]
      expect(loop.afterAdvance()).toBe(true)
      // Until the job is taken in, its due step is unknown: the clock waits.
      expect(loop.settling).toBe(true)
      expect(loop.holdClock).toBe(true)
      await tick()
      expect(loop.settling).toBe(false)
      expect(loop.jobs).toMatchObject([{ job_id: 7, due_step: 3000, state: 'running' }])
      expect(loop.nextDueStep).toBe(3000)
      expect(loop.holdClock).toBe(false)
      sim.now = 2998
      expect(loop.holdClock).toBe(false)
      sim.now = 2999
      expect(loop.holdClock).toBe(true)
      // The model is done: the outcome waits for the boundary, the clock still holds.
      await m.done(7)
      expect(loop.pendingCommands).toBe(1)
      expect(loop.busy).toBe(true)
      expect(loop.holdClock).toBe(true)
      loop.boundary()
      expect(loop.holdClock).toBe(false)
      expect(loop.nextDueStep).toBeNull()
      expect(loop.busy).toBe(false)
    })

    it('a standup is due thirty game minutes after its request', async () => {
      const m = manual()
      const { sim, loop } = setup(m.run)
      stepTo(sim, loop, 1000)
      sim.effects = [JSON.stringify([job(1, 'standup', 0, null)])]
      loop.afterAdvance()
      await tick()
      expect(loop.jobs).toMatchObject([{ job_id: 1, due_step: 1250, who: 'Team' }])
      sim.now = 1248
      expect(loop.holdClock).toBe(false)
      sim.now = 1249
      expect(loop.holdClock).toBe(true)
      await m.done(1, [{ MeetingOutcome: { job_id: 1, briefs: [] } }])
      loop.boundary()
      expect(loop.holdClock).toBe(false)
    })

    it('does not parse the plan to decide the hold', async () => {
      const m = manual()
      const { sim, loop } = setup(m.run)
      sim.effects = [JSON.stringify([job(1, 'draft')])]
      loop.afterAdvance()
      await tick()
      // An exact request step needs no plan.
      expect(sim.plans).toBe(0)
      for (let i = 0; i < 1000; i++) {
        sim.now++
        void loop.holdClock
        void loop.nextDueStep
        void loop.busy
        loop.afterAdvance()
      }
      expect(sim.plans).toBe(0)
    })

    it('runs jobs one at a time, earliest due step first, ties by job id (not first in, first out)', async () => {
      const m = manual()
      const { loop, ran } = setup(m.run, { due: scriptedDue({ 1: 900, 2: 800, 3: 500, 4: 500, 5: 100 }) })
      // Job 1 is taken in alone and starts; the others queue up behind it.
      await loop.enqueueEffects(JSON.stringify([job(1, 'draft')]))
      await loop.enqueueEffects(JSON.stringify([job(2, 'draft'), job(4, 'review'), job(3, 'review'), job(5, 'publish')]))
      expect(ran).toEqual([1]) // a running job is never preempted
      expect(loop.heldFor).toMatchObject({ job_id: 1 })
      expect(loop.nextDueStep).toBe(100)
      for (const id of [1, 5, 3, 4, 2]) await m.done(id)
      expect(ran).toEqual([1, 5, 3, 4, 2])
      expect(loop.queued).toBe(0)
    })

    it('names who the clock waits for: the running job, else the earliest due one', async () => {
      const m = manual()
      const { loop } = setup(m.run, { due: scriptedDue({ 1: 900, 2: 300 }) })
      expect(loop.heldFor).toBeNull()
      const giulia = { ...job(1, 'draft'), staff: [{ id: 'staff-1', persona: 'giulia', role: 'writer' }] }
      const standup = { ...job(2, 'standup', 0, null), staff: [{ id: 'staff-4', persona: 'sophia', role: 'editor-in-chief' }] }
      await loop.enqueueEffects(JSON.stringify([giulia]))
      await loop.enqueueEffects(JSON.stringify([standup]))
      expect(loop.heldFor).toMatchObject({ job_id: 1, who: 'Giulia', kind: 'draft' })
      await m.done(1)
      // Job 1's outcome waits for a boundary; the standup runs now.
      expect(loop.heldFor).toMatchObject({ job_id: 2, who: 'Team', kind: 'standup' })
    })

    it('a failed standup does not hold the clock: nothing will come for it', async () => {
      const { sim, loop } = setup(async () => {
        throw new Error('model crashed')
      })
      stepTo(sim, loop, 1000)
      sim.effects = [JSON.stringify([job(1, 'standup', 0, null)])]
      loop.afterAdvance()
      await loop.idle()
      expect(loop.jobs).toMatchObject([{ job_id: 1, state: 'failed', due_step: 1250 }])
      sim.now = 1400
      expect(loop.holdClock).toBe(false)
      expect(loop.busy).toBe(false)
    })

    it('an outcome the sim rejects does not hold the clock either', async () => {
      const { sim, loop, reported } = setup(async (j) => JSON.stringify([completed((JSON.parse(j) as { job_id: number }).job_id)]))
      sim.reject = () => 'unknown job'
      sim.effects = [JSON.stringify([job(3, 'publish')])]
      loop.afterAdvance()
      await tick()
      sim.now += 5000
      expect(loop.holdClock).toBe(true)
      loop.boundary()
      expect(loop.errors.join('\n')).toMatch(/outcome rejected by the sim: unknown job/)
      expect(reported).toEqual(loop.errors)
      expect(loop.holdClock).toBe(false)
      expect(loop.busy).toBe(false)
    })

    it('a halted loop holds the clock whatever is due', async () => {
      const { loop } = setup(async () => '[]')
      expect(loop.holdClock).toBe(false)
      loop.halt('the company lease was lost')
      expect(loop.holdClock).toBe(true)
    })
  })

  describe('job limits and bounded growth', () => {
    it('gives up on a job that runs past its wall-clock limit: failed through the failure path, without a retry', async () => {
      const { sim, loop, ran, reported } = setup(() => new Promise<string>(() => undefined), { jobTimeoutMs: { draft: 20 }, retries: 2 })
      await loop.enqueueEffects(JSON.stringify([job(3, 'draft')]))
      await loop.settled()
      expect(ran).toEqual([3]) // one run: its first attempt may still be going, so it is not started again
      expect(loop.jobs).toMatchObject([{ job_id: 3, state: 'failed', ok: false, error: 'timed out after 20 ms' }])
      expect(reported).toEqual(['draft job 3 failed: timed out after 20 ms'])
      // The sim is told why, so it blocks the item and raises the escalation ticket.
      loop.boundary()
      expect(sim.applied).toEqual([JSON.stringify(failed(3, 'Timeout'))])
      expect(loop.busy).toBe(false)
    })

    it('cancels a job past its limit (P6): the run stops at its next stage and its JobFailed{Timeout} is applied', async () => {
      const cancels: string[] = []
      let stop: (out: string) => void = () => undefined
      const { sim, loop, ran } = setup(() => new Promise<string>((r) => (stop = r)), { jobTimeoutMs: { draft: 20 }, retries: 2 })
      // The orchestrator stops the job at its next stage boundary and answers JobFailed{Timeout}.
      ;(loop as unknown as { o: LoopOptions }).o.orchestrator.cancel = (reason?: string) => {
        cancels.push(String(reason))
        setTimeout(() => stop(JSON.stringify([failed(3, 'Timeout')])), 5)
      }
      await loop.enqueueEffects(JSON.stringify([job(3, 'draft')]))
      await loop.settled()
      expect(cancels).toEqual(['timeout'])
      expect(ran).toEqual([3])
      expect(loop.jobs).toMatchObject([{ job_id: 3, ok: false, error: 'failed: Timeout' }])
      loop.boundary()
      expect(sim.applied).toEqual([JSON.stringify(failed(3, 'Timeout'))])
      expect(loop.busy).toBe(false)
    })

    it('a cancelled run that does not stop within the grace is given up on', async () => {
      const cancels: string[] = []
      const { sim, loop } = setup(() => new Promise<string>(() => undefined), { jobTimeoutMs: 20, cancelGraceMs: 20 })
      ;(loop as unknown as { o: LoopOptions }).o.orchestrator.cancel = (reason?: string) => void cancels.push(String(reason))
      await loop.enqueueEffects(JSON.stringify([job(5, 'review')]))
      await loop.settled()
      expect(cancels).toEqual(['timeout'])
      loop.boundary()
      expect(sim.applied).toEqual([JSON.stringify(failed(5, 'Timeout'))])
    })

    it('the job clock stands still while the model is not ready', async () => {
      let paused = true
      const m = manual()
      const { loop } = setup(m.run, { jobTimeoutMs: 30, paused: () => paused })
      await loop.enqueueEffects(JSON.stringify([job(6, 'draft')]))
      await new Promise((r) => setTimeout(r, 120))
      expect(loop.jobs[0].state).toBe('running') // four limits passed, all of them paused
      paused = false
      await new Promise((r) => setTimeout(r, 120))
      expect(loop.jobs[0]).toMatchObject({ state: 'failed', error: 'timed out after 30 ms' })
    })

    it('a lost model is not a job failure: the job waits for the model and runs again, without using a retry', async () => {
      let paused = true
      let n = 0
      const { sim, loop, ran, reported } = setup(
        async (j) => {
          if (n++ < 2) throw new Error('model unavailable: the model was lost 3 times during one call')
          return JSON.stringify([completed((JSON.parse(j) as { job_id: number }).job_id)])
        },
        { retries: 0, paused: () => paused, pausePollMs: 5 },
      )
      setTimeout(() => (paused = false), 60)
      await loop.enqueueEffects(JSON.stringify([job(7, 'draft')]))
      await loop.settled()
      expect(ran).toEqual([7, 7, 7])
      expect(reported).toEqual([])
      loop.boundary()
      expect(sim.applied).toEqual([JSON.stringify(completed(7))])
    })

    it('a job that finishes within its limit is not touched by it, and the next job runs', async () => {
      const { loop, ran } = setup(async (j) => JSON.stringify([completed((JSON.parse(j) as { job_id: number }).job_id)]), { jobTimeoutMs: 1000 })
      await loop.enqueueEffects(JSON.stringify([job(1, 'draft'), job(2, 'draft', 1)]))
      await loop.settled()
      expect(ran).toEqual([1, 2])
      expect(loop.jobs.map((j) => j.state)).toEqual(['done', 'done'])
    })

    it('an outcome that arrives after the loop gave up is ignored', async () => {
      const m = manual()
      const { sim, store, loop } = setup(m.run, { jobTimeoutMs: 20 })
      await loop.enqueueEffects(JSON.stringify([job(4, 'review')]))
      await loop.settled()
      expect(loop.jobs[0].state).toBe('failed')
      await m.done(4, [completed(4, true, 9)])
      loop.boundary()
      await loop.flush()
      expect(sim.applied).toEqual([JSON.stringify(failed(4, 'Timeout'))])
      expect(store.kv.has(jobOutcomeKey(4))).toBe(false)
      expect(loop.jobs[0]).toMatchObject({ state: 'failed', ok: false })
    })

    it('keeps the last finished jobs only (50 by default), and never queues a trimmed job again', async () => {
      const { sim, loop, ran } = setup(async (j) => JSON.stringify([completed((JSON.parse(j) as { job_id: number }).job_id)]), { keepJobs: 3 })
      for (let id = 1; id <= 8; id++) {
        await loop.enqueueEffects(JSON.stringify([job(id, 'draft')]))
        await loop.settled()
        loop.boundary()
      }
      expect(sim.applied).toHaveLength(8)
      expect(loop.jobs.map((j) => j.job_id)).toEqual([6, 7, 8])
      expect(KEEP_JOBS).toBe(50)
      // An effect for a job that was trimmed, or settled, is not run again.
      await loop.enqueueEffects(JSON.stringify([job(1, 'draft'), job(8, 'draft')]))
      expect(ran).toHaveLength(8)
    })

    it('jobs still in flight are never trimmed', async () => {
      const m = manual()
      const { loop } = setup(m.run, { keepJobs: 2 })
      await loop.enqueueEffects(JSON.stringify([job(1, 'draft'), job(2, 'draft', 1), job(3, 'draft', 2), job(4, 'draft', 3)]))
      expect(loop.jobs.map((j) => j.job_id)).toEqual([1, 2, 3, 4])
    })

    it('keeps the last errors only, and reports each one', async () => {
      const { sim, loop, reported } = setup(async (j) => JSON.stringify([completed((JSON.parse(j) as { job_id: number }).job_id)]))
      sim.reject = () => 'no'
      const n = KEEP_ERRORS + 7
      for (let id = 1; id <= n; id++) {
        await loop.enqueueEffects(JSON.stringify([job(id, 'publish')]))
        await loop.settled()
        loop.boundary()
      }
      expect(reported).toHaveLength(n)
      expect(loop.errors).toHaveLength(KEEP_ERRORS)
      expect(loop.errors.at(-1)).toBe(reported.at(-1))
    })
  })
})
