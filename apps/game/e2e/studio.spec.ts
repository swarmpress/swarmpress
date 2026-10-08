// The Brick Studio (FEAT-100) and the instruction booklet (FEAT-101), ADR-0077,
// in the real game page against the real central server (fake GitHub, the
// cinqueterre-mini site, whose blueprint is imported from its pages) with the
// scripted model (`?llm=fake`):
//   1. the CEO builds: B opens the Studio, the import is adopted, a part from
//      the tray is dropped into a building on the Building workbench, Review
//      your build steps through the booklet, Build it saves the blueprint;
//   2. the architect builds: Ask the architect, the proposal arrives as a
//      structure-approval ticket, Open the booklet, Build it approves.
import { expect, test, type Page } from '@playwright/test'

const gameUrl = (engine: string, login: string) => `/?central=1&login=${login}&llm=fake&store=${engine}&quality=low&ff=09:00&board=off&speed=10`

async function boot(page: Page, url: string) {
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
}

async function openStudio(page: Page) {
  // The toolbar offers the Studio once the site's models are read.
  await expect(page.getByRole('navigation', { name: 'CEO tools' }).getByRole('button', { name: /Blueprint/ })).toBeVisible({ timeout: 60_000 })
  await page.keyboard.press('b')
  const studio = page.getByRole('region', { name: /Brick Studio/ })
  await expect(studio).toBeVisible()
  await expect(studio.locator('[data-checker="ready"]')).toBeVisible({ timeout: 30_000 })
  return studio
}

test('the CEO builds in the Studio and saves through the booklet', async ({ page }, ti) => {
  await boot(page, gameUrl(ti.project.name, `studio-${ti.project.name}-${Date.now().toString(36)}`))
  const studio = await openStudio(page)
  const adopt = studio.getByRole('button', { name: 'Start editing from this import' })
  if (await adopt.isVisible()) await adopt.click()

  await studio.getByRole('tab', { name: 'Building' }).click()
  // The first of the site's own buildings (a platform one carries a lock).
  const own = studio.getByRole('navigation', { name: 'Buildings' }).getByRole('button').filter({ hasNotText: '🔒' }).first()
  await own.click()
  const elevation = studio.locator('[data-elevation]')
  const type = await elevation.getAttribute('data-elevation')
  const before = await elevation.locator('[data-slot]').count()

  // Pick a part, drop it on a lit gap: a new storey clicks in.
  await studio.getByRole('button', { name: 'Pick up quote' }).click()
  const gap = studio.locator(`[data-drop^="gap:${type}/"].is-ok`).first()
  await expect(gap).toBeVisible()
  await gap.click()
  await expect(elevation.locator('[data-slot]')).toHaveCount(before + 1)
  await expect(studio.locator(`[data-slot="${type}/quote"]`)).toHaveAttribute('data-mark', 'added')

  // Review your build: the booklet steps through the changes; Build it saves.
  await studio.getByRole('button', { name: 'Review your build' }).click()
  const booklet = page.getByRole('dialog', { name: 'Review your build' })
  await expect(booklet).toBeVisible()
  await expect(booklet.getByRole('list', { name: 'Parts in this step' })).toBeVisible()
  await page.screenshot({ path: `test-results/studio/${ti.project.name}-booklet.png` })
  await booklet.getByRole('button', { name: 'Build it' }).click()
  await expect(page.locator('.toast')).toContainText(/Built: \d+ changes? saved/, { timeout: 30_000 })
  await expect(booklet).toBeHidden()
})

test("the architect's proposal is reviewed as a booklet and built from it", async ({ page }, ti) => {
  await boot(page, gameUrl(ti.project.name, `studio-arch-${ti.project.name}-${Date.now().toString(36)}`))
  const studio = await openStudio(page)
  const ask = studio.getByRole('form', { name: 'Ask the architect' })
  await ask.getByRole('textbox').fill('Add an author page type and link articles to it.')
  await ask.getByRole('button', { name: 'Ask the architect' }).click()
  await expect(page.locator('.toast')).toContainText(/Asked the Information Architect/)
  await studio.getByRole('button', { name: /Close Brick Studio/ }).click()

  // The proposal arrives as a structure-approval ticket.
  await page.getByRole('navigation', { name: 'CEO tools' }).getByRole('button', { name: /Inbox/ }).click()
  const ticket = page.getByRole('article', { name: 'Structure approval' })
  await expect(ticket).toBeVisible({ timeout: 180_000 })
  await ticket.getByRole('button', { name: 'Open the booklet' }).click()
  const booklet = page.getByRole('dialog', { name: "The architect's building instructions" })
  await expect(booklet).toBeVisible()
  await expect(booklet.getByRole('list', { name: 'Parts in this step' })).toBeVisible()
  await page.screenshot({ path: `test-results/studio/${ti.project.name}-architect-booklet.png` })
  await booklet.getByRole('button', { name: 'Build it' }).click()
  await expect(booklet).toBeHidden()
  // Approved: the answer is logged (the ticket then leaves the open list).
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const s = (window as unknown as { __swarmpress: { session: { commandLog(): Promise<{ kind: string }[]> } } }).__swarmpress.session
          return (await s.commandLog()).filter((c) => c.kind === 'AnswerTicket').length
        }),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0)
})

test('the CEO builds a tool in the Factory and saves it', async ({ page }, ti) => {
  await boot(page, gameUrl(ti.project.name, `studio-tool-${ti.project.name}-${Date.now().toString(36)}`))
  const studio = await openStudio(page)
  await studio.getByRole('tab', { name: 'Factory' }).click()
  await studio.getByRole('tab', { name: 'Workbench' }).click()
  await studio.getByRole('textbox', { name: 'New tool' }).fill('Digest')
  await studio.getByRole('button', { name: 'Add tool' }).click()
  for (const label of ['Feed', 'Limit', 'Output']) await studio.getByRole('button', { name: `Place ${label}` }).click()
  // Tubes: an outlet, then the inlet it lights green.
  await studio.locator('[data-outlet="rss.out"]').click()
  await expect(studio.locator('[data-inlet="limit.in"]')).toHaveClass(/is-ok/)
  await studio.locator('[data-inlet="limit.in"]').click()
  await studio.locator('[data-outlet="limit.out"]').click()
  await studio.locator('[data-inlet="output.in"]').click()
  await expect(studio.locator('[data-edge]')).toHaveCount(2)
  await page.screenshot({ path: `test-results/studio/${ti.project.name}-factory.png` })
  await studio.getByRole('button', { name: 'Save tools' }).click()
  await expect(page.locator('.toast')).toContainText(/Built: 1 tool saved/, { timeout: 30_000 })
})
