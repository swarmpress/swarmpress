import { expect, test } from '@playwright/test'
import { boot, waitStill } from './helpers'

/**
 * Visual regression of the dollhouse at frozen sim times (ADR-0022).
 * Rendering is deterministic: fixed seed, frozen clock (?t=), snapped camera,
 * software WebGPU (SwiftShader, ADR-0064). Baselines live next to this file; update with
 * `pnpm test:e2e --update-snapshots` after an intended visual change.
 */
const TIMES = ['08:00', '13:00', '19:30', '23:00']

for (const t of TIMES) {
  test(`dollhouse at ${t}`, async ({ page }) => {
    await boot(page, `/?quality=medium&t=${t}`)
    await waitStill(page)
    await expect(page.locator('#stage canvas')).toHaveScreenshot(`dollhouse-${t.replace(':', '')}.png`, {
      maxDiffPixelRatio: 0.01,
    })
  })
}

for (const facing of [0, 2, 3]) {
  test(`camera angle ${facing} cuts away the facing walls`, async ({ page }) => {
    await boot(page, `/?quality=medium&t=13:00&facing=${facing}`)
    await waitStill(page)
    await expect(page.locator('#stage canvas')).toHaveScreenshot(`dollhouse-facing-${facing}.png`, {
      maxDiffPixelRatio: 0.01,
    })
  })
}
