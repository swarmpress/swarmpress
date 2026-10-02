/**
 * Restoring a company's sim (FEAT-014, FEAT-060, ADR-0046).
 *
 * With a snapshot (`restoreSim` given the world bytes): the sim is rebuilt
 * from client-wasm's `Sim.from_snapshot`, checked against the record it came
 * with (step, hash, seed), its pending jobs are re-issued, and only the
 * commands logged after the snapshot are replayed. The cost is the snapshot's
 * size plus that tail, whatever the company's age.
 *
 * Without one (a legacy checkpoint, a new company, or the audit path): the
 * sim is re-run from the seed, applying every logged command at the step it
 * was applied at. The same seed plus the same command log gives the same
 * `World::hash` (CLAUDE.md rule 1), so the checkpoint's hash verifies the
 * result.
 *
 * Either way, effects (re-)emitted on the way are returned so the caller can
 * run the jobs whose outcomes are not in the log yet.
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
  /** Commands applied (after a snapshot: only those logged after it). */
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
 * Replays `commands` (log order) onto `sim` (a freshly created one, or one
 * restored from a snapshot the commands were logged after) and stops at
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

/** The jobs and deploys a log settles, without running it. */
export function settledBy(commands: LoggedCommand[]): Pick<ReplayResult, 'completedJobs' | 'landed'> {
  const completedJobs = new Set<number>()
  const landed = new Set<string>()
  for (const c of commands) {
    const s = settles(c.json)
    if (s.job != null) completedJobs.add(s.job)
    if (s.landed) landed.add(s.landed)
  }
  return { completedJobs, landed }
}

/** What a restore needs from a sim besides replaying: its identity, and its pending jobs back. */
export interface RestorableSim extends ReplaySim {
  seed(): bigint
  /** Re-emits the requests of the jobs the sim still waits for (effects are not in a snapshot). */
  reissue_pending_jobs(): number
}

/** How a host makes sims (client-wasm's `Sim.scenario` and `Sim.from_snapshot`). */
export interface SimFactory<S extends RestorableSim> {
  fromSeed(scenario: string, seed: bigint): S
  /** Throws when the bytes are not an intact snapshot of this sim build. */
  fromSnapshot(world: Uint8Array): S
}

/** Where a device was: the fields of a checkpoint or snapshot record (sync/segments.ts). */
export interface RestorePoint {
  scenario: string
  /** Decimal text. */
  seed: string
  step: number
  /** `World::hash` at `step`, decimal text. */
  hash: string
  /** The last command-log seq the point includes (0 = none). */
  lastSeq: number
}

export interface RestoreInput {
  scenario: string
  /** The company's seed. */
  seed: bigint
  /** The whole command log, seqs `1..n`. */
  commands: LoggedCommand[]
  /** The newest checkpoint or snapshot record, if any. */
  point?: RestorePoint | null
  /** The world bytes of that record (`Sim.snapshot()`); absent for a legacy checkpoint. */
  world?: Uint8Array | null
  /** Ignore the world bytes and replay from the seed (the audit path). */
  forceReplay?: boolean
  chunk?: number
}

export interface RestoredSim<S> {
  sim: S
  result: ReplayResult
  /** The sim was rebuilt from a snapshot (only the tail was replayed). */
  fromSnapshot: boolean
  /** The restore point's step and hash were reached exactly (null without a point; a mismatch throws). */
  verified: boolean | null
}

/** A seed as the sim holds it: 64 bits, unsigned (wasm-bindgen wraps a negative BigInt the same way). */
const u64 = (x: bigint) => BigInt.asUintN(64, x)

/**
 * A record's seed text names `seed` when it is the same 64-bit integer.
 *
 * Two things make a plain text comparison wrong. The browser reads a
 * company's seed from JSON as a number, and records have always printed it
 * with `String(number)` (the shortest text that reads back as that double,
 * "12345678901234567000"), which is not the integer the sim was seeded with
 * (`BigInt(number)`, 12345678901234567168): such a text names the seed when
 * it reads back as the same double. And the central server stores the seed
 * as a signed 64-bit integer, so it can arrive negative, while the sim's
 * seed is the same bits unsigned.
 */
export function sameSeed(text: string, seed: bigint): boolean {
  if (!/^-?\d+$/.test(text)) return false
  if (u64(BigInt(text)) === u64(seed)) return true
  const n = Number(text)
  return Number.isInteger(n) && u64(BigInt(n)) === u64(seed)
}

/**
 * Restores a sim: from the snapshot plus the commands after it when `world`
 * is given, else by replay from the seed. Throws, instead of returning a
 * world that cannot be trusted, when the snapshot is damaged, written by
 * another sim build, not the one its record describes, or when a replay does
 * not reach the checkpoint's hash. A bad snapshot is never silently replaced
 * by a replay.
 */
export function restoreSim<S extends RestorableSim>(make: SimFactory<S>, input: RestoreInput): RestoredSim<S> {
  const { commands, chunk } = input
  const point = input.point ?? null
  if (point && !sameSeed(point.seed, input.seed)) throw new Error(`the checkpoint's seed ${point.seed} is not the company's seed ${input.seed}`)
  if (point && commands.length < point.lastSeq) throw new Error(`the command log ends at #${commands.length}, the checkpoint needs #${point.lastSeq}`)
  const covered = point ? commands.filter((c) => c.seq <= point.lastSeq) : []
  const later = commands.slice(covered.length)

  if (point && input.world && !input.forceReplay) {
    let sim: S
    try {
      sim = make.fromSnapshot(input.world)
    } catch (e) {
      throw new Error(`the snapshot at step ${point.step} cannot be restored: ${String(e)}`)
    }
    // The world must be the company's (its seed, bit for bit) and the one the record describes (step and hash).
    const at = { step: Number(sim.step()), hash: sim.hash().toString(), seed: sim.seed() }
    if (at.step !== point.step || at.hash !== point.hash || u64(at.seed) !== u64(input.seed)) {
      throw new Error(
        `the snapshot is not the world its record describes (snapshot: step ${at.step} hash ${at.hash} seed ${at.seed}; record: step ${point.step} hash ${point.hash}, company seed ${input.seed})`,
      )
    }
    // The outbox is not part of a snapshot: ask again for the jobs the sim waits for.
    sim.reissue_pending_jobs()
    const tail = replay(sim, later, 0, { chunk })
    return { sim, result: { ...tail, ...settledBy(commands) }, fromSnapshot: true, verified: true }
  }

  const sim = make.fromSeed(point?.scenario ?? input.scenario, input.seed)
  // First to the checkpoint (the commands it covers, then its step), where the
  // hash is checked; then the commands logged after it.
  let result = replay(sim, covered, point?.step ?? 0, { chunk })
  let verified: boolean | null = null
  if (point) {
    verified = result.step === point.step && result.hash === point.hash
    if (!verified) throw new Error(`replay desync at the checkpoint (step ${result.step} hash ${result.hash}, checkpoint step ${point.step} hash ${point.hash})`)
  }
  if (later.length) {
    const more = replay(sim, later, 0, { chunk })
    result = {
      step: more.step,
      hash: more.hash,
      applied: result.applied + more.applied,
      effects: [...result.effects, ...more.effects],
      completedJobs: new Set([...result.completedJobs, ...more.completedJobs]),
      landed: new Set([...result.landed, ...more.landed]),
    }
  }
  return { sim, result, fromSnapshot: false, verified }
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
