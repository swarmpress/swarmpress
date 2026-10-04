// The executor lease end to end (ADR-0045, FEAT-013 increment A1), on the
// real game page (`/?central=1`) against the real swarmpress-server:
//
//   device A runs the company (epoch 1)
//   → device B opens it: read-only, with a notice; A is not disturbed
//   → B takes over explicitly (epoch 2)
//   → A is told (LeaseRevoked), halts, holds its clock and goes read-only
//   → A's old fencing token is refused by the gateway with 409; B's is accepted
//
// Two browser contexts are two devices: separate cookies and separate OPFS.
// Run with `playwright test -c playwright.mvp.config.ts` (one project per
// store engine).
import { expect, test, type Page } from '@playwright/test'
import type { SessionHook } from '../src/session/session'

const gameUrl = (engine: string, login: string, extra = '') => `/?central=1&login=${login}&llm=fake&store=${engine}&quality=low&speed=10${extra}`

/** Opens the game page and waits for the session and the first frames. Fails fast when boot threw. */
async function boot(page: Page, url: string) {
  await page.goto(url)
  await ready(page)
}

async function ready(page: Page) {
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
}

function session<K extends keyof SessionHook>(page: Page, method: K): Promise<Awaited<ReturnType<SessionHook[K]>>> {
  return page.evaluate((m) => {
    const hook = (window as unknown as { __swarmpress: { session: Record<string, () => unknown> } }).__swarmpress.session
    return hook[m]()
  }, method) as Promise<Awaited<ReturnType<SessionHook[K]>>>
}

const info = (page: Page) => session(page, 'info')
const state = (page: Page) => session(page, 'state')

/** A gateway draft sent from the page with the given fencing token; returns the HTTP status. */
function draftStatus(page: Page, token: string, contentId: string): Promise<number> {
  return page.evaluate(
    async ([t, id]) => {
      const res = await fetch('/api/gateway/draft', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-swarmpress-lease': t },
        body: JSON.stringify({
          content_id: id,
          path: `content/pages/en/${id}.json`,
          page: { title: { en: 'Takeover' }, blocks: [{ type: 'paragraph', text: { en: 'Hello' } }] },
          message: `Draft: ${id}`,
        }),
      })
      return res.status
    },
    [token, contentId],
  )
}

/**
 * The sim clock runs: the step moves. A standup holds the clock while its turns play as bubbles
 * (FEAT-025), several seconds at speed 10 on a loaded runner, so allow a minute.
 */
async function expectRunning(page: Page) {
  const before = (await state(page)).step
  await expect.poll(async () => (await state(page)).step, { timeout: 60_000 }).toBeGreaterThan(before)
}

/** The sim clock is held: the step does not move for a second and a half. */
async function expectHeld(page: Page) {
  const before = (await state(page)).step
  await page.waitForTimeout(1500)
  expect((await state(page)).step).toBe(before)
}

test('a second device is read-only until it takes over; the first then halts and is fenced out', async ({ page, browser, baseURL }, ti) => {
  const engine = ti.project.name
  const login = `takeover-${engine}-${Date.now().toString(36)}`

  // ---------------------------------------------------------------- device A runs the company
  await boot(page, gameUrl(engine, login))
  const a = await info(page)
  expect(a.epoch).toBe(1)
  expect(a.leaseToken).toBe(`1.${a.leaseId}`)
  expect((await state(page)).readOnly).toBeNull()
  await expect(page.locator('#lease-notice')).toHaveCount(0)
  await expectRunning(page)
  expect(await draftStatus(page, a.leaseToken!, 'from-a')).toBe(200)

  const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 800 } })
  try {
    // -------------------------------------------------------------- device B opens it: read-only
    const other = await context.newPage()
    await boot(other, gameUrl(engine, login))
    const b = await info(other)
    expect(b.companyId).toBe(a.companyId)
    expect(b.leaseId).toBeNull()
    expect(b.leaseToken).toBeNull()
    const waiting = await state(other)
    expect(waiting.readOnly).toMatch(/Another device \(dev-[0-9a-f-]+\) is running this company/)
    expect(waiting.halted).toBe(waiting.readOnly)
    expect(waiting.holdClock).toBe(true)
    const notice = other.locator('#lease-notice')
    await expect(notice).toBeVisible()
    await expect(notice).toHaveAttribute('role', 'alert')
    await expect(notice).toHaveAttribute('data-kind', 'read-only')
    await expect(notice).toContainText('Read-only. Another device')
    await expectHeld(other)
    // A read-only session seals nothing.
    expect(await session(other, 'checkpoint')).toMatchObject({ local: false, central: null })
    // Opening the company elsewhere did not disturb its holder.
    const still = await info(page)
    expect([still.epoch, still.leaseToken]).toEqual([1, a.leaseToken])
    expect((await state(page)).readOnly).toBeNull()
    await expectRunning(page)
    await other.screenshot({ path: `test-results/takeover/${engine}-b-read-only.png` })

    // -------------------------------------------------------------- B takes over explicitly
    // The button reloads the page with `takeover=1`; the new session holds epoch 2.
    await notice.getByRole('button', { name: 'Take over here' }).click()
    await expect
      .poll(async () => info(other).then((i) => i.epoch, () => null), { timeout: 120_000 })
      .toBe(2)
    await ready(other)
    // The takeover belongs to that one page load: the parameter is gone from the URL.
    expect(new URL(other.url()).searchParams.has('takeover')).toBe(false)
    const took = await info(other)
    expect(took.epoch).toBe(2)
    expect(took.leaseToken).toBe(`2.${took.leaseId}`)
    expect(took.leaseId).not.toBe(a.leaseId)
    expect((await state(other)).readOnly).toBeNull()
    await expect(other.locator('#lease-notice')).toHaveCount(0)
    await expectRunning(other)

    // -------------------------------------------------------------- A is told, halts and goes read-only
    await expect.poll(async () => (await state(page)).readOnly, { timeout: 30_000 }).not.toBeNull()
    const lost = await state(page)
    expect(lost.readOnly).toMatch(/This device no longer runs the company: the company lease \(epoch 1\) was taken over by dev-/)
    expect(lost.halted).toBe(lost.readOnly)
    expect(lost.holdClock).toBe(true)
    const gone = await info(page)
    expect([gone.leaseId, gone.epoch, gone.leaseToken]).toEqual([null, null, null])
    // It learned it from the LeaseRevoked event, not from a renew a third of a TTL later.
    expect((await session(page, 'events')).map((e) => [e.kind, e.payload.epoch])).toContainEqual(['LeaseRevoked', 1])
    await expect(page.locator('#lease-notice')).toHaveAttribute('data-kind', 'read-only')
    await expect(page.locator('#lease-notice')).toContainText('Read-only. This device no longer runs the company')
    await expect(page.locator('#lease-notice').getByRole('button', { name: 'Take over here' })).toBeVisible()
    await expectHeld(page)
    expect(await session(page, 'checkpoint')).toMatchObject({ local: false, central: null })
    await page.screenshot({ path: `test-results/takeover/${engine}-a-lost.png` })

    // -------------------------------------------------------------- the old token is fenced out
    expect(await draftStatus(page, a.leaseToken!, 'from-a-late')).toBe(409)
    // The same lease id under the new epoch is not a lease either.
    expect(await draftStatus(page, `2.${a.leaseId}`, 'from-a-late')).toBe(409)
    expect(await draftStatus(other, took.leaseToken!, 'from-b')).toBe(200)
  } finally {
    await context.close()
  }
})
