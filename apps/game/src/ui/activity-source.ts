/**
 * The Activity panel's data (FEAT-078, increment U4; ADR-0058 decisions 8 and
 * 9): the activity record from the company's store, read through the data
 * source a window of jobs at a time, grouped into jobs with their stages,
 * newest first, plus the job in flight from the orchestrator's progress
 * events. Nothing here reads the sim: the record is text-side data
 * (CLAUDE.md rule 2).
 *
 * - `groupActivity`: rows → jobs (job row joined with its stage attempts).
 * - `createActivityFeed`: the newest `ACTIVITY_PAGE` jobs, "load older" pages
 *   on demand (each read bounded by jobs, never the whole record), re-read when
 *   the source's `activityVersion()` moves. The version is compared on the
 *   source's own refresh (its change notifications, about once a second), so
 *   the feed never polls faster than the panels refresh.
 */
import { batch, computed, signal, type ReadonlySignal } from '@preact/signals'
import type { ActivityPage, ActivityQuery, ActivityRowJson, GameDataSource, LiveJob } from './data-source'

/** Jobs per read: the newest window, and each "load older" page. */
export const ACTIVITY_PAGE = 200

export interface ActivityStage {
  stage: string
  index: number
  /** From 1; a later attempt replaced the earlier ones (`repaired`). */
  attempt: number
  model: string | null
  tokensIn: number
  tokensOut: number
  wallMs: number
  /** `done`, `failed`, `repaired` or `reused`. */
  result: string
  /** What went wrong, as written (text, never markup). */
  error: string | null
}

/** What a job left behind in the site repository. */
export interface ActivityRefs {
  pr: number | null
  branch: string | null
  /** The draft branch's head after the job. */
  sha: string | null
  mergedSha: string | null
  path: string | null
}

export type JobResult = 'done' | 'failed' | 'running' | 'unfinished' | (string & {})

export interface ActivityJob {
  jobId: number
  kind: string
  revision: number
  workItem: string | null
  staff: string | null
  role: string | null
  persona: string | null
  /** The model of the job's calls (the job row's, else its latest stage's); null for a job without a model call. */
  model: string | null
  tokensIn: number
  tokensOut: number
  /** Wall time of the job: the job row's, the elapsed time while in flight, else the sum of its stages. */
  wallMs: number
  /** Unix ms; null when the source did not say when its rows were written. */
  startedAt: number | null
  finishedAt: number | null
  /** The game clock when the job ended (or its latest stage, while it has no job row). */
  gameStep: number | null
  day: number | null
  minute: number | null
  /** `running` while in flight; `unfinished` for stages without a job row and no progress (an interrupted run). */
  result: JobResult
  /** The halt or error of a failed job, or of its failed stage. */
  error: string | null
  score: number | null
  words: number | null
  refs: ActivityRefs
  stages: ActivityStage[]
  /** The progress of the job in flight; null once it ended. */
  live: LiveJob | null
}

type Obj = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' && v ? v : null)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** The error of a row's detail: `error`, else the halt reason. */
const errorOf = (d: Obj) => str(d.error) ?? str(d.halt) ?? null

function toStage(r: ActivityRowJson): ActivityStage {
  return {
    stage: r.stage,
    index: r.idx,
    attempt: r.attempt,
    model: r.model,
    tokensIn: r.tokens_in,
    tokensOut: r.tokens_out,
    wallMs: r.wall_ms,
    result: r.result,
    error: errorOf(r.detail ?? {}),
  }
}

function toJob(jobId: number, rows: ActivityRowJson[], live: LiveJob | null): ActivityJob {
  const jobRow = rows.find((r) => r.stage === 'job') ?? null
  const stageRows = rows.filter((r) => r.stage !== 'job')
  const last = stageRows[stageRows.length - 1] ?? null
  const head = jobRow ?? stageRows[0] ?? null
  const detail: Obj = jobRow?.detail ?? {}
  const commit = [...stageRows].reverse().find((r) => r.stage === 'commit')?.detail ?? {}
  const sum = (k: 'tokens_in' | 'tokens_out' | 'wall_ms') => stageRows.reduce((a, r) => a + r[k], 0)
  const model = jobRow?.model ?? [...stageRows].reverse().find((r) => r.model)?.model ?? live?.model ?? null
  const wallMs = jobRow?.wall_ms ?? live?.elapsedMs ?? sum('wall_ms')
  const finishedAt = jobRow?.created_at ?? null
  const firstAt = stageRows[0]?.created_at
  const startedAt = finishedAt != null ? finishedAt - wallMs : firstAt != null ? firstAt - stageRows[0].wall_ms : null
  const clock = jobRow ?? last
  const failedStage = stageRows.find((r) => r.result === 'failed')
  return {
    jobId,
    kind: head?.kind ?? live?.kind ?? 'job',
    revision: head?.revision ?? live?.revision ?? 0,
    workItem: head?.work_item ?? live?.workItem ?? null,
    staff: head?.staff ?? live?.staff ?? null,
    role: head?.role ?? live?.role ?? null,
    persona: head?.persona ?? live?.persona ?? null,
    model,
    tokensIn: jobRow?.tokens_in ?? sum('tokens_in'),
    tokensOut: jobRow?.tokens_out ?? sum('tokens_out'),
    wallMs,
    startedAt,
    finishedAt,
    gameStep: clock?.game_step ?? null,
    day: clock?.day ?? null,
    minute: clock?.minute ?? null,
    result: live ? 'running' : jobRow ? jobRow.result : 'unfinished',
    error: errorOf(detail) ?? (failedStage ? errorOf(failedStage.detail ?? {}) : null),
    score: num(detail.score),
    words: num(detail.words),
    refs: {
      pr: num(detail.pr) ?? num(commit.pr),
      branch: str(detail.branch) ?? str(commit.branch),
      sha: str(detail.sha) ?? str(commit.sha),
      mergedSha: str(detail.merged_sha),
      path: str(detail.path) ?? str(commit.path),
    },
    stages: stageRows.map(toStage),
    live,
  }
}

/**
 * Rows → jobs, newest first (job ids grow with every request the sim makes).
 * A job's stages keep the order their rows were written in; a job in flight
 * (`live`) is listed even before its first row.
 */
export function groupActivity(rows: readonly ActivityRowJson[], live: readonly LiveJob[] = []): ActivityJob[] {
  const byJob = new Map<number, ActivityRowJson[]>()
  for (const r of rows) {
    const list = byJob.get(r.job_id)
    if (list) list.push(r)
    else byJob.set(r.job_id, [r])
  }
  const running = new Map(live.map((j) => [j.jobId, j]))
  const ids = new Set([...byJob.keys(), ...running.keys()])
  return [...ids].sort((a, b) => b - a).map((id) => toJob(id, byJob.get(id) ?? [], running.get(id) ?? null))
}

/**
 * The bounded read of `CompanyStore.activityPage` over rows in memory (the
 * mock source, tests): the rows of the newest `limit` jobs older than
 * `before`, newest job first, each job's rows in their order.
 */
export function pageOf(rows: readonly ActivityRowJson[], q: ActivityQuery): ActivityPage {
  const ids = [...new Set(rows.map((r) => r.job_id))].filter((id) => q.before == null || id < q.before).sort((a, b) => b - a)
  const window = new Set(ids.slice(0, Math.max(1, q.limit)))
  const order = [...window]
  return {
    rows: order.flatMap((id) => rows.filter((r) => r.job_id === id)).map((r) => structuredClone(r)),
    more: ids.length > window.size,
  }
}

export interface ActivityFilter {
  staff: string | null
  workItem: string | null
  kind: string | null
}

export const NO_FILTER: ActivityFilter = Object.freeze({ staff: null, workItem: null, kind: null })

export function filterJobs(jobs: readonly ActivityJob[], f: ActivityFilter): ActivityJob[] {
  return jobs.filter((j) => (!f.staff || j.staff === f.staff) && (!f.workItem || j.workItem === f.workItem) && (!f.kind || j.kind === f.kind))
}

export interface ActivityFeed {
  /** Every loaded job, newest first, the job in flight included (`live` set). */
  jobs: ReadonlySignal<ActivityJob[]>
  /** Older jobs exist beyond the loaded ones. */
  more: ReadonlySignal<boolean>
  /** True until the first read is in. */
  loading: ReadonlySignal<boolean>
  /** Why the last read failed; null after a good one. */
  error: ReadonlySignal<string | null>
  /** Reads the next `pageSize` older jobs. */
  loadOlder(): Promise<void>
  /** Reads the newest window again now. */
  refresh(): Promise<void>
  dispose(): void
}

/**
 * The activity record of a source as the panel shows it. `live` is the
 * overlay store's jobs in flight (refreshed with the clock), so the feed
 * itself reads rows only: once at the start, when the version moves, and on
 * "load older".
 */
export function createActivityFeed(source: GameDataSource, live: ReadonlySignal<LiveJob[]>, opts: { pageSize?: number } = {}): ActivityFeed {
  const pageSize = Math.max(1, opts.pageSize ?? ACTIVITY_PAGE)
  /** Every loaded row, newest job first: the newest window, then what "load older" read. */
  const rows = signal<ActivityRowJson[]>([])
  const newestMore = signal(false)
  /** After the first "load older": whether still older jobs exist (null before it). */
  const olderMore = signal<boolean | null>(null)
  const loading = signal(true)
  const error = signal<string | null>(null)
  let seen: unknown = Symbol('unread')
  let disposed = false
  const lowest = (list: readonly ActivityRowJson[]) => list.reduce((a, r) => Math.min(a, r.job_id), Infinity)

  const fail = (e: unknown) => {
    if (!disposed) error.value = e instanceof Error ? e.message : String(e)
  }

  // One read of the newest window at a time; a change during a read schedules exactly one more.
  let inflight: Promise<void> | null = null
  let again = false
  const readNewest = (): Promise<void> => {
    if (inflight) {
      again = true
      return inflight
    }
    inflight = (async () => {
      do {
        again = false
        // Taken before the read: a row written meanwhile moves it again, and the next refresh reads once more.
        seen = source.activityVersion()
        try {
          const page = await source.getActivity({ limit: pageSize })
          if (disposed) return
          // The window replaces the jobs it covers. Once older pages were read, the jobs below it stay
          // (a new job pushes the window's oldest one down into them); before that only the window is kept.
          const floor = lowest(page.rows)
          const below = olderMore.peek() == null ? [] : rows.peek().filter((r) => r.job_id < floor)
          batch(() => {
            rows.value = [...page.rows, ...below]
            newestMore.value = page.more
            loading.value = false
            error.value = null
          })
        } catch (e) {
          if (disposed) return
          loading.value = false
          fail(e)
        }
      } while (again && !disposed)
    })().finally(() => (inflight = null))
    return inflight
  }

  const unsubscribe = source.subscribe(() => {
    if (!disposed && source.activityVersion() !== seen) void readNewest()
  })
  void readNewest()

  return {
    jobs: computed(() => groupActivity(rows.value, live.value)),
    more: computed(() => olderMore.value ?? newestMore.value),
    loading,
    error,
    async loadOlder() {
      const before = lowest(rows.peek())
      if (before === Infinity) return
      try {
        const page = await source.getActivity({ limit: pageSize, before })
        if (disposed) return
        const floor = lowest(rows.peek())
        batch(() => {
          rows.value = [...rows.peek(), ...page.rows.filter((r) => r.job_id < floor)]
          olderMore.value = page.more
        })
      } catch (e) {
        fail(e)
      }
    },
    refresh: readNewest,
    dispose() {
      disposed = true
      unsubscribe()
    },
  }
}
