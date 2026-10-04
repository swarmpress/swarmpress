/**
 * No WebGPU, no game (ADR-0064 decision 2, FEAT-017): project `nowebgpu` runs
 * headless Chromium without the WebGPU flags, which offers no adapter. The page
 * shows the no-WebGPU screen — what is missing, which browsers work, a link to
 * the requirements — and draws nothing on another renderer.
 */
import { expect, test } from '@playwright/test'

test('without a WebGPU adapter the page says so, names working browsers and draws nothing', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/?quality=low')
  const screen = page.getByRole('alert')
  await expect(screen).toBeVisible()
  await expect(screen.getByRole('heading', { name: 'swarm.press needs WebGPU' })).toBeVisible()
  await expect(screen).toHaveAttribute('data-reason', 'no-adapter')
  await expect(screen).toContainText('no graphics adapter')
  await expect(screen).toContainText('Chrome or Edge 113')
  await expect(screen).toContainText('Safari 26')
  await expect(screen.getByRole('link', { name: /WebGPU support/ })).toHaveAttribute('href', /gpuweb/)
  expect(await page.evaluate(() => document.body.dataset.noWebgpu)).toBe('no-adapter')
  // Nothing else ran: no engine, no scene, no boot screen left behind.
  expect(await page.evaluate(() => 'undefined' !== typeof (window as unknown as { __swarmpress?: unknown }).__swarmpress)).toBe(false)
  await expect(page.locator('#no-webgpu')).toHaveCount(1)
  expect(errors).toEqual([])
  await test.info().attach('no-webgpu.png', { body: await page.screenshot(), contentType: 'image/png' })
})

test('without navigator.gpu the page names the missing API', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'gpu', { get: () => undefined, configurable: true })
  })
  await page.goto('/?quality=low')
  const screen = page.getByRole('alert')
  await expect(screen).toHaveAttribute('data-reason', 'no-api')
  await expect(screen).toContainText('does not offer WebGPU')
  await expect(screen).toContainText('navigator.gpu is missing')
})
