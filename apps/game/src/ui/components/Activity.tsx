import { useEffect, useState } from 'preact/hooks'
import { createActivityFeed, filterJobs, NO_FILTER, type ActivityFeed, type ActivityFilter, type ActivityJob, type ActivityStage } from '../activity-source'
import { duration, elapsed, gameTime, num, sentence } from '../format'
import { commitUrl, pullRequestUrl } from '../links'
import { useStore, type OverlayStore } from '../store'
import { Badge, External, Notice, Panel, PersonButton } from './common'

/**
 * The Activity panel (FEAT-078, increment U4; ADR-0058): who did what, with
 * which model, in how long. Jobs newest first, each expandable to its stages
 * and their attempts; the job in flight pinned on top with its stage now
 * ("section 3 of 5", counts only). Filters by person, work item and kind.
 *
 * Everything shown comes from the activity record in the company's store and
 * the orchestrator's progress events, never from the sim. Errors and model ids
 * are text a model or a service wrote: rendered as text, never as markup.
 */
export function Activity() {
  const store = useStore()
  const feed = useActivityFeed(store)
  const [filter, setFilter] = useState<ActivityFilter>(NO_FILTER)
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set())
  const jobs = feed.jobs.value
  const pinned = jobs.filter((j) => j.live)
  const listed = filterJobs(
    jobs.filter((j) => !j.live),
    filter,
  )
  const filtered = filter.staff != null || filter.workItem != null || filter.kind != null
  const toggle = (id: number) =>
    setExpanded((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // Opened on a job (the HUD's Now strip): expand it and move the focus to it. This effect runs
  // after the Panel's own (which focuses the panel), so the job keeps the focus.
  const focus = store.activityJob.value
  useEffect(() => {
    if (focus == null) return
    setExpanded((s) => new Set(s).add(focus))
    store.activityJob.value = null
    setTimeout(() => document.getElementById(jobDomId(focus))?.focus(), 0)
  }, [focus])

  return (
    <Panel id="activity" title="Activity">
      <p class="small muted">Who did what, with which model, in how long. Newest first.</p>
      {feed.error.value && (
        <Notice tone="bad" title="The activity record could not be read">
          {feed.error.value}
        </Notice>
      )}
      {pinned.length > 0 && (
        <section aria-labelledby="activity-now-title" class="activity-now">
          <h3 id="activity-now-title">Now</h3>
          <ul class="activity-list">
            {pinned.map((j) => (
              <li key={j.jobId}>
                <JobCard job={j} expanded={expanded.has(j.jobId)} onToggle={() => toggle(j.jobId)} />
              </li>
            ))}
          </ul>
        </section>
      )}
      <Filters jobs={jobs} filter={filter} onChange={setFilter} />
      <section aria-labelledby="activity-jobs-title">
        <h3 id="activity-jobs-title">
          Jobs <span class="muted">({listed.length})</span>
        </h3>
        {feed.loading.value ? (
          <p class="muted" role="status">
            Loading…
          </p>
        ) : listed.length === 0 ? (
          <p class="muted activity-empty">
            {filtered
              ? 'No job matches these filters.'
              : pinned.length
                ? 'No finished job yet.'
                : 'No jobs yet. Once the staff work (a standup, a draft, a review), each job appears here with who did it, the model and how long it took.'}
          </p>
        ) : (
          <ol class="activity-list">
            {listed.map((j) => (
              <li key={j.jobId}>
                <JobCard job={j} expanded={expanded.has(j.jobId)} onToggle={() => toggle(j.jobId)} />
              </li>
            ))}
          </ol>
        )}
        {feed.more.value && (
          <p>
            <button type="button" class="btn" onClick={() => void feed.loadOlder()}>
              Load older jobs
            </button>
          </p>
        )}
      </section>
    </Panel>
  )
}

/** The panel's feed: created when the panel opens, disposed when it closes (no reads while it is closed). */
function useActivityFeed(store: OverlayStore): ActivityFeed {
  const [feed] = useState(() => createActivityFeed(store.source, store.live))
  useEffect(() => () => feed.dispose(), [feed])
  return feed
}

export const jobDomId = (jobId: number) => `activity-job-${jobId}`

const RESULTS: Record<string, { label: string; tone: 'good' | 'bad' | 'info' | 'warn' | 'neutral' }> = {
  done: { label: 'Done', tone: 'good' },
  failed: { label: 'Failed', tone: 'bad' },
  running: { label: 'Running', tone: 'info' },
  unfinished: { label: 'Unfinished', tone: 'warn' },
  repaired: { label: 'Repaired', tone: 'warn' },
  reused: { label: 'Reused', tone: 'neutral' },
}

function ResultBadge({ result }: { result: string }) {
  const r = RESULTS[result] ?? { label: sentence(result), tone: 'neutral' as const }
  return <Badge tone={r.tone}>{r.label}</Badge>
}

const part = (i: number) => (i === 0 ? 'intro' : `section ${i}`)

/** A stage in words: "Section 3", "Intro", "Revise section 2" (the record keeps the index, not the total). */
export function stageLabel(stage: string, index: number): string {
  switch (stage) {
    case 'context':
      return 'Context'
    case 'outline':
      return 'Outline'
    case 'section':
      return index === 0 ? 'Intro' : `Section ${index}`
    case 'closing':
      return 'Closing note'
    case 'fix':
      return `Fix ${part(index)}`
    case 'retitle':
      return 'New title'
    case 'revise':
      return `Revise ${part(index)}`
    case 'review':
      return 'Review'
    case 'review_section':
      return `Review ${part(index)}`
    case 'review_summary':
      return 'Summary'
    case 'commit':
      return 'Commit'
    default:
      return index ? `${sentence(stage)} ${index}` : sentence(stage)
  }
}

/** The person of a job: their card when they are on staff, else the persona's name. */
function Who({ job }: { job: ActivityJob }) {
  const store = useStore()
  if (job.staff && store.staff(job.staff)) return <PersonButton staff={job.staff} detail={job.role ? sentence(job.role) : undefined} />
  const name = (job.persona && store.persona(job.persona)?.name) || job.persona || job.staff
  return <span class="activity-who">{name ? sentence(name) : 'Nobody named'}</span>
}

const firstName = (store: OverlayStore, job: Pick<ActivityJob, 'staff' | 'persona'>) =>
  (job.staff && store.staff(job.staff) ? store.personaOf(job.staff).name : (job.persona && store.persona(job.persona)?.name) || job.persona || '').split(' ')[0]

const clockTime = (ms: number) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

function JobCard({ job, expanded, onToggle }: { job: ActivityJob; expanded: boolean; onToggle: () => void }) {
  const store = useStore()
  const id = jobDomId(job.jobId)
  const title = job.workItem ? store.planText.value.items[job.workItem]?.title || job.workItem : null
  const pr = job.refs.pr != null ? pullRequestUrl(store.site, job.refs.pr) : null
  const merged = job.refs.mergedSha ? commitUrl(store.site, job.refs.mergedSha) : null
  const tokens = job.tokensIn + job.tokensOut
  return (
    <article
      id={id}
      class={`activity-job${job.live ? ' is-live' : ''}${job.result === 'failed' ? ' is-failed' : ''}`}
      aria-labelledby={`${id}-title`}
      tabIndex={-1}
      data-job={job.jobId}
      data-kind={job.kind}
    >
      <div class="activity-head">
        <Who job={job} />
        <h4 id={`${id}-title`} class="activity-title">
          {sentence(job.kind)}
          {job.revision > 0 && <span class="muted"> · revision {job.revision}</span>}
          {job.workItem && (
            <>
              {' · '}
              <button type="button" class="link-btn" onClick={() => store.openItem(job.workItem!)}>
                {title}
              </button>
            </>
          )}
        </h4>
        <ResultBadge result={job.result} />
      </div>
      {job.live && (
        <p class="activity-live">
          {firstName(store, job) && <>{firstName(store, job)} · </>}
          {job.live.label ?? 'starting'} · <span class="activity-elapsed">{elapsed(job.live.elapsedMs)}</span>
        </p>
      )}
      <p class="activity-meta small">
        <span class="activity-model" title="Model">
          {job.model ?? 'no model'}
        </span>
        <span title="Wall time">{duration(job.wallMs)}</span>
        <span title={`${num(job.tokensIn)} in · ${num(job.tokensOut)} out`}>{num(tokens)} tokens</span>
        {job.score != null && <span>score {job.score}/10</span>}
        {job.day != null && job.minute != null && <span class="muted">{gameTime(job.day * 1440 + job.minute)}</span>}
        {job.refs.pr != null && <External href={pr}>{`PR #${job.refs.pr}`}</External>}
        {job.refs.mergedSha && <External href={merged}>{`merged ${job.refs.mergedSha.slice(0, 7)}`}</External>}
      </p>
      {job.error && <p class="small error-text activity-error">{job.error}</p>}
      {job.stages.length > 0 && (
        <button type="button" class="btn btn-quiet activity-toggle" aria-expanded={expanded} aria-controls={expanded ? `${id}-stages` : undefined} onClick={onToggle}>
          {expanded ? 'Hide stages' : `Stages (${job.stages.length})`}
        </button>
      )}
      {expanded && job.stages.length > 0 && (
        <div id={`${id}-stages`} class="activity-stages">
          {(job.startedAt != null || job.finishedAt != null) && (
            <p class="small muted">
              {job.startedAt != null && <>Started {clockTime(job.startedAt)}</>}
              {job.finishedAt != null && <> · ended {clockTime(job.finishedAt)}</>}
              {job.refs.branch && (
                <>
                  {' · '}
                  <code>{job.refs.branch}</code>
                </>
              )}
            </p>
          )}
          <div class="scroll-x">
            <table class="table">
              <caption class="sr-only">
                Stages of the {job.kind} job {job.jobId}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Stage</th>
                  <th scope="col">Try</th>
                  <th scope="col">Model</th>
                  <th scope="col" class="num">
                    Time
                  </th>
                  <th scope="col" class="num">
                    Tokens
                  </th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                {job.stages.map((s, i) => (
                  <StageRow key={i} s={s} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </article>
  )
}

function StageRow({ s }: { s: ActivityStage }) {
  return (
    <tr data-stage={`${s.stage}#${s.index}.${s.attempt}`}>
      <th scope="row">{stageLabel(s.stage, s.index)}</th>
      <td>{s.attempt}</td>
      <td class="activity-model">{s.model ?? '—'}</td>
      <td class="num">{duration(s.wallMs)}</td>
      <td class="num" title={`${num(s.tokensIn)} in · ${num(s.tokensOut)} out`}>
        {num(s.tokensIn + s.tokensOut)}
      </td>
      <td>
        <ResultBadge result={s.result} />
        {s.error && <span class="small error-text"> {s.error}</span>}
      </td>
    </tr>
  )
}

function Filters({ jobs, filter, onChange }: { jobs: ActivityJob[]; filter: ActivityFilter; onChange: (f: ActivityFilter) => void }) {
  const store = useStore()
  const uniq = (xs: Array<string | null>, keep: string | null) => [...new Set([...xs, keep].filter((x): x is string => !!x))]
  const staff = uniq(
    jobs.map((j) => j.staff),
    filter.staff,
  ).sort((a, b) => store.nameOf(a).localeCompare(store.nameOf(b)))
  const items = uniq(
    jobs.map((j) => j.workItem),
    filter.workItem,
  )
  const kinds = uniq(
    jobs.map((j) => j.kind),
    filter.kind,
  ).sort()
  const titleOf = (id: string) => store.planText.value.items[id]?.title || id
  const set = (k: keyof ActivityFilter) => (e: Event) => onChange({ ...filter, [k]: (e.currentTarget as HTMLSelectElement).value || null })
  return (
    <div class="toolbar-row filters" role="group" aria-label="Filter the activity">
      <label class="field-inline">
        <span>Person</span>
        <select value={filter.staff ?? ''} onChange={set('staff')}>
          <option value="">Anyone</option>
          {staff.map((s) => (
            <option key={s} value={s}>
              {store.nameOf(s)}
            </option>
          ))}
        </select>
      </label>
      <label class="field-inline">
        <span>Work item</span>
        <select value={filter.workItem ?? ''} onChange={set('workItem')}>
          <option value="">All</option>
          {items.map((i) => (
            <option key={i} value={i}>
              {titleOf(i)}
            </option>
          ))}
        </select>
      </label>
      <label class="field-inline">
        <span>Kind</span>
        <select value={filter.kind ?? ''} onChange={set('kind')}>
          <option value="">All</option>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {sentence(k)}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
