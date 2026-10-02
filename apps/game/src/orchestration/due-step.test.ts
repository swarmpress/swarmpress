// Where a pending job's due step comes from (ADR-0060, FEAT-080): the sim's
// view when the wasm build exports it, else derived in the host.
import { describe, expect, it } from 'vitest'
import { DUE_MINUTES, dueStepSource, HostDueSteps, minutesToSteps, SimDueSteps, type DueSim } from './due-step'

const SPD = 12_000
const START = 7 * 60

/** A sim clock (sim-core `clock_at`) with scripted pending jobs. */
class StubSim implements DueSim {
  now = 0
  jobs: { id: number; kind: string; requestedMinute: number; dueStep?: number }[] = []
  plans = 0
  step = () => BigInt(this.now)
  private total = () => START + Math.floor((this.now * 1440) / SPD)
  day = () => Math.floor(this.total() / 1440)
  minute_of_day = () => this.total() % 1440
  steps_per_day = () => BigInt(SPD)
  plan_json = () => {
    this.plans++
    return JSON.stringify({ items: [], jobs: this.jobs })
  }
}

/** The absolute game minute of a step (`plan_json().jobs[].requestedMinute`). */
const minuteOf = (step: number) => START + Math.floor((step * 1440) / SPD)

describe('minutesToSteps', () => {
  it('mirrors sim-core: whole steps, at least one', () => {
    expect(minutesToSteps(120, SPD)).toBe(1000)
    expect(minutesToSteps(60, SPD)).toBe(500)
    expect(minutesToSteps(15, SPD)).toBe(125)
    expect(minutesToSteps(30, SPD)).toBe(250)
    expect(minutesToSteps(1, SPD)).toBe(8)
    expect(minutesToSteps(0, SPD)).toBe(1)
    expect(DUE_MINUTES).toEqual({ draft: 120, review: 60, publish: 15, standup: 30 })
  })
})

describe('HostDueSteps (derived in the host)', () => {
  it('is exact when the effect left the sim within one step, without reading the plan', () => {
    const sim = new StubSim()
    const due = new HostDueSteps(sim)
    sim.now = 2345
    // A step by the render loop (after 2344, up to 2345), and a command applied at 2345.
    expect(due.track([{ job_id: 1, kind: 'draft' }], { after: 2344, upTo: 2345 })).toEqual([3345])
    expect(due.track([{ job_id: 2, kind: 'review' }, { job_id: 3, kind: 'publish' }], { after: 2345, upTo: 2345 })).toEqual([2845, 2470])
    expect(sim.plans).toBe(0)
    expect(due.next()).toBe(2470)
  })

  it('a standup is due thirty game minutes after its request', () => {
    const sim = new StubSim()
    sim.now = 1000
    expect(new HostDueSteps(sim).track([{ job_id: 1, kind: 'standup' }], { after: 999, upTo: 1000 })).toEqual([1250])
  })

  it('settle drops a job from the earliest due step', () => {
    const sim = new StubSim()
    const due = new HostDueSteps(sim)
    expect(due.next()).toBeNull()
    due.track([{ job_id: 1, kind: 'publish' }, { job_id: 2, kind: 'draft' }], { after: 0, upTo: 0 })
    expect(due.next()).toBe(125)
    due.settle(1)
    expect(due.next()).toBe(1000)
    due.settle(2)
    expect(due.next()).toBeNull()
  })

  it('a restore’s re-emitted job is due from the first step of its requested minute: never late, at most a minute early', () => {
    for (const requestedAt of [1000, 1003, 2996, 7777]) {
      const sim = new StubSim()
      sim.now = requestedAt + 400 // the page was reloaded 400 steps after the request
      sim.jobs = [{ id: 9, kind: 'draft', requestedMinute: minuteOf(requestedAt) }]
      const [due] = new HostDueSteps(sim).track([{ job_id: 9, kind: 'draft' }])
      const real = requestedAt + 1000
      expect(due, `requested at ${requestedAt}`).toBeLessThanOrEqual(real)
      expect(due, `requested at ${requestedAt}`).toBeGreaterThan(real - 9)
      expect(sim.plans).toBe(1)
    }
  })

  it('a chunked fast-forward narrows the request step with what the host saw', () => {
    const sim = new StubSim()
    // The standup is requested at step 1000 (09:00), the last step of a 1000-step chunk.
    sim.now = 1000
    sim.jobs = [{ id: 1, kind: 'standup', requestedMinute: minuteOf(1000) }]
    expect(new HostDueSteps(sim).track([{ job_id: 1, kind: 'standup' }], { after: 0, upTo: 1000 })).toEqual([1250])
    // A request late in its minute, seen at the end of a chunk that began inside that minute.
    sim.now = 2500
    sim.jobs = [{ id: 2, kind: 'review', requestedMinute: minuteOf(2005) }]
    const [due] = new HostDueSteps(sim).track([{ job_id: 2, kind: 'review' }], { after: 2003, upTo: 2500 })
    expect(due).toBe(2004 + 500)
  })

  it('a job the sim no longer waits for is due at once', () => {
    const sim = new StubSim()
    sim.now = 5000
    const due = new HostDueSteps(sim)
    const [d] = due.track([{ job_id: 4, kind: 'draft' }])
    expect(d).toBeLessThanOrEqual(5000)
  })
})

describe('SimDueSteps (the sim’s view, FEAT-079)', () => {
  const withView = (next: () => bigint | number | null | undefined) => Object.assign(new StubSim(), { next_due_step: next })

  it('reads each job’s `dueStep` from the plan once, and the earliest from `next_due_step()`', () => {
    const sim = withView(() => 2125n)
    sim.jobs = [
      { id: 1, kind: 'draft', requestedMinute: 0, dueStep: 3000 },
      { id: 2, kind: 'publish', requestedMinute: 0, dueStep: 2125 },
    ]
    const due = new SimDueSteps(sim)
    expect(due.origin).toBe('sim')
    expect(due.track([{ job_id: 2, kind: 'publish' }, { job_id: 1, kind: 'draft' }])).toEqual([2125, 3000])
    expect(sim.plans).toBe(1)
    expect(due.next()).toBe(2125)
    expect(sim.plans).toBe(1)
  })

  it('no pending job: null, however the view says it', () => {
    expect(new SimDueSteps(withView(() => undefined)).next()).toBeNull()
    expect(new SimDueSteps(withView(() => null)).next()).toBeNull()
    expect(new SimDueSteps(withView(() => 18446744073709551615n)).next()).toBeNull()
    expect(new SimDueSteps(withView(() => 1250)).next()).toBe(1250)
  })

  it('a job missing from the plan is due at once', () => {
    const sim = withView(() => null)
    sim.now = 777
    expect(new SimDueSteps(sim).track([{ job_id: 5, kind: 'draft' }])).toEqual([777])
  })
})

describe('dueStepSource', () => {
  it('uses the sim’s view when the wasm build exports `next_due_step`, else the host’s derivation', () => {
    expect(dueStepSource(new StubSim()).origin).toBe('host')
    expect(dueStepSource(Object.assign(new StubSim(), { next_due_step: () => null })).origin).toBe('sim')
  })
})
