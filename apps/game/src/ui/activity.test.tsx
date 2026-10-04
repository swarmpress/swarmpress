// @vitest-environment jsdom
// The Activity panel and the HUD's "Now" strip (FEAT-078, increment U4;
// ADR-0058): who did what, with which model, in how long; the job in flight
// pinned on top from the orchestrator's progress events; filters; links;
// model text as text.
import { fireEvent, screen, within } from '@testing-library/preact'
import { afterEach, describe, expect, it } from 'vitest'
import { ACTIVITY_PAGE } from './activity-source'
import type { ActivityRowJson, LiveJob } from './data-source'
import { FIXTURE_LIVE_JOB_ID, FIXTURE_MODEL, fixtureActivityRows, fixtureLiveJobs } from './fixtures/activity'
import { hudClock, mountHud } from './hud'
import { flush, setup } from './testing'

const REPO = 'swarmpress/cinqueterre.travel'

let ctx: ReturnType<typeof setup> | null = null
let hud: { dispose(): void; el: HTMLElement } | null = null
afterEach(() => {
  ctx?.cleanup()
  ctx = null
  if (hud) {
    hud.dispose()
    hud.el.remove()
  }
  hud = null
})

const open = async (opts?: Parameters<typeof setup>[0]) => {
  ctx = setup({ site: { repo: REPO }, ...opts })
  ctx.store.panel.value = 'activity'
  await flush()
  await flush()
  return ctx
}
const panel = () => screen.getByRole('region', { name: 'Activity' })
const job = (id: number) => document.getElementById(`activity-job-${id}`) as HTMLElement
const listed = () => [...panel().querySelectorAll<HTMLElement>('ol.activity-list > li > article')].map((a) => Number(a.dataset.job))

const row = (job_id: number, stage: string, over: Partial<ActivityRowJson> = {}): ActivityRowJson => ({
  job_id,
  stage,
  idx: 0,
  attempt: 1,
  kind: 'review',
  revision: 0,
  work_item: 'work-item-1',
  staff: 'staff-5',
  role: 'editor',
  persona: 'marco',
  model: FIXTURE_MODEL,
  tokens_in: 3_000,
  tokens_out: 400,
  wall_ms: 61_000,
  game_step: 132_000,
  day: 11,
  minute: 600,
  result: 'done',
  detail: { score: 9 },
  created_at: Date.UTC(2026, 9, 2, 9, 0, 0),
  ...over,
})

describe('the Activity panel', () => {
  it('lists the jobs newest first: who, what, model, duration, tokens, result; the job in flight pinned on top', async () => {
    await open()
    const p = within(panel())
    // Pinned: Lorenzo's draft, section 3 of 5, 1:42 in (the progress event), with the stages done so far.
    const now = within(screen.getByRole('region', { name: 'Activity' }).querySelector('.activity-now') as HTMLElement)
    expect(now.getByRole('heading', { name: 'Now' })).toBeTruthy()
    const pinned = job(FIXTURE_LIVE_JOB_ID)
    expect(pinned.closest('.activity-now')).not.toBeNull()
    expect(pinned.querySelector('.activity-live')!.textContent).toBe('Lorenzo · section 3 of 5 · 1:42')
    expect(within(pinned).getByRole('button', { name: /Lorenzo/ })).toBeTruthy()
    expect(pinned.textContent).toContain('Running')
    expect(pinned.textContent).toContain('Sciacchetrà: the wine you climb for')

    // The finished jobs, newest first (the job in flight is not listed twice).
    expect(listed()).toEqual([9, 8, 7, 6, 5, 4, 3])
    expect(p.getByRole('heading', { name: /^Jobs/ }).textContent).toBe('Jobs (7)')
    const draft = job(4)
    expect(within(draft).getByRole('heading', { level: 4 }).textContent).toBe('Draft · Harvest week in Manarola')
    expect(within(draft).getByRole('button', { name: /Giulia Rossi/ })).toBeTruthy()
    const meta = draft.querySelector('.activity-meta')!.textContent!
    expect(meta).toContain(FIXTURE_MODEL)
    expect(meta).toContain('4:41') // 281 s of wall time
    expect(meta).toMatch(/[\d,]+ tokens/)
    expect(meta).toContain('Day 11 · 09:12')
    expect(draft.textContent).toContain('Done')
    // The revision says so; the failed draft says why; the standup has no work item; publish ran without a model.
    expect(within(job(6)).getByRole('heading', { level: 4 }).textContent).toBe('Draft · revision 1 · Harvest week in Manarola')
    expect(job(8).textContent).toContain('Failed')
    expect(job(8).querySelector('.activity-error')!.textContent).toBe('NeedsMedia')
    expect(within(job(3)).getByRole('heading', { level: 4 }).textContent).toBe('Standup')
    expect(job(9).querySelector('.activity-model')!.textContent).toBe('no model')
  })

  it('expands a job to its stages and attempts (a repaired section, a failed stage)', async () => {
    await open()
    const toggle = within(job(4)).getByRole('button', { name: 'Stages (9)' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(toggle.hasAttribute('aria-controls')).toBe(false)
    fireEvent.click(toggle)
    await flush()
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    const table = document.getElementById(toggle.getAttribute('aria-controls')!)!
    const rows = [...table.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((c) => c.textContent!.trim()))
    expect(rows.map((r) => `${r[0]}|${r[1]}|${r[5]}`)).toEqual([
      'Context|1|Done',
      'Outline|1|Done',
      'Intro|1|Done',
      'Section 1|1|Done',
      'Section 2|1|Repaired',
      'Section 2|2|Done',
      'Section 3|1|Done',
      'Closing note|1|Done',
      'Commit|1|Done',
    ])
    expect(rows[0][2]).toBe('—')
    expect(rows[1][2]).toBe(FIXTURE_MODEL)
    expect(table.textContent).toMatch(/Started \d\d:\d\d:\d\d · ended \d\d:\d\d:\d\d/)
    fireEvent.click(within(job(8)).getByRole('button', { name: 'Stages (1)' }))
    await flush()
    expect(job(8).querySelector('tbody tr')!.textContent).toContain('Failed no hero image')
    fireEvent.click(toggle)
    await flush()
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(within(job(4)).queryByRole('table')).toBeNull()
  })

  it('filters by person, work item and kind', async () => {
    await open()
    const filters = within(screen.getByRole('group', { name: 'Filter the activity' }))
    const person = filters.getByLabelText('Person') as HTMLSelectElement
    // Everyone with a loaded job, by name.
    expect([...person.options].map((o) => o.textContent)).toEqual(['Anyone', 'Giulia Rossi', 'Isabella Conti', 'Lorenzo Bassi', 'Marco Ferretti', 'Sophia Lang'])
    fireEvent.change(person, { target: { value: 'staff-5' } })
    await flush()
    expect(listed()).toEqual([7, 5])
    fireEvent.change(person, { target: { value: '' } })
    fireEvent.change(filters.getByLabelText('Kind'), { target: { value: 'draft' } })
    await flush()
    expect(listed()).toEqual([8, 6, 4])
    const item = filters.getByLabelText('Work item') as HTMLSelectElement
    expect([...item.options].map((o) => o.textContent)).toContain('Harvest week in Manarola')
    fireEvent.change(item, { target: { value: 'work-item-10' } })
    await flush()
    expect(listed()).toEqual([8])
    fireEvent.change(filters.getByLabelText('Kind'), { target: { value: 'review' } })
    await flush()
    expect(listed()).toEqual([])
    expect(panel().querySelector('.activity-empty')!.textContent).toBe('No job matches these filters.')
    // The job in flight stays pinned whatever the filters say.
    expect(job(FIXTURE_LIVE_JOB_ID)).not.toBeNull()
  })

  it('updates live: a new row appears, and the pinned job follows the progress events', async () => {
    const c = await open()
    // The job in flight moves on to section 4; then it ends and its job row is written.
    const [live] = fixtureLiveJobs()
    c.source.setLive([{ ...live, index: 4, label: 'section 4 of 5', elapsedMs: 131_000 }])
    await flush()
    await flush()
    expect(job(FIXTURE_LIVE_JOB_ID).querySelector('.activity-live')!.textContent).toBe('Lorenzo · section 4 of 5 · 2:11')
    c.source.setLive([])
    c.source.addActivity([
      { ...fixtureActivityRows().find((r) => r.job_id === FIXTURE_LIVE_JOB_ID)!, stage: 'job', idx: 0, tokens_in: 9_000, tokens_out: 1_300, wall_ms: 190_000, result: 'done', detail: { pr: 32 } },
    ])
    await flush()
    await flush()
    expect(panel().querySelector('.activity-now')).toBeNull()
    expect(listed()[0]).toBe(FIXTURE_LIVE_JOB_ID)
    expect(job(FIXTURE_LIVE_JOB_ID).textContent).toContain('Done')
    expect(job(FIXTURE_LIVE_JOB_ID).querySelector('.activity-meta')!.textContent).toContain('10,300 tokens')
    // A new job starts: pinned before its first row.
    const next: LiveJob = { ...live, jobId: 11, kind: 'review', staff: 'staff-5', persona: 'marco', role: 'editor', stage: 'review', index: 0, total: 1, label: 'reading the draft', elapsedMs: 4_000 }
    c.source.setLive([next])
    await flush()
    await flush()
    expect(job(11).closest('.activity-now')).not.toBeNull()
    expect(job(11).querySelector('.activity-live')!.textContent).toBe('Marco · reading the draft · 0:04')
  })

  it('renders model and service text as text, never as markup', async () => {
    const evil = '<img src=x onerror="window.__pwned=1"><b>bold</b>'
    await open({
      activity: [row(1, 'review', { model: evil, result: 'failed', detail: { error: evil } }), row(1, 'job', { model: evil, result: 'failed', detail: { error: `<script>window.__pwned=2</script>` } })],
    })
    const card = job(1)
    expect(card.querySelector('img, b, script')).toBeNull()
    expect(card.querySelector('.activity-model')!.textContent).toBe(evil)
    expect(card.querySelector('.activity-error')!.textContent).toBe('<script>window.__pwned=2</script>')
    fireEvent.click(within(card).getByRole('button', { name: 'Stages (1)' }))
    await flush()
    expect(card.querySelector('img, b, script')).toBeNull()
    expect(card.querySelector('tbody')!.textContent).toContain(evil)
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined()
  })

  it('links: the pull request opens outside the game, the work item opens in the Plan', async () => {
    const c = await open()
    const pr = within(job(4)).getByRole('link', { name: 'PR #31' })
    expect(pr.getAttribute('href')).toBe(`https://github.com/${REPO}/pull/31`)
    expect(pr.getAttribute('target')).toBe('_blank')
    expect(pr.getAttribute('rel')).toBe('noopener noreferrer')
    expect(within(job(9)).getByRole('link', { name: 'merged 4be81c2' }).getAttribute('href')).toBe(`https://github.com/${REPO}/commit/4be81c2d9a01`)
    fireEvent.click(within(job(4)).getByRole('button', { name: 'Harvest week in Manarola' }))
    await flush()
    expect(c.store.panel.value).toBe('plan')
    expect(c.store.selectedItem.value).toBe('work-item-1')
    expect(screen.getByRole('region', { name: /Media & publishing plan/ }).querySelector('.detail-title')!.textContent).toBe('Harvest week in Manarola')
  })

  it('without a repository the pull request is plain text', async () => {
    await open({ site: { repo: null } })
    expect(within(job(4)).queryByRole('link')).toBeNull()
    expect(job(4).querySelector('.activity-meta')!.textContent).toContain('PR #31')
  })

  it('says so when there is nothing yet', async () => {
    await open({ activity: [] })
    expect(panel().querySelector('.activity-now')).toBeNull()
    expect(panel().querySelector('.activity-empty')!.textContent).toMatch(/^No jobs yet\./)
    expect(within(panel()).queryByRole('button', { name: 'Load older jobs' })).toBeNull()
  })

  // 230 rows in jsdom: over 5 s on a loaded CI runner.
  it('loads a bounded window and older jobs on demand', async () => {
    const many = Array.from({ length: ACTIVITY_PAGE + 30 }, (_, i) => row(i + 1, 'job'))
    const c = await open({ activity: many })
    expect(listed()).toHaveLength(ACTIVITY_PAGE)
    expect(c.source.activityReads).toEqual([{ limit: ACTIVITY_PAGE }])
    fireEvent.click(within(panel()).getByRole('button', { name: 'Load older jobs' }))
    await flush()
    await flush()
    expect(listed()).toHaveLength(ACTIVITY_PAGE + 30)
    expect(c.source.activityReads[1]).toEqual({ limit: ACTIVITY_PAGE, before: 31 })
    expect(within(panel()).queryByRole('button', { name: 'Load older jobs' })).toBeNull()
  }, 30_000)

  it('reads nothing while closed', async () => {
    const c = setup()
    ctx = c
    await flush()
    c.source.addActivity([row(20, 'job')])
    await flush()
    expect(c.source.activityReads).toEqual([])
    c.store.togglePanel('activity')
    await flush()
    expect(c.source.activityReads).toHaveLength(1)
    c.store.togglePanel('activity')
    await flush()
    c.source.addActivity([row(21, 'job')])
    await flush()
    expect(c.source.activityReads).toHaveLength(1)
  })

  it('is not offered by a source without an activity record', async () => {
    ctx = setup({ activity: null })
    await flush()
    expect(ctx.store.panels.map((p) => p.id)).not.toContain('activity')
    ctx.store.openActivity(3)
    expect(ctx.store.panel.value).toBeNull()
  })
})

describe('the HUD Now strip', () => {
  const mountBoth = async (state: 'running' | 'held' | null) => {
    const c = setup()
    ctx = c
    const el = document.createElement('div')
    document.body.appendChild(el)
    const h = mountHud(el, null)
    hud = { dispose: h.dispose, el }
    h.set({ clock: '09:20', day: 11, renderer: 'webgl2', version: '0.2.0', fps: 60 })
    if (state) {
      const status = state === 'held' ? { state, label: 'Held', detail: 'Lorenzo · draft · section 3 of 5' } : { state, label: 'Running', detail: null }
      h.setClock({ status, paused: false, speed: 1, unattendedDays: 0, resting: false })
    } else h.setClock(null)
    await flush()
    await flush()
    return c
  }

  it('says what runs now and opens the Activity panel on that job', async () => {
    const c = await mountBoth('running')
    const strip = screen.getByRole('button', { name: /^Now: / })
    expect(strip.querySelector('.hud-now-text')!.textContent).toBe('Lorenzo · draft · section 3 of 5')
    expect(strip.querySelector('.hud-now-time')!.textContent).toBe('1:42')
    expect(strip.getAttribute('aria-label')).toBe('Now: Lorenzo · draft · section 3 of 5, 1:42. Open in Activity')
    fireEvent.click(strip)
    await flush()
    await flush()
    expect(c.store.panel.value).toBe('activity')
    const pinned = job(FIXTURE_LIVE_JOB_ID)
    // Opened on the job: expanded, and focused.
    expect(within(pinned).getByRole('button', { name: 'Hide stages' }).getAttribute('aria-expanded')).toBe('true')
    await new Promise((r) => setTimeout(r, 5))
    expect(document.activeElement).toBe(pinned)
    // The time moves with the progress events.
    c.source.setLive([{ ...fixtureLiveJobs()[0], elapsedMs: 103_500 }])
    await flush()
    await flush()
    expect(document.querySelector('.hud-now-time')!.textContent).toBe('1:43')
  })

  it('is gone when nothing runs', async () => {
    const c = await mountBoth('running')
    c.source.setLive([])
    await flush()
    await flush()
    expect(document.querySelector('.hud-now')).toBeNull()
    expect(screen.queryByRole('button', { name: /^Now: / })).toBeNull()
  })

  it('a held clock already says it on the chip: the chip opens the job, no second line', async () => {
    const c = await mountBoth('held')
    expect(document.querySelector('.hud-now')).toBeNull()
    const chip = document.querySelector('.hud-chip') as HTMLElement
    expect(chip.tagName).toBe('BUTTON')
    expect(chip.dataset.state).toBe('held')
    expect(chip.textContent).toBe('HeldLorenzo · draft · section 3 of 51:42')
    expect(chip.getAttribute('aria-label')).toBe('Held: Lorenzo · draft · section 3 of 5, 1:42. Open in Activity')
    fireEvent.click(chip)
    await flush()
    expect(c.store.panel.value).toBe('activity')
  })

  it('renders nothing on a frozen screenshot page (no clock HUD)', async () => {
    await mountBoth(null)
    expect(hudClock.value).toBeNull()
    expect(document.querySelector('.hud-now')).toBeNull()
    expect(document.querySelector('.hud')!.className).toBe('hud')
    expect(within(document.querySelector('.hud') as HTMLElement).queryAllByRole('button')).toEqual([])
  })
})
