import { expect, type Page } from '@playwright/test'

type Handle = { renderer: string; frames(): number; recoveries(): number; sim: { step(): bigint } }

// SwiftShader's WebGPU cannot copy canvas-backed textures that real GPUs can (ADR-0064 keeps it
// allow-listed; the renderer uploads textures as raw pixels and never depends on it).
export const SWIFTSHADER_KNOWN = /copyExternalImageToTexture/

/**
 * Opens the game and waits for frames on WebGPU (ADR-0064). Collects page errors,
 * shader and pipeline errors, WebGPU validation errors and device losses; fails at
 * once if the page shows the no-WebGPU screen instead.
 */
export async function boot(page: Page, path: string) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    const t = m.text()
    if (m.type() === 'error' && /shader|pipeline|WGSL|GLSL/i.test(t)) errors.push(t)
    else if (/WebGPU uncaptured error|device lost/i.test(t)) errors.push(t)
  })
  await page.goto(path)
  await expect(page.locator('#stage canvas')).toBeVisible()
  await page.waitForFunction(() => {
    const h = (window as unknown as { __swarmpress?: Handle }).__swarmpress
    return !!document.body.dataset.noWebgpu || (!!h && h.frames() > 10)
  }, null, { timeout: 120_000 })
  const noWebgpu = await page.evaluate(() => document.body.dataset.noWebgpu ?? null)
  expect(noWebgpu, 'the page found WebGPU (Playwright flags: e2e/webgpu.ts)').toBeNull()
  const { renderer, recoveries } = await page.evaluate(() => {
    const h = (window as unknown as { __swarmpress: Handle }).__swarmpress
    return { renderer: h.renderer, recoveries: h.recoveries() }
  })
  return { errors, renderer, recoveries }
}

/** Frozen-clock pages stop rendering once stable; wait for that. */
export async function waitStill(page: Page) {
  await page.waitForFunction(() => (window as unknown as { __swarmpress: { still(): boolean } }).__swarmpress.still(), null, {
    timeout: 120_000,
  })
}
