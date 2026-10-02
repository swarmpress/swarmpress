import { expect, test, type Page } from '@playwright/test'
import { boot, SWIFTSHADER_KNOWN } from './helpers'

test('boots the dollhouse with the preferred renderer and no shader errors', async ({ page }, info) => {
  const { errors, renderer, fallback } = await boot(page, '/?quality=medium')
  if (info.project.name === 'webgpu') {
    // Babylon's WebGPU device is lost immediately under headless SwiftShader
    // ("A valid external Instance reference no longer exists"); the watchdog
    // in main.ts must then recover on WebGL2. Real-GPU WebGPU rendering needs
    // a GPU runner (docs/guides/testing.md).
    if (renderer === 'webgpu') {
      expect(errors.filter((e) => !SWIFTSHADER_KNOWN.test(e))).toEqual([])
    } else {
      test.info().annotations.push({ type: 'webgpu-fallback', description: String(fallback) })
      expect(renderer).toBe('webgl2')
      expect(fallback).toBe('webgpu-device-lost')
    }
  } else {
    expect(renderer).toBe('webgl2')
    expect(errors).toEqual([])
  }
})

test('the sim clock drives the HUD', async ({ page }, info) => {
  test.skip(info.project.name !== 'fallback', 'renderer-independent')
  await boot(page, '/?renderer=webgl&quality=low&speed=600')
  const first = await page.locator('.hud-clock').textContent()
  await expect.poll(async () => page.locator('.hud-clock').textContent(), { timeout: 30_000 }).not.toBe(first)
})

test('?renderer=webgl forces WebGL2', async ({ page }, info) => {
  test.skip(info.project.name !== 'fallback', 'one run is enough')
  const { errors, renderer } = await boot(page, '/?renderer=webgl&quality=low')
  expect(renderer).toBe('webgl2')
  expect(errors).toEqual([])
})

type Rect = { left: number; top: number; right: number; bottom: number }
type Person = { id: string; screenX: number; screenY: number; walking: boolean; workItem: string | null; label: Rect | null }
type Hook = { people(): Person[]; sim: { step(): bigint }; overlay: { profile: { value: unknown } } | null }
const people = (page: Page) => page.evaluate(() => (window as unknown as { __swarmpress: Hook }).__swarmpress.people())

test('people walk smoothly between sim steps and open their profile on click', async ({ page }, info) => {
  test.skip(info.project.name !== 'fallback', 'renderer-independent')
  // Fake time (Date, performance.now, requestAnimationFrame): frames come exactly every
  // 16 ms of page time however slow the software renderer is, so one 10 Hz sim slice
  // spans six frames on any machine.
  await page.clock.install()
  await boot(page, '/?renderer=webgl&quality=low&speed=10')
  await page.waitForFunction(() => (window as unknown as { __swarmpress: Hook }).__swarmpress.people().some((p) => p.walking), null, { timeout: 120_000 })
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 100)
  // the walker with the longest way to go
  const walking = (await people(page)).filter((p) => p.walking)
  expect(walking.length).toBeGreaterThan(0)
  const samples: Array<{ id: string; step: number; at: string }> = []
  for (let i = 0; i < 36; i++) {
    await page.clock.runFor(16)
    const frame = await page.evaluate(() => {
      const h = (window as unknown as { __swarmpress: Hook }).__swarmpress
      return { step: Number(h.sim.step()), people: h.people() }
    })
    for (const p of frame.people) if (p.walking) samples.push({ id: p.id, step: frame.step, at: `${p.screenX.toFixed(2)},${p.screenY.toFixed(2)}` })
  }
  // per walker: distinct positions on screen against distinct sim steps while walking
  const ids = [...new Set(samples.map((s) => s.id))]
  const counts = ids.map((id) => {
    const mine = samples.filter((s) => s.id === id)
    return { id, frames: mine.length, steps: new Set(mine.map((s) => s.step)).size, positions: new Set(mine.map((s) => s.at)).size }
  })
  const best = counts.sort((a, b) => b.frames - a.frames)[0]
  test.info().annotations.push({ type: 'smooth-movement', description: JSON.stringify(best) })
  expect(best.frames).toBeGreaterThan(12)
  // A 10 Hz teleport shows one position per sim step; interpolation one per frame.
  expect(best.positions).toBeGreaterThan(best.steps * 2)

  // Clicking a seated person (where no label covers them) opens their profile card.
  // Time stays paused, so the person is still there when the click lands.
  let sitter: Person | null = null
  for (let i = 0; i < 60 && !sitter; i++) {
    sitter = await page.evaluate(() => {
      const all = (window as unknown as { __swarmpress: Hook }).__swarmpress.people()
      const covered = (p: Person) => all.some((o) => o.label && p.screenX >= o.label.left - 2 && p.screenX <= o.label.right + 2 && p.screenY >= o.label.top - 2 && p.screenY <= o.label.bottom + 2)
      return all.find((p) => !p.walking && p.screenY > 80 && p.screenY < 700 && p.screenX > 40 && p.screenX < 1240 && !covered(p)) ?? null
    })
    if (!sitter) await page.clock.runFor(1000)
  }
  expect(sitter, 'someone seated and clickable').toBeTruthy()
  await page.mouse.click(sitter!.screenX, sitter!.screenY)
  await page.clock.runFor(200)
  await expect(page.getByRole('dialog')).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as { __swarmpress: Hook }).__swarmpress.overlay?.profile.value)).toEqual({ staff: sitter!.id })
})
