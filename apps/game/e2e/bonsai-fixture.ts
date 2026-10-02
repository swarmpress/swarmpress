// Shared by the Bonsai e2e specs: installed Chrome, headed (a real GPU), with
// a persistent profile so the 6 GB of weights are downloaded once. Everything
// is skipped unless BONSAI_E2E=1.
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium, test as base, type BrowserContext, type Page } from '@playwright/test'

export const BONSAI_E2E = Boolean(process.env.BONSAI_E2E)
export const ENGINE_PATH = fileURLToPath(new URL('../public/vendor/bonsai/engine.mjs', import.meta.url))
const PROFILE = process.env.BONSAI_PROFILE ?? fileURLToPath(new URL('../.bonsai-profile', import.meta.url))

export const test = base.extend<{ context: BrowserContext; page: Page }>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext(PROFILE, {
      channel: process.env.BONSAI_CHANNEL ?? 'chrome',
      headless: false,
      viewport: { width: 1280, height: 800 },
      args: (process.env.BONSAI_CHROME_ARGS ?? '').split(' ').filter(Boolean),
    })
    await use(context)
    await context.close()
  },
  page: async ({ context }, use) => {
    const page = context.pages()[0] ?? (await context.newPage())
    await use(page)
  },
})

/** Skips the file without the gate, and fails early when the engine was never fetched. */
export function requireBonsai() {
  test.skip(!BONSAI_E2E, 'set BONSAI_E2E=1 to run against the real engine and model (about 6 GB on first run)')
  test.beforeAll(() => {
    if (BONSAI_E2E && !existsSync(ENGINE_PATH)) {
      throw new Error('the Bonsai engine is not installed: run `pnpm --filter @swarm-press/game bonsai:runtime` first')
    }
  })
}

export async function openHarness(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/bonsai.html')
  await page.waitForFunction(() => !!(window as unknown as { __bonsai?: unknown }).__bonsai)
  return errors
}
