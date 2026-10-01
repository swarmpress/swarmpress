import { expect, test } from '@playwright/test'
import { boot, SWIFTSHADER_KNOWN } from './helpers'

test('boots the dollhouse with the preferred renderer and no shader errors', async ({ page }, info) => {
  const { errors, renderer } = await boot(page, '/?quality=medium')
  if (info.project.name === 'webgpu') {
    expect(renderer).toBe('webgpu')
    expect(errors.filter((e) => !SWIFTSHADER_KNOWN.test(e))).toEqual([])
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
