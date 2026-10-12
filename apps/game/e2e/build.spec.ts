/**
 * Build mode in the real browser (FEAT-026, ADR-0087), on software WebGPU over the live wasm sim:
 * the Build section places a plant in a room and a tree in the town through the sim's own
 * commands; the sim's layout gains them and the scene rebuilds on the new layoutRev.
 */
import { expect, test, type Page } from '@playwright/test'
import { boot } from './helpers'

type Layout = {
  rooms: Array<{ id: string; props: Array<{ id: string; kind: string; attachedTo?: string | null }>; objectCapabilities?: { places?: number; lights: number } }>
  town?: Array<{ id: string; kind: string }>
  objects?: Array<{
    id: string
    design: string
    room: string
    summary: { parts: number; mount: string; workstation: boolean }
    seatAt?: [number, number] | null
    places?: Array<[number, number]>
    onDesk?: { desk: string; slot: string } | null
    assignedTo?: string | null
  }>
}
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

test('a design saved in the editor is placed from My designs and stands in the office', async ({ page }) => {
  test.setTimeout(300_000)
  const { errors } = await boot(page, '/?quality=low')
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /^Build/ }).click()

  // The editor: a copy of the kit's plant, saved to the company's library.
  await page.getByRole('tab', { name: /Designs/ }).click()
  const editor = page.getByRole('region', { name: 'Design editor' })
  await editor.getByLabel('Start from a kit design').selectOption({ label: 'Potted plant' })
  await editor.getByRole('button', { name: 'Open a copy' }).click()
  await editor.getByRole('button', { name: 'Save to library' }).click()
  await expect(editor.getByRole('button', { name: 'Open Potted plant (mine)' })).toBeVisible()

  // Furniture, My designs: the saved design goes into the CEO's office through PlaceObject.
  await page.getByRole('tab', { name: /Furniture/ }).click()
  await page.locator('#build-furniture-room').selectOption('room-4')
  expect((await layout(page)).objects ?? []).toEqual([])
  const rebuilt0 = await rebuilds(page)
  await page.locator('.build-tiles').getByRole('button', { name: /Potted plant \(mine\)/ }).click()
  await placeWhereAccepted(page)
  await expect.poll(async () => ((await layout(page)).objects ?? []).length).toBe(1)
  const [object] = (await layout(page)).objects!
  expect(object.room).toBe('room-4')
  expect(object.design).toMatch(/^[0-9a-f]{64}$/)
  expect(object.summary.mount).toBe('Floor')
  expect(object.summary.parts).toBeGreaterThan(0)
  await expect.poll(() => rebuilds(page), { timeout: 60_000 }).toBeGreaterThan(rebuilt0)

  expect(errors).toEqual([])
})

test('a desk of your own is a workstation, and a lamp of your own takes a desk\'s lamp slot', async ({ page }) => {
  test.setTimeout(300_000)
  const { errors } = await boot(page, '/?quality=low')
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /^Build/ }).click()

  // The editor: copies of the kit's desk and desk lamp, saved; the desk is a workstation (ADR-0088).
  await page.getByRole('tab', { name: /Designs/ }).click()
  const editor = page.getByRole('region', { name: 'Design editor' })
  for (const name of ['Desk', 'Desk lamp']) {
    await editor.getByLabel('Start from a kit design').selectOption({ label: name })
    await editor.getByRole('button', { name: 'Open a copy' }).click()
    if (name === 'Desk') await expect(editor.locator('.de-facts')).toContainText(/Workstation\s*Yes/)
    await editor.getByRole('button', { name: 'Save to library' }).click()
    await expect(editor.getByRole('button', { name: `Open ${name} (mine)` })).toBeVisible()
  }

  // The desk goes into the meeting room: a free workstation with its seat.
  await page.getByRole('tab', { name: /Furniture/ }).click()
  await page.locator('#build-furniture-room').selectOption('room-6')
  await page.locator('.build-tiles').getByRole('button', { name: /Desk \(mine\)/ }).click()
  await placeWhereAccepted(page)
  await expect.poll(async () => ((await layout(page)).objects ?? []).length).toBe(1)
  const desk = (await layout(page)).objects![0]
  expect(desk.summary.workstation).toBe(true)
  expect(desk.seatAt).toEqual([0, 0.75])
  expect(desk.assignedTo ?? null).toBeNull()
  await expect(page.getByRole('region', { name: 'Placed' })).toContainText('a free workstation')

  // The CEO's desk: its lamp removed, the lamp of one's own takes the lamp slot.
  await page.locator('#build-furniture-room').selectOption('room-4')
  const ceo = (await layout(page)).rooms.find((r) => r.id === 'room-4')!
  const lamp = ceo.props.find((p) => p.kind === 'desk-lamp')!
  await page.getByRole('region', { name: 'Placed' }).getByRole('button', { name: new RegExp(lamp.id + '\\b') }).click()
  await page.getByRole('region', { name: /^Selected/ }).getByRole('button', { name: 'Remove' }).click()
  await expect.poll(async () => (await layout(page)).rooms.find((r) => r.id === 'room-4')!.props.some((p) => p.id === lamp.id)).toBe(false)
  await page.locator('.build-tiles').getByRole('button', { name: /Desk lamp \(mine\)/ }).click()
  await page.locator('#build-desk-pick').selectOption(lamp.attachedTo!)
  const place = page.getByRole('button', { name: /^Place here/ })
  await expect(place).toBeEnabled()
  await place.click()
  await expect.poll(async () => ((await layout(page)).objects ?? []).length).toBe(2)
  const own = (await layout(page)).objects!.find((o) => o.id !== desk.id)!
  expect(own.summary.mount).toBe('Surface')
  expect(own.onDesk).toEqual({ desk: lamp.attachedTo, slot: 'lamp' })

  expect(errors).toEqual([])
})

test('a chair of your own seats a meeting, and a lamp of your own hangs from the ceiling', async ({ page }) => {
  test.setTimeout(300_000)
  const { errors } = await boot(page, '/?quality=low')
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /^Build/ }).click()

  // The editor: copies of the kit's office chair (a seat, ADR-0089) and ceiling light (ADR-0090), saved.
  await page.getByRole('tab', { name: /Designs/ }).click()
  const editor = page.getByRole('region', { name: 'Design editor' })
  for (const name of ['Office chair', 'Ceiling light']) {
    await editor.getByLabel('Start from a kit design').selectOption({ label: name })
    await editor.getByRole('button', { name: 'Open a copy' }).click()
    await expect(editor.getByTestId('de-provides')).toContainText(name === 'Office chair' ? 'Seats 1 at meetings and breaks' : 'Hangs from the ceiling · 1 light')
    await editor.getByRole('button', { name: 'Save to library' }).click()
    await expect(editor.getByRole('button', { name: `Open ${name} (mine)` })).toBeVisible()
  }

  // Both go into the meeting room: the chair adds a place at its meetings, the lamp a light.
  await page.getByRole('tab', { name: /Furniture/ }).click()
  await page.locator('#build-furniture-room').selectOption('room-6')
  const tiles = page.locator('.build-tiles')
  await expect(tiles.getByRole('button', { name: /Office chair \(mine\)/ })).toContainText('Seats 1 at meetings and breaks')
  await expect(tiles.getByRole('button', { name: /Ceiling light \(mine\)/ })).toContainText('On the ceiling')
  await tiles.getByRole('button', { name: /Office chair \(mine\)/ }).click()
  await placeWhereAccepted(page)
  await expect.poll(async () => ((await layout(page)).objects ?? []).length).toBe(1)
  const chair = (await layout(page)).objects![0]
  expect(chair.summary.mount).toBe('Floor')
  expect(chair.places).toEqual([[0, 0]])
  await tiles.getByRole('button', { name: /Ceiling light \(mine\)/ }).click()
  await placeWhereAccepted(page)
  await expect.poll(async () => ((await layout(page)).objects ?? []).length).toBe(2)
  const lamp = (await layout(page)).objects!.find((o) => o.id !== chair.id)!
  expect(lamp.summary.mount).toBe('Ceiling')
  expect(lamp.room).toBe('room-6')
  const room = (await layout(page)).rooms.find((r) => r.id === 'room-6')!
  expect(room.objectCapabilities).toMatchObject({ places: 1, lights: 1 })
  await expect(page.getByTestId('room-provides')).toContainText('seats 1 at meetings and breaks')
  await expect(page.getByRole('region', { name: 'Placed' })).toContainText('on the ceiling')

  expect(errors).toEqual([])
})
