/**
 * The browser orchestration loop (FEAT-015, docs/architecture/browser-runtime.md):
 *
 *   sim.drain_effects_json() → jobsFromEffects → OrchestratorHandle.run (one at a time)
 *     → outcomesForSim → applied at the next step boundary → command log
 *   central DeployLanded event → held until the sim accepts it → applied → command log
 *
 * The sim owns every transition (ADR-0011): this loop only moves job requests
 * out and digests back in (CLAUDE.md rules 2-4). Every command it applies is
 * appended to the store's command log with the step it was applied at, so a
 * replay from the seed reproduces the world (catchup/replay.ts). Jobs are
 * keyed by `job_id`: a job whose outcome is already in the log is never
 * queued again. `run()` is not idempotent for drafts and reviews (it would
 * call the model again and post twice), so a job's outcomes are stored under
 * its id as soon as `run()` resolves and reused if the page reloads before
 * they are logged.
 *
 * Failures are loud (CLAUDE.md rule 11): a job that keeps failing is reported
 * to the sim as `JobFailed{Infrastructure}`, one that runs past its
 * wall-clock limit is cancelled (P6: the orchestrator stops it at its next
 * stage boundary and answers `JobFailed{Timeout}`); the sim blocks the item
 * and raises the escalation ticket. A failed command-log write halts the
 * loop. A lost model is not a failure: the job waits for it and runs again,
 * resuming from its stored stages.
 *
 * Game time (ADR-0060, FEAT-080): every job has a due step (`due-step.ts`).
 * Jobs run one at a time, earliest due first, and the clock holds one step
 * short of the earliest due step until that job's outcome is applied
 * (`holdClock`), so an action costs its phase minimum in game time however
 * long the model took. The hold is policy of this host: nothing of it is in
 * the sim or in the command log.
 */
import { commandKind, settles, type ReplaySim } from '../catchup/replay'
import { activeTimer, type OrchestratorLike } from '../orchestrator/bridge'
import type { CommandRecord } from '../store/company-store'
import { commandBytes } from '../sync/segments'
import { dueStepSource, type DueStepSource, type StepRange } from './due-step'
import { boardContext, expectedSeq, notSeatedYet, standupContext, turnOf, utteranceMs, type Turn } from './speech'

export interface LoopSim extends ReplaySim {
  validate_command_json(json: string): string | undefined
  /** The skeleton: `items[].{id,status}` and the pending `jobs[].{id,kind,requestedMinute}`. */
  plan_json(project?: string | null): string
  pending_effects(): number
  /** FEAT-079: the earliest due step of the sim's pending jobs (feature-detected by `dueStepSource`). */
  next_due_step?: () => bigint | number | null | undefined
}

export interface LoopStore {
  appendCommands(cmds: CommandRecord[]): Promise<number[]>
  appendPost(company: string, item: string, postJson: string): Promise<string>
  getKv(key: string): Promise<string | null>
  setKv(key: string, value: string): Promise<void>
  deleteKv?(key: string): Promise<void>
}

/** The two pure helpers of orchestrator-wasm (sync in wasm; the lazy loader makes them async). */
export interface JobCodec {
  jobsFromEffects(effectsJson: string, companyId: string): string[] | Promise<string[]>
  outcomesForSim(outcomesJson: string): string[] | Promise<string[]>
}

export type JobState = 'queued' | 'running' | 'done' | 'failed'

export interface JobRecord {
  job_id: number
  kind: string
  revision: number
  work_item: string | null
  state: JobState
  /** The step the job is due at (ADR-0060): the clock holds one step short of it until the outcome is applied. */
  due_step: number
  /** Who works on it, for the status chip ("Giulia"; "Team" for a standup); null when the request names nobody. */
  who: string | null
  /** From the `JobCompleted` digest. */
  ok?: boolean
  score?: number
  error?: string
}

export interface LoopOptions {
  sim: LoopSim
  store: LoopStore
  companyId: string
  orchestrator: OrchestratorLike
  codec: JobCodec
  /** Retries of a job whose run rejects (store or gateway errors are retryable). Default 2. */
  retries?: number
  retryMs?: number
  /**
   * Wall-clock limit of one `run()`, in ms: one number for every job, or per
   * job kind (missing kinds keep their default). 0 or Infinity: no limit.
   * Default `DEFAULT_JOB_TIMEOUT_MS`.
   */
  jobTimeoutMs?: number | Partial<Record<string, number>>
  /** While true a job's wall clock stands still (the model is not ready: loading, a lost GPU device). */
  paused?: () => boolean
  /** How long a job cancelled at its limit may take to stop before the loop gives up on it, ms. Default 30 s. */
  cancelGraceMs?: number
  /** Poll interval while waiting for a paused model, ms. Default 500. */
  pausePollMs?: number
  /** Where due steps come from. Default: the sim's view when the wasm build has it, else derived in the host. */
  due?: DueStepSource
  /** Finished jobs kept in `jobs` (jobs still in flight are always kept). Default 50. */
  keepJobs?: number
  log?: (line: string) => void
  /** Called with every loop error (also kept in `errors`): the HUD shows it as a toast and on the chip. */
  onError?: (message: string) => void
  /** Called after plan text in the store changed (a job's posts, the deploy status post). */
  onPlanText?: () => void
  /** Called after a `DeployLanded` was applied (the item is published). */
  onLanded?: (workItem: string) => void
  /**
   * A standup's context (ADR-0062, `orchestrator::StandupContext`), added to
   * its job request as `context`. Default: work in progress and items in
   * flight from `sim.plan_json()`, and today's date (speech.ts).
   */
  standupContext?: (job: { job_id: number; project: string }) => unknown | Promise<unknown>
  /**
   * An editorial board's context (ADR-0069, `orchestrator::BoardContext`).
   * Default: the standup's plus the room for planned items (speech.ts).
   */
  boardContext?: (job: { job_id: number; project: string }) => unknown | Promise<unknown>
  /** Wall time in ms for meeting speech (default `Date.now`). */
  now?: () => number
  /** The clock's speed: meeting turns play this many times as fast (default 1). */
  speechSpeed?: () => number
}

export interface ApplyResult {
  ok: boolean
  reason?: string
}

/** kv key holding work items whose DeployLanded arrived but is not applied yet. */
export const PENDING_DEPLOYS_KEY = 'deploys.pending'

/** kv key of a job's outcomes JSON, kept from `run()` resolving until its command is logged. */
export const jobOutcomeKey = (jobId: number) => `job.outcome.${jobId}`

/**
 * Wall-clock limits of one job run. Generous: a staged draft is expected to
 * take about eight minutes on the target machine (docs/mvp.md, unmeasured).
 * A job past its limit is given up on and reported as failed; cancelling the
 * model call itself is a later increment (P6), so the abandoned run may still
 * occupy the model for a while.
 */
export const DEFAULT_JOB_TIMEOUT_MS: Record<string, number> = {
  standup: 30 * 60_000,
  board: 30 * 60_000,
  draft: 60 * 60_000,
  review: 30 * 60_000,
  publish: 15 * 60_000,
}
/** The limit of a job kind not listed above. */
export const FALLBACK_JOB_TIMEOUT_MS = 60 * 60_000
/** Finished jobs kept in `OrchestrationLoop.jobs`, and errors kept in `errors`. */
export const KEEP_JOBS = 50
export const KEEP_ERRORS = 50
/**
 * Settled job ids (and landed work items) remembered for de-duplication
 * (FEAT-085, docs/mvp.md W). The sim requests a job once; only a restore
 * re-emits effects, and it re-emits only the jobs the sim still waits for
 * (`pendingOnly`). So an id older than the last few thousand jobs can never
 * come back, and the sets stay bounded over weeks of play.
 */
export const KEEP_SETTLED = 4096

/**
 * A Set that forgets its oldest entries past `cap` (insertion order). For
 * de-duplication of ids that, once old, can never be seen again.
 */
export class BoundedSet<T> {
  private s = new Set<T>()
  constructor(readonly cap: number) {}
  add(v: T): this {
    if (this.s.has(v)) return this
    this.s.add(v)
    if (this.s.size > this.cap) this.s.delete(this.s.values().next().value as T)
    return this
  }
  has(v: T): boolean {
    return this.s.has(v)
  }
  get size(): number {
    return this.s.size
  }
}

/** Sizes of the loop's in-memory collections (the soak test's growth check, FEAT-085). */
export interface LoopSizes {
  jobs: number
  byId: number
  seen: number
  completed: number
  landed: number
  failures: number
  open: number
  queue: number
  ready: number
  deploys: number
  where: number
  speech: number
  simSeq: number
  spoken: number
  errors: number
}

/** The orchestrator's error for a lost model (`OrchestratorError::Unavailable`): not a job failure. */
export const isModelUnavailable = (msg: string) => /model unavailable/.test(msg)

/** A job ran past its wall-clock limit: the loop gives up on it, without a retry. */
export class JobTimeout extends Error {
  constructor(readonly limitMs: number) {
    super(`timed out after ${formatLimit(limitMs)}`)
    this.name = 'JobTimeout'
  }
}

function formatLimit(ms: number): string {
  if (ms >= 60_000) return `${Math.round(ms / 6000) / 10} min`
  return ms >= 1000 ? `${Math.round(ms / 100) / 10} s` : `${ms} ms`
}

interface PlanItem {
  id: string
  status: string
}

interface PlanJob {
  id: number
  kind: string
  requestedMinute: number
}

interface PlanView {
  items: PlanItem[]
  jobs?: PlanJob[]
}

/** A deploy event waiting for the sim to accept it. */
interface HeldDeploy {
  workItem: string
  mergedSha?: string
  source?: string
  /** A DeployFailed (ADR-0059): the item is blocked with a `DeployFailed` ticket. */
  failed?: boolean
  /**
   * The server's `attempt` of a DeployFailed: how many redeploys preceded the
   * failure (FEAT-085). A failure after a redeploy has a higher one.
   */
  attempt?: number
}

interface QueuedJob {
  json: string
  rec: JobRecord
}

/** One deploy failure of a work item: its server `attempt` (FEAT-085). */
const failureKey = (workItem: string, attempt: number) => `${workItem}#${attempt}`

/** Earliest due step first, ties by job id. */
const runsBefore = (a: JobRecord, b: JobRecord) => a.due_step < b.due_step || (a.due_step === b.due_step && a.job_id < b.job_id)

/** "giulia" → "Giulia": the persona slug of the first person on the job; a standup is the team's. */
function whoOf(job: { kind: string; staff?: { persona?: string | null }[] }): string | null {
  if (job.kind === 'standup' || job.kind === 'board') return 'Team'
  const slug = job.staff?.[0]?.persona
  return slug ? slug.charAt(0).toUpperCase() + slug.slice(1) : null
}

export class OrchestrationLoop {
  /** The last `keepJobs` finished jobs, and every job still in flight, oldest first. */
  readonly jobs: JobRecord[] = []
  /** The last `KEEP_ERRORS` errors. */
  readonly errors: string[] = []
  /** Commands applied (and logged) by this loop since it started. */
  logged = 0
  /**
   * Why the loop stopped (a command could not be written to the log, or the
   * session lost the company lease); null while it runs. A halted loop holds
   * the clock, applies nothing and starts no job.
   */
  halted: string | null = null
  /** The seq of the last command applied (the log is contiguous from 1). */
  private seq = 0
  private byId = new Map<number, JobRecord>()
  /** Every job id this loop took in (a job is never queued twice, also after its record was trimmed); the newest `KEEP_SETTLED`. */
  private seen = new BoundedSet<number>(KEEP_SETTLED)
  /** Jobs whose outcome is in the log; the newest `KEEP_SETTLED`. */
  private completed = new BoundedSet<number>(KEEP_SETTLED)
  /** Work items whose DeployLanded is in the log; the newest `KEEP_SETTLED`. */
  private landed = new BoundedSet<string>(KEEP_SETTLED)
  /** `<work item>#<attempt>` of every DeployFailed applied in this session (one ticket per failure); the newest `KEEP_SETTLED`. */
  private failures = new BoundedSet<string>(KEEP_SETTLED)
  /** Jobs waiting or running; the running one stays in here until it finished. */
  private queue: QueuedJob[] = []
  /** Jobs taken in whose outcome is not applied yet (and that the loop did not give up on). */
  private open = new Set<number>()
  private due: DueStepSource
  /** Intakes started and not finished: effects left the sim, their jobs are not queued yet. */
  private taking = 0
  /** `sim.step()` when the sim's effects were last looked at. */
  private seenStep: number
  /** Outcome commands waiting for the next step boundary. */
  private ready: string[] = []
  /**
   * Deploy events of work items (DeployLanded, or DeployFailed with
   * `failed`), waiting until the sim accepts them, in arrival order: one
   * entry per item and kind; an entry whose item is closed is dropped.
   */
  private deploys: HeldDeploy[] = []
  /** `seq` when the held deploys were last checked for closed items. */
  private deploysCheckedAt = -1
  private intake: Promise<void> = Promise.resolve()
  private writes: Promise<void> = Promise.resolve()
  private running: Promise<void> | null = null
  /** Project and meeting of each job taken in (a standup's turns become its meeting's utterances). */
  private where = new Map<number, { project: string; meeting: string | null }>()
  /** Turns of a job waiting to be spoken, and until when the last one spoken holds the floor (ms). */
  private speech = new Map<number, { queue: Turn[]; until: number }>()
  /** The sim's next utterance seq per meeting, as last seen; dropped when the meeting's job closes. */
  private simSeq = new Map<string, number>()
  /** `meeting:sim seq` → the transcript row the bubble shows (the newest 256). */
  private spoken = new Map<string, { job: number; seq: number }>()
  private log: (line: string) => void

  constructor(private o: LoopOptions) {
    this.log = o.log ?? (() => undefined)
    this.due = o.due ?? dueStepSource(o.sim)
    this.seenStep = Number(o.sim.step())
  }

  /** Job ids and work items already settled in the replayed log, and the log's last seq. */
  seed(completed: Iterable<number>, landed: Iterable<string>, lastSeq = 0) {
    for (const j of completed) this.completed.add(j)
    for (const w of landed) this.landed.add(w)
    this.seq = lastSeq
  }

  /**
   * Stops the loop for good (ADR-0045 decision 10: an executor that loses the
   * lease halts). Queued jobs stay queued, outcomes that came back are not
   * applied, and the clock is held. The first reason is kept.
   */
  halt(reason: string) {
    if (this.halted) return
    this.halted = reason
    this.log(`halted: ${reason}`)
  }

  /** The seq of the last command applied; read it in the same turn as the sim's step and hash for a checkpoint. */
  get lastSeq(): number {
    return this.seq
  }

  /**
   * The earliest due step of a job this loop still works on (queued, running,
   * or finished with its outcome waiting for a boundary); null without one.
   * No plan parse: due steps are recorded when a job is taken in.
   */
  get nextDueStep(): number | null {
    return this.open.size ? this.due.next() : null
  }

  /** Effects left the sim and their jobs are not queued yet (the due steps are not known). */
  get settling(): boolean {
    return this.taking > 0
  }

  /** A pending job or a queued command exists: the day is not done. */
  get busy(): boolean {
    return this.taking > 0 || this.open.size > 0 || this.ready.length > 0
  }

  /**
   * True while the sim clock must not advance (ADR-0060): the loop is halted,
   * jobs are being taken in, or the next step would reach the due step of a
   * job whose outcome is not applied yet. (The model's readiness, pause and
   * rest are the clock driver's: session/clock-driver.ts.)
   */
  get holdClock(): boolean {
    if (this.halted || this.taking > 0) return true
    const next = this.nextDueStep
    return next != null && Number(this.o.sim.step()) + 1 >= next
  }

  /** The job the clock waits for: the one running, else the earliest due one in flight. */
  get heldFor(): JobRecord | null {
    let first: JobRecord | null = null
    for (const id of this.open) {
      const rec = this.byId.get(id)
      if (!rec) continue
      if (rec.state === 'running') return rec
      if (!first || runsBefore(rec, first)) first = rec
    }
    return first
  }

  /** Where the due steps come from: the sim's view, or derived in the host. */
  get dueOrigin(): 'sim' | 'host' {
    return this.due.origin
  }

  /** Restores DeployLanded events that arrived before a reload but were not applied yet. */
  async loadPendingDeploys(): Promise<void> {
    const raw = await this.o.store.getKv(PENDING_DEPLOYS_KEY)
    if (!raw) return
    for (const d of JSON.parse(raw) as HeldDeploy[]) {
      if (!this.holds(d.workItem, !!d.failed)) this.deploys.push(d)
    }
  }

  /**
   * Queues the jobs of a drained effects array (`[]` is a no-op).
   * `pendingOnly` (effects re-emitted by a replay): only jobs the sim still
   * waits for are queued, so a standup that timed out or a job whose item was
   * cancelled before the reload is not run again.
   */
  enqueueEffects(effectsJson: string, opts: { pendingOnly?: boolean; requested?: StepRange } = {}): Promise<void> {
    if (effectsJson === '[]') return this.intake
    const pending = opts.pendingOnly ? new Set(((JSON.parse(this.o.sim.plan_json()) as PlanView).jobs ?? []).map((j) => j.id)) : null
    // Until the jobs are queued their due steps are unknown: the clock holds (`settling`).
    this.taking++
    this.intake = this.intake
      .then(async () => {
        const fresh: QueuedJob[] = []
        for (const jobJson of await this.o.codec.jobsFromEffects(effectsJson, this.o.companyId)) {
          const j = JSON.parse(jobJson) as {
            job_id: number
            kind: string
            revision: number
            work_item: string | null
            project?: string
            meeting?: string | null
            staff?: { persona?: string | null }[]
          }
          if (this.completed.has(j.job_id) || this.seen.has(j.job_id)) continue
          if (pending && !pending.has(j.job_id)) continue
          this.seen.add(j.job_id)
          this.where.set(j.job_id, { project: j.project ?? '', meeting: j.meeting ?? null })
          fresh.push({ json: jobJson, rec: { job_id: j.job_id, kind: j.kind, revision: j.revision, work_item: j.work_item, state: 'queued', due_step: 0, who: whoOf(j) } })
        }
        const due = this.due.track(
          fresh.map((f) => f.rec),
          opts.requested,
        )
        fresh.forEach((f, i) => {
          f.rec.due_step = due[i]
          this.byId.set(f.rec.job_id, f.rec)
          this.open.add(f.rec.job_id)
          this.jobs.push(f.rec)
          this.queue.push(f)
        })
        this.trim()
        this.pump()
      })
      .catch((e) => this.fail(`effects: ${String(e)}`))
      .finally(() => {
        this.taking--
      })
    return this.intake
  }

  /**
   * After the sim advanced: drain its effects into the job queue. Returns true
   * when it asked for a job; the caller then stops stepping until the job is
   * taken in. Called after every single step, the request step is exact.
   */
  afterAdvance(): boolean {
    const now = Number(this.o.sim.step())
    const after = Math.min(this.seenStep, now)
    this.seenStep = now
    if (this.o.sim.pending_effects() === 0) return false
    void this.enqueueEffects(this.o.sim.drain_effects_json(), { requested: { after, upTo: now } })
    return true
  }

  /**
   * At a step boundary (between `advance` calls): apply the outcomes that came
   * back, then any held DeployLanded the sim now accepts.
   */
  boundary() {
    if (this.halted) return
    // Meeting turns first; a standup's outcome waits until its turns were spoken (ADR-0062).
    if (this.speech.size) this.speak()
    const held: string[] = []
    while (this.ready.length) {
      const cmd = this.ready.shift()!
      const settled = settles(cmd).job
      if (settled != null && this.speaking(settled)) {
        held.push(cmd)
        continue
      }
      if (commandKind(cmd) === 'DeployLanded') {
        this.holdDeploy(JSON.parse(cmd).DeployLanded.work_item as string)
        continue
      }
      const r = this.apply(cmd)
      if (!r.ok) {
        this.fail(`outcome rejected by the sim: ${r.reason} (${cmd.slice(0, 120)})`)
        // Nothing more will come for that job: the clock must not wait for it.
        const job = settles(cmd).job
        if (job != null) this.close(job)
      }
    }
    this.ready.push(...held)
    if (this.deploys.length) this.tryDeploys()
  }

  /**
   * A `turn` progress event of the orchestrator (`TurnFinished`, ADR-0062):
   * queued as an `Utterance` of the job's meeting, applied at a step boundary.
   */
  turnFinished(ev: { job_id: number; stage: string; detail?: Record<string, unknown> | null }): void {
    if (this.halted || this.completed.has(ev.job_id)) return
    const turn = turnOf(ev, this.where.get(ev.job_id)?.meeting ?? null)
    if (!turn) return
    const s = this.speech.get(turn.job) ?? { queue: [], until: 0 }
    s.queue.push(turn)
    this.speech.set(turn.job, s)
  }

  /** The transcript row of a meeting's utterance `seq` (the sim's), if this loop spoke it. */
  spokenAt(meeting: string, seq: number): { job: number; seq: number } | null {
    return this.spoken.get(`${meeting}:${seq}`) ?? null
  }

  /** Turns of `job` still to be spoken, or the last one still holding the floor. */
  private speaking(job: number): boolean {
    const s = this.speech.get(job)
    return !!s && (s.queue.length > 0 || this.nowMs() < s.until)
  }

  private nowMs(): number {
    return (this.o.now ?? Date.now)()
  }

  /**
   * Applies the next turn of each meeting whose floor is free. The seq is the
   * sim's own (a rejected turn leaves a gap in the transcript's numbering, not
   * the sim's). A speaker still walking to the table is waited for until the
   * job is due; any other rejection skips the turn, never the loop.
   */
  private speak() {
    const now = this.nowMs()
    for (const [job, s] of this.speech) {
      if (now < s.until || !s.queue.length) continue
      const t = s.queue[0]
      const cmd = (seq: number) => JSON.stringify({ Utterance: { meeting: t.meeting, seq, speaker: t.speaker, chars: t.chars } })
      let seq = this.simSeq.get(t.meeting) ?? 0
      let why = this.o.sim.validate_command_json(cmd(seq))
      const expected = expectedSeq(why)
      if (expected != null) {
        seq = expected
        why = this.o.sim.validate_command_json(cmd(seq))
      }
      const due = this.byId.get(job)?.due_step
      if (notSeatedYet(why) && due != null && Number(this.o.sim.step()) + 1 < due) continue
      s.queue.shift()
      const r = why ? { ok: false, reason: why } : this.apply(cmd(seq))
      if (!r.ok) {
        this.log(`turn ${t.seq} of job ${job} (${t.speaker}) not spoken: ${r.reason}`)
        continue
      }
      this.simSeq.set(t.meeting, seq + 1)
      this.spoken.set(`${t.meeting}:${seq}`, { job, seq: t.seq })
      if (this.spoken.size > 256) this.spoken.delete(this.spoken.keys().next().value!)
      s.until = now + utteranceMs(t.chars, this.o.speechSpeed?.() ?? 1)
    }
  }

  /**
   * Applies a command now (this must be a step boundary) and appends it to the
   * command log. CEO commands from the overlay come through here too.
   */
  apply(json: string): ApplyResult {
    if (this.halted) return { ok: false, reason: `the session is halted: ${this.halted}` }
    try {
      this.o.sim.apply_command_json(json)
    } catch (e) {
      return { ok: false, reason: typeof e === 'string' ? e : (e as Error).message }
    }
    // The seq is assigned here, in the same turn as the apply, so a checkpoint
    // can name the exact log position of the world it captured.
    const rec: CommandRecord = { seq: ++this.seq, step: Number(this.o.sim.step()), kind: commandKind(json), payload: commandBytes(json) }
    const s = settles(json)
    if (s.job != null) {
      this.completed.add(s.job)
      this.close(s.job)
    }
    if (s.landed) this.landed.add(s.landed)
    this.logged++
    this.write(async () => {
      await this.o.store.appendCommands([rec])
      // The outcome is in the log now; its copy in the kv is no longer needed.
      if (s.job != null) await this.o.store.deleteKv?.(jobOutcomeKey(s.job)).catch(() => undefined)
    }).catch((e) => {
      // The world has a command the log does not: stop before anything else is built on it.
      this.halted = `command #${rec.seq} (${rec.kind}) could not be written to the log: ${String(e)}`
      this.fail(this.halted)
    })
    // A logged command may request new jobs at once (e.g. MeetingOutcome → Draft).
    this.afterAdvance()
    return { ok: true }
  }

  /**
   * A DeployLanded event from the central server (EventStream handler):
   * persisted, applied when the sim accepts it. Rejects when it could not be
   * persisted, so the event cursor does not move past it.
   */
  async deployLanded(workItem: string, info: { mergedSha?: string; source?: string } = {}): Promise<void> {
    if (this.landed.has(workItem) || this.holds(workItem, false)) return
    this.deploys.push({ workItem, ...info })
    await this.persistDeploys()
  }

  /**
   * A DeployFailed event from the central server (ADR-0059): persisted, and
   * applied as `DeployFailed{work_item}` once the sim accepts it (the item is
   * merged and waits for its deploy), which blocks the item with a
   * `DeployFailed` ticket. Without it the item would wait for a deploy that
   * never comes: a silent stall. Rejects when it could not be persisted.
   *
   * The CEO's `Retry` on that ticket redeploys (FEAT-085: the publish job asks
   * the server to re-run the failed deploy). If that deploy fails too, the
   * server sends a new DeployFailed with a higher `attempt`, which blocks the
   * item again with a new ticket; the same failure delivered twice (same
   * `attempt`) raises no second ticket.
   */
  async deployFailed(workItem: string, info: { mergedSha?: string; source?: string; attempt?: number } = {}): Promise<void> {
    if (this.landed.has(workItem)) return
    if (info.attempt != null && this.failures.has(failureKey(workItem, info.attempt))) return
    const held = this.deploys.find((d) => d.workItem === workItem && d.failed)
    if (held) {
      // One held failure per item: a newer attempt replaces the older one.
      if (info.attempt == null || (held.attempt ?? -1) >= info.attempt) return
      Object.assign(held, info)
    } else this.deploys.push({ workItem, ...info, failed: true })
    await this.persistDeploys()
  }

  /** A central event (`DeployLanded`, `DeployFailed`) for the loop; other kinds are ignored. */
  async deployEvent(ev: { kind: string; payload: Record<string, unknown> }): Promise<void> {
    const p = ev.payload
    if (typeof p.work_item !== 'string') return
    const info = { mergedSha: typeof p.merged_sha === 'string' ? p.merged_sha : undefined, source: typeof p.source === 'string' ? p.source : undefined }
    if (ev.kind === 'DeployLanded') await this.deployLanded(p.work_item, info)
    else if (ev.kind === 'DeployFailed') await this.deployFailed(p.work_item, { ...info, attempt: typeof p.attempt === 'number' ? p.attempt : undefined })
  }

  /** The loop's collections and their sizes (diagnostics; the soak test's growth check). */
  sizes(): LoopSizes {
    return {
      jobs: this.jobs.length,
      byId: this.byId.size,
      seen: this.seen.size,
      completed: this.completed.size,
      landed: this.landed.size,
      failures: this.failures.size,
      open: this.open.size,
      queue: this.queue.length,
      ready: this.ready.length,
      deploys: this.deploys.length,
      where: this.where.size,
      speech: this.speech.size,
      simSeq: this.simSeq.size,
      spoken: this.spoken.size,
      errors: this.errors.length,
    }
  }

  /** Resolves once queued effects are taken in, every job ran, its outcomes were applied and the log is written. */
  async idle(pollMs = 50): Promise<void> {
    for (;;) {
      await this.intake
      if (this.running) await this.running
      if (!this.queue.length && !this.ready.length && !this.running) break
      // A halted loop never drains its queue: what is left stays where it is.
      if (this.halted && !this.running) break
      await new Promise((r) => setTimeout(r, pollMs))
    }
    await this.writes
  }

  /** Resolves once queued effects are taken in and the running job (if any) finished. */
  async settled(): Promise<void> {
    await this.intake
    if (this.running) await this.running
  }

  /** Resolves when every command applied so far is in the store. */
  flush(): Promise<void> {
    return this.writes
  }

  get queued(): number {
    return this.queue.length
  }

  get pendingDeploys(): string[] {
    return this.deploys.map((d) => d.workItem)
  }

  get pendingCommands(): number {
    return this.ready.length
  }

  // ------------------------------------------------------------ internals

  private holds(workItem: string, failed: boolean): boolean {
    return this.deploys.some((d) => d.workItem === workItem && !!d.failed === failed)
  }

  private holdDeploy(workItem: string) {
    if (this.landed.has(workItem) || this.holds(workItem, false)) return
    this.deploys.push({ workItem, source: 'orchestrator' })
    this.persistDeploys().catch((e) => this.fail(`pending deploys not persisted: ${String(e)}`))
  }

  private items(): PlanItem[] {
    return (JSON.parse(this.o.sim.plan_json()) as PlanView).items
  }

  private tryDeploys() {
    const keep: HeldDeploy[] = []
    let changed = false
    // An entry whose item closed (published, killed) can never apply: it is
    // dropped instead of being held, and re-validated every boundary, for
    // good. Checked once per applied command, so the plan is not parsed per step.
    const closed = this.seq !== this.deploysCheckedAt ? this.closedItems() : null
    if (closed) this.deploysCheckedAt = this.seq
    for (const d of this.deploys) {
      if (!d.failed && this.landed.has(d.workItem)) {
        changed = true
        continue
      }
      const cmd = JSON.stringify(d.failed ? { DeployFailed: { work_item: d.workItem } } : { DeployLanded: { work_item: d.workItem } })
      // The sim rejects a deploy event until the item is merged and waits for
      // its deploy (`scheduled`; `approved` until the publish phase ran):
      // hold the event until it is accepted.
      if (this.o.sim.validate_command_json(cmd) !== undefined) {
        if (closed?.has(d.workItem)) {
          changed = true
          this.log(`${d.failed ? 'DeployFailed' : 'DeployLanded'} ${d.workItem} dropped: the item is closed`)
          continue
        }
        keep.push(d)
        continue
      }
      const before = this.items().find((i) => i.id === d.workItem)?.status ?? 'scheduled'
      const r = this.apply(cmd)
      if (!r.ok) {
        keep.push(d)
        continue
      }
      changed = true
      if (d.failed && d.attempt != null) this.failures.add(failureKey(d.workItem, d.attempt))
      const sha = d.mergedSha ? ` (commit ${d.mergedSha.slice(0, 7)})` : ''
      const minute = this.o.sim.minute_of_day()
      const post = {
        type: 'status',
        author: 'system',
        text: d.failed ? `Blocked: the deploy failed${sha}.` : `Published: the deploy landed${sha}.`,
        from: before,
        toStatus: d.failed ? 'blocked' : 'published',
        day: this.o.sim.day(),
        minute,
        payload: { merged_sha: d.mergedSha ?? null, source: d.source ?? null },
      }
      this.write(() => this.o.store.appendPost(this.o.companyId, d.workItem, JSON.stringify(post)).then(() => this.o.onPlanText?.())).catch((e) =>
        this.fail(`status post not written: ${String(e)}`),
      )
      this.log(`${d.failed ? 'DeployFailed' : 'DeployLanded'} ${d.workItem} applied at step ${this.o.sim.step()}`)
      if (!d.failed) this.o.onLanded?.(d.workItem)
    }
    this.deploys = keep
    if (changed) this.persistDeploys().catch((e) => this.fail(`pending deploys not persisted: ${String(e)}`))
  }

  private closedItems(): Set<string> {
    return new Set(
      this.items()
        .filter((i) => i.status === 'published' || i.status === 'cancelled')
        .map((i) => i.id),
    )
  }

  private persistDeploys(): Promise<void> {
    const snapshot = JSON.stringify(this.deploys)
    return this.write(() => this.o.store.setKv(PENDING_DEPLOYS_KEY, snapshot))
  }

  /**
   * Store writes run one after another, in call order. The returned promise
   * rejects when this write failed (the caller decides what that means); the
   * chain itself carries on.
   */
  private write(fn: () => Promise<void>): Promise<void> {
    const done = this.writes.then(fn)
    this.writes = done.catch(() => undefined)
    return done
  }

  private fail(msg: string) {
    this.errors.push(msg)
    if (this.errors.length > KEEP_ERRORS) this.errors.splice(0, this.errors.length - KEEP_ERRORS)
    console.error(`[orchestration] ${msg}`)
    this.o.onError?.(msg)
  }

  /** The job is settled for the clock: its outcome was applied, or nothing will come for it. */
  private close(jobId: number) {
    this.open.delete(jobId)
    this.due.settle(jobId)
    this.speech.delete(jobId)
    // A meeting has one job (its standup): once that is settled no more turns come for the meeting.
    const meeting = this.where.get(jobId)?.meeting
    if (meeting) this.simSeq.delete(meeting)
    this.where.delete(jobId)
  }

  /** Keeps the last `keepJobs` finished jobs; jobs still in flight always stay. */
  private trim() {
    const keep = this.o.keepJobs ?? KEEP_JOBS
    for (let i = 0; this.jobs.length > keep && i < this.jobs.length; ) {
      const rec = this.jobs[i]
      if (this.open.has(rec.job_id) || rec.state === 'queued' || rec.state === 'running') i++
      else {
        this.jobs.splice(i, 1)
        this.byId.delete(rec.job_id)
      }
    }
  }

  private timeoutFor(kind: string): number {
    const t = this.o.jobTimeoutMs
    if (typeof t === 'number') return t
    return t?.[kind] ?? DEFAULT_JOB_TIMEOUT_MS[kind] ?? FALLBACK_JOB_TIMEOUT_MS
  }

  /**
   * `orchestrator.run` under the job's wall-clock limit, which stands still
   * while `paused()`. Past the limit the job is cancelled (P6): the run stops
   * at its next stage boundary and resolves with `JobFailed{Timeout}` (or
   * with its outcome, if it got there first). A run that does not stop
   * within the grace, or an orchestrator that cannot cancel, rejects with
   * `JobTimeout`; whatever it returns later is ignored.
   */
  private runWithLimit(rec: JobRecord, jobJson: string): Promise<string> {
    const run = this.o.orchestrator.run(jobJson)
    const limit = this.timeoutFor(rec.kind)
    if (!(limit > 0) || !Number.isFinite(limit)) return run
    return new Promise<string>((resolve, reject) => {
      let graceTimer: ReturnType<typeof setTimeout> | null = null
      const stopTimer = activeTimer(
        limit,
        () => {
          const cancel = this.o.orchestrator.cancel?.bind(this.o.orchestrator)
          if (!cancel) return reject(new JobTimeout(limit))
          this.log(`${rec.kind} job ${rec.job_id} ran past ${formatLimit(limit)}: cancelled`)
          cancel('timeout')
          graceTimer = setTimeout(() => reject(new JobTimeout(limit)), this.o.cancelGraceMs ?? 30_000)
        },
        this.o.paused,
      )
      const done = () => {
        stopTimer()
        if (graceTimer) clearTimeout(graceTimer)
      }
      run.then(
        (out) => {
          done()
          resolve(out)
        },
        (e) => {
          done()
          // Cancelled at the limit, a run that errs on its way out is still a timeout.
          reject(graceTimer ? new JobTimeout(limit) : e)
        },
      )
    })
  }

  /** Waits until the model is ready again (`paused()` false). */
  private async whilePaused(): Promise<void> {
    while (this.o.paused?.() && !this.halted) await new Promise((r) => setTimeout(r, this.o.pausePollMs ?? 500))
  }

  private pump() {
    if (this.running) return
    this.running = (async () => {
      while (this.queue.length && !this.halted) {
        // One job at a time, earliest due first (ADR-0060 decision 4); a running job is never preempted.
        const next = this.queue.reduce((best, q) => (runsBefore(q.rec, best.rec) ? q : best))
        const { json: jobJson, rec } = next
        rec.state = 'running'
        const retries = this.o.retries ?? 2
        const key = jobOutcomeKey(rec.job_id)
        for (let attempt = 0; ; attempt++) {
          try {
            // Outcomes of a run that finished before a reload, but were not logged yet, are reused.
            let out = await this.o.store.getKv(key)
            if (out) this.log(`${rec.kind} job ${rec.job_id}: reusing the stored outcome`)
            else {
              out = await this.runWithLimit(rec, rec.kind === 'standup' || rec.kind === 'board' ? await this.withContext(rec, jobJson) : jobJson)
              await this.o.store.setKv(key, out)
            }
            this.summarize(rec, out)
            const cmds = await this.o.codec.outcomesForSim(out)
            this.ready.push(...cmds)
            // A run without an outcome for its own job leaves nothing to wait for.
            if (!cmds.some((c) => settles(c).job === rec.job_id)) this.close(rec.job_id)
            rec.state = 'done'
            this.o.onPlanText?.()
            this.log(`${rec.kind} r${rec.revision} (job ${rec.job_id}) → ${out.slice(0, 200)}`)
            break
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            if (this.halted) {
              // Halted while the job ran (the lease is gone): it is not this
              // executor's job any more. No retry, and no failure is reported
              // to the sim; the next holder runs it.
              rec.state = 'queued'
              this.log(`${rec.kind} job ${rec.job_id} stopped (${msg}): ${this.halted}`)
              return
            }
            // A lost model is not the job's failure (P6): wait for it, then run the
            // same job again; it resumes from its stored stages. Not an attempt.
            if (isModelUnavailable(msg) && !(e instanceof JobTimeout)) {
              this.log(`${rec.kind} job ${rec.job_id}: ${msg}; waiting for the model`)
              await this.whilePaused()
              await new Promise((r) => setTimeout(r, this.o.retryMs ?? 2000))
              attempt--
              continue
            }
            // A job past its limit is not retried: it was cancelled (P6), and its run may still be going.
            if (attempt < retries && !(e instanceof JobTimeout)) {
              this.log(`${rec.kind} job ${rec.job_id} failed (${msg}); retrying`)
              await new Promise((r) => setTimeout(r, this.o.retryMs ?? 2000))
              continue
            }
            // Stubs fail loudly (CLAUDE.md rule 11): the sim is told the job
            // failed and why, so it blocks the item and raises the escalation
            // ticket. A failed standup is left to the sim, which ends the
            // meeting without briefs when its hour is over.
            rec.state = 'failed'
            rec.ok = false
            rec.error = msg
            this.fail(`${rec.kind} job ${rec.job_id} failed: ${msg}`)
            if (rec.kind !== 'standup') {
              const reason = e instanceof JobTimeout ? 'Timeout' : 'Infrastructure'
              this.ready.push(JSON.stringify({ JobFailed: { job_id: rec.job_id, reason } }))
            } else this.close(rec.job_id)
            break
          }
        }
        this.queue.splice(this.queue.indexOf(next), 1)
      }
    })().finally(() => {
      this.running = null
    })
  }

  /**
   * A meeting's request with its context: a standup's (ADR-0062) or a board's
   * (ADR-0069). A meeting's request has no u64 to lose in a parse.
   */
  private async withContext(rec: JobRecord, jobJson: string): Promise<string> {
    const project = this.where.get(rec.job_id)?.project ?? ''
    const job = { job_id: rec.job_id, project }
    const now = new Date(this.nowMs())
    const context =
      rec.kind === 'board'
        ? this.o.boardContext
          ? await this.o.boardContext(job)
          : boardContext(this.o.sim.plan_json(), project, { now })
        : this.o.standupContext
          ? await this.o.standupContext(job)
          : standupContext(this.o.sim.plan_json(), project, { now })
    return JSON.stringify({ ...(JSON.parse(jobJson) as Record<string, unknown>), context })
  }

  private summarize(rec: JobRecord, outcomesJson: string) {
    // Small fields only; u64 brief and workstream refs in MeetingOutcome and BoardOutcome are not read here.
    for (const o of JSON.parse(outcomesJson) as Record<string, { digest?: { ok: boolean; score: number }; reason?: string }>[]) {
      const d = o.JobCompleted?.digest
      if (d) {
        rec.ok = d.ok
        rec.score = d.score
      } else if (o.MeetingOutcome || o.BoardOutcome) rec.ok = true
      else if (o.JobFailed) {
        // ADR-0059: the sim blocks the item with the ticket the reason calls for (e.g. NeedsMedia).
        rec.ok = false
        rec.error = `failed: ${o.JobFailed.reason ?? 'unknown'}`
      }
    }
  }
}
