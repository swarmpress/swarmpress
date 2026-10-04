/**
 * The lean activity record (ADR-0058 decision 9, FEAT-078,
 * `docs/design/mvp-pipeline.md` §8): who did what, with which model, in how
 * long, written by the host from the orchestrator's progress events
 * (`OrchestratorHandle.setProgress`) and the LLM bridge's per-call usage
 * (`localLlmBridge`'s `onCall`).
 *
 * Jobs run one at a time, so the calls between a stage's `started` and its
 * `done` (or `failed`) belong to that stage: each call is one attempt row
 * (the first, then a repair turn, …); a stage without a model call (context,
 * commit) or one taken from the stage store is one row. The job row
 * (`stage: 'job'`) sums its stages and carries the pull request, branch and
 * sha. Rows are keyed (job, stage, index, attempt): a re-run job replaces its
 * job row and never overwrites the attempt that produced a reused stage, so a
 * reload adds no rows. The shape is what an ADR-0056 work record absorbs: the
 * job row plus its commands plus its job-keyed text.
 *
 * It also knows what each job is doing right now, for the HUD chip
 * ("Giulia · draft · section 3 of 5", counts only), and the jobs in flight
 * with their elapsed time (`live`) for the Activity panel and the HUD's
 * "Now" strip (U4).
 */
import type { LlmCallRecord, ProgressEvent } from '../orchestrator/bridge'
import type { ActivityRow } from '../store/company-store'

export interface ActivitySink {
  putActivity(company: string, row: ActivityRow, mode?: 'replace' | 'keep'): Promise<void>
}

export interface ActivityClock {
  step: number
  day: number
  minute: number
}

export interface ActivityRecorderOptions {
  store: ActivitySink
  companyId: string
  /** The game clock when a row is written (null fields without one). */
  clock?: () => ActivityClock
  /** Wall time, ms (performance.now by default). */
  now?: () => number
  log?: (line: string) => void
}

interface Attempt {
  rec: LlmCallRecord
}

interface OpenStage {
  ev: ProgressEvent
  started: number
  calls: Attempt[]
}

interface OpenJob {
  ev: ProgressEvent
  started: number
  tokensIn: number
  tokensOut: number
  model: string | null
}

/**
 * A job in flight as the Activity panel pins it and the HUD's "Now" strip
 * shows it (U4): who, what, the stage running now in counts ("section 3 of
 * 5") and the wall time since the job started.
 */
export interface LiveJobInfo {
  jobId: number
  kind: string
  revision: number
  workItem: string | null
  staff: string | null
  persona: string | null
  role: string | null
  /** The latest stage event's stage; null before the first stage. */
  stage: string | null
  index: number
  total: number
  /** `progressLabel` of that stage ("section 3 of 5"); null before the first stage. */
  label: string | null
  /** The model of the job's latest call, once it made one. */
  model: string | null
  elapsedMs: number
}

/** What a stage is, in the chip's words; null for the job itself. */
export function progressLabel(ev: Pick<ProgressEvent, 'stage' | 'index' | 'total'>): string | null {
  const part = (i: number) => (i === 0 ? 'the intro' : i > ev.total ? 'the closing note' : `section ${i}`)
  switch (ev.stage) {
    case 'job':
      return null
    case 'context':
      return 'gathering context'
    case 'outline':
      return 'outline'
    case 'section':
      return ev.index === 0 ? 'intro' : `section ${ev.index} of ${ev.total}`
    case 'closing':
      return 'closing note'
    case 'fix':
      return `fixing ${part(ev.index)}`
    case 'retitle':
      return 'new title'
    case 'revise':
      return ev.index === 0 || ev.index > ev.total ? `revising ${part(ev.index)}` : `revising section ${ev.index} of ${ev.total}`
    case 'review':
      return 'reading the draft'
    case 'review_section':
      return ev.index === 0 || ev.index > ev.total ? `reading ${part(ev.index)}` : `reading section ${ev.index} of ${ev.total}`
    case 'review_summary':
      return 'summing up'
    case 'commit':
      return 'committing'
    default:
      return ev.stage
  }
}

/**
 * What the HUD chip says the clock waits for: "Giulia · draft · section 3 of 5"
 * while a stage of the job runs, "Giulia · draft" otherwise.
 */
export function heldByText(job: { who: string | null; kind: string; state: string }, stage: string | null): string {
  const who = job.who ? `${job.who} · ` : ''
  return `${who}${job.kind}${stage && job.state === 'running' ? ` · ${stage}` : ''}`
}

export class ActivityRecorder {
  private stage: OpenStage | null = null
  private jobs = new Map<number, OpenJob>()
  /** The latest stage event of each job in flight. */
  private latest = new Map<number, ProgressEvent>()
  private writes: Promise<void> = Promise.resolve()
  private now: () => number
  /** Rows written by this recorder (diagnostics and tests). */
  written = 0
  readonly errors: string[] = []

  constructor(private o: ActivityRecorderOptions) {
    this.now = o.now ?? (() => performance.now())
  }

  /** A progress event of the orchestrator. */
  progress(ev: ProgressEvent): void {
    if (ev.stage === 'job') return this.jobEvent(ev)
    switch (ev.state) {
      case 'started':
        this.latest.set(ev.job_id, ev)
        this.stage = { ev, started: this.now(), calls: [] }
        return
      case 'reused':
        this.latest.set(ev.job_id, ev)
        this.write(this.row(ev, 1, null, 0, 0, 0, 'reused', ev.detail ?? {}), 'keep')
        return
      case 'done':
      case 'failed':
        return this.closeStage(ev)
    }
  }

  /** One LLM call of the bridge: an attempt of the open stage (or of the job, outside a stage). */
  call(rec: LlmCallRecord): void {
    if (this.stage) this.stage.calls.push({ rec })
    for (const job of this.jobs.values()) {
      job.tokensIn += rec.promptTokens
      job.tokensOut += rec.completionTokens + rec.reasoningTokens
      job.model = rec.model ?? job.model
    }
  }

  /** What a job is doing ("section 3 of 5"), while it runs; null otherwise. */
  label(jobId: number): string | null {
    const ev = this.latest.get(jobId)
    return ev ? progressLabel(ev) : null
  }

  /** The latest stage event of a job in flight (or of any job in flight). */
  current(jobId?: number): ProgressEvent | null {
    if (jobId != null) return this.latest.get(jobId) ?? null
    const all = [...this.latest.values()]
    return all[all.length - 1] ?? null
  }

  /** The jobs in flight (started, not yet done or failed), oldest first, with their stage now. */
  live(): LiveJobInfo[] {
    const at = this.now()
    return [...this.jobs.values()].map(({ ev, started, model }) => {
      const stage = this.latest.get(ev.job_id) ?? null
      return {
        jobId: ev.job_id,
        kind: ev.kind,
        revision: ev.revision,
        workItem: ev.work_item,
        staff: ev.staff,
        persona: ev.persona,
        role: ev.role,
        stage: stage?.stage ?? null,
        index: stage?.index ?? 0,
        total: stage?.total ?? 0,
        label: stage ? progressLabel(stage) : null,
        model,
        elapsedMs: Math.max(0, Math.round(at - started)),
      }
    })
  }

  /** Resolves when every row so far is written. */
  flush(): Promise<void> {
    return this.writes
  }

  // ------------------------------------------------------------ internals

  private jobEvent(ev: ProgressEvent) {
    if (ev.state === 'started') {
      this.jobs.set(ev.job_id, { ev, started: this.now(), tokensIn: 0, tokensOut: 0, model: null })
      this.latest.delete(ev.job_id)
      return
    }
    const job = this.jobs.get(ev.job_id)
    this.jobs.delete(ev.job_id)
    this.latest.delete(ev.job_id)
    if (this.stage?.ev.job_id === ev.job_id) this.stage = null
    const wall = job ? this.now() - job.started : 0
    this.write(this.row(ev, 1, job?.model ?? null, job?.tokensIn ?? 0, job?.tokensOut ?? 0, wall, ev.state, ev.detail ?? {}), 'replace')
  }

  private closeStage(ev: ProgressEvent) {
    const open = this.stage && this.stage.ev.job_id === ev.job_id && this.stage.ev.stage === ev.stage && this.stage.ev.index === ev.index ? this.stage : null
    this.stage = null
    const result = ev.state
    if (!open || open.calls.length === 0) {
      const wall = open ? this.now() - open.started : 0
      this.write(this.row(ev, 1, null, 0, 0, wall, result, ev.detail ?? {}), 'replace')
      return
    }
    // One row per call: earlier ones were repaired, the last one carries the stage's result.
    open.calls.forEach((a, i) => {
      const last = i === open.calls.length - 1
      const detail = last ? { ...(ev.detail ?? {}), turns: a.rec.turns } : { turns: a.rec.turns, ok: a.rec.ok }
      this.write(this.row(ev, i + 1, a.rec.model, a.rec.promptTokens, a.rec.completionTokens + a.rec.reasoningTokens, a.rec.wallMs, last ? result : 'repaired', detail), 'replace')
    })
  }

  private row(
    ev: ProgressEvent,
    attempt: number,
    model: string | null,
    tokensIn: number,
    tokensOut: number,
    wallMs: number,
    result: string,
    detail: Record<string, unknown>,
  ): ActivityRow {
    const clock = this.o.clock?.()
    return {
      job_id: ev.job_id,
      stage: ev.stage,
      idx: ev.index,
      attempt,
      kind: ev.kind,
      revision: ev.revision,
      work_item: ev.work_item,
      staff: ev.staff,
      role: ev.role,
      persona: ev.persona,
      model,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      wall_ms: Math.max(0, Math.round(wallMs)),
      game_step: clock?.step ?? null,
      day: clock?.day ?? null,
      minute: clock?.minute ?? null,
      result,
      detail,
    }
  }

  private write(row: ActivityRow, mode: 'replace' | 'keep') {
    this.writes = this.writes
      .then(() => this.o.store.putActivity(this.o.companyId, row, mode))
      .then(() => {
        this.written++
      })
      .catch((e) => {
        const msg = `activity row not written (job ${row.job_id} ${row.stage}#${row.idx}): ${String(e)}`
        this.errors.push(msg)
        if (this.errors.length > 50) this.errors.splice(0, this.errors.length - 50)
        this.o.log?.(msg)
      })
  }
}
