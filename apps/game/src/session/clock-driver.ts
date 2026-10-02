/**
 * The game clock's host policy (ADR-0060, ADR-0048, FEAT-080): how far the
 * browser lets the sim advance. Game time must not depend on how fast the GPU
 * is, so the clock
 *
 *   - never bursts: wall time is clamped to `MAX_ACC_MS` before it becomes
 *     steps, so a tab that was hidden for an hour catches up on nothing;
 *   - holds while a pending job is due (`ClockView.nextDueStep`), so every
 *     action costs exactly its phase minimum in game time on any hardware;
 *   - holds while the loop is halted, the model is not ready, or the player
 *     paused;
 *   - rests at night once nothing is in flight: the day ends on a card, and
 *     the next one starts on a click or while "unattended days" is positive;
 *     the night itself is skipped by fast stepping to the morning.
 *
 * All of it is policy of this host. Nothing here enters the sim state or the
 * command log: the log still records `(seq, step, json)` and a replay applies
 * each command at its logged step.
 *
 * The file has two layers: pure functions (`accumulate`, `stepsToRun`,
 * `clockStatus`), and `ClockDriver`, the small imperative shell main.ts and
 * the hidden-tab timer both tick.
 */

/** One sim step is 100 ms of game-clock wall time. */
export const STEP_MS = 100
/** Wall time carried into one tick at most: five steps' worth. */
export const MAX_ACC_MS = 500
/** The day is done at or after this minute once nothing is in flight (sim-core `NIGHT_START`). */
export const REST_FROM_MINUTE = 22 * 60
/** The morning the night skip stops at (the scenario's own start of day). */
export const DAY_START_MINUTE = 7 * 60
/** Steps per 100 ms slice while the night is skipped (a 9 hour night takes about a second). */
export const NIGHT_STEPS_PER_SLICE = 500
/** The speeds the HUD offers (steps per 100 ms slice). */
export const SPEEDS = [1, 2, 5, 10] as const
const MINUTES_PER_DAY = 1440

// ------------------------------------------------------------------ model status

/**
 * What the model backend tells the clock (ADR-0060 decision 7). `none`: no
 * model is loaded and none is loading; `loading`: download, verification or
 * warm-up; `lost`: the GPU device is gone and the model is being recovered.
 * Only `ready` lets the clock run.
 */
export type ModelState = 'none' | 'loading' | 'ready' | 'lost'

export interface ModelStatus {
  state: ModelState
  /** One short line for the status chip ("downloading 41%", "verifying", "recovering the GPU"). */
  detail?: string
}

// ------------------------------------------------------------------ pure policy

/** `day`: normal stepping. `resting`: the day-done card is up. `night`: fast stepping to the morning. */
export type DayPhase = 'day' | 'resting' | 'night'

export interface ClockState {
  /** Wall time not yet turned into slices, below `STEP_MS` after a tick. */
  accMs: number
  /** Sim steps per 100 ms slice (1 = real time). */
  speed: number
  paused: boolean
  /** Days that still start by themselves; decremented each time one does. */
  unattendedDays: number
  phase: DayPhase
}

/** What the host reads from the sim, the loop and the model before each slice. */
export interface ClockView {
  /** `sim.step()`. */
  step: number
  /** `sim.minute_of_day()`. */
  minuteOfDay: number
  /** `sim.steps_per_day()`. */
  stepsPerDay: number
  /** The orchestration loop stopped for good (lease lost, or a log write failed). */
  halted: boolean
  modelReady: boolean
  /**
   * The earliest due step of a job the host still works on (a work-item job:
   * its phase's minimum-done step; a standup: its request step plus 30 game
   * minutes); null without one.
   */
  nextDueStep: number | null
  /** A pending job or a queued command exists: the day is not done, whatever the hour. */
  busy: boolean
  /** Effects left the sim but their jobs are not taken in yet (their due steps are unknown). */
  settling: boolean
}

/** Why a slice ran no step, most important first. */
export type HoldReason = 'halted' | 'model' | 'paused' | 'resting' | 'settling' | 'due'

export interface SliceDecision {
  state: ClockState
  /** Sim steps to run in this slice. */
  steps: number
  hold: HoldReason | null
}

export interface ClockPolicy {
  /** The rest rule applies (a company session). The offline demo runs around the clock. */
  rest: boolean
  restFromMinute: number
  dayStartMinute: number
  nightStepsPerSlice: number
  maxAccMs: number
}

export const DEFAULT_POLICY: ClockPolicy = {
  rest: true,
  restFromMinute: REST_FROM_MINUTE,
  dayStartMinute: DAY_START_MINUTE,
  nightStepsPerSlice: NIGHT_STEPS_PER_SLICE,
  maxAccMs: MAX_ACC_MS,
}

export function initialClock(opts: Partial<Pick<ClockState, 'speed' | 'paused' | 'unattendedDays'>> = {}): ClockState {
  return {
    accMs: 0,
    speed: cleanSpeed(opts.speed ?? 1),
    paused: opts.paused ?? false,
    unattendedDays: cleanDays(opts.unattendedDays ?? 0),
    phase: 'day',
  }
}

/** A speed is a whole number of steps per slice, at least 1. */
export function cleanSpeed(n: number): number {
  return Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 1
}

/** The unattended-days counter is a whole number from 0 to 365. */
export function cleanDays(n: number): number {
  return Number.isFinite(n) ? Math.min(365, Math.max(0, Math.floor(n))) : 0
}

/**
 * Wall time into slices: `acc = min(acc + dt, maxAccMs)`, then one slice per
 * `STEP_MS`. However long the page was away, at most `maxAccMs / STEP_MS`
 * slices come out of one tick.
 */
export function accumulate(accMs: number, dtMs: number, maxAccMs = MAX_ACC_MS): { accMs: number; slices: number } {
  const dt = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0
  const acc = Math.min(accMs + dt, maxAccMs)
  const slices = Math.floor(acc / STEP_MS)
  return { accMs: acc - slices * STEP_MS, slices }
}

/** Night: from `restFromMinute` until the morning. */
export function isNight(minuteOfDay: number, policy: Pick<ClockPolicy, 'restFromMinute' | 'dayStartMinute'> = DEFAULT_POLICY): boolean {
  return minuteOfDay >= policy.restFromMinute || minuteOfDay < policy.dayStartMinute
}

/**
 * Steps from `view.step` to the first step of the next `minuteOfDay` (always
 * ahead: a full day when the clock shows that minute now). Integer math that
 * mirrors sim-core's `SimConfig::clock_at`.
 */
export function stepsUntilMinute(view: Pick<ClockView, 'step' | 'minuteOfDay' | 'stepsPerDay'>, minuteOfDay: number): number {
  const elapsed = Math.floor((view.step * MINUTES_PER_DAY) / view.stepsPerDay)
  const ahead = (((minuteOfDay - view.minuteOfDay) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY || MINUTES_PER_DAY
  return Math.ceil(((elapsed + ahead) * view.stepsPerDay) / MINUTES_PER_DAY) - view.step
}

/**
 * Steps the clock may still run before it holds for the due job.
 *
 * `World::step()` increments the step and then completes the phases whose
 * minimum-done step is reached, so a phase completes *in the step that
 * reaches* its due step, provided the outcome was applied before. The clock
 * therefore stops one step short of the due step: the outcome is applied at
 * `due - 1` and the phase completes at `due`, exactly as it does when the
 * outcome arrived early. Holding at `due` itself would complete it at
 * `due + 1` and make a slow model cost one step more than a fast one.
 */
export function roomBeforeDue(step: number, nextDueStep: number | null): number {
  return nextDueStep == null ? Number.POSITIVE_INFINITY : nextDueStep - 1 - step
}

/**
 * One slice (100 ms of clock): how many steps to run, why none, and the
 * policy state after it (rest and night transitions, the unattended counter).
 */
export function stepsToRun(state: ClockState, view: ClockView, policy: ClockPolicy = DEFAULT_POLICY): SliceDecision {
  if (view.halted) return { state, steps: 0, hold: 'halted' }
  if (!view.modelReady) return { state, steps: 0, hold: 'model' }
  // Pause freezes the policy too: no rest card, no counter change while paused.
  if (state.paused) return { state, steps: 0, hold: 'paused' }

  let s = state
  const night = policy.rest && isNight(view.minuteOfDay, policy)
  // The morning ends the night skip; work that turned up ends a rest.
  if (s.phase === 'night' && !night) s = { ...s, phase: 'day' }
  if (s.phase === 'resting' && (!night || view.busy)) s = { ...s, phase: 'day' }
  // The day is done: nothing in flight at night. It ends on the card, or, while
  // the counter is positive (also when it is raised on the card), on its own.
  if (s.phase !== 'night' && night && !view.busy) {
    if (s.unattendedDays > 0) s = { ...s, phase: 'night', unattendedDays: s.unattendedDays - 1 }
    else if (s.phase !== 'resting') s = { ...s, phase: 'resting' }
  }
  if (s.phase === 'resting') return { state: s, steps: 0, hold: 'resting' }
  if (view.settling) return { state: s, steps: 0, hold: 'settling' }

  const room = roomBeforeDue(view.step, view.nextDueStep)
  if (room <= 0) return { state: s, steps: 0, hold: 'due' }
  const want = s.phase === 'night' ? Math.min(policy.nightStepsPerSlice, stepsUntilMinute(view, policy.dayStartMinute)) : s.speed
  return { state: s, steps: Math.min(want, room), hold: null }
}

/** The player starts the next day from the day-done card: the night is skipped. */
export function startNextDay(state: ClockState): ClockState {
  return state.phase === 'resting' ? { ...state, phase: 'night' } : state
}

// ------------------------------------------------------------------ status chip

/** The HUD chip shows exactly one of these. */
export type ChipState = 'running' | 'held' | 'resting' | 'model-loading' | 'lease-lost' | 'halted' | 'paused'

export const CHIP_LABELS: Record<ChipState, string> = {
  running: 'Running',
  held: 'Held',
  resting: 'Resting',
  'model-loading': 'Model loading',
  'lease-lost': 'Lease lost',
  halted: 'Halted',
  paused: 'Paused',
}

export interface ClockStatus {
  state: ChipState
  label: string
  /** Who and what, or the reason ("Giulia · draft", "the company lease was taken over …"). */
  detail: string | null
}

export interface StatusInputs {
  /** The last slice's hold. */
  hold: HoldReason | null
  phase: DayPhase
  /** Why the loop halted; null while it runs. */
  halted: string | null
  /** Why this session does not hold the company lease; null while it does. */
  leaseLost: string | null
  model: ModelStatus
  /** The job the clock waits for ("Giulia · draft"); null without one. */
  heldBy: string | null
}

const MODEL_DETAIL: Record<ModelState, string | null> = {
  none: 'no model loaded',
  loading: null,
  lost: 'recovering the GPU',
  ready: null,
}

/** The one state the player sees (ADR-0060 decision 8). */
export function clockStatus(i: StatusInputs): ClockStatus {
  const of = (state: ChipState, detail: string | null = null): ClockStatus => ({ state, label: CHIP_LABELS[state], detail })
  if (i.leaseLost) return of('lease-lost', i.leaseLost)
  if (i.halted) return of('halted', i.halted)
  if (i.model.state !== 'ready') return of('model-loading', i.model.detail ?? MODEL_DETAIL[i.model.state])
  if (i.hold === 'paused') return of('paused')
  if (i.phase === 'resting') return of('resting', 'day done')
  if (i.phase === 'night') return of('resting', 'skipping the night')
  if (i.hold === 'due') return of('held', i.heldBy)
  return of('running')
}

// ------------------------------------------------------------------ driver

/** What the driver steps: the session (sim + orchestration loop), or the offline demo's sim. */
export interface ClockHost {
  view(): ClockView
  /** A step boundary, before any step of the slice: apply job outcomes and landed deploys. */
  boundary(): void
  /**
   * Advances the sim by up to `steps` steps and returns how many it ran. A
   * host stops early when the sim asked for a job, so the job's due step is
   * known before the clock moves on.
   */
  advance(steps: number): number
}

/** The part of client-wasm's `Sim` the clock steps and reads. */
export interface ClockSim {
  step(): bigint
  minute_of_day(): number
  steps_per_day(): bigint
  advance(steps: number): void
}

/** The part of the orchestration loop the clock reads and drives (orchestration/loop.ts). */
export interface ClockLoop {
  readonly halted: string | null
  readonly nextDueStep: number | null
  readonly busy: boolean
  readonly settling: boolean
  boundary(): void
  /** Drains the sim's effects into the job queue; true when the sim asked for a job. */
  afterAdvance(): boolean
}

/**
 * The host of a company session: the sim stepped through the orchestration
 * loop. It advances one step at a time, so the step a job was requested at is
 * exact, and stops as soon as the sim asks for a job, so the job's due step is
 * known before the clock moves on.
 */
export function sessionClockHost(sim: ClockSim, loop: ClockLoop, opts: { modelReady(): boolean; onStep?(): void }): ClockHost {
  return {
    view: () => ({
      step: Number(sim.step()),
      minuteOfDay: sim.minute_of_day(),
      stepsPerDay: Number(sim.steps_per_day()),
      halted: loop.halted != null,
      modelReady: opts.modelReady(),
      nextDueStep: loop.nextDueStep,
      busy: loop.busy,
      settling: loop.settling,
    }),
    boundary: () => loop.boundary(),
    advance: (steps) => {
      let ran = 0
      while (ran < steps) {
        sim.advance(1)
        ran++
        const asked = loop.afterAdvance()
        opts.onStep?.()
        if (asked) break
      }
      return ran
    },
  }
}

export interface ClockDriverOptions {
  speed?: number
  paused?: boolean
  unattendedDays?: number
  policy?: Partial<ClockPolicy>
  /** Called when a setting or the day phase changed (persist the counter, redraw the HUD). */
  onChange?: (state: ClockState) => void
}

export interface TickResult {
  slices: number
  steps: number
}

/**
 * Ticks the clock from two sources that never add up: the render loop
 * (`tickAt` every frame) and the 1 Hz worker timer (`idleTickAt`, which only
 * acts when no frame ticked for `IDLE_AFTER_MS`, i.e. the tab is hidden).
 * Both measure wall time from the same mark, and every tick goes through the
 * clamp, so neither a hidden hour nor the first frame after it can burst.
 */
export class ClockDriver {
  static readonly IDLE_AFTER_MS = 900
  state: ClockState
  /** Why the last slice ran no step; null when it stepped (or before the first slice). */
  hold: HoldReason | null = null
  /** Steps run since the driver was created. */
  stepsRun = 0
  readonly policy: ClockPolicy
  private lastAt: number | null = null

  constructor(
    private host: ClockHost,
    private opts: ClockDriverOptions = {},
  ) {
    this.policy = { ...DEFAULT_POLICY, ...opts.policy }
    this.state = initialClock(opts)
  }

  /** `dtMs` of wall time passed: clamp, then run the slices. */
  tick(dtMs: number): TickResult {
    const a = accumulate(this.state.accMs, dtMs, this.policy.maxAccMs)
    this.state = { ...this.state, accMs: a.accMs }
    let steps = 0
    for (let i = 0; i < a.slices; i++) {
      this.host.boundary()
      steps += this.slice()
    }
    return { slices: a.slices, steps }
  }

  /** A tick at wall time `nowMs` (the render loop). The first call only sets the mark. */
  tickAt(nowMs: number): TickResult {
    const dt = this.lastAt == null ? 0 : nowMs - this.lastAt
    this.lastAt = nowMs
    return this.tick(dt)
  }

  /** The slow timer's tick: acts only when nothing else ticked the clock for `IDLE_AFTER_MS`. */
  idleTickAt(nowMs: number): TickResult {
    if (this.lastAt != null && nowMs - this.lastAt < ClockDriver.IDLE_AFTER_MS) return { slices: 0, steps: 0 }
    return this.tickAt(nowMs)
  }

  /** Re-evaluates the policy without stepping (after a setting changed, so the HUD is right at once). */
  refresh() {
    const d = stepsToRun(this.state, this.host.view(), this.policy)
    this.hold = d.hold
    this.commit(d.state)
  }

  pause() {
    this.set({ paused: true })
  }

  resume() {
    this.set({ paused: false })
  }

  setSpeed(speed: number) {
    this.set({ speed: cleanSpeed(speed) })
  }

  setUnattendedDays(days: number) {
    this.set({ unattendedDays: cleanDays(days) })
  }

  /** The day-done card's button. */
  startNextDay() {
    this.commit(startNextDay(this.state))
  }

  get resting(): boolean {
    return this.state.phase === 'resting'
  }

  private slice(): number {
    const d = stepsToRun(this.state, this.host.view(), this.policy)
    this.hold = d.hold
    this.commit(d.state)
    if (d.steps <= 0) return 0
    const ran = this.host.advance(d.steps)
    this.stepsRun += ran
    return ran
  }

  private set(patch: Partial<ClockState>) {
    this.commit({ ...this.state, ...patch })
    this.refresh()
  }

  private commit(next: ClockState) {
    const prev = this.state
    this.state = next
    if (prev.phase !== next.phase || prev.speed !== next.speed || prev.paused !== next.paused || prev.unattendedDays !== next.unattendedDays) {
      this.opts.onChange?.(next)
    }
  }
}
