// The Activity panel's data (FEAT-078, U4; ADR-0058): rows of the activity
// record grouped into jobs with their stages, newest first; bounded reads; a
// re-read only when the record changed.
import { signal } from '@preact/signals'
import { describe, expect, it } from 'vitest'
import { createActivityFeed, filterJobs, groupActivity, NO_FILTER, pageOf } from './activity-source'
import type { ActivityRowJson, LiveJob } from './data-source'
import { FIXTURE_LIVE_JOB_ID, FIXTURE_MODEL, fixtureActivityRows, fixtureLiveJobs } from './fixtures/activity'
import { MockDataSource } from './mock-source'

const flush = () => new Promise((r) => setTimeout(r, 0))

const row = (job_id: number, stage: string, over: Partial<ActivityRowJson> = {}): ActivityRowJson => ({
  job_id,
  stage,
  idx: 0,
  attempt: 1,
  kind: 'draft',
  revision: 0,
  work_item: 'work-item-1',
  staff: 'staff-1',
  role: 'writer',
  persona: 'giulia',
  model: 'fake-mvp',
  tokens_in: 100,
  tokens_out: 20,
  wall_ms: 40,
  game_step: 1100,
  day: 0,
  minute: 552,
  result: 'done',
  detail: {},
  created_at: 1_000_000 + job_id * 1000,
  ...over,
})

/** `n` finished jobs, ids 1…n: a stage row and a job row each. */
const jobs = (n: number) => Array.from({ length: n }, (_, i) => [row(i + 1, 'section', { idx: 1 }), row(i + 1, 'job')]).flat()

describe('grouping the record into jobs', () => {
  it('lists jobs newest first, each with its stages in write order, attempts and failed stages kept', () => {
    const grouped = groupActivity(fixtureActivityRows())
    expect(grouped.map((j) => `${j.jobId}:${j.kind}:${j.result}`)).toEqual([
      '10:draft:unfinished',
      '9:publish:done',
      '8:draft:failed',
      '7:review:done',
      '6:draft:done',
      '5:review:done',
      '4:draft:done',
      '3:standup:done',
    ])
    const draft = grouped.find((j) => j.jobId === 4)!
    expect(draft).toMatchObject({ staff: 'staff-1', persona: 'giulia', role: 'writer', workItem: 'work-item-1', model: FIXTURE_MODEL, wallMs: 281_000, words: 842, day: 10, minute: 552 })
    expect(draft.stages.map((s) => `${s.stage}#${s.index}.${s.attempt}:${s.result}`)).toEqual([
      'context#0.1:done',
      'outline#0.1:done',
      'section#0.1:done',
      'section#1.1:done',
      'section#2.1:repaired',
      'section#2.2:done',
      'section#3.1:done',
      'closing#0.1:done',
      'commit#0.1:done',
    ])
    // The job row carries the totals and the pull request.
    expect(draft.tokensIn).toBe(draft.stages.reduce((a, s) => a + s.tokensIn, 0))
    expect(draft.refs).toMatchObject({ pr: 31, branch: 'drafts/harvest-week-in-manarola', sha: '9f2c1aa7b3e4' })
    expect(draft.finishedAt! - draft.startedAt!).toBe(281_000)
    // A stage without a model call has none; the context stage is one.
    expect(draft.stages[0]).toMatchObject({ stage: 'context', model: null, tokensIn: 0 })

    const failed = grouped.find((j) => j.jobId === 8)!
    expect(failed).toMatchObject({ result: 'failed', error: 'NeedsMedia', model: null })
    expect(failed.stages).toEqual([expect.objectContaining({ stage: 'context', result: 'failed', error: 'no hero image' })])

    expect(grouped.find((j) => j.jobId === 9)).toMatchObject({ kind: 'publish', model: null, refs: { mergedSha: '4be81c2d9a01' } })
    expect(grouped.find((j) => j.jobId === 5)).toMatchObject({ score: 6, staff: 'staff-5' })
  })

  it('a job without a job row is unfinished; with progress it is the job in flight, even before its first row', () => {
    const [live] = fixtureLiveJobs()
    const grouped = groupActivity(fixtureActivityRows(), [live])
    const job = grouped[0]
    expect(job).toMatchObject({ jobId: FIXTURE_LIVE_JOB_ID, result: 'running', wallMs: 102_000, model: FIXTURE_MODEL, workItem: 'work-item-2', staff: 'staff-3' })
    expect(job.live).toMatchObject({ label: 'section 3 of 5' })
    expect(job.stages).toHaveLength(5)
    // Summed from the stages written so far.
    expect(job.tokensIn).toBe(job.stages.reduce((a, s) => a + s.tokensIn, 0))

    const fresh: LiveJob = { ...live, jobId: 11, stage: null, index: 0, total: 0, label: null, model: null, elapsedMs: 900 }
    const withFresh = groupActivity(fixtureActivityRows(), [live, fresh])
    expect(withFresh[0]).toMatchObject({ jobId: 11, result: 'running', stages: [], kind: 'draft', staff: 'staff-3', wallMs: 900 })
  })

  it('a re-run job (a reload) shows its replaced job row once, with the reused stages', () => {
    const rows = [row(2, 'section', { idx: 1 }), row(2, 'section', { idx: 2, result: 'reused', tokens_in: 0 }), row(2, 'job', { tokens_in: 4100, detail: { pr: 1 } })]
    const [job] = groupActivity(rows)
    expect(job).toMatchObject({ jobId: 2, result: 'done', tokensIn: 4100, refs: { pr: 1 } })
    expect(job.stages.map((s) => s.result)).toEqual(['done', 'reused'])
  })

  it('filters by person, work item and kind', () => {
    const grouped = groupActivity(fixtureActivityRows())
    expect(filterJobs(grouped, NO_FILTER)).toHaveLength(grouped.length)
    expect(filterJobs(grouped, { ...NO_FILTER, staff: 'staff-5' }).map((j) => j.jobId)).toEqual([7, 5])
    expect(filterJobs(grouped, { ...NO_FILTER, workItem: 'work-item-1', kind: 'draft' }).map((j) => j.jobId)).toEqual([6, 4])
    expect(filterJobs(grouped, { staff: 'staff-1', workItem: 'work-item-10', kind: null })).toEqual([])
  })
})

describe('bounded reads', () => {
  it('pageOf reads a window of jobs, never more, with whether older ones exist', () => {
    const rows = jobs(5)
    expect(pageOf(rows, { limit: 2 })).toMatchObject({ more: true })
    expect(pageOf(rows, { limit: 2 }).rows.map((r) => r.job_id)).toEqual([5, 5, 4, 4])
    expect(pageOf(rows, { limit: 2, before: 4 }).rows.map((r) => r.job_id)).toEqual([3, 3, 2, 2])
    expect(pageOf(rows, { limit: 2, before: 2 })).toMatchObject({ more: false })
  })

  it('the feed loads the newest 200 jobs, then older pages on demand', async () => {
    const source = new MockDataSource({ activity: jobs(450) })
    const feed = createActivityFeed(source, signal([]))
    await flush()
    expect(feed.loading.value).toBe(false)
    expect(source.activityReads).toEqual([{ limit: 200 }])
    expect(feed.jobs.value).toHaveLength(200)
    expect(feed.jobs.value[0].jobId).toBe(450)
    expect(feed.more.value).toBe(true)
    await feed.loadOlder()
    expect(source.activityReads[1]).toEqual({ limit: 200, before: 251 })
    expect(feed.jobs.value).toHaveLength(400)
    expect(feed.more.value).toBe(true)
    await feed.loadOlder()
    expect(feed.jobs.value).toHaveLength(450)
    expect(feed.jobs.value.at(-1)!.jobId).toBe(1)
    expect(feed.more.value).toBe(false)
    expect(source.activityReads.every((q) => q.limit === 200)).toBe(true)
    feed.dispose()
  })

  it('reads again only when the record changed: a new row appears, older pages stay', async () => {
    const source = new MockDataSource({ activity: jobs(3) })
    const live = signal<LiveJob[]>([])
    const feed = createActivityFeed(source, live, { pageSize: 2 })
    await flush()
    await feed.loadOlder()
    expect(feed.jobs.value.map((j) => j.jobId)).toEqual([3, 2, 1])
    const reads = source.activityReads.length
    // A notification without a change (the clock) reads nothing.
    source.setLive([])
    await flush()
    expect(source.activityReads).toHaveLength(reads)
    // A stage of job 4 is written: one read of the newest window.
    source.addActivity([row(4, 'outline')])
    await flush()
    expect(source.activityReads).toHaveLength(reads + 1)
    expect(feed.jobs.value.map((j) => `${j.jobId}:${j.result}`)).toEqual(['4:unfinished', '3:done', '2:done', '1:done'])
    // Its job row: the same job, now done.
    source.addActivity([row(4, 'job')])
    await flush()
    expect(feed.jobs.value.map((j) => `${j.jobId}:${j.result}`)).toEqual(['4:done', '3:done', '2:done', '1:done'])
    // The job in flight comes from progress, not from a read.
    live.value = [{ ...fixtureLiveJobs()[0], jobId: 5 }]
    expect(feed.jobs.value[0]).toMatchObject({ jobId: 5, result: 'running' })
    feed.dispose()
    source.addActivity([row(6, 'job')])
    await flush()
    expect(source.activityReads).toHaveLength(reads + 2)
  })

  it('a failed read says why and keeps what it had', async () => {
    const source = new MockDataSource({ activity: jobs(2) })
    const feed = createActivityFeed(source, signal([]))
    await flush()
    source.getActivity = async () => {
      throw new Error('database is locked')
    }
    source.addActivity([row(3, 'job')])
    await flush()
    expect(feed.error.value).toBe('database is locked')
    expect(feed.jobs.value.map((j) => j.jobId)).toEqual([2, 1])
    feed.dispose()
  })
})
