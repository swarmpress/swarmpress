import { expect, type Page } from '@playwright/test'

type Handle = { renderer: string; fallback: string | null; frames(): number; sim: { step(): bigint } }

// SwiftShader's WebGPU cannot copy canvas-backed textures that real GPUs can.
export const SWIFTSHADER_KNOWN = /copyExternalImageToTexture/

export async function boot(page: Page, path: string) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error' && /shader|pipeline|WGSL|GLSL/i.test(m.text())) errors.push(m.text())
  })
  await page.goto(path)
  await expect(page.locator('#stage canvas')).toBeVisible()
  await page.waitForFunction(() => {
    const h = (window as unknown as { __simpress?: Handle }).__simpress
    return !!h && h.frames() > 10
  }, null, { timeout: 120_000 })
  const { renderer, fallback } = await page.evaluate(() => {
    const h = (window as unknown as { __simpress: Handle }).__simpress
    return { renderer: h.renderer, fallback: h.fallback }
  })
  return { errors, renderer, fallback }
}

/** Frozen-clock pages stop rendering once stable; wait for that. */
export async function waitStill(page: Page) {
  await page.waitForFunction(() => (window as unknown as { __simpress: { still(): boolean } }).__simpress.still(), null, {
    timeout: 120_000,
  })
}
