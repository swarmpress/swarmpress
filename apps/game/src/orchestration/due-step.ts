/**
 * Where a pending job's due step comes from (ADR-0060, FEAT-080).
 *
 * A work-item job is due at its phase's minimum-done step; a standup thirty
 * game minutes after it was requested. The clock holds while a pending job is
 * due, and the loop runs jobs earliest-due first, so the loop needs each
 * job's due step when it takes the job in, and the earliest of them before
 * every slice.
 *
 * `DueStepSource` is that narrow interface. Two implementations:
 *
 * - `SimDueSteps`: the sim's own views, `Sim.next_due_step()` and `dueStep` on
 *   the pending jobs of `plan_json()` (FEAT-079). Used when the wasm build
 *   exports `next_due_step`.
 * - `HostDueSteps`: the same numbers derived in the host, for wasm builds
 *   without the view. **Delete it (and `dueStepSource`'s fallback) once every
 *   build exports the view.**
 *
 * Neither is sim state: a due step is a pure function of the world.
 */

/** The part of client-wasm's `Sim` the due-step sources read. */
export interface DueSim {
  step(): bigint
  day(): number
  minute_of_day(): number
  steps_per_day(): bigint
  /** The pending jobs: `jobs[].{id, kind, requestedMinute}`, plus `dueStep` once the sim exports the view. */
  plan_json(project?: string | null): string
  /** FEAT-079: the earliest due step of the sim's pending jobs. Feature-detected. */
  next_due_step?: () => bigint | number | null | undefined
}

export interface TrackedJob {
  job_id: number
  kind: string
}

/**
 * The steps between which the sim requested a job: it was not pending at
 * `after` and its effect left the sim at `upTo`. `after === upTo`: requested
 * by a command applied at that step.
 */
export interface StepRange {
  after: number
  upTo: number
}

export interface DueStepSource {
  /** `sim`: the sim's view. `host`: derived here. */
  readonly origin: 'sim' | 'host'
  /**
   * The loop took these jobs in: their due steps, in the same order. Called
   * once per intake, never per step. `requested` is missing for effects
   * re-emitted by a restore (nobody saw them leave the sim).
   */
  track(jobs: readonly TrackedJob[], requested?: StepRange): number[]
  /** The job's outcome was applied, or the loop gave up on it. */
  settle(jobId: number): void
  /** The earliest due step of a pending job; null without one. Cheap: read before every slice. */
  next(): number | null
}

interface PlanJobView {
  id: number
  kind: string
  /** Absolute game minute (minutes since day 0, 00:00) of the request. */
  requestedMinute: number
  dueStep?: number
}

const pendingJobs = (sim: DueSim): PlanJobView[] => (JSON.parse(sim.plan_json()) as { jobs?: PlanJobView[] }).jobs ?? []

// ------------------------------------------------------------------ the sim's view

/** The due steps as the sim reports them (FEAT-079). */
export class SimDueSteps implements DueStepSource {
  readonly origin = 'sim' as const

  constructor(private sim: DueSim) {}

  track(jobs: readonly TrackedJob[]): number[] {
    if (!jobs.length) return []
    const now = Number(this.sim.step())
    const due = new Map(pendingJobs(this.sim).map((j) => [j.id, j.dueStep]))
    // A job the sim no longer waits for is due at once: the clock never runs past work in flight.
    return jobs.map((j) => due.get(j.job_id) ?? now)
  }

  settle(): void {
    // The sim drops a job from its pending set when the outcome is applied.
  }

  next(): number | null {
    const v = this.sim.next_due_step?.()
    if (v == null) return null
    const n = Number(v)
    return Number.isSafeInteger(n) ? n : null
  }
}

// ------------------------------------------------------------------ derived in the host

/**
 * Game minutes from a job's request to its due step: sim-core
 * `PhaseKind::min_minutes` (draft 120, review 60, publish 15) and the thirty
 * minutes a standup may run before the clock holds (the sim drops a standup
 * sixty minutes after it opened, `STANDUP_TIMEOUT_MINUTES`).
 */
export const DUE_MINUTES: Record<string, number> = { draft: 120, review: 60, publish: 15, standup: 30 }

const MINUTES_PER_DAY = 1440

/** sim-core `World::minutes_to_steps`: whole steps, at least one. */
export function minutesToSteps(minutes: number, stepsPerDay: number): number {
  return Math.max(1, Math.floor((minutes * stepsPerDay) / MINUTES_PER_DAY))
}

/**
 * The due steps derived in the host, for a wasm build without
 * `Sim.next_due_step()`:
 *
 *   due = request step + minutes_to_steps(DUE_MINUTES[kind])
 *
 * which is the sim's `min_done_step` for a work-item job, because a phase
 * starts in the same step that requests its job (`World::start_phase`).
 *
 * The request step is exact when the host saw the effect leave the sim within
 * one step (`requested.upTo - requested.after <= 1`): the render loop steps the
 * session one step at a time, and a command's job is requested at the step the
 * command is applied. Otherwise (a restore's re-emitted effects, the boot
 * fast-forward's chunks) it is the first step of the pending job's
 * `requestedMinute` in `plan_json()`, raised to `requested.after + 1` when
 * known. That is a lower bound, at most one game minute early: the clock then
 * holds a few steps sooner than it must, which never changes an outcome.
 */
export class HostDueSteps implements DueStepSource {
  readonly origin = 'host' as const
  private due = new Map<number, number>()

  constructor(private sim: DueSim) {}

  track(jobs: readonly TrackedJob[], requested?: StepRange): number[] {
    if (!jobs.length) return []
    const spd = Number(this.sim.steps_per_day())
    const exact = requested && requested.upTo - requested.after <= 1 ? requested.upTo : null
    const pending = exact == null ? new Map(pendingJobs(this.sim).map((j) => [j.id, j.requestedMinute])) : null
    return jobs.map((j) => {
      const request = exact ?? this.requestStep(pending?.get(j.job_id), requested, spd)
      const due = request + minutesToSteps(DUE_MINUTES[j.kind] ?? 0, spd)
      this.due.set(j.job_id, due)
      return due
    })
  }

  settle(jobId: number): void {
    this.due.delete(jobId)
  }

  next(): number | null {
    let min: number | null = null
    for (const d of this.due.values()) if (min == null || d < min) min = d
    return min
  }

  private requestStep(requestedMinute: number | undefined, requested: StepRange | undefined, spd: number): number {
    const now = Number(this.sim.step())
    const floor = requested ? Math.min(requested.after + 1, requested.upTo) : 0
    // Not pending in the sim (it gave up on the job): due as early as it can be.
    if (requestedMinute == null) return floor
    // The absolute game minute of step 0, then the first step of the request's minute.
    const startMinute = this.sim.day() * MINUTES_PER_DAY + this.sim.minute_of_day() - Math.floor((now * MINUTES_PER_DAY) / spd)
    const first = Math.ceil(((requestedMinute - startMinute) * spd) / MINUTES_PER_DAY)
    return Math.min(now, Math.max(first, floor))
  }
}

/** The sim's view when this wasm build has it, else the host's derivation. */
export function dueStepSource(sim: DueSim): DueStepSource {
  return typeof sim.next_due_step === 'function' ? new SimDueSteps(sim) : new HostDueSteps(sim)
}
