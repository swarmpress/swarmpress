import { expect, test, type Locator } from '@playwright/test'
import { boot, waitStill } from './helpers'

/**
 * Compare against the baseline, then attach the baseline and this run's image as
 * `<name>-expected.png` / `<name>-actual.png`: Playwright attaches them only on a mismatch, and
 * Cockpit counts a passing visual check only from such a pair (FEAT-028).
 */
async function matchBaseline(canvas: Locator, name: string) {
  await expect(canvas).toHaveScreenshot(`${name}.png`, { maxDiffPixelRatio: 0.01 })
  const info = test.info()
  await info.attach(`${name}-expected.png`, { path: info.snapshotPath(`${name}.png`), contentType: 'image/png' })
  await info.attach(`${name}-actual.png`, { body: await canvas.screenshot(), contentType: 'image/png' })
}

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
    await matchBaseline(page.locator('#stage canvas'), `dollhouse-${t.replace(':', '')}`)
  })
}

for (const facing of [0, 2, 3]) {
  test(`camera angle ${facing} cuts away the facing walls`, async ({ page }) => {
    await boot(page, `/?quality=medium&t=13:00&facing=${facing}`)
    await waitStill(page)
    await matchBaseline(page.locator('#stage canvas'), `dollhouse-facing-${facing}`)
  })
}
