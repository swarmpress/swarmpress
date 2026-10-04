// The MVP acceptance test (docs/mvp.md, "one article, end to end"), on the
// REAL game page (`/?central=1`, production build) against the real
// swarmpress-server (dev auth, fake GitHub, simulated deploys, the gateway's
// article profile and closed-world checks on) with the brief-driven fake
// `?llm=fake` model, which answers every stage of the staged Draft and Review
// jobs (ADR-0058):
//
//   dev login → company founded → fast-forward to 09:00
//   → standup → staged draft (outline, intro, 3 sections, closing) → PR → review 6
//   → revision of the one section the review names → review 8
//   → the publish gate: the CEO answers the approval ticket in the Inbox → merge
//   → DeployLanded via the events API → item published
//   → the Plan panel shows the thread
//   → a reload restores everything from OPFS
//   → a fresh browser context restores from central sync
//
// The sim runs in the page's own render loop (`speed=` only scales the clock);
// the spec observes through `window.__swarmpress.session` and drives nothing but
// the clock (pause). Run with `playwright test -c playwright.mvp.config.ts`
// (one project per store engine).
import { expect, test, type Page } from '@playwright/test'
import { MVP_REVISION_LINE } from '../src/llm/mvp-script'
import type { SessionHook } from '../src/session/session'

const ITEM = 'work-item-1'
const TITLE = 'Harvest week in Manarola'
const JOBS = ['standup:0', 'draft:0', 'review:0', 'draft:1', 'review:1', 'publish:1']
/** The thread of the work item, oldest first (src/llm/mvp-script.ts MVP_POST_TYPES). */
const POST_TYPES = ['minutes', 'artifact', 'handoff', 'review', 'artifact', 'handoff', 'review', 'artifact', 'status']
/** MeetingOutcome + 4 JobCompleted + the CEO's approval at the publish gate (ADR-0059) + JobCompleted (publish) + DeployLanded. */
const LOGGED = ['MeetingOutcome', 'JobCompleted', 'JobCompleted', 'JobCompleted', 'JobCompleted', 'AnswerTicket', 'JobCompleted', 'DeployLanded']


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
      const h = (window as unknown as { __swarmpress?: { frames(): number; session: unknown } }).__swarmpress
      return !!h && !!h.session && h.frames() > 5
    },
    null,
    { timeout: 120_000 },
  )
  return errors
}

/** Calls a method of the page's session hook (`window.__swarmpress.session`). */
function session<K extends keyof SessionHook>(page: Page, method: K): Promise<Awaited<ReturnType<SessionHook[K]>>> {
  return page.evaluate((m) => {
    const hook = (window as unknown as { __swarmpress: { session: Record<string, () => unknown> } }).__swarmpress.session
    return hook[m]()
  }, method) as Promise<Awaited<ReturnType<SessionHook[K]>>>
}

/** A JSON view of the page's sim (`window.__swarmpress.sim`). */
function simJson<T>(page: Page, view: 'org_json' | 'plan_json'): Promise<T> {
  return page.evaluate((v) => {
    const sim = (window as unknown as { __swarmpress: { sim: Record<string, () => string> } }).__swarmpress.sim
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
  items: { id: string; status: string; awaitingApproval?: boolean }[]
  jobs: { id: number; kind: string }[]
  feed: { kind: string; workItem: string }[]
}

/**
 * The publish gate (ADR-0059, FEAT-079): the approved article waits for the
 * CEO, who answers the `publish-approval` ticket in the Inbox panel. Nothing
 * was merged before the click. The clock is paused while the CEO reads.
 */
async function approveInInbox(page: Page, shot: string) {
  await session(page, 'pause')
  await session(page, 'idle')
  const parked = await state(page)
  expect(parked.errors).toEqual([])
  // standup, draft, review 6, revision, review 8: no publish job, and the sim waits for none.
  expect(parked.jobs.map((j) => `${j.kind}:${j.revision}`)).toEqual(JOBS.slice(0, 5))
  expect((await simJson<SimPlan>(page, 'plan_json')).jobs).toEqual([])
  expect((await session(page, 'gateway')).map((c) => c.op)).toEqual(['draft', 'draft'])
  expect(await logKinds(page)).toEqual(LOGGED.slice(0, 5))

  await page.getByRole('navigation', { name: 'CEO tools' }).getByRole('button', { name: /^Inbox/ }).click()
  const inbox = page.getByRole('region', { name: 'Inbox', exact: true })
  await expect(inbox).toBeVisible()
  const ticket = inbox.getByRole('article', { name: 'Publish approval', exact: true })
  await expect(ticket).toHaveCount(1)
  // The ticket names the article (its title comes from the store, not the sim).
  await expect(ticket).toContainText(TITLE)
  const options = inbox.getByRole('group', { name: 'Answer Publish approval' })
  await expect(options.getByRole('button')).toHaveText([/^Publish/, /^Send back/, /^Kill/, /^Defer/])
  // What the CEO judges it by (increment U1), from the store's artifact record: the
  // measured checks apart from the editor's opinion (the second review: 8), and the pull request.
  await expect(ticket.getByRole('group', { name: 'Measured checks' })).toContainText(/Words\s*\d+ of 600 target/)
  await expect(ticket.getByRole('group', { name: 'Editor’s opinion' })).toContainText('Score 8/10')
  const draft = (await session(page, 'gateway'))[1]
  await expect(ticket.getByText(`Pull request #${draft.number}`)).toBeVisible()
  // The preview: the page JSON in a sandboxed frame; its one h1 is the article's title.
  await ticket.getByRole('button', { name: 'Read article' }).click()
  const preview = page.getByRole('dialog', { name: TITLE })
  await expect(preview).toBeVisible()
  await expect(preview.locator('iframe')).toHaveAttribute('sandbox', '')
  await expect(page.frameLocator('.article-preview iframe').getByRole('heading', { level: 1 })).toHaveText(TITLE)
  // The revised section is what the CEO reads (the revision rewrote only that part).
  await expect(page.frameLocator('.article-preview iframe').getByText(MVP_REVISION_LINE).first()).toBeVisible()
  await page.screenshot({ path: `test-results/mvp/${shot}-preview.png` })
  await page.keyboard.press('Escape')
  await expect(preview).toHaveCount(0)
  await page.screenshot({ path: `test-results/mvp/${shot}.png` })
  await options.getByRole('button', { name: /^Publish/ }).click()
  // Answered: the ticket has no options any more, and the command is in the log.
  await expect(options).toHaveCount(0)
  await page.keyboard.press('Escape')
  expect(await logKinds(page)).toEqual(LOGGED.slice(0, 6))
  await session(page, 'resume')
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
  // The boot screen is gone, and the HUD chip says what the clock does (FEAT-080).
  await expect(page.locator('#boot-screen')).toHaveCount(0)
  await expect(page.locator('.hud-chip')).toHaveAttribute('data-state', /^(running|held)$/)

  // ---------------------------------------------------------------- fast-forward to 09:00
  // The scenario starts at 07:00; 12,000 steps a day → 1,000 steps to 09:00.
  expect(first.fastForwarded).toBe(1000)
  const early = await state(page)
  expect(early.day).toBe(0)
  expect(early.minute).toBeGreaterThanOrEqual(9 * 60)
  expect(early.step).toBeGreaterThanOrEqual(1000)

  // ---------------------------------------------------------------- the loop, driven by the sim, up to the publish gate
  await expect
    .poll(
      async () => {
        const s = await state(page)
        if (s.errors.length) throw new Error(`the loop failed: ${s.errors.join('; ')}`)
        return (await simJson<SimPlan>(page, 'plan_json')).items.find((i) => i.id === ITEM)?.awaitingApproval ?? false
      },
      { timeout: 180_000, intervals: [500] },
    )
    .toBe(true)
  await approveInInbox(page, `${engine}-inbox-approval`)

  // ---------------------------------------------------------------- approved: merge, deploy, published
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
  // Freeze the clock: tomorrow's standup would commission the next article.
  await session(page, 'pause')
  await expect(page.locator('.hud-chip')).toHaveAttribute('data-state', 'paused')
  await session(page, 'idle')

  const done = await state(page)
  expect(done.status).toMatchObject({ state: 'paused', label: 'Paused' })
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

  // ---------------------------------------------------------------- the activity record (ADR-0058, FEAT-078)
  // One job row per job with who did it (and, for the model's jobs, which model), and a row per stage of the draft.
  const activity = await session(page, 'activity')
  const jobRows = activity.filter((r) => r.stage === 'job')
  expect(jobRows.map((r) => `${r.kind}:${r.revision}:${r.result}`)).toEqual(JOBS.map((j) => `${j}:done`))
  expect(jobRows.every((r) => r.staff && r.persona && r.role)).toBe(true)
  for (const r of jobRows.filter((r) => r.kind !== 'publish')) expect(r.model).toBe('fake-mvp')
  expect(jobRows.filter((r) => r.kind !== 'publish').every((r) => r.tokens_in > 0 && r.tokens_out > 0)).toBe(true)
  const firstDraft = jobRows[1].job_id
  expect(activity.filter((r) => r.job_id === firstDraft && r.stage !== 'job').map((r) => `${r.stage}#${r.idx}`)).toEqual([
    'context#0',
    'outline#0',
    'section#0',
    'section#1',
    'section#2',
    'section#3',
    'closing#0',
    'commit#0',
  ])
  expect(jobRows[1].detail).toMatchObject({ pr: gateway[0].number, branch: gateway[0].branch, sha: gateway[0].headSha })
  expect(activity.filter((r) => r.job_id === jobRows[3].job_id && r.stage !== 'job').map((r) => `${r.stage}#${r.idx}`)).toEqual(['revise#2', 'commit#0'])
  // The Activity panel (U4) lists the draft job with the writer's name and the model, read from the store.
  const writer = await page.evaluate(
    (staff) => (window as unknown as { __swarmpress: { overlay: { personaOf(id: string): { name: string } } } }).__swarmpress.overlay.personaOf(staff).name,
    jobRows[1].staff!,
  )
  await page.getByRole('navigation', { name: 'CEO tools' }).getByRole('button', { name: /^Activity/ }).click()
  const draftCard = page.getByRole('region', { name: 'Activity', exact: true }).locator(`article[data-job="${firstDraft}"]`)
  await expect(draftCard).toContainText(writer)
  await expect(draftCard).toContainText('fake-mvp')
  await expect(draftCard).toContainText(`Draft · ${TITLE}`)
  await page.keyboard.press('Escape')

  // ---------------------------------------------------------------- the site's knowledge pack (ADR-0061, K2)
  // The fake site repo starts as the cinqueterre-mini fixture (e2e/central-server.mjs). The session
  // fetched its pack at start and before the standup, and bound the orchestrator to it with the site's
  // own style guide and writer prompt; the merge moved the head, so the pack was fetched again.
  expect(done.knowledge.bound).toMatch(/^[0-9a-f]{7,}$/)
  expect(done.knowledge.binding).toMatchObject({ site_id: 'cinqueterre.travel', commit: done.knowledge.bound, media: 20, pages: 9, style_guide: 'pack', writer_prompt: 'pack' })
  await expect
    .poll(
      async () => {
        const k = (await state(page)).knowledge
        return [k.commit, k.refreshes.length]
      },
      { timeout: 30_000 },
    )
    .toEqual([gateway[2].mergedSha, 4])
  const knowledge = (await state(page)).knowledge
  expect(knowledge).toMatchObject({ source: 'network', error: null })
  expect(knowledge.refreshes.slice(0, 2)).toEqual([
    { reason: 'start', result: 'fetched' },
    { reason: 'standup', result: 'not-modified' },
  ])
  // The merge and its DeployLanded both refetch; the server publishes the simulated deploy before
  // the merge answers, so either may be the one that brought the new pack.
  const afterMerge = knowledge.refreshes.slice(2)
  expect(afterMerge.map((r) => r.reason).sort()).toEqual(['deploy', 'merge'])
  expect(afterMerge.filter((r) => r.result === 'fetched')).toHaveLength(1)

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
    const { world, ...snapshot } = (await (await fetch(`/api/sync/${company}/snapshot`)).json()) as { format: string; step: number; hash: string; lastSeq: number; world: string }
    return { segments: list.segments.map((x) => x.segment), kinds: segment.commands.map((c) => c.kind), seqs: segment.commands.map((c) => c.seq), snapshot, worldChars: world.length }
  }, first.companyId)
  expect(remote.segments).toEqual([0])
  expect(remote.kinds).toEqual(LOGGED)
  expect(remote.seqs).toEqual(LOGGED.map((_, i) => i + 1))
  // The record carries the world itself (base64 of `Sim.snapshot()`), not just where it was.
  expect(remote.snapshot).toMatchObject({ format: 'swarmpress.snapshot.v1', step: sealed.step, hash: sealed.hash, lastSeq: LOGGED.length })
  expect(remote.worldChars).toBeGreaterThan(1000)
  expect((await state(page)).errors).toEqual([])
  expect(errors).toEqual([])
  // A restore lands on a checkpoint taken between the publish and the pause (the
  // page also checkpoints when it is hidden); at a known step the hash is known.
  const known = new Map([
    [sealed.step, sealed.hash],
    [done.step, done.hash],
  ])
  // The checkpoint is a world snapshot (FEAT-060): the sim is rebuilt from it and
  // nothing is replayed, because every logged command is before the snapshot.
  const expectRestored = (r: typeof first.restored, source: string) => {
    expect(r).toMatchObject({ source, snapshot: true, replayed: 0, verified: true })
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
  // Nothing ran again: no job, no gateway call, no new command, no new activity row.
  await session(page, 'idle')
  const after = await state(page)
  expect(after.jobs).toEqual([])
  expect(after.logged).toBe(0)
  expect(after.errors).toEqual([])
  expect(await session(page, 'gateway')).toEqual([])
  expect(await session(page, 'activity')).toHaveLength(activity.length)
  // The pack of the merged head came from the store and was revalidated with its ETag (304).
  expect(after.knowledge).toMatchObject({ commit: gateway[2].mergedSha, bound: gateway[2].mergedSha, error: null })
  expect(after.knowledge.refreshes[0]).toEqual({ reason: 'start', result: 'not-modified' })
  expect(reloadErrors).toEqual([])

  // ---------------------------------------------------------------- a fresh browser context restores from central sync
  // A new context has no cookies and no OPFS: only the login and the central server remain.
  const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 800 } })
  try {
    const fresh = await context.newPage()
    // The reloaded page still holds the lease, so the new device takes the
    // company over explicitly (ADR-0045; e2e/takeover.spec.ts covers the handover).
    const freshErrors = await boot(fresh, gameUrl(engine, login, '&takeover=1'))
    const there = await info(fresh)
    expect(there.companyId).toBe(first.companyId)
    expect(there.leaseId).toBeTruthy()
    expect(there.leaseId).not.toBe(again.leaseId)
    // One epoch per holder: the first load, its reload, the new device.
    expect([first.epoch, again.epoch, there.epoch]).toEqual([1, 2, 3])
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
