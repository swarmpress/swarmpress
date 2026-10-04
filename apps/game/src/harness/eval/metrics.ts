/**
 * The eval's numbers and the "publishable" threshold
 * (docs/design/mvp-pipeline.md §9; the owner sets the numbers). Pure over
 * `EvalResults` and the owner's marks: runs in the page, under vitest and in
 * Node (the Playwright spec writes the documents).
 */
import type { ArticleResult, EvalChecks, EvalResults, StageRecord } from './runner'

/** The owner's reading of one approved article (eval.html, saved in localStorage). */
export interface OwnerMark {
  publish: boolean | null
  factualError: boolean
  note?: string
}
export type OwnerMarks = Record<string, OwnerMark>

/** The proposed bar of §9. Every number is the owner's to change. */
export const THRESHOLDS = {
  minBriefs: 20,
  committedPassPct: 100,
  approvedPct: 80,
  medianRevisionsMax: 1,
  firstTryPct: 90,
  meanRepairsMax: 0.3,
  truncationPctMax: 2,
  seededRejectedMin: 5,
  controlsApprovedPct: 80,
  ownerPublishPct: 80,
} as const

/**
 * The legacy profile of the positive controls (docs/qualification/check-calibration.md):
 * the rules the site's own published articles may break without the check being called
 * miscalibrated. The gate for new drafts is unchanged; a control is only *scored* on this
 * profile, and the report names every exception.
 *
 * - `banned-phrase`: the live articles predate the style guide's `vocabulary.avoid` list
 *   ("iconic", "stunning", "hidden gem(s)", "tourist trap(s)"); the words are banned for
 *   new writing, not wrong in the theme.
 * - `media`: six live heroes are not in `content/config/media-index.json` (a gap in the
 *   site's index the owner fixes); new drafts may only use indexed media (rule 5).
 */
export const LEGACY_RULES: Readonly<Record<string, string>> = {
  'banned-phrase': "the live articles predate the style guide's banned vocabulary",
  media: 'live hero images missing from the media index (a site data gap)',
}

/** A control's broken rules, create-only left out (a reference is on the site already). Results without `rules` fall back to the failing check names, which no legacy rule matches. */
export const controlRules = (c: EvalChecks): string[] => (c.rules ?? failedChecks(c)).filter((r) => r !== 'create-only')

/** A control breaks only rules of the legacy profile. */
export const withinLegacyProfile = (c: EvalChecks | null): boolean => !!c && controlRules(c).every((r) => r in LEGACY_RULES)

export interface StageSummary {
  stage: string
  /** Stages that called the model (reused ones left out). */
  n: number
  firstTry: number
  firstTryPct: number
  meanRepairs: number
  failed: number
  calls: number
  truncated: number
  wallMs: { total: number; median: number; max: number }
  promptTokens: number
  completionTokens: number
  reasoningTokens: number
}

export interface EvalSummary {
  briefs: number
  approved: number
  approvedPct: number
  blocked: number
  failed: number
  /** Revisions to approval, per approved brief. */
  revisions: number[]
  medianRevisions: number | null
  blockedBy: Record<string, number>
  committed: number
  committedPass: number
  committedPassPct: number | null
  stages: StageSummary[]
  /** Over every model stage. */
  firstTryPct: number | null
  meanRepairs: number | null
  calls: number
  truncated: number
  truncationPct: number | null
  approvedWithinWords: number
  approvedBanned: number
  approvedNearDuplicates: number
  controls: number
  controlScores: number[]
  controlsApproved: number
  controlsApprovedPct: number | null
  seeded: number
  seededEditorRejected: number
  seededChecksRejected: number
  seededRejected: number
  /** References failing each check: a check that fails many accepted references is miscalibrated (§9). */
  calibration: Record<string, number>
  /** References breaking each rule (create-only left out), each counted once per reference. */
  controlRules: Record<string, number>
  /** References whose only broken rules are in {@link LEGACY_RULES}. */
  controlsWithinLegacy: number
  /** References breaking a rule outside the legacy profile: a check bug or a rule the live site disagrees with, to look at before going live. */
  controlsOutsideLegacy: { source: string; rules: string[] }[]
  jobsOverTimeout: number
  maxJobMs: number
  minutesPerArticle: number | null
  tokens: { prompt: number; completion: number; reasoning: number }
  owner: { marked: number; publish: number; factualErrors: number; publishPct: number | null }
}

const pct = (a: number, b: number): number | null => (b > 0 ? Math.round((a * 1000) / b) / 10 : null)

export function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** A model stage: it ran (not reused) and called the model. */
const modelStage = (s: StageRecord) => s.state !== 'reused' && s.calls > 0 && s.stage !== 'job'
const firstTry = (s: StageRecord) => s.state === 'done' && s.turns === 1
const repairs = (s: StageRecord) => Math.max(0, s.turns - 1)

export function summarizeStages(stages: StageRecord[]): StageSummary[] {
  const by = new Map<string, StageRecord[]>()
  for (const s of stages) {
    if (s.stage === 'job' && s.calls === 0) continue
    by.set(s.stage, [...(by.get(s.stage) ?? []), s])
  }
  return [...by.entries()]
    .map(([stage, list]) => {
      const ran = list.filter(modelStage)
      const walls = ran.map((s) => s.wallMs)
      const ok = ran.filter(firstTry).length
      return {
        stage,
        n: ran.length,
        firstTry: ok,
        firstTryPct: pct(ok, ran.length) ?? 0,
        meanRepairs: ran.length ? Math.round((ran.reduce((a, s) => a + repairs(s), 0) / ran.length) * 100) / 100 : 0,
        failed: list.filter((s) => s.state === 'failed').length,
        calls: list.reduce((a, s) => a + s.calls, 0),
        truncated: list.reduce((a, s) => a + s.truncated, 0),
        wallMs: { total: walls.reduce((a, b) => a + b, 0), median: median(walls) ?? 0, max: walls.length ? Math.max(...walls) : 0 },
        promptTokens: list.reduce((a, s) => a + s.promptTokens, 0),
        completionTokens: list.reduce((a, s) => a + s.completionTokens, 0),
        reasoningTokens: list.reduce((a, s) => a + s.reasoningTokens, 0),
      }
    })
    .sort((a, b) => (a.stage < b.stage ? -1 : a.stage > b.stage ? 1 : 0))
}

/** The checks a reference is measured on, by name: true when it fails. Create-only is left out (a reference is on the site already). */
export function failedChecks(c: EvalChecks): string[] {
  const gateway = c.gateway_issues.filter((i) => !i.includes('create-only'))
  const out: [string, boolean][] = [
    ['words', !c.words_ok],
    ['banned-phrases', c.banned_phrases.length > 0],
    ['near-duplicates', c.near_duplicates > 0],
    ['headings', !c.headings_ok],
    ['title-length', !c.title_ok],
    ['description-length', !c.description_ok],
    ['plain-text', c.plain_text_findings.length > 0],
    ['links-and-media', c.link_media_issues.length > 0],
    ['site-validator', c.site_issues.length > 0],
    ['gateway', gateway.length > 0],
  ]
  return out.filter(([, failed]) => failed).map(([name]) => name)
}

/** Whether the deterministic checks reject an article (a seeded-bad one must be rejected). */
export const checksReject = (c: EvalChecks | null) => !!c && (failedChecks(c).length > 0 || c.gateway_issues.length > 0)

export const editorRejects = (a: ArticleResult, bar: number) => {
  const r = a.reviews[a.reviews.length - 1]
  return !r || !r.ok || r.score < bar
}

export function summarize(res: EvalResults, marks: OwnerMarks = {}): EvalSummary {
  const bar = res.config.bar
  const briefs = res.articles.filter((a) => a.kind === 'brief')
  const approved = briefs.filter((a) => a.outcome === 'approved')
  const revisions = approved.map((a) => a.reviews[a.reviews.length - 1]?.revision ?? 0)
  const blockedBy: Record<string, number> = {}
  for (const a of briefs.filter((x) => x.outcome !== 'approved')) {
    const key = a.outcome === 'failed' ? `failed: ${(a.reason ?? '').replace(/^.*?: /, '')}` : `blocked: ${a.reason ?? ''}`
    blockedBy[key] = (blockedBy[key] ?? 0) + 1
  }
  const drafts = briefs.flatMap((a) => a.drafts.filter((d) => d.committed))
  const committedPass = drafts.filter((d) => d.gatewayIssues.length === 0 && !d.pathTaken).length
  const stages = summarizeStages(res.stages)
  const ran = res.stages.filter(modelStage)
  const calls = res.stages.reduce((a, s) => a + s.calls, 0)
  const truncated = res.stages.reduce((a, s) => a + s.truncated, 0)
  const controls = res.articles.filter((a) => a.kind === 'control')
  const controlScores = controls.map((a) => a.reviews[a.reviews.length - 1]?.score ?? 0)
  const controlsApproved = controls.filter((a) => !editorRejects(a, bar)).length
  const seeded = res.articles.filter((a) => a.kind === 'seeded')
  const calibration: Record<string, number> = {}
  for (const a of controls) for (const c of a.checks ? failedChecks(a.checks) : []) calibration[c] = (calibration[c] ?? 0) + 1
  const controlRuleCounts: Record<string, number> = {}
  for (const a of controls) for (const r of a.checks ? controlRules(a.checks) : []) controlRuleCounts[r] = (controlRuleCounts[r] ?? 0) + 1
  const outsideLegacy = controls
    .filter((a) => !withinLegacyProfile(a.checks))
    .map((a) => ({ source: a.source, rules: a.checks ? controlRules(a.checks).filter((r) => !(r in LEGACY_RULES)) : ['no checks'] }))
  const jobs = res.articles.flatMap((a) => a.jobs)
  const ownerOf = approved.map((a) => marks[a.id]).filter((m): m is OwnerMark => !!m && m.publish !== null)
  return {
    briefs: briefs.length,
    approved: approved.length,
    approvedPct: pct(approved.length, briefs.length) ?? 0,
    blocked: briefs.filter((a) => a.outcome === 'blocked').length,
    failed: briefs.filter((a) => a.outcome === 'failed').length,
    revisions,
    medianRevisions: median(revisions),
    blockedBy,
    committed: drafts.length,
    committedPass,
    committedPassPct: pct(committedPass, drafts.length),
    stages,
    firstTryPct: pct(ran.filter(firstTry).length, ran.length),
    meanRepairs: ran.length ? Math.round((ran.reduce((a, s) => a + repairs(s), 0) / ran.length) * 100) / 100 : null,
    calls,
    truncated,
    truncationPct: pct(truncated, calls),
    approvedWithinWords: approved.filter((a) => a.checks?.words_ok).length,
    approvedBanned: approved.filter((a) => (a.checks?.banned_phrases.length ?? 0) > 0).length,
    approvedNearDuplicates: approved.filter((a) => (a.checks?.near_duplicates ?? 0) > 0).length,
    controls: controls.length,
    controlScores,
    controlsApproved,
    controlsApprovedPct: pct(controlsApproved, controls.length),
    seeded: seeded.length,
    seededEditorRejected: seeded.filter((a) => editorRejects(a, bar)).length,
    seededChecksRejected: seeded.filter((a) => checksReject(a.checks)).length,
    seededRejected: seeded.filter((a) => editorRejects(a, bar) || checksReject(a.checks)).length,
    calibration,
    controlRules: controlRuleCounts,
    controlsWithinLegacy: controls.length - outsideLegacy.length,
    controlsOutsideLegacy: outsideLegacy,
    jobsOverTimeout: jobs.filter((j) => j.wallMs > res.config.jobTimeoutMs).length,
    maxJobMs: jobs.length ? Math.max(...jobs.map((j) => j.wallMs)) : 0,
    minutesPerArticle: (() => {
      const m = median(briefs.map((a) => a.wallMs))
      return m === null ? null : Math.round((m / 60000) * 100) / 100
    })(),
    tokens: {
      prompt: res.stages.reduce((a, s) => a + s.promptTokens, 0),
      completion: res.stages.reduce((a, s) => a + s.completionTokens, 0),
      reasoning: res.stages.reduce((a, s) => a + s.reasoningTokens, 0),
    },
    owner: {
      marked: ownerOf.length,
      publish: ownerOf.filter((m) => m.publish).length,
      factualErrors: approved.filter((a) => marks[a.id]?.factualError).length,
      publishPct: pct(ownerOf.filter((m) => m.publish).length, ownerOf.length),
    },
  }
}

export type Verdict = 'pass' | 'fail' | 'pending' | 'inconclusive'

export interface ThresholdRow {
  id: string
  /** The §9 threshold it belongs to (1–7). */
  rule: number
  metric: string
  bar: string
  measured: string
  verdict: Verdict
}

const fmt = (v: number | null, unit = '%') => (v === null ? 'not measured' : `${v}${unit}`)

/** The §9 threshold, row by row, with a verdict each. */
export function thresholdRows(s: EvalSummary, res: EvalResults): ThresholdRow[] {
  const T = THRESHOLDS
  const v = (ok: boolean | null): Verdict => (ok === null ? 'inconclusive' : ok ? 'pass' : 'fail')
  const rows: ThresholdRow[] = [
    { id: 'briefs', rule: 0, metric: 'briefs run', bar: `≥ ${T.minBriefs}`, measured: String(s.briefs), verdict: v(s.briefs >= T.minBriefs) },
    {
      id: 'committed-pass',
      rule: 1,
      metric: "committed drafts passing the gateway's check_draft",
      bar: `${T.committedPassPct}%`,
      measured: s.committed ? `${s.committedPass} of ${s.committed} (${fmt(s.committedPassPct)})` : 'no draft committed',
      verdict: v(s.committed ? s.committedPass === s.committed : null),
    },
    { id: 'approved', rule: 2, metric: 'approved (score ≥ bar) within 3 revisions', bar: `≥ ${T.approvedPct}%`, measured: `${s.approved} of ${s.briefs} (${fmt(s.approvedPct)})`, verdict: v(s.briefs ? s.approvedPct >= T.approvedPct : null) },
    { id: 'median-revisions', rule: 2, metric: 'median revisions to approval', bar: `≤ ${T.medianRevisionsMax}`, measured: fmt(s.medianRevisions, ''), verdict: v(s.medianRevisions === null ? null : s.medianRevisions <= T.medianRevisionsMax) },
  ]
  for (const st of s.stages.filter((x) => x.n > 0)) {
    rows.push({ id: `first-try-${st.stage}`, rule: 3, metric: `first-try validity, ${st.stage}`, bar: `≥ ${T.firstTryPct}%`, measured: `${st.firstTry} of ${st.n} (${st.firstTryPct}%)`, verdict: v(st.firstTryPct >= T.firstTryPct) })
  }
  rows.push(
    { id: 'mean-repairs', rule: 3, metric: 'mean repairs per model stage', bar: `≤ ${T.meanRepairsMax}`, measured: fmt(s.meanRepairs, ''), verdict: v(s.meanRepairs === null ? null : s.meanRepairs <= T.meanRepairsMax) },
    { id: 'truncation', rule: 3, metric: 'truncated model calls', bar: `≤ ${T.truncationPctMax}%`, measured: `${s.truncated} of ${s.calls} (${fmt(s.truncationPct)})`, verdict: v(s.truncationPct === null ? null : s.truncationPct <= T.truncationPctMax) },
    {
      id: 'approved-words',
      rule: 4,
      metric: 'approved articles within ±25% of target',
      bar: 'all',
      measured: `${s.approvedWithinWords} of ${s.approved}`,
      verdict: v(s.approved ? s.approvedWithinWords === s.approved : null),
    },
    { id: 'approved-banned', rule: 4, metric: 'approved articles with a banned phrase', bar: '0', measured: String(s.approvedBanned), verdict: v(s.approved ? s.approvedBanned === 0 : null) },
    { id: 'approved-near-duplicates', rule: 4, metric: 'approved articles with near-duplicate paragraphs', bar: '0', measured: String(s.approvedNearDuplicates), verdict: v(s.approved ? s.approvedNearDuplicates === 0 : null) },
    {
      id: 'seeded-editor',
      rule: 5,
      metric: 'seeded-bad drafts the editor scores under the bar',
      bar: `≥ ${T.seededRejectedMin} of 6`,
      measured: `${s.seededEditorRejected} of ${s.seeded}`,
      verdict: v(s.seeded ? s.seededEditorRejected >= T.seededRejectedMin : null),
    },
    {
      id: 'seeded-rejected',
      rule: 5,
      metric: 'seeded-bad drafts rejected by the editor or the checks',
      bar: `≥ ${T.seededRejectedMin} of 6`,
      measured: `${s.seededRejected} of ${s.seeded} (checks alone: ${s.seededChecksRejected})`,
      verdict: v(s.seeded ? s.seededRejected >= T.seededRejectedMin : null),
    },
    {
      id: 'controls',
      rule: 5,
      metric: 'existing articles the editor scores at or above the bar',
      bar: `≥ ${T.controlsApprovedPct}%`,
      measured: s.controls ? `${s.controlsApproved} of ${s.controls} (${fmt(s.controlsApprovedPct)})` : 'no references in the pack',
      verdict: v(s.controls ? (s.controlsApprovedPct ?? 0) >= T.controlsApprovedPct : null),
    },
    {
      id: 'calibration',
      rule: 5,
      metric: 'existing articles passing the checks on the legacy profile (calibration)',
      bar: 'all',
      measured: s.controls
        ? `${s.controlsWithinLegacy} of ${s.controls}` +
          (Object.keys(s.controlRules).length
            ? `; rules broken: ${Object.entries(s.controlRules)
                .sort()
                .map(([r, n]) => `${r} ${n}${r in LEGACY_RULES ? ' (legacy)' : ''}`)
                .join(', ')}`
            : '; no rule broken')
        : 'no references in the pack',
      verdict: v(s.controls ? s.controlsOutsideLegacy.length === 0 : null),
    },
    {
      id: 'owner',
      rule: 6,
      metric: 'the owner would publish (and no factual error)',
      bar: `≥ ${T.ownerPublishPct}%, 0 wrong`,
      measured: s.approved ? `${s.owner.publish} of ${s.owner.marked} marked (${s.approved} approved), ${s.owner.factualErrors} factually wrong` : 'nothing approved',
      verdict:
        s.approved === 0
          ? 'inconclusive'
          : s.owner.factualErrors > 0
            ? 'fail'
            : s.owner.marked < s.approved
              ? 'pending'
              : v((s.owner.publishPct ?? 0) >= T.ownerPublishPct),
    },
    {
      id: 'timeouts',
      rule: 7,
      metric: 'jobs over their timeout',
      bar: `0 (limit ${Math.round(res.config.jobTimeoutMs / 60000)} min)`,
      measured: `${s.jobsOverTimeout} (longest ${Math.round(s.maxJobMs / 1000)} s; median ${fmt(s.minutesPerArticle, ' min')} per article)`,
      verdict: v(s.jobsOverTimeout === 0),
    },
  )
  return rows
}

/** The run's verdict: every row passes; pending while the owner has not read every approved article. */
export function overallVerdict(rows: ThresholdRow[]): Verdict {
  if (rows.some((r) => r.verdict === 'fail')) return 'fail'
  if (rows.some((r) => r.verdict === 'pending')) return 'pending'
  if (rows.some((r) => r.verdict === 'inconclusive')) return 'inconclusive'
  return 'pass'
}
