// The browser runtime end to end (docs/mvp.md, minus the sim loop): dev login
// → company → lease → standup → draft PR → review 6 → revision → review 8 →
// merge through orchestrator-wasm with the company store (one project per
// engine: turso, sqlite), the central gateway of the real simpress-server
// and the scripted `?llm=fake` model; DeployLanded arrives through the events
// API; a reload shows the plan from OPFS. Run with
// `playwright test -c playwright.orchestrator.config.ts`.
import { expect, test, type Page } from '@playwright/test'

const POST_TYPES = ['minutes', 'artifact', 'handoff', 'review', 'artifact', 'handoff', 'review', 'artifact']

type Harness = Window['__harness']

async function open(page: Page, engine: string) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`/orchestrator.html?store=${engine}&llm=fake`)
  const info = await page.evaluate(() => (window as unknown as { __harness: Harness }).__harness.ready)
  return { info, errors }
}

test('standup → publish through the orchestrator bridge, persisted across a reload', async ({ page }, ti) => {
  const engine = ti.project.name
  const { info, errors } = await open(page, engine)
  expect(info.crossOriginIsolated).toBe(true)
  expect(info.engine).toBe(engine)
  expect(info.persistent).toBe(true)

  const login = `e2e-${engine}-${Date.now().toString(36)}`
  const conn = await page.evaluate((l) => window.__harness.connect(l), login)
  expect(conn.companyId).toBeTruthy()
  expect(conn.leaseId).toBeTruthy()

  const report = await page.evaluate(() => window.__harness.runLoop())
  expect(report.jobs).toEqual(['standup:0', 'draft:0', 'review:0', 'draft:1', 'review:1', 'publish:1'])
  expect(report.scores).toEqual([6, 8])
  expect(report.briefRef).toMatch(/^\d+$/)
  expect(report.mergedSha).toMatch(/^[0-9a-f]{7,}$/)
  // The site binding leaves the deploy to the server: no local DeployLanded, no "simulated" status post.
  expect(report.deployLanded).toBe(false)
  expect(report.postTypes).toEqual(POST_TYPES)
  expect(report.posts[2]).toMatchObject({ type: 'handoff', author: 'staff-1', to: 'staff-5' })
  expect(report.posts[3]).toMatchObject({ type: 'review', author: 'staff-5', verdict: 'changes' })
  expect(report.posts[6]).toMatchObject({ type: 'review', verdict: 'approve' })
  expect(report.title).toBe('Harvest week in Manarola')

  // The server's simulated deploy comes back through the events API.
  const landed = await page.evaluate(() => window.__harness.waitForEvent('DeployLanded', 'work-item-1', 30_000))
  expect(landed.payload).toMatchObject({ work_item: 'work-item-1', merged_sha: report.mergedSha, source: 'simulated' })

  // Sync: a log segment and a snapshot round-trip through the central API.
  const sync = await page.evaluate(() => window.__harness.syncRoundTrip())
  expect(sync.segmentStatus).toBe(201)
  expect(sync.segmentBack.length).toBeGreaterThan(0)
  expect(sync.snapshotStep).toBe(120)
  expect(sync.snapshotBack).toHaveLength(2)

  expect(errors).toEqual([])

  // Reload: the plan (and the event cursor) come back from OPFS, without the network.
  await page.reload()
  const again = await page.evaluate(() => window.__harness.ready)
  expect(again.engine).toBe(engine)
  const stored = await page.evaluate(() => window.__harness.plan())
  expect(stored.companyId).toBe(conn.companyId)
  expect(stored.plan!.items['work-item-1'].title).toBe('Harvest week in Manarola')
  expect(stored.plan!.posts['work-item-1'].map((p) => p.type)).toEqual(POST_TYPES)
  expect(Number(stored.cursor)).toBe(landed.seq)
})

test('the sim drives the loop: effects → orchestrator-wasm → outcomes, DeployLanded publishes the item', async ({ page }, ti) => {
  const engine = ti.project.name
  const { info, errors } = await open(page, engine)
  expect(info.engine).toBe(engine)
  await page.evaluate((l) => window.__harness.connect(l), `e2e-sim-${engine}-${Date.now().toString(36)}`)
  const r = await page.evaluate(() => window.__harness.runSimLoop())
  expect(r.jobs).toEqual(['standup:0', 'draft:0', 'review:0', 'draft:1', 'review:1', 'publish:1'])
  // The sim staffs a draft with its writer only and a review with its editor only.
  expect(r.staff[1]).toEqual(['writer'])
  expect(r.staff[2]).toEqual(['editor'])
  expect(r.statusBefore).toBe('scheduled')
  expect(r.statusAfter).toBe('published')
  expect(r.feed).toContainEqual({ kind: 'published', workItem: 'work-item-1' })
  expect(r.postTypes).toEqual(POST_TYPES)
  // MeetingOutcome + 5 JobCompleted + DeployLanded, in the command log.
  expect(r.logged).toBe(7)
  expect(errors).toEqual([])
})

test('automatic engine selection picks turso when the page is isolated', async ({ page }, ti) => {
  test.skip(ti.project.name !== 'turso', 'one run is enough')
  await page.goto('/orchestrator.html?llm=fake')
  const info = await page.evaluate(() => window.__harness.ready)
  expect(info.crossOriginIsolated).toBe(true)
  expect(info.engine).toBe('turso')
  expect(info.fallbackReason).toBeNull()
})
