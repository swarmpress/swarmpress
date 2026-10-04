/**
 * The eval's reports (FEAT-036): the `cockpit.benchmark.v1` document for
 * Cockpit (evidence `bench/agent-pipeline`, file
 * `artifacts/bench/agent-pipeline-eval-<backend>[.<machine>].json`), the
 * Markdown record for `docs/qualification/`, and an article as reading text.
 *
 * Pure: runs in the page, under vitest and in Node. Imports no JSON.
 */
import { BENCHMARK_SCHEMA, TOOL, type BenchmarkDoc, type BenchmarkMetric, type Direction, type ReportContext } from '../../llm/bench/report'
import { failedChecks, overallVerdict, summarize, thresholdRows, type EvalSummary, type OwnerMarks, type ThresholdRow } from './metrics'
import type { ArticleResult, EvalResults } from './runner'

export const evalDocName = (backend: string) => `agent-pipeline-eval-${backend}`
/** The scripted run's document has no machine in its name (its counts do not depend on one). */
export const evalDocFile = (backend: string, machine: string) => (backend === 'fake' ? `${evalDocName(backend)}.json` : `${evalDocName(backend)}.${machine}.json`)
export const evalRecordFile = (date: string, backend: string, machine: string) => `${date}-eval-${backend}-${machine}.md`

const round = (x: number, digits = 2) => Math.round(x * 10 ** digits) / 10 ** digits

/** The Cockpit document of one eval run. Counts are deterministic on the scripted backend; times and tokens of a real model are not. */
export function evalBenchmarkDoc(res: EvalResults, ctx: ReportContext, s: EvalSummary = summarize(res)): BenchmarkDoc {
  const scripted = res.config.backend === 'fake'
  const p = ctx.provenance
  const metrics: BenchmarkMetric[] = []
  const count = (name: string, subject: string, unit: string, value: number | null, direction: Direction = 'informational', budget?: BenchmarkMetric['budget']) => {
    if (value === null || !Number.isFinite(value)) return
    metrics.push({ name, subject, unit, value: round(value), determinism: scripted ? 'deterministic' : 'semi-deterministic', direction, ...(budget ? { budget } : {}) })
  }
  const measured = (name: string, subject: string, unit: string, value: number | null, direction: Direction) => {
    if (value === null || !Number.isFinite(value)) return
    metrics.push({
      name,
      subject,
      unit,
      value: round(value),
      determinism: 'environment-sensitive',
      direction,
      ...(scripted ? { status: 'inconclusive' as const, reason: 'scripted backend: no model ran, the timing says nothing about one' } : {}),
    })
  }
  count('briefs', 'pipeline', 'briefs', s.briefs)
  count('approved', 'pipeline', 'briefs', s.approved, 'higher_is_better')
  count('approved_pct', 'pipeline', '%', s.approvedPct, 'higher_is_better', { min: 80 })
  count('blocked', 'pipeline', 'briefs', s.blocked, 'lower_is_better')
  count('failed', 'pipeline', 'briefs', s.failed, 'lower_is_better')
  count('revisions.median', 'pipeline', 'revisions', s.medianRevisions, 'lower_is_better', { max: 1 })
  count('committed_drafts', 'gateway', 'drafts', s.committed)
  count('committed_pass_pct', 'gateway', '%', s.committedPassPct, 'higher_is_better', { min: 100 })
  count('first_try_pct', 'all-stages', '%', s.firstTryPct, 'higher_is_better', { min: 90 })
  count('repairs.mean', 'all-stages', 'repairs', s.meanRepairs, 'lower_is_better', { max: 0.3 })
  count('calls', 'all-stages', 'calls', s.calls)
  count('truncation_pct', 'all-stages', '%', s.truncationPct, 'lower_is_better', { max: 2 })
  for (const st of s.stages) {
    count('stages', st.stage, 'stages', st.n)
    count('first_try_pct', st.stage, '%', st.n ? st.firstTryPct : null, 'higher_is_better', { min: 90 })
    count('repairs.mean', st.stage, 'repairs', st.n ? st.meanRepairs : null, 'lower_is_better')
    count('calls', st.stage, 'calls', st.calls)
    measured('wall.median_ms', st.stage, 'ms', st.n ? st.wallMs.median : null, 'lower_is_better')
    measured('tokens.completion', st.stage, 'tokens', st.completionTokens, 'informational')
    measured('tokens.prompt', st.stage, 'tokens', st.promptTokens, 'informational')
  }
  count('approved.within_words', 'checks', 'articles', s.approvedWithinWords, 'higher_is_better')
  count('approved.banned_phrases', 'checks', 'articles', s.approvedBanned, 'lower_is_better', { max: 0 })
  count('approved.near_duplicates', 'checks', 'articles', s.approvedNearDuplicates, 'lower_is_better', { max: 0 })
  count('seeded_bad', 'editor', 'drafts', s.seeded)
  count('seeded_bad.editor_rejected', 'editor', 'drafts', s.seededEditorRejected, 'higher_is_better', { min: 5 })
  count('seeded_bad.checks_rejected', 'checks', 'drafts', s.seededChecksRejected, 'higher_is_better')
  count('seeded_bad.rejected', 'editor+checks', 'drafts', s.seededRejected, 'higher_is_better', { min: 5 })
  count('controls', 'editor', 'articles', s.controls)
  count('controls.approved_pct', 'editor', '%', s.controlsApprovedPct, 'higher_is_better', { min: 80 })
  count('controls.score_mean', 'editor', 'score', s.controlScores.length ? s.controlScores.reduce((a, b) => a + b, 0) / s.controlScores.length : null, 'higher_is_better')
  for (const [check, n] of Object.entries(s.calibration).sort()) count('controls.failing_check', check, 'articles', n, 'lower_is_better')
  count('jobs.over_timeout', 'pipeline', 'jobs', s.jobsOverTimeout, 'lower_is_better', { max: 0 })
  measured('article.minutes_median', 'pipeline', 'min', s.minutesPerArticle, 'lower_is_better')
  measured('tokens.completion', 'all-stages', 'tokens', s.tokens.completion, 'informational')
  measured('tokens.prompt', 'all-stages', 'tokens', s.tokens.prompt, 'informational')
  return {
    schema: BENCHMARK_SCHEMA,
    name: evalDocName(res.config.backend),
    feature_ids: ['FEAT-036'],
    component: 'agents',
    provenance: {
      ...(p.commit ? { commit: p.commit } : {}),
      ...(p.branch ? { branch: p.branch } : {}),
      ...(p.dirty !== null ? { dirty: p.dirty } : {}),
      generated_at: p.generatedAt,
      tool: TOOL,
    },
    build: { profile: 'harness' },
    machine: { os: ctx.machine.os, arch: ctx.machine.arch, cpus: ctx.machine.cpus, cpu_model: ctx.machine.cpuModel, runner: 'local' },
    workload: {
      backend: res.config.backend,
      model: res.config.modelId,
      site_commit: res.site.commit,
      briefs: res.config.n,
      topics_available: res.site.topicsAvailable,
      references: res.site.articles,
      quality_bar: res.config.bar,
      max_revisions: res.config.maxRevisions,
      complete: res.finishedAt !== null,
    },
    metrics,
  }
}

// ---------------------------------------------------------------- reading text

const str = (v: unknown): string => (typeof v === 'string' ? v : v && typeof v === 'object' ? String((v as Record<string, unknown>).en ?? '') : '')

const unescape = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

/** One block of an article page as plain reading text. */
export interface TextBlock {
  kind: 'title' | 'dek' | 'heading' | 'paragraph' | 'list' | 'tip' | 'image' | 'closing' | 'link' | 'other'
  text: string
  items?: string[]
}

/** An article page (the assembled JSON) as the blocks a reader sees, in order. */
export function articleBlocks(page: unknown): TextBlock[] {
  const out: TextBlock[] = []
  const body = (page as { body?: unknown[] } | null)?.body
  for (const raw of Array.isArray(body) ? body : []) {
    const b = raw as Record<string, unknown>
    switch (b.type) {
      case 'editorial-hero':
        out.push({ kind: 'title', text: unescape(str(b.title)) })
        if (b.subtitle) out.push({ kind: 'dek', text: str(b.subtitle) })
        if (b.image) out.push({ kind: 'image', text: `hero image: ${str(b.image)}` })
        break
      case 'heading':
        out.push({ kind: 'heading', text: str(b.text) })
        break
      case 'paragraph':
        out.push({ kind: 'paragraph', text: str(b.markdown) })
        break
      case 'list':
        out.push({ kind: 'list', text: '', items: (Array.isArray(b.items) ? b.items : []).map(str) })
        break
      case 'callout':
        out.push({ kind: 'tip', text: str(b.content) })
        break
      case 'image':
        out.push({ kind: 'image', text: `image: ${str(b.alt)} (${str(b.src)})` })
        break
      case 'closing-note':
        out.push({ kind: 'closing', text: `${str(b.title)}: ${unescape(str(b.content))}` })
        for (const a of Array.isArray(b.actions) ? (b.actions as Record<string, unknown>[]) : []) out.push({ kind: 'link', text: `${str(a.label)} → ${str(a.href)}` })
        break
      default:
        out.push({ kind: 'other', text: `[${String(b.type)}]` })
    }
  }
  return out
}

export function articleText(page: unknown): string {
  return articleBlocks(page)
    .map((b) => {
      switch (b.kind) {
        case 'title':
          return `# ${b.text}`
        case 'dek':
          return `_${b.text}_`
        case 'heading':
          return `## ${b.text}`
        case 'list':
          return (b.items ?? []).map((i) => `- ${i}`).join('\n')
        case 'tip':
          return `> Tip: ${b.text}`
        case 'closing':
          return `> ${b.text}`
        case 'link':
          return `> ${b.text}`
        case 'image':
          return `(${b.text})`
        default:
          return b.text
      }
    })
    .join('\n\n')
}

export const articleTitle = (a: ArticleResult): string => articleBlocks(a.page).find((b) => b.kind === 'title')?.text || a.brief.title
export const articleDek = (a: ArticleResult): string => articleBlocks(a.page).find((b) => b.kind === 'dek')?.text || a.brief.angle

// ---------------------------------------------------------------- the record

function table(rows: string[][]): string {
  const [head, ...rest] = rows
  return [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rest.map((r) => `| ${r.map((c) => c.replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ')} |`)].join('\n')
}

function articleSection(a: ArticleResult, marks: OwnerMarks): string {
  const last = a.reviews[a.reviews.length - 1]
  const mark = marks[a.id]
  const lines = [
    `### ${articleTitle(a)}`,
    '',
    `- ${a.kind}${a.seedKind ? ` (${a.seedKind})` : ''} · ${a.source} · outcome **${a.outcome}**${a.reason ? ` (${a.reason})` : ''}`,
    `- scores: ${a.reviews.map((r) => `r${r.revision} ${r.score}`).join(', ') || 'no review'}`,
    a.checks ? `- words ${a.checks.words} of ${a.checks.target_words} (${a.checks.words_percent}%); failing checks: ${failedChecks(a.checks).join(', ') || 'none'}` : '- no checks',
    ...(mark ? [`- owner: ${mark.publish === null ? 'not decided' : mark.publish ? 'would publish' : 'would not publish'}${mark.factualError ? ', factually wrong' : ''}${mark.note ? ` (${mark.note})` : ''}`] : []),
    ...(last?.notes ? [`- editor: ${last.notes}`] : []),
    ...(last?.issues ?? []).map((i) => `  - [${i.section}] ${i.problem}${i.fix ? ` → ${i.fix}` : ''}`),
    ...(a.notes.length ? [`- notes: ${a.notes.join('; ')}`] : []),
  ]
  return lines.join('\n')
}

/** The eval record for `docs/qualification/`: the threshold table, the numbers, and every generated article. */
export function evalMarkdown(res: EvalResults, ctx: ReportContext, marks: OwnerMarks = {}): string {
  const s = summarize(res, marks)
  const rows = thresholdRows(s, res)
  const verdict = overallVerdict(rows)
  const p = ctx.provenance
  const out: string[] = [
    `# Pipeline eval: ${res.config.backend}${res.config.modelId ? ` (${res.config.modelId})` : ''} on ${ctx.machine.cpuModel}`,
    '',
    `> FEAT-036, docs/design/mvp-pipeline.md §9. Generated by eval.html (\`docs/runbooks/eval.md\`) on ${p.generatedAt}` +
      `${p.commit ? ` at ${p.commit.slice(0, 12)}${p.dirty ? ' (dirty)' : ''}` : ''}. Site pack ${res.site.commit.slice(0, 12)}: ${res.site.topicsAvailable} unpublished calendar topics, ${res.site.articles} existing articles.`,
    '',
    `**Verdict: ${verdict.toUpperCase()}**${verdict === 'pending' ? ' (the owner has not read every approved article yet)' : ''}`,
    '',
    '## Threshold',
    '',
    table([['#', 'metric', 'bar', 'measured', 'verdict'], ...rows.map((r: ThresholdRow) => [String(r.rule || '–'), r.metric, r.bar, r.measured, r.verdict])]),
    '',
    '## Per stage',
    '',
    table([
      ['stage', 'model stages', 'first try', 'mean repairs', 'failed', 'calls', 'truncated', 'median s', 'prompt tokens', 'completion tokens'],
      ...s.stages.map((st) => [st.stage, String(st.n), `${st.firstTryPct}%`, String(st.meanRepairs), String(st.failed), String(st.calls), String(st.truncated), String(round(st.wallMs.median / 1000, 1)), String(st.promptTokens), String(st.completionTokens)]),
    ]),
    '',
    '## Per brief',
    '',
    table([
      ['brief', 'outcome', 'scores', 'words / target', 'gateway', 'minutes'],
      ...res.articles
        .filter((a) => a.kind === 'brief')
        .map((a) => [
          a.brief.title,
          a.outcome + (a.reason ? ` (${a.reason})` : ''),
          a.reviews.map((r) => String(r.score)).join(' → ') || '–',
          a.checks ? `${a.checks.words} / ${a.checks.target_words}` : '–',
          a.drafts.every((d) => !d.committed || (d.gatewayIssues.length === 0 && !d.pathTaken)) ? 'ok' : 'refused',
          String(round(a.wallMs / 60000, 1)),
        ]),
    ]),
    '',
    `Blocked or failed: ${Object.entries(s.blockedBy).map(([k, n]) => `${k} ×${n}`).join('; ') || 'none'}.`,
    '',
    '## Editor discrimination',
    '',
    table([
      ['article', 'kind', 'score', 'editor rejects', 'checks reject'],
      ...res.articles
        .filter((a) => a.kind !== 'brief')
        .map((a) => {
          const last = a.reviews[a.reviews.length - 1]
          const checks = a.checks ? failedChecks(a.checks).concat(a.checks.gateway_issues.some((i) => i.includes('create-only')) && a.kind === 'seeded' ? ['create-only'] : []) : []
          return [a.kind === 'seeded' ? `${a.seedKind} (${a.source.split(':').pop()})` : a.source, a.kind, last ? String(last.score) : '–', last ? String(!last.ok || last.score < res.config.bar) : 'no review', checks.join(', ') || '–']
        }),
    ]),
    '',
    `Checks failed by the existing articles (calibration; create-only left out): ${Object.entries(s.calibration).map(([k, n]) => `${k} ${n} of ${s.controls}`).join(', ') || 'none'}.`,
    '',
    '## Articles',
    '',
    ...res.articles.filter((a) => a.kind === 'brief').map((a) => `${articleSection(a, marks)}\n\n${articleText(a.page)
      .split('\n')
      .map((l) => (l ? `    ${l}` : ''))
      .join('\n')}\n`),
    ...(res.errors.length ? ['## Errors', '', ...res.errors.map((e) => `- ${e}`), ''] : []),
  ]
  return `${out.join('\n')}\n`
}
