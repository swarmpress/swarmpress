// The MVP acceptance test (docs/mvp.md, "one article, end to end"), on the
// REAL game page (`/?central=1`, production build) against the real
// simpress-server (dev auth, fake GitHub, simulated deploys) with the scripted
// `?llm=fake` model:
//
//   dev login → company founded → fast-forward to 09:00
//   → standup → draft PR → review 6 → revision → review 8 → merge
//   → DeployLanded via the events API → item published
//   → the Plan panel shows the thread
//   → a reload restores everything from OPFS
//   → a fresh browser context restores from central sync
//
// The sim runs in the page's own render loop (`speed=` only scales the clock);
// the spec observes through `window.__simpress.session` and drives nothing but
// the clock (pause). Run with `playwright test -c playwright.mvp.config.ts`
// (one project per store engine).
import { expect, test, type Page } from '@playwright/test'
import type { SessionHook } from '../src/session/session'

const ITEM = 'work-item-1'
const TITLE = 'Harvest week in Manarola'
const JOBS = ['standup:0', 'draft:0', 'review:0', 'draft:1', 'review:1', 'publish:1']
/** The thread of the work item, oldest first (src/llm/mvp-script.ts MVP_POST_TYPES). */
const POST_TYPES = ['minutes', 'artifact', 'handoff', 'review', 'artifact', 'handoff', 'review', 'artifact', 'status']
/** MeetingOutcome + 5 JobCompleted + DeployLanded. */
const LOGGED = ['MeetingOutcome', 'JobCompleted', 'JobCompleted', 'JobCompleted', 'JobCompleted', 'JobCompleted', 'DeployLanded']


const gameUrl = (engine: string, login: string, extra = '') =>
  `/?central=1&login=${login}&llm=fake&store=${engine}&renderer=webgl&quality=low&ff=09:00${extra}`

/** Opens the game page and waits for the session and the first frames. Fails fast when boot threw. */
async function boot(page: Page, url: string) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error' && /\[(session|orchestration)\]/.test(m.text())) errors.push(m.text())
  })
  await page.goto(url)
  await page.waitForFunction(
    () => {
      const failed = document.body.dataset.error
      if (failed) throw new Error(`the game page failed to boot: ${failed}`)
      const h = (window as unknown as { __simpress?: { frames(): number; session: unknown } }).__simpress
      return !!h && !!h.session && h.frames() > 5
    },
    null,
    { timeout: 120_000 },
  )
  return errors
}

/** Calls a method of the page's session hook (`window.__simpress.session`). */
function session<K extends keyof SessionHook>(page: Page, method: K): Promise<Awaited<ReturnType<SessionHook[K]>>> {
  return page.evaluate((m) => {
    const hook = (window as unknown as { __simpress: { session: Record<string, () => unknown> } }).__simpress.session
    return hook[m]()
  }, method) as Promise<Awaited<ReturnType<SessionHook[K]>>>
}

/** A JSON view of the page's sim (`window.__simpress.sim`). */
function simJson<T>(page: Page, view: 'org_json' | 'plan_json'): Promise<T> {
  return page.evaluate((v) => {
    const sim = (window as unknown as { __simpress: { sim: Record<string, () => string> } }).__simpress.sim
    return JSON.parse(sim[v]())
  }, view) as Promise<T>
}

const info = (page: Page) => session(page, 'info')
const state = (page: Page) => session(page, 'state')
const items = (page: Page) => session(page, 'items')
const postTypes = async (page: Page) => ((await session(page, 'planText')).posts[ITEM] ?? []).map((p) => p.type)
/** The command log in the page's store (OPFS). */
const logKinds = async (page: Page) => (await session(page, 'commandLog')).map((c) => c.kind)

interface SimPlan {
  items: { id: string; status: string }[]
  feed: { kind: string; workItem: string }[]
}

/** The Plan panel: open the work item and check its thread, as the CEO sees it. */
async function expectThreadInPlanPanel(page: Page, shot: string) {
  await page.getByRole('navigation', { name: 'CEO tools' }).getByRole('button', { name: /^Plan/ }).click()
  const plan = page.getByRole('region', { name: 'Media & publishing plan', exact: true })
  await expect(plan).toBeVisible()
  await plan.getByRole('button', { name: TITLE, exact: true }).first().click()
  await expect(plan.locator('.detail-title')).toHaveText(TITLE)
  await expect(plan.locator('.work-item .card-row')).toContainText('Published')
  const posts = plan.locator('ol.posts > li.post')
  await expect(posts).toHaveCount(POST_TYPES.length)
  expect(await posts.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.type))).toEqual(POST_TYPES)
  await expect(plan.getByText('Changes requested · score 6/10')).toBeVisible()
  await expect(plan.getByText('Approved · score 8/10')).toBeVisible()
  await expect(posts.nth(0)).toContainText('Sciacchetrà')
  await expect(posts.nth(8)).toContainText('the deploy landed')
  await page.screenshot({ path: `test-results/mvp/${shot}.png` })
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
}

test('one article, end to end, in the real game page', async ({ page, browser, baseURL }, ti) => {
  const engine = ti.project.name
  const login = `mvp-${engine}-${Date.now().toString(36)}`
  // `speed=10`: ten sim steps per 100 ms, so a game hour takes five seconds.
  const url = gameUrl(engine, login, '&speed=10')

  // ---------------------------------------------------------------- dev login → company founded
  const errors = await boot(page, url)
  const first = await info(page)
  expect(first.login).toBe(login)
  expect(first.companyId).toBeTruthy()
  expect(first.companyName).toBe(`${login} Dispatch`)
  expect(first.leaseId).toBeTruthy()
  expect(first.engine).toBe(engine)
  expect(first.persistent).toBe(true)
  expect(first.restored).toMatchObject({ source: 'new', step: 0, replayed: 0, checkpoint: null })
  // The server agrees: a session for this login, owning that company.
  const me = await page.evaluate(async () => (await fetch('/api/me')).json())
  expect(me.user.login).toBe(login)
  expect(me.company.id).toBe(first.companyId)
  expect(me.company.seed).toBe(first.seed)
  // The sim-core scenario "cinqueterre": 13 people.
  const org = await simJson<{ staff: unknown[] }>(page, 'org_json')
  expect(org.staff).toHaveLength(13)

  // ---------------------------------------------------------------- fast-forward to 09:00
  // The scenario starts at 07:00; 12,000 steps a day → 1,000 steps to 09:00.
  expect(first.fastForwarded).toBe(1000)
  const early = await state(page)
  expect(early.day).toBe(0)
  expect(early.minute).toBeGreaterThanOrEqual(9 * 60)
  expect(early.step).toBeGreaterThanOrEqual(1000)

  // ---------------------------------------------------------------- the loop, driven by the sim
  await expect
    .poll(
      async () => {
        const s = await state(page)
        if (s.errors.length) throw new Error(`the loop failed: ${s.errors.join('; ')}`)
        return (await items(page))[ITEM] ?? null
      },
      { timeout: 180_000, intervals: [500] },
    )
    .toBe('published')
  // Freeze the clock: the script has one article; tomorrow's standup would find it exhausted.
  await session(page, 'pause')
  await session(page, 'idle')

  const done = await state(page)
  expect(done.errors).toEqual([])
  expect(done.day).toBe(0)
  // standup → draft → review 6 → revision → review 8 → publish, each run once.
  expect(done.jobs.map((j) => `${j.kind}:${j.revision}`)).toEqual(JOBS)
  expect(done.jobs.map((j) => j.state)).toEqual(JOBS.map(() => 'done'))
  expect(done.jobs.filter((j) => j.kind === 'review').map((j) => j.score)).toEqual([6, 8])
  expect(done.jobs.every((j) => j.ok === true)).toBe(true)
  expect(done.queued).toBe(0)
  expect(done.pendingCommands).toBe(0)
  expect(done.pendingDeploys).toEqual([])
  expect(done.logged).toBe(LOGGED.length)
  expect(await logKinds(page)).toEqual(LOGGED)

  // The central gateway: one draft PR (two commits: draft and revision), then the merge.
  const gateway = await session(page, 'gateway')
  expect(gateway.map((c) => c.op)).toEqual(['draft', 'draft', 'merge'])
  expect(gateway[0].workItem).toBe(ITEM)
  expect(gateway[0].branch).toMatch(/^drafts\//)
  expect(gateway[1].number).toBe(gateway[0].number)
  expect(gateway[1].headSha).not.toBe(gateway[0].headSha)
  expect(gateway[2]).toMatchObject({ number: gateway[0].number, headSha: gateway[1].headSha })
  expect(gateway[2].mergedSha).toMatch(/^[0-9a-f]{7,}$/)

  // ---------------------------------------------------------------- DeployLanded via the events API
  const events = await session(page, 'events')
  const landed = events.filter((e) => e.kind === 'DeployLanded')
  expect(landed).toHaveLength(1)
  expect(landed[0].payload).toMatchObject({ work_item: ITEM, merged_sha: gateway[2].mergedSha, source: 'simulated' })
  // The same event, read back from the server's inbox by an independent request.
  const inbox = await page.evaluate(async () => (await fetch('/api/events?after=0')).json())
  expect(inbox.events.map((e: { kind: string; seq: number }) => [e.kind, e.seq])).toContainEqual(['DeployLanded', landed[0].seq])
  // … and the sim published the item because of it.
  const plan = await simJson<SimPlan>(page, 'plan_json')
  expect(plan.items.find((i) => i.id === ITEM)?.status).toBe('published')
  expect(plan.feed.map((f) => ({ kind: f.kind, workItem: f.workItem }))).toContainEqual({ kind: 'published', workItem: ITEM })

  // ---------------------------------------------------------------- the Plan panel shows the thread
  expect(await postTypes(page)).toEqual(POST_TYPES)
  await expectThreadInPlanPanel(page, `${engine}-plan-live`)

  // ---------------------------------------------------------------- sync: sealed segment + checkpoint
  // The session seals the log and a checkpoint to the central server by itself when an item is published.
  await expect.poll(async () => (await state(page)).sealed?.central ?? null, { timeout: 30_000 }).not.toBeNull()
  const sealed = (await state(page)).sealed!
  expect(sealed.local).toBe(true)
  expect(sealed.central).toEqual({ segment: 0, commands: LOGGED.length, step: sealed.step })
  expect(sealed.step).toBeLessThanOrEqual(done.step)
  // Read back from the server by an independent request: one segment, and the checkpoint.
  const remote = await page.evaluate(async (company) => {
    const list = (await (await fetch(`/api/sync/${company}/log`)).json()) as { segments: { segment: number }[] }
    const segment = (await (await fetch(`/api/sync/${company}/log/0`)).json()) as { commands: { seq: number; kind: string }[] }
    const snapshot = (await (await fetch(`/api/sync/${company}/snapshot`)).json()) as { step: number; hash: string; lastSeq: number }
    return { segments: list.segments.map((x) => x.segment), kinds: segment.commands.map((c) => c.kind), seqs: segment.commands.map((c) => c.seq), snapshot }
  }, first.companyId)
  expect(remote.segments).toEqual([0])
  expect(remote.kinds).toEqual(LOGGED)
  expect(remote.seqs).toEqual(LOGGED.map((_, i) => i + 1))
  expect(remote.snapshot).toMatchObject({ step: sealed.step, hash: sealed.hash, lastSeq: LOGGED.length })
  expect((await state(page)).errors).toEqual([])
  expect(errors).toEqual([])
  // A restore lands on a checkpoint taken between the publish and the pause (the
  // page also checkpoints when it is hidden); at a known step the hash is known.
  const known = new Map([
    [sealed.step, sealed.hash],
    [done.step, done.hash],
  ])
  const expectRestored = (r: typeof first.restored, source: string) => {
    expect(r).toMatchObject({ source, replayed: LOGGED.length, verified: true })
    expect(r.checkpoint).toEqual({ step: r.step, hash: r.hash })
    expect(r.step).toBeGreaterThanOrEqual(sealed.step)
    expect(r.step).toBeLessThanOrEqual(done.step)
    if (known.has(r.step)) expect(r.hash).toBe(known.get(r.step))
  }

  // ---------------------------------------------------------------- a reload restores everything from OPFS
  // Offline for the sync API: the restore must come from the browser's own store.
  let syncReads = 0
  await page.route('**/api/sync/**', (route) => {
    if (route.request().method() === 'GET') syncReads++
    return route.continue()
  })
  const reloadErrors = await boot(page, gameUrl(engine, login))
  const again = await info(page)
  expect(again.companyId).toBe(first.companyId)
  expect(again.engine).toBe(engine)
  expectRestored(again.restored, 'opfs')
  expect(again.fastForwarded).toBe(0)
  expect(syncReads).toBe(0)
  expect((await items(page))[ITEM]).toBe('published')
  expect(await postTypes(page)).toEqual(POST_TYPES)
  expect(await logKinds(page)).toEqual(LOGGED)
  await expectThreadInPlanPanel(page, `${engine}-plan-reloaded`)
  // Nothing ran again: no job, no gateway call, no new command (the script is exhausted, so a re-run would fail loudly).
  await session(page, 'idle')
  const after = await state(page)
  expect(after.jobs).toEqual([])
  expect(after.logged).toBe(0)
  expect(after.errors).toEqual([])
  expect(await session(page, 'gateway')).toEqual([])
  expect(reloadErrors).toEqual([])

  // ---------------------------------------------------------------- a fresh browser context restores from central sync
  // A new context has no cookies and no OPFS: only the login and the central server remain.
  const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 800 } })
  try {
    const fresh = await context.newPage()
    const freshErrors = await boot(fresh, gameUrl(engine, login))
    const there = await info(fresh)
    expect(there.companyId).toBe(first.companyId)
    expect(there.leaseId).toBeTruthy()
    expect(there.leaseId).not.toBe(again.leaseId)
    expectRestored(there.restored, 'central')
    expect((await items(fresh))[ITEM]).toBe('published')
    expect(await logKinds(fresh)).toEqual(LOGGED)
    const restoredPlan = await simJson<SimPlan>(fresh, 'plan_json')
    expect(restoredPlan.feed.map((f) => ({ kind: f.kind, workItem: f.workItem }))).toContainEqual({ kind: 'published', workItem: ITEM })
    // The Plan panel shows the item as published (the sim's skeleton). Its thread
    // text is NOT part of central sync (CLAUDE.md rule 6: plan text lives in the
    // browser store), so a new device has the item without its posts.
    await fresh.getByRole('navigation', { name: 'CEO tools' }).getByRole('button', { name: /^Plan/ }).click()
    const panel = fresh.getByRole('region', { name: 'Media & publishing plan', exact: true })
    await panel.getByRole('button', { name: ITEM, exact: true }).first().click()
    await expect(panel.locator('.work-item .card-row')).toContainText('Published')
    await fresh.screenshot({ path: `test-results/mvp/${engine}-plan-fresh-context.png` })
    // The DeployLanded event is delivered again (new cursor) and ignored; nothing re-runs.
    await session(fresh, 'idle')
    const quiet = await state(fresh)
    expect(quiet.jobs).toEqual([])
    expect(quiet.logged).toBe(0)
    expect(quiet.pendingDeploys).toEqual([])
    expect(quiet.errors).toEqual([])
    expect(await session(fresh, 'gateway')).toEqual([])
    expect(freshErrors).toEqual([])
  } finally {
    await context.close()
  }
})
