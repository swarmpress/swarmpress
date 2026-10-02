// The game clock's host policy (ADR-0060, FEAT-080): the pure functions, then
// the driver over a fake host whose clock is sim-core's integer formula.
import { describe, expect, it } from 'vitest'
import {
  accumulate,
  ClockDriver,
  clockStatus,
  DAY_START_MINUTE,
  DEFAULT_POLICY,
  initialClock,
  isNight,
  MAX_ACC_MS,
  NIGHT_STEPS_PER_SLICE,
  REST_FROM_MINUTE,
  roomBeforeDue,
  startNextDay,
  stepsToRun,
  stepsUntilMinute,
  type ClockHost,
  type ClockState,
  type ClockView,
  type ModelStatus,
} from './clock-driver'

const SPD = 12_000 // steps a day: a 20 minute day
const START = 7 * 60 // the scenario starts at 07:00

/** sim-core `SimConfig::clock_at`: the minute of day and the day at a step. */
const minuteAt = (step: number) => (START + Math.floor((step * 1440) / SPD)) % 1440
const dayAt = (step: number) => Math.floor((START + Math.floor((step * 1440) / SPD)) / 1440)
/** The first step of `HH:MM` on day `day`. */
const stepAt = (hh: number, mm = 0, day = 0) => Math.ceil(((day * 1440 + hh * 60 + mm - START) * SPD) / 1440)

const view = (over: Partial<ClockView> = {}): ClockView => {
  const step = over.step ?? 0
  return { step, minuteOfDay: minuteAt(step), stepsPerDay: SPD, halted: false, modelReady: true, nextDueStep: null, busy: false, settling: false, ...over }
}
const clock = (over: Partial<ClockState> = {}): ClockState => ({ ...initialClock(), ...over })

describe('accumulate (the clamp)', () => {
  it('turns wall time into 100 ms slices and keeps the rest', () => {
    expect(accumulate(0, 16)).toEqual({ accMs: 16, slices: 0 })
    expect(accumulate(90, 16)).toEqual({ accMs: 6, slices: 1 })
    expect(accumulate(0, 250)).toEqual({ accMs: 50, slices: 2 })
  })

  it('never carries more than 500 ms: an hour away is five slices, not 36,000', () => {
    expect(accumulate(0, 3_600_000)).toEqual({ accMs: 0, slices: 5 })
    expect(accumulate(99, 3_600_000)).toEqual({ accMs: 0, slices: 5 })
    expect(accumulate(0, MAX_ACC_MS + 1).slices).toBe(5)
  })

  it('ignores a negative or broken delta', () => {
    expect(accumulate(40, -1000)).toEqual({ accMs: 40, slices: 0 })
    expect(accumulate(40, Number.NaN)).toEqual({ accMs: 40, slices: 0 })
    expect(accumulate(40, Number.POSITIVE_INFINITY)).toEqual({ accMs: 40, slices: 0 })
  })
})

describe('stepsToRun: speed, pause and the other holds', () => {
  it('runs `speed` steps per slice when nothing holds', () => {
    expect(stepsToRun(clock(), view({ step: 100 }))).toMatchObject({ steps: 1, hold: null })
    expect(stepsToRun(clock({ speed: 10 }), view({ step: 100 }))).toMatchObject({ steps: 10, hold: null })
  })

  it('pause holds, and nothing else changes while paused', () => {
    const paused = clock({ paused: true, unattendedDays: 2 })
    const d = stepsToRun(paused, view({ step: stepAt(23) }))
    expect(d).toEqual({ state: paused, steps: 0, hold: 'paused' })
  })

  it('a halted loop and a model that is not ready hold, before anything else', () => {
    expect(stepsToRun(clock(), view({ halted: true }))).toMatchObject({ steps: 0, hold: 'halted' })
    expect(stepsToRun(clock(), view({ modelReady: false }))).toMatchObject({ steps: 0, hold: 'model' })
    expect(stepsToRun(clock({ paused: true }), view({ halted: true, modelReady: false }))).toMatchObject({ hold: 'halted' })
    expect(stepsToRun(clock({ paused: true }), view({ modelReady: false }))).toMatchObject({ hold: 'model' })
  })

  it('holds while the sim asked for a job that is not taken in yet', () => {
    expect(stepsToRun(clock({ speed: 10 }), view({ settling: true, busy: true }))).toMatchObject({ steps: 0, hold: 'settling' })
  })
})

describe('stepsToRun: the hold for a due job', () => {
  it('stops one step short of the due step, whatever the speed', () => {
    // The sim completes a phase in the step that reaches its due step, so the outcome must be in by `due - 1`.
    expect(roomBeforeDue(1000, 2000)).toBe(999)
    expect(roomBeforeDue(1999, 2000)).toBe(0)
    expect(roomBeforeDue(1000, null)).toBe(Number.POSITIVE_INFINITY)
    expect(stepsToRun(clock({ speed: 10 }), view({ step: 1985, nextDueStep: 2000, busy: true }))).toMatchObject({ steps: 10, hold: null })
    expect(stepsToRun(clock({ speed: 10 }), view({ step: 1995, nextDueStep: 2000, busy: true }))).toMatchObject({ steps: 4, hold: null })
    expect(stepsToRun(clock({ speed: 10 }), view({ step: 1999, nextDueStep: 2000, busy: true }))).toMatchObject({ steps: 0, hold: 'due' })
  })

  it('holds for a job that is already overdue (a restore with work in flight)', () => {
    expect(stepsToRun(clock(), view({ step: 5000, nextDueStep: 4200, busy: true }))).toMatchObject({ steps: 0, hold: 'due' })
  })

  it('runs again once the job is settled', () => {
    expect(stepsToRun(clock(), view({ step: 1999, nextDueStep: null }))).toMatchObject({ steps: 1, hold: null })
  })
})

describe('stepsToRun: rest at 22:00 and the night skip', () => {
  it('night is 22:00 to 07:00', () => {
    expect(REST_FROM_MINUTE).toBe(22 * 60)
    expect(DAY_START_MINUTE).toBe(7 * 60)
    expect([21 * 60 + 59, 22 * 60, 23 * 60 + 59, 0, 6 * 60 + 59, 7 * 60].map((m) => isNight(m))).toEqual([false, true, true, true, true, false])
  })

  it('keeps running until 22:00', () => {
    const d = stepsToRun(clock(), view({ step: stepAt(22) - 1 }))
    expect(d).toMatchObject({ steps: 1, hold: null })
    expect(d.state.phase).toBe('day')
  })

  it('rests at 22:00 when nothing is in flight: the clock stops and the day-done card is up', () => {
    const d = stepsToRun(clock(), view({ step: stepAt(22) }))
    expect(d).toMatchObject({ steps: 0, hold: 'resting' })
    expect(d.state.phase).toBe('resting')
    // …and it stays there, slice after slice.
    expect(stepsToRun(d.state, view({ step: stepAt(22) }))).toEqual({ state: d.state, steps: 0, hold: 'resting' })
  })

  it('does not rest while a job is pending or a command is queued: work in flight finishes first', () => {
    const d = stepsToRun(clock(), view({ step: stepAt(22, 30), busy: true, nextDueStep: stepAt(23) }))
    expect(d).toMatchObject({ steps: 1, hold: null })
    expect(d.state.phase).toBe('day')
  })

  it('work that turns up during a rest ends it (a ticket answered on the card restarts a phase)', () => {
    const resting = clock({ phase: 'resting' })
    const d = stepsToRun(resting, view({ step: stepAt(22, 10), busy: true, nextDueStep: stepAt(23) }))
    expect(d).toMatchObject({ steps: 1, hold: null })
    expect(d.state.phase).toBe('day')
  })

  it('starting the next day skips the night by fast stepping, and stops exactly at 07:00', () => {
    let state = startNextDay(clock({ phase: 'resting' }))
    expect(state.phase).toBe('night')
    let step = stepAt(22, 10)
    let slices = 0
    for (; slices < 100; slices++) {
      const d = stepsToRun(state, view({ step }))
      state = d.state
      if (state.phase !== 'night') break
      expect(d.hold).toBeNull()
      expect(d.steps).toBeLessThanOrEqual(NIGHT_STEPS_PER_SLICE)
      step += d.steps
    }
    expect(step).toBe(stepAt(7, 0, 1))
    expect([dayAt(step), minuteAt(step)]).toEqual([1, 7 * 60])
    expect(minuteAt(step - 1)).toBe(6 * 60 + 59)
    // 8 h 50 min of night at 500 steps a slice: nine slices, then the morning.
    expect(slices).toBe(9)
    expect(stepsToRun(state, view({ step }))).toMatchObject({ steps: 1, hold: null })
  })

  it('startNextDay does nothing unless the day is done', () => {
    const day = clock()
    expect(startNextDay(day)).toBe(day)
  })

  it('the night skip still holds for a job that became due (a ticket default restarted a phase)', () => {
    const night = clock({ phase: 'night' })
    const at = stepAt(2, 0, 1) // 02:00 of the next day
    expect(minuteAt(at)).toBe(2 * 60)
    expect(stepsToRun(night, view({ step: at, busy: true, nextDueStep: at + 40 }))).toMatchObject({ steps: 39, hold: null })
    expect(stepsToRun(night, view({ step: at + 39, busy: true, nextDueStep: at + 40 }))).toMatchObject({ steps: 0, hold: 'due' })
  })

  it('the offline demo has no rest rule', () => {
    const d = stepsToRun(clock({ speed: 600 }), view({ step: stepAt(23) }), { ...DEFAULT_POLICY, rest: false })
    expect(d).toMatchObject({ steps: 600, hold: null })
    expect(d.state.phase).toBe('day')
  })
})

describe('stepsToRun: unattended days', () => {
  it('a positive counter starts the next day by itself and counts down by one', () => {
    const d = stepsToRun(clock({ unattendedDays: 2 }), view({ step: stepAt(22) }))
    expect(d.state).toMatchObject({ phase: 'night', unattendedDays: 1 })
    expect(d.steps).toBe(NIGHT_STEPS_PER_SLICE)
    // During the skip the counter does not move again.
    expect(stepsToRun(d.state, view({ step: stepAt(23) })).state.unattendedDays).toBe(1)
  })

  it('raising the counter on the day-done card starts the next day', () => {
    const d = stepsToRun(clock({ phase: 'resting', unattendedDays: 1 }), view({ step: stepAt(22, 5) }))
    expect(d.state).toMatchObject({ phase: 'night', unattendedDays: 0 })
    expect(d.hold).toBeNull()
  })

  it('zero rests', () => {
    expect(stepsToRun(clock({ unattendedDays: 0 }), view({ step: stepAt(22) })).state.phase).toBe('resting')
  })

  it('initialClock cleans its settings', () => {
    expect(initialClock({ speed: 0, unattendedDays: -3 })).toMatchObject({ speed: 1, unattendedDays: 0, paused: false, phase: 'day', accMs: 0 })
    expect(initialClock({ speed: Number.NaN, unattendedDays: 2.9 })).toMatchObject({ speed: 1, unattendedDays: 2 })
    expect(initialClock({ speed: 10.7, unattendedDays: 9999 })).toMatchObject({ speed: 10, unattendedDays: 365 })
  })
})

describe('stepsUntilMinute', () => {
  it('is the exact number of steps to the first step of that minute', () => {
    for (const from of [0, 1, 7, 999, 1000, stepAt(22), stepAt(23, 59), stepAt(3, 0, 1) + 5]) {
      const n = stepsUntilMinute(view({ step: from }), 9 * 60)
      expect(minuteAt(from + n), `from ${from}`).toBe(9 * 60)
      expect(minuteAt(from + n - 1), `from ${from}`).toBe(8 * 60 + 59)
    }
  })

  it('is a full day ahead when the clock shows that minute now', () => {
    expect(stepsUntilMinute(view({ step: 0 }), 7 * 60)).toBe(SPD)
  })
})

// ------------------------------------------------------------------ the driver

/** A sim that only counts steps, with a pending-job model the tests script. */
class FakeHost implements ClockHost {
  step = 0
  boundaries = 0
  /** The largest number of steps one `advance` was asked for. */
  maxAdvance = 0
  halted = false
  modelReady = true
  due: number | null = null
  busy = false

  view = (): ClockView => view({ step: this.step, halted: this.halted, modelReady: this.modelReady, nextDueStep: this.due, busy: this.busy || this.due != null })
  boundary = () => {
    this.boundaries++
  }
  advance = (steps: number) => {
    this.maxAdvance = Math.max(this.maxAdvance, steps)
    this.step += steps
    return steps
  }
}

describe('ClockDriver', () => {
  it('ticks 100 ms slices: a boundary, then the steps the policy allows', () => {
    const host = new FakeHost()
    const driver = new ClockDriver(host, { speed: 10 })
    expect(driver.tick(250)).toEqual({ slices: 2, steps: 20 })
    expect(host.step).toBe(20)
    expect(host.boundaries).toBe(2)
    expect(driver.tick(40)).toEqual({ slices: 0, steps: 0 })
    expect(driver.tick(10)).toEqual({ slices: 1, steps: 10 })
    expect(driver.hold).toBeNull()
  })

  it('calls the boundary while held, so outcomes and commands still apply', () => {
    const host = new FakeHost()
    host.due = 1
    const driver = new ClockDriver(host)
    expect(driver.tick(300)).toEqual({ slices: 3, steps: 0 })
    expect(host.boundaries).toBe(3)
    expect(driver.hold).toBe('due')
    host.due = null
    expect(driver.tick(100).steps).toBe(1)
  })

  it('pause, resume and speed', () => {
    const host = new FakeHost()
    const changes: string[] = []
    const driver = new ClockDriver(host, { onChange: (s) => changes.push(`${s.paused ? 'paused' : 'running'}@${s.speed}`) })
    driver.pause()
    expect(driver.hold).toBe('paused')
    expect(driver.tick(500).steps).toBe(0)
    driver.resume()
    driver.setSpeed(5)
    expect(driver.tick(200).steps).toBe(10)
    expect(changes).toEqual(['paused@1', 'running@1', 'running@5'])
  })

  it('a held clock does not save up time: no burst after a long hold', () => {
    const host = new FakeHost()
    host.due = 1
    const driver = new ClockDriver(host, { speed: 10 })
    for (let i = 0; i < 6000; i++) driver.tick(100) // ten minutes held
    expect(host.step).toBe(0)
    host.due = null
    expect(driver.tick(100).steps).toBe(10)
  })

  it('rests at 22:00, shows the card, and the next day starts on a click', () => {
    const host = new FakeHost()
    host.step = stepAt(21, 59)
    const driver = new ClockDriver(host, { speed: 10 })
    for (let i = 0; i < 50; i++) driver.tick(100)
    expect(driver.resting).toBe(true)
    expect(driver.hold).toBe('resting')
    const restedAt = host.step
    expect(minuteAt(restedAt)).toBeGreaterThanOrEqual(22 * 60)
    expect(restedAt).toBeLessThan(stepAt(22) + 10)
    for (let i = 0; i < 600; i++) driver.tick(100) // a minute of wall time: nothing moves
    expect(host.step).toBe(restedAt)

    driver.startNextDay()
    expect(driver.resting).toBe(false)
    for (let i = 0; i < 20 && driver.state.phase === 'night'; i++) driver.tick(100)
    // The skip stopped at 07:00 sharp; the slice that saw the morning already ran its normal ten steps.
    expect(driver.state.phase).toBe('day')
    expect(dayAt(host.step)).toBe(1)
    expect(host.step).toBe(stepAt(7, 0, 1) + 10)
  })

  it('runs days unattended while the counter is positive, one fewer each day, then rests', () => {
    const host = new FakeHost()
    host.step = stepAt(21)
    const days: number[] = []
    const driver = new ClockDriver(host, { speed: 100, unattendedDays: 2, onChange: (s) => days.push(s.unattendedDays) })
    for (let i = 0; i < 3000 && !driver.resting; i++) driver.tick(100)
    expect(driver.resting).toBe(true)
    expect(driver.state.unattendedDays).toBe(0)
    // Day 0 ended, days 1 and 2 ran unattended, and day 2's evening is where it rests.
    expect(dayAt(host.step)).toBe(2)
    expect(minuteAt(host.step)).toBeGreaterThanOrEqual(22 * 60)
    expect([...new Set(days)]).toEqual([1, 0])
  })

  describe('a hidden tab', () => {
    /** The render loop: 60 frames a second for `ms`. */
    const frames = (driver: ClockDriver, from: number, ms: number) => {
      let steps = 0
      for (let t = from; t <= from + ms; t += 1000 / 60) steps += driver.tickAt(t).steps
      return steps
    }

    it('without the timer, an hour away runs five slices on return, not 36,000 steps', () => {
      const host = new FakeHost()
      const driver = new ClockDriver(host)
      frames(driver, 0, 1000)
      const before = host.step
      expect(before).toBeGreaterThanOrEqual(9)
      // The render loop stops for an hour; then one frame arrives.
      const back = driver.tickAt(1000 + 3_600_000)
      expect(back).toEqual({ slices: 5, steps: 5 })
      expect(host.step).toBe(before + 5)
      expect(host.maxAdvance).toBe(1)
    })

    it('the 1 Hz timer steps at most five slices a second while hidden, and the first frame back adds nothing', () => {
      const host = new FakeHost()
      // (No rest rule here: ten hidden minutes at speed 10 would otherwise reach 22:00 and stop.)
      const driver = new ClockDriver(host, { speed: 10, policy: { rest: false } })
      frames(driver, 0, 1000)
      const visibleSteps = host.step
      // Hidden for ten minutes: only the worker timer ticks, once a second.
      let t = 1000
      let worst = 0
      for (let i = 0; i < 600; i++) {
        t += 1000
        const r = driver.idleTickAt(t)
        worst = Math.max(worst, r.steps)
        expect(r.slices).toBeLessThanOrEqual(5)
      }
      expect(worst).toBe(50)
      expect(host.maxAdvance).toBe(10)
      const hiddenSteps = host.step - visibleSteps
      // Bounded: half real time at most (5 slices of 10 steps a second), never the 60,000 steps of ten minutes.
      expect(hiddenSteps).toBe(600 * 50)
      // Back: the first frame comes 16 ms after the last timer tick.
      expect(driver.tickAt(t + 16)).toEqual({ slices: 0, steps: 0 })
      expect(frames(driver, t + 16, 1000)).toBeLessThanOrEqual(110)
    })

    it('the timer does nothing while frames tick the clock', () => {
      const host = new FakeHost()
      const driver = new ClockDriver(host)
      driver.tickAt(0)
      driver.tickAt(990)
      expect(driver.idleTickAt(1000)).toEqual({ slices: 0, steps: 0 })
      // …and it did not move the mark: the next frame still sees its own 16 ms.
      expect(driver.tickAt(1006).slices).toBe(0)
    })

    it('hidden with work in flight: the job finishes, the day finishes, then the company rests', () => {
      const host = new FakeHost()
      host.step = stepAt(21, 30)
      host.due = stepAt(21, 45)
      const driver = new ClockDriver(host, { speed: 10 })
      driver.tickAt(0)
      let t = 0
      const tick = () => driver.idleTickAt((t += 1000))
      // Held one step short of the due step while the model works (five minutes of wall time).
      for (let i = 0; i < 300; i++) tick()
      expect(host.step).toBe(stepAt(21, 45) - 1)
      expect(driver.hold).toBe('due')
      // The outcome is applied: the clock runs on, bounded, to 22:00 and rests.
      host.due = null
      let worst = 0
      for (let i = 0; i < 3600; i++) worst = Math.max(worst, tick().steps)
      expect(worst).toBeLessThanOrEqual(50)
      expect(driver.resting).toBe(true)
      expect(host.step).toBeGreaterThanOrEqual(stepAt(22))
      expect(host.step).toBeLessThan(stepAt(22) + 10)
      expect(dayAt(host.step)).toBe(0)
    })
  })
})

describe('clockStatus (the chip)', () => {
  const ready: ModelStatus = { state: 'ready' }
  const base = { hold: null, phase: 'day' as const, halted: null, leaseLost: null, model: ready, heldBy: null }

  it('shows exactly one state', () => {
    expect(clockStatus(base)).toEqual({ state: 'running', label: 'Running', detail: null })
    expect(clockStatus({ ...base, hold: 'due', heldBy: 'Giulia · draft' })).toEqual({ state: 'held', label: 'Held', detail: 'Giulia · draft' })
    expect(clockStatus({ ...base, hold: 'resting', phase: 'resting' })).toEqual({ state: 'resting', label: 'Resting', detail: 'day done' })
    expect(clockStatus({ ...base, phase: 'night' })).toEqual({ state: 'resting', label: 'Resting', detail: 'skipping the night' })
    expect(clockStatus({ ...base, hold: 'paused' })).toEqual({ state: 'paused', label: 'Paused', detail: null })
    expect(clockStatus({ ...base, hold: 'model', model: { state: 'loading', detail: 'downloading 41%' } })).toEqual({ state: 'model-loading', label: 'Model loading', detail: 'downloading 41%' })
    expect(clockStatus({ ...base, hold: 'halted', halted: 'command #7 (JobCompleted) could not be written to the log: disk full' })).toEqual({
      state: 'halted',
      label: 'Halted',
      detail: 'command #7 (JobCompleted) could not be written to the log: disk full',
    })
    expect(clockStatus({ ...base, hold: 'halted', halted: 'taken over', leaseLost: 'This device no longer runs the company: taken over.' })).toEqual({
      state: 'lease-lost',
      label: 'Lease lost',
      detail: 'This device no longer runs the company: taken over.',
    })
  })

  it('orders them: lease lost, halted, model, paused, resting, held, running', () => {
    const all = { hold: 'paused' as const, phase: 'resting' as const, halted: 'h', leaseLost: 'l', model: { state: 'lost' as const }, heldBy: 'x' }
    expect(clockStatus(all).state).toBe('lease-lost')
    expect(clockStatus({ ...all, leaseLost: null }).state).toBe('halted')
    expect(clockStatus({ ...all, leaseLost: null, halted: null })).toMatchObject({ state: 'model-loading', detail: 'recovering the GPU' })
    expect(clockStatus({ ...all, leaseLost: null, halted: null, model: ready }).state).toBe('paused')
    expect(clockStatus({ ...all, leaseLost: null, halted: null, model: ready, hold: 'resting' }).state).toBe('resting')
  })

  it('a model that is not there says so', () => {
    expect(clockStatus({ ...base, hold: 'model', model: { state: 'none' } })).toMatchObject({ state: 'model-loading', detail: 'no model loaded' })
    expect(clockStatus({ ...base, hold: 'model', model: { state: 'loading' } })).toMatchObject({ state: 'model-loading', detail: null })
  })

  it('a transient intake hold reads as running', () => {
    expect(clockStatus({ ...base, hold: 'settling' }).state).toBe('running')
  })
})
