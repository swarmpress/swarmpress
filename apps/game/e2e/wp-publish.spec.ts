// A company on WordPress publishes an article end to end (FEAT-108, FEAT-109; ADR-0082, ADR-0083), on
// the REAL game page against the real swarmpress-server, with the scripted `?llm=fake` model:
//
//   ?site=wordpress → WordPress installs onto live in the sandbox
//   → the CEO seeds the media library (uploads on a branch, merged into live; the bytes go to the
//     server's object store) and the knowledge pack is read from live
//   → standup → draft (a post of Gutenberg blocks on its branch, a change request) → review 6
//   → revision → review 8 → the CEO's Publish at the gate → the change request merges into live
//   → live is exported through the sandbox, the release deployed → DeployLanded → published
//   → the public site (/sites/{company}/) serves the article, the revised text in it
//
// Needs the sandbox release (`cargo xtask sandbox-fetch`); skipped without it. Run with
// `playwright test -c playwright.mvp.config.ts`.
import { existsSync, readdirSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { MVP_REVISION_LINE } from '../src/llm/mvp-script'

const VENDOR = new URL('../../../vendor/wp-sandbox/', import.meta.url).pathname
const fetched = existsSync(VENDOR) && readdirSync(VENDOR).some((d) => existsSync(`${VENDOR}${d}/.verified`))
const ITEM = 'work-item-1'
const TITLE = 'Harvest week in Manarola'

type Hook = {
  session: Record<string, (...a: unknown[]) => unknown>
  wordpress: { info(): { phase: string; error: string | null }; request(r: unknown): Promise<{ status: number; text(): string }>; repo(m: unknown): Promise<any> }
  wordpressSite: { lastExport(): { release: { id: string; files: Record<string, unknown> } } | null }
  refreshKnowledge(): Promise<string>
  sim: { plan_json(): string }
}

const hook = <T>(page: Page, fn: (h: Hook) => T | Promise<T>) => page.evaluate(`(${fn.toString()})(window.__swarmpress)`) as Promise<T>

test.skip(!fetched, 'the sandbox release is not fetched (cargo xtask sandbox-fetch)')

test('a company on WordPress drafts, reviews, publishes, exports and deploys an article', async ({ page }, ti) => {
  const engine = ti.project.name
  const login = `wppub${engine}${Date.now().toString(36)}`
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  // 08:00: an hour before the standup, for the CEO to seed the media library.
  await page.goto(`/?central=1&login=${login}&llm=fake&store=${engine}&quality=low&ff=08:00&board=off&site=wordpress`)
  await page.waitForFunction(
    () => {
      const failed = document.body.dataset.error
      if (failed) throw new Error(`the game page failed to boot: ${failed}`)
      const wp = (window as any).__swarmpress?.wordpress
      const i = wp?.info()
      if (i?.phase === 'failed' || i?.phase === 'blocked') throw new Error(`WordPress: ${i.error}`)
      return i?.phase === 'ready' && !!(window as any).__swarmpress.session
    },
    null,
    { timeout: 240_000 },
  )
  await hook(page, (h) => h.session.pause())

  // The CEO seeds the media library: two landscape images uploaded on a branch, merged into live.
  const seeded = await hook(page, async (h) => {
    const wp = h.wordpress
    const ceo = { kind: 'human', id: 'ceo' }
    await wp.repo({ op: 'branch.create', name: 'seed-media', from: 'live' })
    await wp.repo({ op: 'session.set', branch: 'seed-media', user_id: 1, author: ceo })
    const ids: number[] = []
    for (const [name, color] of [['terraces', '#7a9a3a'], ['harbour', '#2a6fb0']]) {
      const c = new OffscreenCanvas(320, 180)
      const g = c.getContext('2d')!
      g.fillStyle = color
      g.fillRect(0, 0, 320, 180)
      const bytes = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer())
      const r = await wp.request({ method: 'POST', url: '/?rest_route=/wp/v2/media', headers: { 'content-type': 'image/png', 'content-disposition': `attachment; filename="${name}.png"` }, body: bytes })
      if (r.status !== 201) throw new Error(`upload ${name}: ${r.status} ${r.text().slice(0, 200)}`)
      const m = JSON.parse(r.text()) as { id: number }
      const alt = await wp.request({ method: 'POST', url: `/?rest_route=/wp/v2/media/${m.id}`, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ alt_text: `The ${name} of Manarola` }) })
      if (alt.status !== 200) throw new Error(`alt ${name}: ${alt.status}`)
      ids.push(m.id)
    }
    const { id } = await wp.repo({ op: 'cr.open', source: 'seed-media', title: 'Media library', author: ceo })
    const merged = await wp.repo({ op: 'cr.merge', id, author: ceo })
    if (!merged.head) throw new Error(`merge: ${JSON.stringify(merged)}`)
    return { ids, refreshed: await h.refreshKnowledge() }
  })
  expect(seeded.ids).toHaveLength(2)
  expect(seeded.refreshed).toBe('fetched')

  await hook(page, (h) => {
    h.session.setSpeed(10)
    h.session.resume()
  })
  // The loop, driven by the sim, up to the publish gate.
  await expect
    .poll(
      async () => {
        const s = (await hook(page, (h) => h.session.state())) as { errors: string[] }
        if (s.errors.length) throw new Error(`the loop failed: ${s.errors.join('; ')}`)
        const plan = JSON.parse(await hook(page, (h) => h.sim.plan_json())) as { items: { id: string; awaitingApproval?: boolean }[] }
        return plan.items.find((i) => i.id === ITEM)?.awaitingApproval ?? false
      },
      { timeout: 240_000, intervals: [500] },
    )
    .toBe(true)

  // Nothing is on live yet: the post is on its branch, with an open change request.
  const before = await hook(page, async (h) => {
    const crs = (await h.wordpress.repo({ op: 'cr.list', open: true })) as { id: number; source: string; title: string }[]
    const live = await h.wordpress.repo({ op: 'objects', branch: 'live', prefix: 'post:' })
    return { crs, livePosts: (live as { value: { row: { post_name: string } } }[]).map((o) => o.value?.row?.post_name) }
  })
  expect(before.crs.map((c) => c.source)).toEqual([expect.stringMatching(/^draft-content-/)])
  expect(before.livePosts).not.toContain('harvest-week-in-manarola')

  // The CEO publishes at the gate.
  await hook(page, (h) => h.session.pause())
  await page.getByRole('navigation', { name: 'CEO tools' }).getByRole('button', { name: /^Inbox/ }).click()
  const inbox = page.getByRole('region', { name: 'Inbox', exact: true })
  const ticket = inbox.getByRole('article', { name: 'Publish approval', exact: true })
  await expect(ticket).toContainText(TITLE)
  // The preview is the draft branch as WordPress renders it (ADR-0083 §4), shown as data.
  await ticket.getByRole('button', { name: 'Read article' }).click()
  const preview = page.getByRole('dialog', { name: TITLE })
  await expect(preview).toContainText('rendered by WordPress')
  await expect(preview.locator('iframe')).toHaveAttribute('sandbox', '')
  await expect(page.frameLocator('.article-preview iframe').getByText(MVP_REVISION_LINE).first()).toBeVisible()
  await page.keyboard.press('Escape')
  await inbox.getByRole('group', { name: 'Answer Publish approval' }).getByRole('button', { name: /^Publish/ }).click()
  await page.keyboard.press('Escape')
  await hook(page, (h) => h.session.resume())

  // Merge, export, deploy, DeployLanded: published.
  await expect
    .poll(
      async () => {
        const s = (await hook(page, (h) => h.session.state())) as { errors: string[] }
        if (s.errors.length) throw new Error(`the loop failed: ${s.errors.join('; ')}`)
        return ((await hook(page, (h) => h.session.items())) as Record<string, string>)[ITEM] ?? null
      },
      { timeout: 240_000, intervals: [500] },
    )
    .toBe('published')
  await hook(page, (h) => h.session.pause())

  const exported = await hook(page, (h) => h.wordpressSite.lastExport())
  expect(exported).not.toBeNull()
  expect(Object.keys(exported!.release.files)).toEqual(expect.arrayContaining(['/', '/harvest-week-in-manarola/', '/search-index.json', '/feed/']))
  const info = (await hook(page, (h) => h.session.info())) as { companyId: string }

  // The public site serves the article from the release.
  const site = await page.evaluate(async (company) => {
    const r = await fetch(`/sites/${company}/harvest-week-in-manarola/`)
    return { status: r.status, html: await r.text() }
  }, info.companyId)
  expect(site.status).toBe(200)
  expect(site.html).toContain(TITLE)
  expect(site.html).toContain(MVP_REVISION_LINE)
  expect(site.html).not.toContain('sandbox.invalid')
  const current = await page.evaluate(async () => (await fetch('/api/releases/current')).json())
  expect(current.id).toBe(exported!.release.id)
  expect(errors).toEqual([])
})
