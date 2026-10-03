/**
 * The real game page on the real local model (ADR-0057, increment R8):
 * `/?central=1&llm=bonsai` against the central server of the MVP suite. The
 * office opens at once with the clock held, the model card runs its stages
 * (explain on a fresh profile, probe, storage, verify, download, load,
 * warm-up, qualification turn), and once the model is ready the clock runs.
 *
 * Gated: runs only with BONSAI_E2E=1, in installed Chrome, headed (a real
 * GPU), with a persistent profile. It is not part of CI. The weights are
 * cached per origin: the first run on this port downloads about 6 GB even
 * when the qualification harness (another port) has them already.
 *
 *   pnpm --filter @swarm-press/game bonsai:runtime     # once: fetch the pinned engine (git-ignored)
 *   BONSAI_E2E=1 pnpm --filter @swarm-press/game exec playwright test -c playwright.mvp.config.ts --project=bonsai
 */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium, expect, test as base, type BrowserContext, type Page } from '@playwright/test'
import type { SessionHook } from '../src/session/session'

const BONSAI_E2E = Boolean(process.env.BONSAI_E2E)
const ENGINE_PATH = fileURLToPath(new URL('../public/vendor/bonsai/engine.mjs', import.meta.url))
const PROFILE = process.env.BONSAI_PROFILE ?? fileURLToPath(new URL('../.bonsai-profile', import.meta.url))

const test = base.extend<{ context: BrowserContext; page: Page }>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use, info) => {
    const context = await chromium.launchPersistentContext(PROFILE, {
      channel: process.env.BONSAI_CHANNEL ?? 'chrome',
      headless: false,
      viewport: { width: 1280, height: 800 },
      baseURL: info.project.use.baseURL,
      args: (process.env.BONSAI_CHROME_ARGS ?? '').split(' ').filter(Boolean),
    })
    await use(context)
    await context.close()
  },
  page: async ({ context }, use) => {
    await use(context.pages()[0] ?? (await context.newPage()))
  },
})

// Skipped before any fixture runs: without the gate no browser is launched.
test.skip(!BONSAI_E2E, 'set BONSAI_E2E=1 to run the game page on the real engine and model (about 6 GB on the first run on this origin)')

function session<K extends keyof SessionHook>(page: Page, method: K): Promise<Awaited<ReturnType<SessionHook[K]>>> {
  return page.evaluate((m) => {
    const hook = (window as unknown as { __swarmpress: { session: Record<string, () => unknown> } }).__swarmpress.session
    return hook[m]()
  }, method) as Promise<Awaited<ReturnType<SessionHook[K]>>>
}

test('the game page starts the real model, holds the clock until it is ready, then runs', async ({ page }) => {
  // Cold: a 6 GB download plus kernel compilation; warm: about a minute (unmeasured).
  test.setTimeout(120 * 60_000)
  expect(existsSync(ENGINE_PATH), 'the Bonsai engine is not installed: run `pnpm --filter @swarm-press/game bonsai:runtime` first').toBe(true)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => console.log(`[page] ${m.text()}`))

  const login = `bonsai-${Date.now().toString(36)}`
  await page.goto(`/?central=1&login=${login}&llm=bonsai&store=turso&quality=medium`)
  await page.waitForFunction(
    () => {
      const failed = document.body.dataset.error
      if (failed) throw new Error(`the game page failed to boot: ${failed}`)
      const h = (window as unknown as { __swarmpress?: { frames(): number; session: unknown } }).__swarmpress
      return !!h && !!h.session && h.frames() > 5
    },
    null,
    { timeout: 120_000 },
  )
  expect(await page.evaluate(() => globalThis.crossOriginIsolated)).toBe(true)
  const first = await session(page, 'llm')
  expect(first).toMatchObject({ backend: 'bonsai', source: 'query' })
  // The office is open while the model starts; the clock waits for it.
  if (first.phase !== 'ready') {
    expect((await session(page, 'state')).model.state).not.toBe('ready')
    await expect(page.locator('.hud-chip')).toHaveAttribute('data-state', 'model-loading')
    await expect(page.locator('#model-startup')).toBeVisible()
  }

  // A fresh profile is asked first; the test is the player who starts the model.
  let lastStage = ''
  await expect
    .poll(
      async () => {
        const i = await session(page, 'llm')
        const stage = `${i.phase}:${i.stage}:${i.stage ? i.stages[i.stage].detail : ''}`
        if (stage !== lastStage) console.log(`[model] ${stage}`)
        lastStage = stage
        if (i.phase === 'explain') await page.getByRole('button', { name: 'Start the model' }).click()
        if (i.phase === 'blocked' || i.phase === 'failed' || i.phase === 'lost') throw new Error(`the model did not start (${i.phase} at ${i.stage}): ${i.error}`)
        return i.phase
      },
      { timeout: 110 * 60_000, intervals: [2000] },
    )
    .toBe('ready')

  const ready = await session(page, 'llm')
  console.log(`[model] ready: weights ${ready.fromCache ? 'from the browser cache' : 'downloaded'}; stage ms ${JSON.stringify(ready.ms)}; storage ${JSON.stringify(ready.storage)}`)
  for (const [id, s] of Object.entries(ready.stages)) expect(['done', 'skipped'], id).toContain(s.state)
  expect(ready.stages.qualify.state).toBe('done')
  expect(ready.stages.probe.state).toBe('done')
  // The hold is released: the chip leaves "Model loading" and the clock moves.
  expect((await session(page, 'state')).model.state).toBe('ready')
  await expect(page.locator('.hud-chip')).not.toHaveAttribute('data-state', 'model-loading')
  await expect(page.locator('#model-startup')).toHaveCount(0)
  const before = (await session(page, 'state')).step
  await expect.poll(async () => (await session(page, 'state')).step, { timeout: 30_000 }).toBeGreaterThan(before)
  await page.screenshot({ path: 'test-results/mvp-bonsai/ready.png' })
  expect(errors).toEqual([])
})
