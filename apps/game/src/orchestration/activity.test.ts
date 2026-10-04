// The lean activity record (ADR-0058 decision 9, FEAT-078) and the HUD chip's
// "Giulia · draft · section 3 of 5" (counts only), from progress events and
// the bridge's per-call usage.
import { describe, expect, it } from 'vitest'
import type { LlmCallRecord, ProgressEvent } from '../orchestrator/bridge'
import { CompanyStore } from '../store/company-store'
import { MemorySqliteDriver } from '../store/sqlite-driver'
import { ActivityRecorder, heldByText, progressLabel } from './activity'

const ev = (stage: string, index: number, total: number, state: ProgressEvent['state'], detail: Record<string, unknown> = {}, jobId = 2): ProgressEvent => ({
  job_id: jobId,
  kind: 'draft',
  revision: 0,
  work_item: 'work-item-1',
  staff: 'staff-1',
  persona: 'giulia',
  role: 'writer',
  stage,
  index,
  total,
  state,
  detail,
})

const call = (promptTokens: number, completionTokens: number, ok = true): LlmCallRecord => ({
  kind: 'structured',
  model: 'fake-mvp',
  promptTokens,
  completionTokens,
  reasoningTokens: 0,
  turns: 1,
  wallMs: 40,
  ok,
})

async function recorder() {
  const store = await CompanyStore.open(await MemorySqliteDriver.open())
  let t = 0
  const r = new ActivityRecorder({ store, companyId: 'c1', clock: () => ({ step: 1100, day: 0, minute: 552 }), now: () => (t += 10) })
  return { store, r }
}

/** A draft job: context, outline, intro, three sections (section 2 repaired once), closing, commit. */
function draft(r: ActivityRecorder, jobId = 2) {
  const e = (stage: string, index: number, total: number, state: ProgressEvent['state'], detail = {}) => r.progress(ev(stage, index, total, state, detail, jobId))
  e('job', 0, 1, 'started')
  e('context', 0, 1, 'started')
  e('context', 0, 1, 'done', { heroes: 6 })
  e('outline', 0, 1, 'started')
  r.call(call(1500, 300))
  e('outline', 0, 1, 'done')
  for (const i of [0, 1, 2, 3]) {
    e('section', i, 3, 'started')
    r.call(call(1800, 260, i !== 2))
    if (i === 2) r.call(call(2100, 250))
    e('section', i, 3, 'done', { words: 150 })
  }
  e('closing', 0, 1, 'started')
  r.call(call(1600, 90))
  e('closing', 0, 1, 'done')
  e('commit', 0, 1, 'started')
  e('commit', 0, 1, 'done', { pr: 1, branch: 'drafts/content-x', sha: 'abc123' })
  e('job', 0, 1, 'done', { pr: 1, branch: 'drafts/content-x', sha: 'abc123', words: 610 })
}

describe('the activity record', () => {
  it('writes one row per stage attempt and one per job, with staff, model, tokens, time and the game clock', async () => {
    const { store, r } = await recorder()
    draft(r)
    await r.flush()
    const rows = await store.activity('c1')
    expect(rows.map((x) => `${x.stage}#${x.idx}.${x.attempt}:${x.result}`)).toEqual([
      'context#0.1:done',
      'outline#0.1:done',
      'section#0.1:done',
      'section#1.1:done',
      'section#2.1:repaired',
      'section#2.2:done',
      'section#3.1:done',
      'closing#0.1:done',
      'commit#0.1:done',
      'job#0.1:done',
    ])
    const job = rows[rows.length - 1]
    expect(job).toMatchObject({ job_id: 2, kind: 'draft', revision: 0, work_item: 'work-item-1', staff: 'staff-1', role: 'writer', persona: 'giulia', model: 'fake-mvp' })
    expect(job.tokens_in).toBe(1500 + 1800 * 4 + 2100 + 1600)
    expect(job.tokens_out).toBe(300 + 260 * 4 + 250 + 90)
    expect(job.detail).toMatchObject({ pr: 1, branch: 'drafts/content-x', sha: 'abc123' })
    expect(job.wall_ms).toBeGreaterThan(0)
    expect(job).toMatchObject({ game_step: 1100, day: 0, minute: 552 })
    const repaired = rows.find((x) => x.stage === 'section' && x.idx === 2 && x.attempt === 1)!
    expect(repaired).toMatchObject({ tokens_in: 1800, tokens_out: 260, model: 'fake-mvp', detail: { ok: false } })
    expect(rows.find((x) => x.stage === 'context')).toMatchObject({ tokens_in: 0, model: null, detail: { heroes: 6 } })
  })

  it('a re-run job (a reload) adds no rows: reused stages keep their attempt, the job row is replaced', async () => {
    const { store, r } = await recorder()
    draft(r)
    await r.flush()
    const before = await store.activity('c1')
    // The same job again: every stage comes from the stage store.
    r.progress(ev('job', 0, 1, 'started'))
    for (const [stage, index, total] of [['context', 0, 1], ['outline', 0, 1], ['section', 0, 3], ['section', 1, 3], ['section', 2, 3], ['section', 3, 3], ['closing', 0, 1]] as const) {
      r.progress(ev(stage, index, total, 'reused'))
    }
    r.progress(ev('commit', 0, 1, 'started'))
    r.progress(ev('commit', 0, 1, 'done', { pr: 1 }))
    r.progress(ev('job', 0, 1, 'done', { pr: 1 }))
    await r.flush()
    const after = await store.activity('c1')
    expect(after).toHaveLength(before.length)
    expect(after.find((x) => x.stage === 'section' && x.idx === 1)).toEqual(before.find((x) => x.stage === 'section' && x.idx === 1))
    expect(after.find((x) => x.stage === 'job')!.tokens_in).toBe(0)
    expect(r.errors).toEqual([])
  })

  it('a failed stage and a failed job are rows too', async () => {
    const { store, r } = await recorder()
    r.progress(ev('job', 0, 1, 'started'))
    r.progress(ev('context', 0, 1, 'started'))
    r.progress(ev('context', 0, 1, 'failed', { error: 'no hero image' }))
    r.progress(ev('job', 0, 1, 'failed', { halt: 'NeedsMedia' }))
    await r.flush()
    expect((await store.activity('c1')).map((x) => [x.stage, x.result, x.detail])).toEqual([
      ['context', 'failed', { error: 'no hero image' }],
      ['job', 'failed', { halt: 'NeedsMedia' }],
    ])
  })
})

describe('the HUD chip data', () => {
  it('says what a job is doing in counts', () => {
    expect(progressLabel(ev('section', 3, 5, 'started'))).toBe('section 3 of 5')
    expect(progressLabel(ev('section', 0, 5, 'started'))).toBe('intro')
    expect(progressLabel(ev('outline', 0, 1, 'started'))).toBe('outline')
    expect(progressLabel(ev('closing', 0, 1, 'started'))).toBe('closing note')
    expect(progressLabel(ev('revise', 2, 3, 'started'))).toBe('revising section 2 of 3')
    expect(progressLabel(ev('revise', 4, 3, 'started'))).toBe('revising the closing note')
    expect(progressLabel(ev('fix', 0, 3, 'started'))).toBe('fixing the intro')
    expect(progressLabel(ev('review', 0, 1, 'started'))).toBe('reading the draft')
    expect(progressLabel(ev('review_section', 2, 5, 'started'))).toBe('reading section 2 of 5')
    expect(progressLabel(ev('review_summary', 0, 1, 'started'))).toBe('summing up')
    expect(progressLabel(ev('job', 0, 1, 'started'))).toBeNull()
    for (const e of ['section', 'revise', 'review_section']) expect(progressLabel(ev(e, 1, 4, 'started'))).not.toMatch(/%/)
  })

  it('"Giulia · draft · section 3 of 5" while a stage runs, from the latest progress event', async () => {
    const { r } = await recorder()
    const job = { job_id: 2, who: 'Giulia', kind: 'draft', state: 'running' }
    expect(heldByText(job, r.label(2))).toBe('Giulia · draft')
    r.progress(ev('job', 0, 1, 'started'))
    r.progress(ev('section', 3, 5, 'started'))
    expect(heldByText(job, r.label(2))).toBe('Giulia · draft · section 3 of 5')
    expect(r.current()).toMatchObject({ stage: 'section', index: 3, total: 5 })
    // A queued job shows no stage; a finished job none at all.
    expect(heldByText({ ...job, state: 'queued' }, r.label(2))).toBe('Giulia · draft')
    r.progress(ev('section', 3, 5, 'done'))
    r.progress(ev('job', 0, 1, 'done'))
    expect(r.label(2)).toBeNull()
    expect(heldByText({ who: null, kind: 'standup', state: 'running' }, null)).toBe('standup')
  })

  it('lists the jobs in flight with their stage now, model and elapsed time (the Activity panel and the Now strip, U4)', async () => {
    const { r } = await recorder()
    expect(r.live()).toEqual([])
    r.progress(ev('job', 0, 1, 'started'))
    expect(r.live()).toEqual([
      expect.objectContaining({ jobId: 2, kind: 'draft', staff: 'staff-1', persona: 'giulia', workItem: 'work-item-1', stage: null, label: null, model: null }),
    ])
    r.progress(ev('section', 3, 5, 'started'))
    r.call(call(1800, 260))
    const [job] = r.live()
    expect(job).toMatchObject({ stage: 'section', index: 3, total: 5, label: 'section 3 of 5', model: 'fake-mvp' })
    // The test clock moves 10 ms a read: started at 10, read at 40 and later.
    expect(job.elapsedMs).toBeGreaterThan(0)
    expect(r.live()[0].elapsedMs).toBeGreaterThan(job.elapsedMs)
    r.progress(ev('section', 3, 5, 'done'))
    r.progress(ev('job', 0, 1, 'failed', { halt: 'Timeout' }))
    expect(r.live()).toEqual([])
  })
})
