/**
 * Build mode in the real browser (FEAT-026, ADR-0087), on software WebGPU over the live wasm sim:
 * the Build section places a plant in a room and a tree in the town through the sim's own
 * commands; the sim's layout gains them and the scene rebuilds on the new layoutRev.
 */
import { expect, test, type Page } from '@playwright/test'
import { boot } from './helpers'

type Layout = { rooms: Array<{ id: string; props: Array<{ id: string; kind: string }> }>; town?: Array<{ id: string; kind: string }> }
type Hook = { sim: { layout_json(): string }; layoutRebuilds(): { count: number } }

const layout = (page: Page) => page.evaluate(() => JSON.parse((window as unknown as { __swarmpress: Hook }).__swarmpress.sim.layout_json()) as Layout)
const rebuilds = (page: Page) => page.evaluate(() => (window as unknown as { __swarmpress: Hook }).__swarmpress.layoutRebuilds().count)

/** Nudge the pending placement with the arrow keys until the sim accepts it, then place it. */
async function placeWhereAccepted(page: Page) {
  const place = page.getByRole('button', { name: /^Place here/ })
  const pending = page.getByRole('region', { name: 'Pending action' })
  for (let i = 0; i < 24 && !(await place.isEnabled()); i++) {
    // Keys go to the placer when focus is inside it.
    await pending.getByRole('button', { name: /^Cancel/ }).focus()
    await page.keyboard.press(i % 2 ? 'ArrowDown' : 'ArrowRight')
    await page.waitForTimeout(150)
  }
  await expect(place).toBeEnabled()
  await place.click()
}

test('the Build section places a plant in a room and a tree in the town, and the scene follows', async ({ page }) => {
  test.setTimeout(300_000)
  const { errors } = await boot(page, '/?quality=low')
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /^Build/ }).click()

  // Furniture: a plant in the CEO's office.
  await page.getByRole('tab', { name: /Furniture/ }).click()
  const before = await layout(page)
  const office = before.rooms.find((r) => r.props.length >= 0 && r.id === 'room-4')!
  await page.locator('#build-furniture-room').selectOption(office.id)
  await page.locator('.build-tiles').getByRole('button', { name: /Potted plant/ }).click()
  const rebuilt0 = await rebuilds(page)
  await placeWhereAccepted(page)
  await expect.poll(async () => (await layout(page)).rooms.find((r) => r.id === office.id)!.props.filter((p) => p.kind === 'plant').length).toBe(
    office.props.filter((p) => p.kind === 'plant').length + 1,
  )
  await expect.poll(() => rebuilds(page), { timeout: 60_000 }).toBeGreaterThan(rebuilt0)

  // Town: a tree.
  await page.getByRole('tab', { name: /Town/ }).click()
  const trees = (before.town ?? []).filter((t) => t.kind === 'Tree').length
  await page.locator('.build-tiles').getByRole('button', { name: /Town tree/ }).click()
  await placeWhereAccepted(page)
  await expect.poll(async () => ((await layout(page)).town ?? []).filter((t) => t.kind === 'Tree').length).toBe(trees + 1)

  expect(errors).toEqual([])
})
