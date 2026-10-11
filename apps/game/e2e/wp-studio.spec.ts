// The Brick Studio over a company's WordPress (FEAT-110, FEAT-104; ADR-0082 §4–§5, ADR-0077), on
// the REAL game page against the real swarmpress-server:
//
//   ?site=wordpress → the Studio shows WordPress's post types as buildings, a post type's template
//   regions as storeys, the palette in the Paint shop and the plugin sets
//   → the CEO builds new regions for posts and repaints a colour: each a commit on a branch, merged
//   into live
//   → wp-admin opens as a door on a branch of its own; a setting saved there is built into live
//
// Needs the sandbox release (`cargo xtask sandbox-fetch`); skipped without it. Run with
// `playwright test -c playwright.mvp.config.ts`.
import { existsSync, readdirSync } from 'node:fs'
import { expect, test, type Frame, type Page } from '@playwright/test'

const VENDOR = new URL('../../../vendor/wp-sandbox/', import.meta.url).pathname
const fetched = existsSync(VENDOR) && readdirSync(VENDOR).some((d) => existsSync(`${VENDOR}${d}/.verified`))

const liveObject = (page: Page, key: string) =>
  page.evaluate(async (k) => {
    const wp = (window as any).__swarmpress.wordpress
    return (await wp.repo({ op: 'object', branch: 'live', key: k })).value
  }, key)

test.skip(!fetched, 'the sandbox release is not fetched (cargo xtask sandbox-fetch)')

test('the Studio builds a WordPress site: regions, palette, sets, and wp-admin as a door', async ({ page }, ti) => {
  const login = `wpstudio${ti.project.name}${Date.now().toString(36)}`
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`))

  await page.goto(`/?central=1&login=${login}&llm=fake&store=${ti.project.name}&quality=low&ff=08:00&board=off&site=wordpress`)
  await page.waitForFunction(
    () => {
      const failed = document.body.dataset.error
      if (failed) throw new Error(`the game page failed to boot: ${failed}`)
      const i = (window as any).__swarmpress?.wordpress?.info()
      if (i?.phase === 'failed' || i?.phase === 'blocked') throw new Error(`WordPress: ${i.error}`)
      return i?.phase === 'ready' && !!(window as any).__swarmpress.session
    },
    null,
    { timeout: 240_000 },
  )
  await page.evaluate(() => (window as any).__swarmpress.session.pause())

  // ---------------------------------------------------------------- the Town: post types as buildings
  await expect(page.getByRole('navigation', { name: 'CEO tools' }).getByRole('button', { name: /Blueprint/ })).toBeVisible({ timeout: 90_000 })
  await page.keyboard.press('b')
  const studio = page.getByRole('region', { name: /Brick Studio/ })
  await expect(studio).toBeVisible()
  await expect(studio.locator('[data-checker="ready"]')).toContainText('WordPress: post types and their regions', { timeout: 30_000 })
  await expect(studio.getByRole('region', { name: 'Sets' })).toContainText('No plugin sets')

  // ---------------------------------------------------------------- the Building: regions as storeys
  await studio.getByRole('tab', { name: 'Building' }).click()
  await studio.getByRole('navigation', { name: 'Buildings' }).getByRole('button', { name: /Posts/ }).click()
  await expect(studio.locator('[data-slot="post/content"]')).toBeVisible()
  const built = await page.evaluate(async () => {
    const source = (window as any).__swarmpress.overlay.source
    const models = (window as any).__swarmpress.overlay.siteModels.value
    const blueprint = structuredClone(models.blueprint)
    const post = blueprint.page_types.find((t: { id: string }) => t.id === 'post')
    post.slots = [
      { id: 'intro', blocks: ['core/heading'], min: 1, max: 1 },
      { id: 'body', blocks: ['core/paragraph', 'core/list'], min: 0 },
    ]
    const r = await source.saveBlueprint({ blueprint, base_hash: models.hash, message: 'Posts: an intro and a body' })
    // As the Studio's own save does: the models are read again.
    await source.reloadSiteModels()
    return r
  })
  expect(built.changes.length).toBeGreaterThan(0)
  const templates = JSON.parse((await liveObject(page, 'option:swarmpress_post_type_templates')).value)
  expect(templates.post.regions.map((r: { id: string }) => r.id)).toEqual(['intro', 'body'])
  await expect(studio.locator('[data-slot="post/intro"]')).toBeVisible({ timeout: 30_000 })
  // The architects' structural jobs read the same models through the orchestrator's engine.
  const forJobs = await page.evaluate(async () => (await (window as any).__swarmpress.wordpressSite.orchestratorEngine(() => {}).siteModels()) as { hash: string; blueprint: { page_types: { id: string }[] }; types: object; tools: unknown[] })
  expect(forJobs.blueprint.page_types.map((t) => t.id)).toContain('post')
  expect(forJobs.hash).toBeTruthy()

  // ---------------------------------------------------------------- the Paint shop: the palette
  await studio.getByRole('tab', { name: 'Paint shop' }).click()
  const swatches = studio.getByRole('list', { name: 'Palette' }).getByRole('listitem')
  await expect(swatches.first()).toBeVisible()
  const painted = await page.evaluate(async () => {
    const source = (window as any).__swarmpress.overlay.source
    const palette = structuredClone((window as any).__swarmpress.overlay.siteModels.value.palette)
    palette[0].color = '#2a6fb0'
    await source.savePalette(palette)
    return palette[0].slug as string
  })
  const styles = await page.evaluate(async () => {
    const wp = (window as any).__swarmpress.wordpress
    // A post's content is kept as its parsed tree: the whole object is searched.
    return (await wp.repo({ op: 'objects', branch: 'live', prefix: 'post:' })).filter((o: { value: { row: { post_type: string } } }) => o.value?.row?.post_type === 'wp_global_styles').map((o: { value: unknown }) => JSON.stringify(o.value))
  })
  expect(styles.some((text: string) => text.includes('#2a6fb0') && text.includes(painted))).toBe(true)

  // ---------------------------------------------------------------- wp-admin, a door on a branch of its own
  await studio.getByRole('tab', { name: 'Town' }).click()
  await studio.getByRole('button', { name: 'Open wp-admin on a branch' }).click()
  const door = page.getByRole('dialog', { name: 'wp-admin' })
  await expect(door.getByRole('button', { name: 'Build it' })).toBeEnabled({ timeout: 180_000 })
  const admin = async (): Promise<Frame> => {
    const until = Date.now() + 90_000
    for (;;) {
      const f = page.frames().find((fr) => fr.url().includes('/door/wp-admin/'))
      if (f) return f
      if (Date.now() > until) {
        const texts = await Promise.all(page.frames().map((fr) => fr.evaluate(() => document.body?.innerText?.slice(0, 300) ?? '').catch((e) => `(${String(e).slice(0, 80)})`)))
        throw new Error(`no wp-admin frame; frames: ${page.frames().map((fr, i) => `${fr.url()} → ${texts[i]}`).join(' | ')}`)
      }
      await page.waitForTimeout(250)
    }
  }
  const dashboard = await admin()
  await expect(dashboard.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 60_000 })
  await dashboard.goto(new URL('options-general.php', dashboard.url()).href)
  await dashboard.locator('#blogdescription').fill('Five villages, one coast')
  await dashboard.locator('#submit').click()
  await expect(dashboard.getByText('Settings saved.')).toBeVisible({ timeout: 60_000 })
  await door.getByRole('button', { name: 'Build it' }).click()
  await expect(door).toHaveCount(0)
  expect((await liveObject(page, 'option:blogdescription')).value).toBe('Five villages, one coast')
})
