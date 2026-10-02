/**
 * Restore by replay (FEAT-014, ADR-0038): client-wasm exports no world
 * snapshot yet, so a company is restored by re-running its deterministic sim
 * from the seed and applying the logged commands at the steps they were
 * applied at. The same seed plus the same command log gives the same
 * `World::hash` (CLAUDE.md rule 1), so a checkpoint's hash verifies the
 * result. Effects re-emitted during the replay are returned so the caller can
 * re-run the jobs whose outcomes are not in the log yet.
 */

/** The part of client-wasm's `Sim` a replay needs. */
export interface ReplaySim {
  step(): bigint
  hash(): bigint
  advance(steps: number): void
  apply_command_json(json: string): void
  drain_effects_json(): string
  day(): number
  minute_of_day(): number
  steps_per_day(): bigint
}

/** One command of the log, as JSON text (`sim_core::Command` / `ServerCommand`, externally tagged). */
export interface LoggedCommand {
  seq: number
  /** `sim.step()` when the command was applied (a step boundary). */
  step: number
  kind: string
  json: string
}

export interface ReplayResult {
  /** The step the replay stopped at. */
  step: number
  /** `World::hash` there, as decimal text. */
  hash: string
  /** Commands applied. */
  applied: number
  /** Every non-empty `drain_effects_json()` array seen during the replay, in order. */
  effects: string[]
  /** Job ids whose outcome (`MeetingOutcome` / `JobCompleted`) is in the log. */
  completedJobs: Set<number>
  /** Work items with a logged `DeployLanded`. */
  landed: Set<string>
}

/** The variant name of an externally tagged command (`{"JobCompleted":{…}}` → `JobCompleted`). */
export function commandKind(json: string): string {
  const m = /^\s*(?:\{\s*"([A-Za-z]+)"|"([A-Za-z]+)")/.exec(json)
  if (!m) throw new Error(`bad command JSON: ${json.slice(0, 80)}`)
  return m[1] ?? m[2]
}

/** What a logged outcome command settles: the job it completes, or the work item it lands. */
export function settles(json: string): { job?: number; landed?: string } {
  const kind = commandKind(json)
  if (kind !== 'MeetingOutcome' && kind !== 'JobCompleted' && kind !== 'DeployLanded') return {}
  // Only small fields are read; u64 brief refs may lose precision here and are ignored.
  const body = (JSON.parse(json) as Record<string, { job_id?: number; work_item?: string }>)[kind]
  if (kind === 'DeployLanded') return { landed: body.work_item }
  return { job: body.job_id }
}

function advanceTo(sim: ReplaySim, step: number, effects: string[], chunk: number) {
  for (let now = Number(sim.step()); now < step; now = Number(sim.step())) {
    sim.advance(Math.min(chunk, step - now))
    const e = sim.drain_effects_json()
    if (e !== '[]') effects.push(e)
  }
}

/**
 * Replays `commands` (log order) onto a freshly created `sim` and stops at
 * `targetStep` (or the last command's step, whichever is later). Throws when
 * the log does not apply (a corrupt log or a different sim version).
 */
export function replay(sim: ReplaySim, commands: LoggedCommand[], targetStep = 0, opts: { chunk?: number } = {}): ReplayResult {
  const chunk = Math.max(1, opts.chunk ?? 1000)
  const effects: string[] = []
  const completedJobs = new Set<number>()
  const landed = new Set<string>()
  let applied = 0
  // Effects already queued by the scenario itself (none today) belong to the replay too.
  const first = sim.drain_effects_json()
  if (first !== '[]') effects.push(first)
  for (const c of commands) {
    if (c.step < Number(sim.step())) throw new Error(`command #${c.seq} at step ${c.step} is behind the replay (step ${sim.step()})`)
    advanceTo(sim, c.step, effects, chunk)
    try {
      sim.apply_command_json(c.json)
    } catch (e) {
      throw new Error(`replay: command #${c.seq} (${c.kind}) at step ${c.step} was rejected: ${String(e)}`)
    }
    applied++
    const s = settles(c.json)
    if (s.job != null) completedJobs.add(s.job)
    if (s.landed) landed.add(s.landed)
    const e = sim.drain_effects_json()
    if (e !== '[]') effects.push(e)
  }
  advanceTo(sim, targetStep, effects, chunk)
  return { step: Number(sim.step()), hash: sim.hash().toString(), applied, effects, completedJobs, landed }
}

/** "HH:MM" → minute of day; null when malformed. */
export function parseClock(v: string | null): number | null {
  if (!v) return null
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  return h < 24 && min < 60 ? h * 60 + min : null
}

/**
 * Steps from the sim's clock to `minuteOfDay` later the same game day; 0 when
 * that time has already passed today (fast-forward never skips a day).
 */
export function stepsUntil(sim: Pick<ReplaySim, 'minute_of_day' | 'steps_per_day'>, minuteOfDay: number): number {
  const ahead = minuteOfDay - sim.minute_of_day()
  if (ahead <= 0) return 0
  return Math.ceil((ahead * Number(sim.steps_per_day())) / 1440)
}
