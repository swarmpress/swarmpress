/**
 * The eval run (FEAT-036; docs/design/mvp-pipeline.md §9): briefs through the
 * real staged pipeline, the editor on the site's own articles and on
 * seeded-bad drafts, with every stage metered.
 *
 * - **Briefs:** draft (revision 0) → review → while the score is under the
 *   bar and fewer than 3 revisions were made: revision → review. These are
 *   the sim's rules (ADR-0011: the editor approves at 7 or above, at most 3
 *   revisions, then Blocked); the harness plays the sim's side, as
 *   `runMvpLoop` does. A review that is not ok (reject, high risk) blocks.
 * - **Positive controls:** each existing article, read into parts by
 *   `orchestrator::eval::reference_article`, gets one Review job.
 * - **Seeded-bad:** six faults (`SEED_KINDS`), each on a reference in turn,
 *   one Review job each. The editor and the deterministic checks must reject
 *   them.
 *
 * Only orchestrator-wasm's public API is used: `OrchestratorHandle.run`, its
 * progress events and `evalOp`. No sim, no gateway writes.
 */
import type { LlmCallRecord, Outcome, ProgressEvent, StaffRef } from '../../orchestrator/bridge'
import { MVP_TEAM } from '../../llm/mvp-script'
import { articleEntries, type Brief, type EvalSite } from './briefs'
import type { LocalGateway, MemoryOrchestratorStore } from './local'

export const SEED_KINDS = ['block-order', 'banned-phrase', 'unknown-entity', 'too-short', 'raw-html', 'duplicate-slug'] as const
export type SeedKind = (typeof SEED_KINDS)[number]

export const COMPANY = 'eval'
export const QUALITY_BAR = 7
export const MAX_REVISIONS = 3

/** `orchestrator::eval::EvalChecks`. */
export interface EvalChecks {
  words: number
  target_words: number
  words_percent: number
  words_ok: boolean
  banned_phrases: string[]
  near_duplicates: number
  headings: number
  headings_ok: boolean
  title_chars: number
  description_chars: number
  title_ok: boolean
  description_ok: boolean
  plain_text_findings: string[]
  link_media_issues: string[]
  site_issues: string[]
  gateway_issues: string[]
  measured: string[]
}

/** `orchestrator::eval::EvalArticle` (records cross as JSON; brief refs stay below 2^53). */
export interface EvalArticle {
  brief: Brief
  record: ArtifactJson
  source: string
  notes: string[]
}

/** `orchestrator::ArtifactRecord`, the parts the harness reads. */
export interface ArtifactJson {
  brief_ref: number
  page?: unknown
  revision?: number
  path?: string | null
  parts?: unknown
  sectioned_review?: { decision: string; score: number; notes: string; issues: { section: string; problem: string; fix: string }[]; high_risk: string[] } | null
  [k: string]: unknown
}

/** What the harness needs of an `OrchestratorHandle`. */
export interface EvalOrchestrator {
  run(jobJson: string): Promise<string>
  evalOp(op: string, argsJson: string): string
}

/** One stage of one job, metered. */
export interface StageRecord {
  jobId: number
  jobKind: string
  revision: number
  workItem: string | null
  stage: string
  index: number
  state: 'done' | 'failed' | 'reused' | 'open'
  /** `complete()` calls through the bridge (1 + the orchestrator's repair turns, + halves of a cut section). */
  calls: number
  /** Model turns, the adapter's own repair turns included. */
  turns: number
  truncated: number
  wallMs: number
  promptTokens: number
  completionTokens: number
  reasoningTokens: number
  error: string | null
}

export interface ReviewRecord {
  revision: number
  score: number
  ok: boolean
  verdict: 'approve' | 'changes' | 'reject'
  notes: string
  issues: { section: string; problem: string; fix: string }[]
  highRisk: string[]
}

export interface DraftRecord {
  revision: number
  ok: boolean
  /** `JobFailed` reason, `invalid` for a not-ok digest, `error: …` for an infrastructure failure. */
  failure: string | null
  /** Committed through the gateway (a pull request was opened). */
  committed: boolean
  gatewayIssues: string[]
  pathTaken: boolean
}

export type ArticleKind = 'brief' | 'control' | 'seeded'

export interface ArticleResult {
  kind: ArticleKind
  id: string
  source: string
  seedKind: SeedKind | null
  brief: Brief
  /** approved / blocked (score, cap, reject) / failed (a draft or review could not finish) / reviewed (controls, seeded). */
  outcome: 'approved' | 'blocked' | 'failed' | 'reviewed'
  reason: string | null
  drafts: DraftRecord[]
  reviews: ReviewRecord[]
  checks: EvalChecks | null
  page: unknown
  wallMs: number
  jobs: { jobId: number; kind: string; revision: number; wallMs: number }[]
  notes: string[]
}

export interface EvalConfig {
  backend: string
  modelId: string | null
  n: number
  bar: number
  maxRevisions: number
  /** Per job; a job that took longer counts against threshold 7. */
  jobTimeoutMs: number
  controls: boolean
  seeded: boolean
}

export interface EvalResults {
  schema: 'swarmpress.eval.v1'
  config: EvalConfig
  site: { commit: string; articles: number; topicsAvailable: number; published: string[] }
  startedAt: string
  finishedAt: string | null
  articles: ArticleResult[]
  stages: StageRecord[]
  errors: string[]
}

export interface EvalProgress {
  phase: 'briefs' | 'controls' | 'seeded' | 'done'
  done: number
  total: number
  current: string
  stage: string
}

// ---------------------------------------------------------------- the meter

/**
 * Attributes model calls to stages. Jobs run one at a time and a stage's
 * calls happen between its `started` and its `done`/`failed` event, so every
 * call belongs to the stage open when it was made (else to its job).
 */
export class Meter {
  readonly stages: StageRecord[] = []
  private open: { rec: StageRecord; t0: number } | null = null
  private job: { id: number; kind: string; revision: number; workItem: string | null } | null = null
  private now: () => number

  constructor(now: () => number = () => performance.now()) {
    this.now = now
  }

  beginJob(id: number, kind: string, revision: number, workItem: string | null): void {
    this.job = { id, kind, revision, workItem }
    this.open = null
  }

  endJob(): void {
    if (this.open) this.close('failed', 'the job ended inside the stage')
    this.job = null
  }

  private fresh(ev: { job_id: number; kind: string; revision: number; work_item: string | null; stage: string; index: number }): StageRecord {
    return {
      jobId: ev.job_id,
      jobKind: ev.kind,
      revision: ev.revision,
      workItem: ev.work_item,
      stage: ev.stage,
      index: ev.index,
      state: 'open',
      calls: 0,
      turns: 0,
      truncated: 0,
      wallMs: 0,
      promptTokens: 0,
      completionTokens: 0,
      reasoningTokens: 0,
      error: null,
    }
  }

  private close(state: StageRecord['state'], error: string | null): void {
    if (!this.open) return
    this.open.rec.state = state
    this.open.rec.wallMs = Math.round(this.now() - this.open.t0)
    this.open.rec.error = error
    this.open = null
  }

  progress(ev: ProgressEvent): void {
    if (ev.stage === 'job') return
    const same = this.open && this.open.rec.stage === ev.stage && this.open.rec.index === ev.index && this.open.rec.jobId === ev.job_id
    if (ev.state === 'started') {
      if (this.open) this.close('failed', 'another stage started')
      const rec = this.fresh(ev)
      this.stages.push(rec)
      this.open = { rec, t0: this.now() }
    } else if (ev.state === 'reused') {
      const rec = this.fresh(ev)
      rec.state = 'reused'
      this.stages.push(rec)
    } else if (same) {
      const d = ev.detail as Record<string, unknown> | null
      this.close(ev.state === 'done' ? 'done' : 'failed', ev.state === 'failed' ? String(d?.error ?? (Array.isArray(d?.errors) ? (d.errors as unknown[]).join('; ') : 'failed')) : null)
    } else if (ev.state === 'done' || ev.state === 'failed') {
      // A stage without a model call (context#0 reused path) reports done only.
      const rec = this.fresh(ev)
      rec.state = ev.state
      this.stages.push(rec)
    }
  }

  call(rec: LlmCallRecord, truncated: boolean): void {
    let target = this.open?.rec
    if (!target) {
      const j = this.job
      if (!j) return
      target = this.fresh({ job_id: j.id, kind: j.kind, revision: j.revision, work_item: j.workItem, stage: 'job', index: 0 })
      target.state = 'done'
      this.stages.push(target)
    }
    target.calls += 1
    target.turns += rec.turns
    target.truncated += truncated ? 1 : 0
    target.promptTokens += rec.promptTokens
    target.completionTokens += rec.completionTokens
    target.reasoningTokens += rec.reasoningTokens
    if (!this.open) target.wallMs += rec.wallMs
  }
}

/** Whether a bridged answer was cut at its token limit. */
export function truncatedAnswer(answer: string): boolean {
  try {
    const v = JSON.parse(answer) as { truncated?: boolean; error?: Record<string, unknown> }
    return v.truncated === true || (typeof v.error === 'object' && v.error !== null && 'Truncated' in v.error)
  } catch {
    return false
  }
}

// ---------------------------------------------------------------- the run

export interface EvalDeps {
  orch: EvalOrchestrator
  store: MemoryOrchestratorStore
  gateway: LocalGateway
  meter: Meter
  site: EvalSite
  briefs: Brief[]
  topicsAvailable: number
  published: string[]
  config: EvalConfig
  staff?: StaffRef[]
  onProgress?: (p: EvalProgress) => void
  now?: () => number
}

type JobKind = 'draft' | 'review'

function digestOf(out: Outcome[]): { ok: boolean; score: number; failure: string | null } {
  const o = out[0]
  if (o && 'JobCompleted' in o) return { ok: o.JobCompleted.digest.ok, score: o.JobCompleted.digest.score, failure: o.JobCompleted.digest.ok ? null : 'invalid' }
  if (o && 'JobFailed' in o) return { ok: false, score: 0, failure: o.JobFailed.reason }
  return { ok: false, score: 0, failure: `unexpected outcome ${JSON.stringify(out)}` }
}

/** Runs the whole eval. Resolves with the results; a job's infrastructure error is recorded, not thrown. */
export async function runEval(d: EvalDeps): Promise<EvalResults> {
  const now = d.now ?? (() => performance.now())
  const staff = d.staff ?? MVP_TEAM
  const writer = staff.find((s) => s.role === 'writer')!
  const editor = staff.find((s) => s.role === 'editor') ?? staff[0]
  const results: EvalResults = {
    schema: 'swarmpress.eval.v1',
    config: d.config,
    site: { commit: d.site.pack.commit, articles: Object.keys(d.site.articles).length, topicsAvailable: d.topicsAvailable, published: d.published },
    startedAt: new Date().toISOString(),
    finishedAt: null,
    articles: [],
    stages: d.meter.stages,
    errors: [],
  }
  let jobId = 0
  const op = <T>(name: string, args: unknown): T => JSON.parse(d.orch.evalOp(name, JSON.stringify(args))) as T

  const putBrief = (briefRef: string, brief: Brief) =>
    d.store.putBrief(COMPANY, briefRef, JSON.stringify({ job_id: 0, brief, writer: writer.id, editor: editor.id, minutes: [], work_item: null, staff }))

  const runJob = async (r: ArticleResult, kind: JobKind, item: string, briefRef: string, revision: number, label: string) => {
    const id = ++jobId
    const job = { company_id: COMPANY, job_id: id, kind, project: 'eval', work_item: item, brief_ref: briefRef, revision, staff }
    d.meter.beginJob(id, kind, revision, item)
    d.onProgress?.({ ...progress, current: label, stage: `${kind} r${revision}` })
    const t0 = now()
    try {
      const out = JSON.parse(await d.orch.run(JSON.stringify(job))) as Outcome[]
      return { ...digestOf(out), jobId: id }
    } catch (e) {
      const msg = `${label}: ${kind} r${revision}: ${e instanceof Error ? e.message : String(e)}`
      results.errors.push(msg)
      return { ok: false, score: 0, failure: `error: ${e instanceof Error ? e.message : String(e)}`, jobId: id }
    } finally {
      d.meter.endJob()
      r.jobs.push({ jobId: id, kind, revision, wallMs: Math.round(now() - t0) })
    }
  }

  const artifact = (item: string): ArtifactJson | null => {
    const t = d.store.getArtifact(COMPANY, item)
    return t ? (JSON.parse(t) as ArtifactJson) : null
  }

  const review = async (r: ArticleResult, item: string, briefRef: string, revision: number, label: string): Promise<ReviewRecord | null> => {
    const dg = await runJob(r, 'review', item, briefRef, revision, label)
    // A review that finished posts its verdict; a halted one only a status.
    const posted = (d.store.posts.get(item) ?? []).some((p) => p.type === 'review' && p.job_id === dg.jobId)
    const sr = posted ? artifact(item)?.sectioned_review : null
    if (!sr) {
      r.outcome = 'failed'
      r.reason = `review r${revision}: ${dg.failure}`
      return null
    }
    const rec: ReviewRecord = {
      revision,
      score: sr?.score ?? dg.score,
      ok: dg.ok,
      verdict: sr?.decision === 'reject' ? 'reject' : sr?.decision === 'approve' && (sr?.score ?? 0) >= d.config.bar ? 'approve' : 'changes',
      notes: sr?.notes ?? '',
      issues: sr?.issues ?? [],
      highRisk: sr?.high_risk ?? [],
    }
    r.reviews.push(rec)
    return rec
  }

  const checksOf = (brief: Brief, item: string): EvalChecks | null => {
    const rec = artifact(item)
    if (!rec?.page) return null
    try {
      return op<EvalChecks>('checks', { brief, record: rec })
    } catch (e) {
      results.errors.push(`checks of ${brief.content_id}: ${e instanceof Error ? e.message : String(e)}`)
      return null
    }
  }

  const blank = (kind: ArticleKind, brief: Brief, source: string, seedKind: SeedKind | null = null, notes: string[] = []): ArticleResult => ({
    kind,
    id: brief.content_id,
    source,
    seedKind,
    brief,
    outcome: 'reviewed',
    reason: null,
    drafts: [],
    reviews: [],
    checks: null,
    page: null,
    wallMs: 0,
    jobs: [],
    notes,
  })

  const references = d.config.controls || d.config.seeded ? articleEntries(d.site) : []
  const total = d.briefs.length + (d.config.controls ? references.length : 0) + (d.config.seeded && references.length ? SEED_KINDS.length : 0)
  const progress: EvalProgress = { phase: 'briefs', done: 0, total, current: '', stage: '' }
  const tick = (r: ArticleResult) => {
    results.articles.push(r)
    progress.done++
    d.onProgress?.({ ...progress, current: r.brief.title, stage: r.outcome })
  }

  // ---- briefs: the staged pipeline, draft → review → revisions
  for (const [i, brief] of d.briefs.entries()) {
    const r = blank('brief', brief, `calendar:${brief.slug}`)
    const item = `eval-item-${i + 1}`
    const briefRef = String(i + 1)
    const label = `brief ${i + 1} of ${d.briefs.length}: ${brief.title}`
    const t0 = now()
    putBrief(briefRef, brief)
    for (let revision = 0; ; revision++) {
      const before = d.gateway.drafts.length
      const dg = await runJob(r, 'draft', item, briefRef, revision, label)
      const pr = d.gateway.drafts.slice(before).pop()
      r.drafts.push({ revision, ok: dg.ok, failure: dg.failure, committed: !!pr, gatewayIssues: pr?.issues ?? [], pathTaken: pr?.pathTaken ?? false })
      if (!dg.ok) {
        r.outcome = 'failed'
        r.reason = `draft r${revision}: ${dg.failure}`
        break
      }
      const rv = await review(r, item, briefRef, revision, label)
      if (!rv) break
      if (!rv.ok) {
        r.outcome = 'blocked'
        r.reason = rv.verdict === 'reject' ? 'the editor rejected it' : 'the editor flagged a high risk'
        break
      }
      if (rv.score >= d.config.bar) {
        r.outcome = 'approved'
        break
      }
      if (revision >= d.config.maxRevisions) {
        r.outcome = 'blocked'
        r.reason = `score ${rv.score} after ${revision} revisions`
        break
      }
    }
    r.checks = checksOf(brief, item)
    r.page = artifact(item)?.page ?? null
    r.wallMs = Math.round(now() - t0)
    tick(r)
  }

  // ---- positive controls: the site's own articles, one review each
  const goods: EvalArticle[] = []
  progress.phase = 'controls'
  for (const [i, [path, text]] of references.entries()) {
    let a: EvalArticle
    try {
      a = op<EvalArticle>('reference', { path, page: JSON.parse(text) })
    } catch (e) {
      results.errors.push(`reference ${path}: ${e instanceof Error ? e.message : String(e)}`)
      continue
    }
    goods.push(a)
    if (!d.config.controls) continue
    const r = blank('control', a.brief, path, null, a.notes)
    const item = `eval-control-${i + 1}`
    const briefRef = String(a.record.brief_ref)
    const t0 = now()
    putBrief(briefRef, a.brief)
    d.store.putArtifact(COMPANY, item, JSON.stringify(a.record))
    await review(r, item, briefRef, 0, `control ${i + 1} of ${references.length}: ${a.brief.title}`)
    r.checks = checksOf(a.brief, item)
    r.page = a.record.page ?? null
    r.wallMs = Math.round(now() - t0)
    tick(r)
  }

  // ---- seeded-bad: six faults on the references in turn, one review each
  progress.phase = 'seeded'
  if (d.config.seeded) {
    if (!goods.length) results.errors.push('no existing articles in the pack (build it with --articles): the seeded-bad drafts need good ones to spoil')
    for (const [k, kind] of (goods.length ? SEED_KINDS : []).entries()) {
      let bad: EvalArticle | null = null
      let lastError = ''
      for (let j = 0; j < goods.length && !bad; j++) {
        try {
          bad = op<EvalArticle>('seeded_bad', { article: goods[(k + j) % goods.length], kind })
        } catch (e) {
          lastError = e instanceof Error ? e.message : String(e)
        }
      }
      if (!bad) {
        results.errors.push(`seeded ${kind}: ${lastError}`)
        continue
      }
      const r = blank('seeded', bad.brief, bad.source, kind, bad.notes)
      const item = `eval-seeded-${k + 1}`
      const briefRef = String(bad.record.brief_ref)
      const t0 = now()
      putBrief(briefRef, bad.brief)
      d.store.putArtifact(COMPANY, item, JSON.stringify(bad.record))
      await review(r, item, briefRef, 0, `seeded ${k + 1} of ${SEED_KINDS.length}: ${kind}`)
      r.checks = checksOf(bad.brief, item)
      r.page = bad.record.page ?? null
      r.wallMs = Math.round(now() - t0)
      tick(r)
    }
  }

  progress.phase = 'done'
  d.onProgress?.({ ...progress, current: '', stage: '' })
  results.finishedAt = new Date().toISOString()
  return results
}
