import { describe, expect, it } from 'vitest'
import type { CommandRecord } from '../store/company-store'
import { commandText } from '../sync/segments'
import { jobOutcomeKey, OrchestrationLoop, PENDING_DEPLOYS_KEY, STANDUP_HOLD_MINUTES, type LoopSim, type LoopStore } from './loop'

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
  plan_json = () => JSON.stringify({ items: this.items, jobs: this.pending })
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

function setup(run: (jobJson: string) => Promise<string>) {
  const sim = new StubSim()
  const store = new MemStore()
  const ran: number[] = []
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
  })
  return { sim, store, loop, ran }
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

  it('reports a job that keeps failing to the sim as JobCompleted{ok: false} (rule 11)', async () => {
    const { sim, loop, ran } = setup(async () => {
      throw new Error('gateway down')
    })
    await loop.enqueueEffects(JSON.stringify([job(3, 'draft')]))
    await loop.settled()
    loop.boundary()
    await loop.idle()
    expect(ran).toEqual([3, 3]) // one retry
    expect(sim.applied).toEqual([JSON.stringify(completed(3, false))])
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
    await loop.enqueueEffects(JSON.stringify([job(2, 'review'), job(3, 'publish', 1)]))
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

  it('holds the clock for a standup job still in flight close to the meeting timeout', async () => {
    let finish: (out: string) => void = () => undefined
    const { sim, loop } = setup(() => new Promise<string>((r) => (finish = r)))
    sim.pending = [{ id: 1, kind: 'standup', requestedMinute: 540 }]
    await loop.enqueueEffects(JSON.stringify([job(1, 'standup', 0, null)]))
    expect(loop.holdClock).toBe(false)
    sim.minute = 540 + STANDUP_HOLD_MINUTES
    expect(loop.holdClock).toBe(true)
    finish(JSON.stringify([{ MeetingOutcome: { job_id: 1, briefs: [] } }]))
    await loop.settled()
    expect(loop.holdClock).toBe(false)
  })
})
