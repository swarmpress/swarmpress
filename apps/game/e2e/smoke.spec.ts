import { expect, test, type Page } from '@playwright/test'
import { boot, SWIFTSHADER_KNOWN } from './helpers'

// The renderer is WebGPU only (ADR-0064); these run on SwiftShader's WebGPU (e2e/webgpu.ts).

test('boots the dollhouse on WebGPU with no shader errors and no device loss', async ({ page }) => {
  const { errors, renderer, recoveries } = await boot(page, '/?quality=medium')
  expect(renderer).toBe('webgpu')
  expect(recoveries).toBe(0)
  expect(errors.filter((e) => !SWIFTSHADER_KNOWN.test(e))).toEqual([])
})

test('the sim clock drives the HUD', async ({ page }) => {
  await boot(page, '/?quality=low&speed=600')
  const first = await page.locator('.hud-clock').textContent()
  await expect.poll(async () => page.locator('.hud-clock').textContent(), { timeout: 30_000 }).not.toBe(first)
})

type Recovery = { renderer: string; frames(): number; recoveries(): number; recovering(): boolean; loseDevice(): void; sim: { step(): bigint } }

test('a lost device is recovered on a new WebGPU engine, the clock held meanwhile', async ({ page }) => {
  const { errors } = await boot(page, '/?quality=low&speed=10')
  const seen = await page.evaluate(async () => {
    const h = (window as unknown as { __swarmpress: Recovery }).__swarmpress
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
    const canvas = document.querySelector('#stage canvas')
    h.loseDevice()
    // The loss arrives asynchronously (seconds on a loaded software GPU); the recovery then takes at least 250 ms.
    const t0 = performance.now()
    while (!h.recovering() && h.recoveries() === 0 && performance.now() - t0 < 30_000) await sleep(2)
    const held = h.recovering()
    const steps = new Set<number>()
    while (h.recovering()) {
      steps.add(Number(h.sim.step()))
      await sleep(10)
    }
    return { held, steps: steps.size, newCanvas: document.querySelector('#stage canvas') !== canvas }
  })
  expect(seen.held, 'the page noticed the loss').toBe(true)
  expect(seen.steps, 'the clock held while the engine was rebuilt').toBeLessThanOrEqual(1)
  expect(seen.newCanvas).toBe(true)
  // Drawing again, on WebGPU, after one recovery; the sim runs on.
  const after = await page.evaluate(() => {
    const h = (window as unknown as { __swarmpress: Recovery }).__swarmpress
    return { frames: h.frames(), step: Number(h.sim.step()), renderer: h.renderer, recoveries: h.recoveries() }
  })
  expect(after.renderer).toBe('webgpu')
  expect(after.recoveries).toBe(1)
  await page.waitForFunction(
    (a) => {
      const h = (window as unknown as { __swarmpress: Recovery }).__swarmpress
      return h.frames() > a.frames + 10 && Number(h.sim.step()) > a.step
    },
    after,
    { timeout: 60_000 },
  )
  await expect(page.locator('#no-webgpu')).toHaveCount(0)
  // The loss is reported once; nothing else went wrong.
  expect(errors.filter((e) => !SWIFTSHADER_KNOWN.test(e) && !/device lost \(destroyed\)/.test(e))).toEqual([])
})


type Rect = { left: number; top: number; right: number; bottom: number }
type Person = { id: string; screenX: number; screenY: number; walking: boolean; workItem: string | null; label: Rect | null }
type Hook = { people(): Person[]; sim: { step(): bigint }; overlay: { profile: { value: unknown } } | null }
const people = (page: Page) => page.evaluate(() => (window as unknown as { __swarmpress: Hook }).__swarmpress.people())

test('people walk smoothly between sim steps and open their profile on click', async ({ page }) => {
  // Fake time (Date, performance.now, requestAnimationFrame): frames come exactly every
  // 16 ms of page time however slow the software renderer is, so one 10 Hz sim slice
  // spans six frames on any machine.
  await page.clock.install()
  await boot(page, '/?quality=low&speed=10')
  await page.waitForFunction(() => (window as unknown as { __swarmpress: Hook }).__swarmpress.people().some((p) => p.walking), null, { timeout: 120_000 })
  // pauseAt must name a future instant; on a loaded runner the page's clock can pass a small
  // margin before the call lands, so retry with a growing one.
  for (let margin = 250; ; margin *= 2) {
    try {
      await page.clock.pauseAt((await page.evaluate(() => Date.now())) + margin)
      break
    } catch (e) {
      if (margin >= 8000 || !String(e).includes('fast-forward to the past')) throw e
    }
  }
  // Wait, in fake time, until the sim is stepping again and someone is still walking: on a slow
  // CI runner the first frames after the pause can all land in the same sim slice.
  const stepNow = () => page.evaluate(() => Number((window as unknown as { __swarmpress: Hook }).__swarmpress.sim.step()))
  const before = await stepNow()
  for (let i = 0; i < 240; i++) {
    await page.clock.runFor(16)
    if ((await stepNow()) > before && (await people(page)).some((p) => p.walking)) break
  }
  expect(await stepNow(), 'the sim advances in fake time').toBeGreaterThan(before)
  // the walker with the longest way to go
  const walking = (await people(page)).filter((p) => p.walking)
  expect(walking.length).toBeGreaterThan(0)
  const samples: Array<{ id: string; step: number; at: string }> = []
  // 72 frames (seven sim slices): long enough that some walk spans more than 12 of them even when
  // the sample starts near the end of the walks in progress (36 frames flaked 1 in 20).
  for (let i = 0; i < 72; i++) {
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
