/**
 * Job-worker leader election across real tabs (Web Locks + BroadcastChannel
 * in Chromium): one leader per company, the follower takes over when the
 * leader tab closes, status reaches followers. Cheap (no model), so not gated.
 */
import { expect, test, type Page } from '@playwright/test'
import type { electLeader } from '../src/llm/leader'

type W = Window & {
  __llmHarness: { electLeader: typeof electLeader }
  __leader?: ReturnType<typeof electLeader>
  __statuses?: string[]
}

async function join(page: Page, tabId: string, companyId = 'acme') {
  await page.goto('/llm.html')
  await page.waitForFunction(() => !!(window as unknown as Partial<W>).__llmHarness)
  await page.evaluate(
    ({ tabId, companyId }) => {
      const w = window as unknown as W
      w.__statuses = []
      w.__leader = w.__llmHarness.electLeader({ companyId, tabId })
      w.__leader.onStatus((s) => w.__statuses!.push(`${s.tabId}:${s.state}`))
    },
    { tabId, companyId },
  )
}

const isLeader = (p: Page) => p.evaluate(() => (window as unknown as W).__leader!.isLeader)

test('one leader per company across tabs; failover when the leader tab closes', async ({ context }, info) => {
  test.skip(info.project.name !== 'fallback', 'browser-feature test; one project is enough')
  const a = await context.newPage()
  const b = await context.newPage()
  await join(a, 'A')
  await expect.poll(() => isLeader(a)).toBe(true)
  await join(b, 'B')
  expect(await b.evaluate(() => (window as unknown as W).__leader!.mechanism)).toBe('web-locks')
  await expect.poll(() => b.evaluate(() => (window as unknown as W).__leader!.leaderTabId)).toBe('A')
  expect(await isLeader(b)).toBe(false)

  await a.evaluate(() => (window as unknown as W).__leader!.publishStatus({ state: 'generating', jobId: 'j1' }))
  await expect.poll(() => b.evaluate(() => (window as unknown as W).__statuses)).toEqual(['A:generating'])

  // Another company in the same browser gets its own leader.
  const c = await context.newPage()
  await join(c, 'C', 'other-co')
  await expect.poll(() => isLeader(c)).toBe(true)

  await a.close() // the browser releases A's lock together with the tab
  await expect.poll(() => isLeader(b)).toBe(true)
})
