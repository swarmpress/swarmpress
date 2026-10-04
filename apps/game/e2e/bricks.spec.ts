/**
 * The brick office spike behind `?office=bricks` (FEAT-081, FEAT-082):
 * boots on software WebGPU (SwiftShader, ADR-0064; e2e/webgpu.ts),
 * checks the brick rooms through the `__swarmpress.bricks()` hook, zooms
 * onto the newsroom so the surfaces reach their close level, and attaches
 * screenshots. The screenshots are evidence for the report, not baselines:
 * the flag is off by default and visual.spec.ts' baselines do not move.
 */
import { expect, test, type Page } from '@playwright/test'
import { boot } from './helpers'

interface Stats {
  rooms: Array<{ room: string; kind: string; instances: number; studs: number; kitInstances: number; kitStuds: number; meshes: number; compileMs: number; meshMs: number }>
  instances: number
  studs: number
  meshes: number
  drawCalls: number
  kitLoadMs: number | null
  buildMs: number
  surfaces: { monitors: number; boards: number; close: number; redraws: number; maxRedrawsPerFrame: number }
}
type Hook = { bricks: (() => Stats) | null; frames(): number; scene: { activeCamera: unknown } }

const stats = (page: Page) => page.evaluate(() => (window as unknown as { __swarmpress: Hook }).__swarmpress.bricks?.() ?? null)
// Software WebGPU on a shared CI runner can be slow; on a timeout, say how far the frames got and
// what the page reported, instead of a bare TimeoutError.
const framesAfter = async (page: Page, n: number, log: string[]) => {
  const frames = () => page.evaluate(() => (window as unknown as { __swarmpress: Hook }).__swarmpress.frames())
  const start = await frames()
  try {
    await page.waitForFunction((s) => (window as unknown as { __swarmpress: Hook }).__swarmpress.frames() > s, start + n, { timeout: 120_000 })
  } catch (e) {
    const failed = await page.evaluate(() => document.getElementById('no-webgpu')?.textContent ?? null)
    throw new Error(`waited for ${n} frames after frame ${start}, reached ${await frames()}; no-WebGPU screen: ${failed}; console: ${log.slice(-20).join(' | ')}`, { cause: e })
  }
}

test('?office=bricks builds the newsroom and the editor’s office from the kit, with live surfaces', async ({ page }, info) => {
  const consoleErrors: string[] = []
  const consoleLog: string[] = []
  page.on('console', (m) => {
    consoleLog.push(`${m.type()}: ${m.text()}`)
    if (m.type() === 'error') consoleErrors.push(m.text())
  })
  const { errors, renderer } = await boot(page, '/?office=bricks&quality=low')
  expect(renderer).toBe('webgpu')

  const s = (await stats(page))!
  expect(s, 'the bricks hook is set').not.toBeNull()
  expect(s.rooms.map((r) => r.kind).sort()).toEqual(['editor-office', 'newsroom'])
  for (const r of s.rooms) {
    expect(r.instances, r.room).toBeGreaterThan(2000)
    expect(r.instances).toBe(r.kitInstances)
    expect(r.studs).toBe(r.kitStuds)
  }
  // Every desk in the two rooms has a monitor surface; the newsroom has its board.
  expect(s.surfaces.monitors).toBe(8)
  expect(s.surfaces.boards).toBe(1)
  // Brick meshes exist in the scene under their room ids.
  const names = await page.evaluate(() =>
    (window as unknown as { __swarmpress: { scene: { meshes: Array<{ name: string }> } } }).__swarmpress.scene.meshes.map((m) => m.name).filter((n) => n.startsWith('bricks-')),
  )
  for (const r of s.rooms) expect(names.some((n) => n.startsWith(`bricks-${r.room}-`)), r.room).toBe(true)
  await info.attach('bricks-office.png', { body: await page.locator('#stage canvas').screenshot(), contentType: 'image/png' })

  // Mid-morning: the writers at their desks, the monitors on.
  await page.evaluate(() => {
    const sim = (window as unknown as { __swarmpress: { sim: { advance(n: number): void; steps_per_day(): bigint; minute_of_day(): number } } }).__swarmpress.sim
    const perMinute = Number(sim.steps_per_day()) / 1440
    sim.advance(Math.round(((10 * 60 + 30 - sim.minute_of_day() + 1440) % 1440) * perMinute))
  })
  await framesAfter(page, 20, consoleLog)
  await info.attach('bricks-office-1030.png', { body: await page.locator('#stage canvas').screenshot(), contentType: 'image/png' })

  // Close up on the newsroom: the monitors and the board switch to their close views, within the budget.
  await page.evaluate(() => {
    const cam = (window as unknown as { __swarmpress: Hook }).__swarmpress.scene.activeCamera as unknown as {
      target: { set(x: number, y: number, z: number): void }
      orthoTop: number
      orthoBottom: number
      orthoLeft: number
      orthoRight: number
    }
    cam.target.set(4, 0.9, 2.6)
    const aspect = (cam.orthoRight - cam.orthoLeft) / (cam.orthoTop - cam.orthoBottom)
    const zoom = 2.6
    cam.orthoTop = zoom
    cam.orthoBottom = -zoom
    cam.orthoLeft = -zoom * aspect
    cam.orthoRight = zoom * aspect
  })
  await framesAfter(page, 30, consoleLog)
  const close = (await stats(page))!
  expect(close.surfaces.close).toBeGreaterThan(0)
  expect(close.surfaces.redraws).toBeGreaterThan(0)
  expect(close.surfaces.maxRedrawsPerFrame).toBeLessThanOrEqual(4)
  await info.attach('bricks-newsroom-close.png', { body: await page.locator('#stage canvas').screenshot(), contentType: 'image/png' })
  await info.attach('bricks-stats.json', { body: JSON.stringify(close, null, 2), contentType: 'application/json' })
  console.log(`[bricks] ${JSON.stringify({ instances: close.instances, studs: close.studs, meshes: close.meshes, drawCalls: close.drawCalls, kitLoadMs: close.kitLoadMs, buildMs: close.buildMs, rooms: close.rooms.map((r) => [r.room, r.instances, r.studs, Math.round(r.compileMs), Math.round(r.meshMs)]) })}`)

  expect(errors).toEqual([])
  expect(consoleErrors).toEqual([])
})
