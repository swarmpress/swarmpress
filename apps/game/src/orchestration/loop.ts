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
 * queued again, and the orchestrator itself is idempotent per job.
 */
import { commandKind, settles, type ReplaySim } from '../catchup/replay'
import type { OrchestratorLike } from '../orchestrator/bridge'
import type { CommandRecord } from '../store/company-store'
import { commandBytes } from '../sync/segments'

export interface LoopSim extends ReplaySim {
  validate_command_json(json: string): string | undefined
  plan_json(project?: string | null): string
  pending_effects(): number
}

export interface LoopStore {
  appendCommands(cmds: CommandRecord[]): Promise<number[]>
  appendPost(company: string, item: string, postJson: string): Promise<string>
  getKv(key: string): Promise<string | null>
  setKv(key: string, value: string): Promise<void>
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
}

export interface ApplyResult {
  ok: boolean
  reason?: string
}

/** kv key holding work items whose DeployLanded arrived but is not applied yet. */
export const PENDING_DEPLOYS_KEY = 'deploys.pending'

interface PlanItem {
  id: string
  status: string
}

export class OrchestrationLoop {
  readonly jobs: JobRecord[] = []
  readonly errors: string[] = []
  /** Commands applied (and logged) by this loop since it started. */
  logged = 0
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

  /** Job ids and work items already settled in the replayed log. */
  seed(completed: Iterable<number>, landed: Iterable<string>) {
    for (const j of completed) this.completed.add(j)
    for (const w of landed) this.landed.add(w)
  }

  /** Restores DeployLanded events that arrived before a reload but were not applied yet. */
  async loadPendingDeploys(): Promise<void> {
    const raw = await this.o.store.getKv(PENDING_DEPLOYS_KEY)
    if (!raw) return
    for (const d of JSON.parse(raw) as OrchestrationLoop['deploys']) {
      if (!this.deploys.some((x) => x.workItem === d.workItem)) this.deploys.push(d)
    }
  }

  /** Queues the jobs of a drained effects array (`[]` is a no-op). */
  enqueueEffects(effectsJson: string): Promise<void> {
    if (effectsJson === '[]') return this.intake
    this.intake = this.intake.then(async () => {
      for (const jobJson of await this.o.codec.jobsFromEffects(effectsJson, this.o.companyId)) {
        const j = JSON.parse(jobJson) as { job_id: number; kind: string; revision: number; work_item: string | null }
        if (this.completed.has(j.job_id) || this.byId.has(j.job_id)) continue
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
    try {
      this.o.sim.apply_command_json(json)
    } catch (e) {
      return { ok: false, reason: typeof e === 'string' ? e : (e as Error).message }
    }
    const rec: CommandRecord = { step: Number(this.o.sim.step()), kind: commandKind(json), payload: commandBytes(json) }
    const s = settles(json)
    if (s.job != null) this.completed.add(s.job)
    if (s.landed) this.landed.add(s.landed)
    this.logged++
    this.write(() => this.o.store.appendCommands([rec]).then(() => undefined))
    // A logged command may request new jobs at once (e.g. MeetingOutcome → Draft).
    this.afterAdvance()
    return { ok: true }
  }

  /** A DeployLanded event from the central server (EventStream handler): persisted, applied when the sim accepts it. */
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
    void this.persistDeploys()
  }

  private items(): PlanItem[] {
    return (JSON.parse(this.o.sim.plan_json()) as { items: PlanItem[] }).items
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
      this.write(() => this.o.store.appendPost(this.o.companyId, d.workItem, JSON.stringify(post)).then(() => undefined))
      this.log(`DeployLanded ${d.workItem} applied at step ${this.o.sim.step()}`)
    }
    this.deploys = keep
    if (changed) void this.persistDeploys()
  }

  private persistDeploys(): Promise<void> {
    const snapshot = JSON.stringify(this.deploys)
    this.write(() => this.o.store.setKv(PENDING_DEPLOYS_KEY, snapshot))
    return this.writes
  }

  private write(fn: () => Promise<void>) {
    this.writes = this.writes.then(fn).catch((e) => this.fail(`store write failed: ${String(e)}`))
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
        for (let attempt = 0; ; attempt++) {
          try {
            const out = await this.o.orchestrator.run(jobJson)
            this.summarize(rec, out)
            this.ready.push(...(await this.o.codec.outcomesForSim(out)))
            rec.state = 'done'
            this.log(`${rec.kind} r${rec.revision} (job ${rec.job_id}) → ${out.slice(0, 200)}`)
            break
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            if (attempt < retries) {
              this.log(`${rec.kind} job ${rec.job_id} failed (${msg}); retrying`)
              await new Promise((r) => setTimeout(r, this.o.retryMs ?? 2000))
              continue
            }
            // Stubs fail loudly (CLAUDE.md rule 11): the job stays unsettled in
            // the sim, which keeps the item where it is; a reload re-runs it.
            rec.state = 'failed'
            rec.error = msg
            this.fail(`${rec.kind} job ${rec.job_id} failed: ${msg}`)
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
