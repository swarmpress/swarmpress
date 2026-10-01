import { expect, test } from '@playwright/test'
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
