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
 * to the sim as `JobCompleted{ok: false}` (the item is blocked and a ticket
 * raised), and a failed command-log write halts the loop.
 */
import { commandKind, settles, type ReplaySim } from '../catchup/replay'
import type { OrchestratorLike } from '../orchestrator/bridge'
import type { CommandRecord } from '../store/company-store'
import { commandBytes } from '../sync/segments'

export interface LoopSim extends ReplaySim {
  validate_command_json(json: string): string | undefined
  /** The skeleton: `items[].{id,status}` and the pending `jobs[].{id,kind,requestedMinute}`. */
  plan_json(project?: string | null): string
  pending_effects(): number
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
  log?: (line: string) => void
  /** Called after plan text in the store changed (a job's posts, the deploy status post). */
  onPlanText?: () => void
  /** Called after a `DeployLanded` was applied (the item is published). */
  onLanded?: (workItem: string) => void
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
 * The sim drops a standup whose outcome has not arrived 60 game minutes after
 * it opened (sim-core `STANDUP_TIMEOUT_MINUTES`). A model can take longer than
 * that in real time, so the clock is held once a standup job has been in
 * flight for this many game minutes.
 */
export const STANDUP_HOLD_MINUTES = 30

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

export class OrchestrationLoop {
  readonly jobs: JobRecord[] = []
  readonly errors: string[] = []
  /** Commands applied (and logged) by this loop since it started. */
  logged = 0
  /** Why the loop stopped (a command could not be written to the log); null while it runs. */
  halted: string | null = null
  /** The seq of the last command applied (the log is contiguous from 1). */
  private seq = 0
  private byId = new Map<number, JobRecord>()
  private completed = new Set<number>()
  private landed = new Set<string>()
  private queue: string[] = []
  /** Outcome commands waiting for the next step boundary. */
  private ready: string[] = []
  /** Work items whose deploy landed, waiting until the sim accepts DeployLanded. */
  private deploys: { workItem: string; mergedSha?: string; source?: string }[] = []
  private intake: Promise<void> = Promise.resolve()
  private writes: Promise<void> = Promise.resolve()
  private running: Promise<void> | null = null
  private log: (line: string) => void

  constructor(private o: LoopOptions) {
    this.log = o.log ?? (() => undefined)
  }

  /** Job ids and work items already settled in the replayed log, and the log's last seq. */
  seed(completed: Iterable<number>, landed: Iterable<string>, lastSeq = 0) {
    for (const j of completed) this.completed.add(j)
    for (const w of landed) this.landed.add(w)
    this.seq = lastSeq
  }

  /** The seq of the last command applied; read it in the same turn as the sim's step and hash for a checkpoint. */
  get lastSeq(): number {
    return this.seq
  }

  /**
   * True while the sim clock must not advance: the loop is halted, or a
   * standup job is still in flight close to the sim's meeting timeout.
   */
  get holdClock(): boolean {
    if (this.halted) return true
    const standups = this.jobs.filter((j) => j.kind === 'standup' && (j.state === 'queued' || j.state === 'running'))
    if (!standups.length) return false
    const pending = (JSON.parse(this.o.sim.plan_json()) as PlanView).jobs ?? []
    const now = this.o.sim.minute_of_day()
    return standups.some((s) => {
      const p = pending.find((j) => j.id === s.job_id)
      return !!p && (now - p.requestedMinute + 1440) % 1440 >= STANDUP_HOLD_MINUTES
    })
  }

  /** Restores DeployLanded events that arrived before a reload but were not applied yet. */
  async loadPendingDeploys(): Promise<void> {
    const raw = await this.o.store.getKv(PENDING_DEPLOYS_KEY)
    if (!raw) return
    for (const d of JSON.parse(raw) as OrchestrationLoop['deploys']) {
      if (!this.deploys.some((x) => x.workItem === d.workItem)) this.deploys.push(d)
    }
  }

  /**
   * Queues the jobs of a drained effects array (`[]` is a no-op).
   * `pendingOnly` (effects re-emitted by a replay): only jobs the sim still
   * waits for are queued, so a standup that timed out or a job whose item was
   * cancelled before the reload is not run again.
   */
  enqueueEffects(effectsJson: string, opts: { pendingOnly?: boolean } = {}): Promise<void> {
    if (effectsJson === '[]') return this.intake
    const pending = opts.pendingOnly ? new Set(((JSON.parse(this.o.sim.plan_json()) as PlanView).jobs ?? []).map((j) => j.id)) : null
    this.intake = this.intake.then(async () => {
      for (const jobJson of await this.o.codec.jobsFromEffects(effectsJson, this.o.companyId)) {
        const j = JSON.parse(jobJson) as { job_id: number; kind: string; revision: number; work_item: string | null }
        if (this.completed.has(j.job_id) || this.byId.has(j.job_id)) continue
        if (pending && !pending.has(j.job_id)) continue
        const rec: JobRecord = { job_id: j.job_id, kind: j.kind, revision: j.revision, work_item: j.work_item, state: 'queued' }
        this.byId.set(j.job_id, rec)
        this.jobs.push(rec)
        this.queue.push(jobJson)
      }
      this.pump()
    })
    this.intake = this.intake.catch((e) => this.fail(`effects: ${String(e)}`))
    return this.intake
  }

  /** After the sim advanced: drain its effects into the job queue. */
  afterAdvance() {
    if (this.o.sim.pending_effects() > 0) void this.enqueueEffects(this.o.sim.drain_effects_json())
  }

  /**
   * At a step boundary (between `advance` calls): apply the outcomes that came
   * back, then any held DeployLanded the sim now accepts.
   */
  boundary() {
    if (this.halted) return
    while (this.ready.length) {
      const cmd = this.ready.shift()!
      if (commandKind(cmd) === 'DeployLanded') {
        this.holdDeploy(JSON.parse(cmd).DeployLanded.work_item as string)
        continue
      }
      const r = this.apply(cmd)
      if (!r.ok) this.fail(`outcome rejected by the sim: ${r.reason} (${cmd.slice(0, 120)})`)
    }
    if (this.deploys.length) this.tryDeploys()
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
    if (s.job != null) this.completed.add(s.job)
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
    if (this.landed.has(workItem) || this.deploys.some((d) => d.workItem === workItem)) return
    this.deploys.push({ workItem, ...info })
    await this.persistDeploys()
  }

  /** Resolves once queued effects are taken in, every job ran, its outcomes were applied and the log is written. */
  async idle(pollMs = 50): Promise<void> {
    for (;;) {
      await this.intake
      if (this.running) await this.running
      if (!this.queue.length && !this.ready.length && !this.running) break
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

  private holdDeploy(workItem: string) {
    if (this.landed.has(workItem) || this.deploys.some((d) => d.workItem === workItem)) return
    this.deploys.push({ workItem, source: 'orchestrator' })
    this.persistDeploys().catch((e) => this.fail(`pending deploys not persisted: ${String(e)}`))
  }

  private items(): PlanItem[] {
    return (JSON.parse(this.o.sim.plan_json()) as PlanView).items
  }

  private tryDeploys() {
    const keep: OrchestrationLoop['deploys'] = []
    let changed = false
    for (const d of this.deploys) {
      if (this.landed.has(d.workItem)) {
        changed = true
        continue
      }
      const cmd = JSON.stringify({ DeployLanded: { work_item: d.workItem } })
      // The sim rejects DeployLanded until its publish phase ran (the item is
      // `approved` until then): hold the event until it is accepted.
      if (this.o.sim.validate_command_json(cmd) !== undefined) {
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
      const sha = d.mergedSha ? ` (commit ${d.mergedSha.slice(0, 7)})` : ''
      const minute = this.o.sim.minute_of_day()
      const post = {
        type: 'status',
        author: 'system',
        text: `Published: the deploy landed${sha}.`,
        from: before,
        toStatus: 'published',
        day: this.o.sim.day(),
        minute,
        payload: { merged_sha: d.mergedSha ?? null, source: d.source ?? null },
      }
      this.write(() => this.o.store.appendPost(this.o.companyId, d.workItem, JSON.stringify(post)).then(() => this.o.onPlanText?.())).catch((e) =>
        this.fail(`status post not written: ${String(e)}`),
      )
      this.log(`DeployLanded ${d.workItem} applied at step ${this.o.sim.step()}`)
      this.o.onLanded?.(d.workItem)
    }
    this.deploys = keep
    if (changed) this.persistDeploys().catch((e) => this.fail(`pending deploys not persisted: ${String(e)}`))
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
    console.error(`[orchestration] ${msg}`)
  }

  private pump() {
    if (this.running) return
    this.running = (async () => {
      while (this.queue.length) {
        const jobJson = this.queue[0]
        const rec = this.byId.get((JSON.parse(jobJson) as { job_id: number }).job_id)!
        rec.state = 'running'
        const retries = this.o.retries ?? 2
        const key = jobOutcomeKey(rec.job_id)
        for (let attempt = 0; ; attempt++) {
          try {
            // Outcomes of a run that finished before a reload, but were not logged yet, are reused.
            let out = await this.o.store.getKv(key)
            if (out) this.log(`${rec.kind} job ${rec.job_id}: reusing the stored outcome`)
            else {
              out = await this.o.orchestrator.run(jobJson)
              await this.o.store.setKv(key, out)
            }
            this.summarize(rec, out)
            this.ready.push(...(await this.o.codec.outcomesForSim(out)))
            rec.state = 'done'
            this.o.onPlanText?.()
            this.log(`${rec.kind} r${rec.revision} (job ${rec.job_id}) → ${out.slice(0, 200)}`)
            break
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            if (attempt < retries) {
              this.log(`${rec.kind} job ${rec.job_id} failed (${msg}); retrying`)
              await new Promise((r) => setTimeout(r, this.o.retryMs ?? 2000))
              continue
            }
            // Stubs fail loudly (CLAUDE.md rule 11): the sim is told the job
            // failed, so it blocks the item and raises the escalation ticket.
            // A standup has no failure command; the sim ends the meeting
            // without briefs when its hour is over.
            rec.state = 'failed'
            rec.ok = false
            rec.error = msg
            this.fail(`${rec.kind} job ${rec.job_id} failed: ${msg}`)
            if (rec.kind !== 'standup') {
              this.ready.push(
                JSON.stringify({ JobCompleted: { job_id: rec.job_id, digest: { ok: false, score: 0, words: 0, qa_defects: 0, artifact_sha: null } } }),
              )
            }
            break
          }
        }
        this.queue.shift()
      }
    })().finally(() => {
      this.running = null
    })
  }

  private summarize(rec: JobRecord, outcomesJson: string) {
    // Small fields only; u64 brief refs in MeetingOutcome are not read here.
    for (const o of JSON.parse(outcomesJson) as Record<string, { digest?: { ok: boolean; score: number } }>[]) {
      const d = o.JobCompleted?.digest
      if (d) {
        rec.ok = d.ok
        rec.score = d.score
      } else if (o.MeetingOutcome) rec.ok = true
    }
  }
}
