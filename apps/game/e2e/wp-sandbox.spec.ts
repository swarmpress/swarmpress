// A company on the WordPress engine (FEAT-105, plan M1), on the REAL game page against the real
// swarmpress-server: `?site=wordpress` opens the company, the session starts the GPL sandbox on its
// own origin (vite.config.ts serves the pinned release on :5181), WordPress installs onto live
// through the storage worker, and the REST index answers through the session's runtime. A reload
// restores the site from the company store's records instead of installing it again.
//
// Needs the sandbox release (`cargo xtask sandbox-fetch`); skipped without it. Run with
// `playwright test -c playwright.mvp.config.ts`.
import { existsSync, readdirSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

const VENDOR = new URL('../../../vendor/wp-sandbox/', import.meta.url).pathname
const fetched = existsSync(VENDOR) && readdirSync(VENDOR).some((d) => existsSync(`${VENDOR}${d}/.verified`))

type Info = { phase: string; name: string | null; stages: Record<string, { state: string }> }
const wpInfo = (page: Page) => page.evaluate(() => (window as unknown as { __swarmpress: { wordpress: { info(): Info } | null } }).__swarmpress.wordpress?.info() ?? null)

async function bootReady(page: Page, url: string): Promise<Info> {
  await page.goto(url)
  await page.waitForFunction(
    () => {
      const failed = document.body.dataset.error
      if (failed) throw new Error(`the game page failed to boot: ${failed}`)
      const wp = (window as unknown as { __swarmpress?: { wordpress: { info(): { phase: string; error: string | null } } | null } }).__swarmpress?.wordpress
      const i = wp?.info()
      if (i && (i.phase === 'failed' || i.phase === 'blocked')) throw new Error(`WordPress: ${i.phase}: ${i.error}`)
      return i?.phase === 'ready'
    },
    null,
    { timeout: 240_000 },
  )
  return (await wpInfo(page))!
}

test.skip(!fetched, 'the sandbox release is not fetched (cargo xtask sandbox-fetch)')

test('?site=wordpress boots the sandbox on its own origin, installs, answers REST, and restores after a reload', async ({ page }, testInfo) => {
  const login = `wp${testInfo.project.name}${Date.now().toString(36)}`
  const url = `/?central=1&login=${login}&llm=fake&store=${testInfo.project.name}&quality=low&site=wordpress`
  const first = await bootReady(page, url)
  expect(first.stages.install.state).toBe('done')
  expect(first.name).toBeTruthy()

  // The sandbox is a cross-origin iframe: the game page cannot reach into it.
  const frame = await page.evaluate(() => {
    const f = document.querySelector('iframe[title="WordPress sandbox"]') as HTMLIFrameElement | null
    let reachable = true
    try {
      void f!.contentWindow!.document
    } catch {
      reachable = false
    }
    return { origin: f ? new URL(f.src).origin : null, reachable }
  })
  expect(frame.origin).not.toBe(new URL(page.url()).origin)
  expect(frame.reachable).toBe(false)

  const rest = await page.evaluate(async () => {
    const wp = (window as unknown as { __swarmpress: { wordpress: { request(r: unknown): Promise<{ status: number; text(): string }> } } }).__swarmpress.wordpress
    const r = await wp.request({ url: '/?rest_route=/wp/v2/types' })
    return { status: r.status, body: r.text() }
  })
  expect(rest.status).toBe(200)
  expect(Object.keys(JSON.parse(rest.body))).toEqual(expect.arrayContaining(['post', 'page']))

  // The repository's records are in the company store: a reload restores, it does not reinstall.
  await page.evaluate(() => (window as unknown as { __swarmpress: { wordpress: { flushed(): Promise<void> } } }).__swarmpress.wordpress.flushed())
  const again = await bootReady(page, url.replace('&site=wordpress', ''))
  expect(again.stages.install.state).toBe('skipped')
  expect(again.name).toBe(first.name)
})
