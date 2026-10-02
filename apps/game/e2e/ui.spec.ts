import { createRequire } from 'node:module'
import { expect, test, type Page } from '@playwright/test'
import { boot, waitStill } from './helpers'

/**
 * CEO management overlay (ADR-0018) in the real browser, on the WebGL2
 * fallback over the live dollhouse, with the fixture data source (?ui=mock).
 * Screenshots go to test-results/ui/ as evidence (not baselines).
 */
const require = createRequire(import.meta.url)
const AXE = require.resolve('axe-core/axe.min.js')

const PANELS = [
  { label: 'Plan', key: 'p', title: 'Media & publishing plan' },
  { label: 'Inbox', key: 'i', title: 'Inbox' },
  { label: 'Org chart', key: 'o', title: 'Org chart' },
  { label: 'Projects', key: 'j', title: 'Projects' },
  { label: 'Finance', key: 'f', title: 'Finance' },
  { label: 'Performance', key: 'k', title: 'Performance' },
  { label: 'Hiring', key: 'h', title: 'Hiring' },
]

const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/ui/${name}.png` })
const region = (page: Page, title: string) => page.getByRole('region', { name: title, exact: true })
const toolbar = (page: Page) => page.getByRole('navigation', { name: 'CEO tools' })

/** Real-browser colour contrast (jsdom can't compute it; vitest covers the rest of axe). */
async function contrast(page: Page) {
  await page.addScriptTag({ path: AXE })
  return page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<{ violations: Array<{ id: string; nodes: Array<{ target: string[]; failureSummary: string }> }> }> } }).axe
    // The article preview is a sandboxed frame without scripts: axe cannot run inside it, and it is the page's own look.
    const r = await axe.run('#overlay', { runOnly: ['color-contrast'], iframes: false })
    return r.violations.flatMap((v) => v.nodes.map((n) => `${n.target.join(' ')}: ${n.failureSummary}`))
  })
}

test.describe('CEO overlay', () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== 'fallback', 'the overlay is renderer-independent')
  })

  test('opens every panel from the toolbar and by keyboard', async ({ page }) => {
    const { errors } = await boot(page, '/?renderer=webgl&quality=low&ui=mock')
    await expect(page.locator('.hud-business')).toContainText('Cash')
    await expect(page.locator('.hud-business')).toContainText('3 high')

    const buttons = toolbar(page).getByRole('button')
    await expect(buttons.first()).toContainText('Plan')

    for (const p of PANELS) {
      await toolbar(page).getByRole('button', { name: new RegExp(`^${p.label}`) }).click()
      await expect(region(page, p.title)).toBeVisible()
      await shot(page, `panel-${p.label.toLowerCase().replace(/\s+/g, '-')}`)
      expect(await contrast(page), `${p.label} contrast`).toEqual([])
      await page.keyboard.press('Escape')
      await expect(region(page, p.title)).toHaveCount(0)
    }

    // Keyboard: letters and numbers toggle panels.
    await page.locator('body').click({ position: { x: 640, y: 300 } })
    for (const p of PANELS) {
      await page.keyboard.press(p.key)
      await expect(region(page, p.title)).toBeVisible()
    }
    await page.keyboard.press('1')
    await expect(region(page, 'Media & publishing plan')).toBeVisible()
    await page.keyboard.press('1')
    await expect(region(page, 'Media & publishing plan')).toHaveCount(0)

    // Tab reaches the toolbar.
    await page.locator('body').click({ position: { x: 640, y: 300 } })
    await page.keyboard.press('Tab')
    await expect(page.locator(':focus')).toBeVisible()
    expect(errors).toEqual([])
  })

  test('profile card, allocation and answering a ticket', async ({ page }) => {
    const { errors } = await boot(page, '/?renderer=webgl&quality=low&ui=mock')

    await page.keyboard.press('o')
    await region(page, 'Org chart').getByRole('button', { name: /Giulia Rossi/ }).click()
    const dialog = page.getByRole('dialog', { name: 'Giulia Rossi' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('making pesto by hand')
    await shot(page, 'profile-giulia')
    expect(await contrast(page), 'profile contrast').toEqual([])

    // Assign 10% to the second project; the slider stops at 20% (80% elsewhere).
    await dialog.getByRole('combobox', { name: 'Project', exact: true }).selectOption('project-2')
    const slider = dialog.getByRole('slider')
    await expect(slider).toHaveAttribute('max', '20')
    await slider.fill('10')
    await expect(dialog).toContainText('Total after: 90% of 100%')
    await dialog.getByRole('button', { name: 'Assign' }).click()
    await expect(dialog).toContainText('90% of 100% allocated')
    await shot(page, 'profile-giulia-assigned')
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)

    // Answer the high-risk ticket.
    await page.keyboard.press('i')
    const inbox = region(page, 'Inbox')
    await expect(inbox.getByRole('heading', { name: /Open tickets \(6\)/ })).toBeVisible()
    const ticket = inbox.getByRole('article', { name: 'High risk article' })
    await ticket.getByRole('button', { name: /^Hold/ }).click()
    await expect(inbox.getByRole('heading', { name: /Open tickets \(5\)/ })).toBeVisible()
    await expect(page.locator('.hud-business')).toContainText('2 high')
    await shot(page, 'inbox-answered')

    // Plan: open a work item with its thread.
    await page.keyboard.press('p')
    await region(page, 'Media & publishing plan').getByRole('button', { name: 'Harvest week in Manarola', exact: true }).click()
    await expect(page.getByText('Changes requested · score 6/10')).toBeVisible()
    await shot(page, 'plan-work-item')
    expect(await contrast(page), 'work item contrast').toEqual([])
    expect(errors).toEqual([])
  })

  test('publish approval: the article in its ticket, the preview, and Send back with a note', async ({ page }) => {
    const { errors } = await boot(page, '/?renderer=webgl&quality=low&ui=mock')
    // What the preview frame asks the network for (the game page's own requests are not counted).
    const fromPreview: string[] = []
    page.on('request', (r) => {
      if (r.frame() !== page.mainFrame()) fromPreview.push(r.url())
    })
    await page.keyboard.press('i')
    const inbox = region(page, 'Inbox')
    const ticket = inbox.getByRole('article', { name: 'Publish approval', exact: true })
    await expect(ticket).toHaveCount(1)
    await expect(ticket.getByRole('button', { name: 'Harvest week in Manarola', exact: true })).toBeVisible()
    // The two groups, apart: what was counted, and what the editor thinks.
    const measured = ticket.getByRole('group', { name: 'Measured checks' })
    await expect(measured).toContainText('314 of 400 target (79%), within ±25%')
    await expect(measured).toContainText('Banned phrases')
    const opinion = ticket.getByRole('group', { name: 'Editor’s opinion' })
    await expect(opinion).toContainText('Score 8/10')
    await expect(ticket.getByText('Pull request #31')).toBeVisible()
    await ticket.scrollIntoViewIfNeeded()
    await shot(page, 'inbox-publish-approval')
    expect(await contrast(page), 'approval ticket contrast').toEqual([])

    // The preview: a dialog with the page in a sandboxed frame.
    await ticket.getByRole('button', { name: 'Read article' }).click()
    const dialog = page.getByRole('dialog', { name: 'Crates, Ladders & Sweet Wine: Harvest Week in Manarola' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('Preview (approximation of the live theme)')
    const iframe = dialog.locator('iframe')
    await expect(iframe).toHaveAttribute('sandbox', '')
    const article = page.frameLocator('.article-preview iframe')
    await expect(article.getByRole('heading', { level: 1 })).toHaveText('Crates, Ladders & Sweet Wine: Harvest Week in Manarola')
    await expect(article.getByRole('heading', { level: 2 })).toHaveCount(4)
    await expect(article.getByRole('link')).toHaveCount(0)
    // The frame is an opaque origin: the page cannot reach into it, and it cannot reach the page.
    expect(await iframe.evaluate((f) => (f as HTMLIFrameElement).contentDocument)).toBeNull()
    await shot(page, 'article-preview')
    expect(await contrast(page), 'preview dialog contrast').toEqual([])
    // The frame asked for the hero and the inline image at their https addresses, and for nothing else.
    await expect.poll(() => fromPreview.length).toBe(2)
    expect(fromPreview.map((u) => new URL(u).origin + new URL(u).pathname)).toEqual([
      'https://images.unsplash.com/photo-1499678329028-101435549a4e',
      'https://images.unsplash.com/photo-1516483638261-f4dbaf036963',
    ])
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(ticket.getByRole('button', { name: 'Read article' })).toBeFocused()

    // Send back with a note: the note lands in the thread, then the ticket is answered.
    await ticket.getByRole('button', { name: /^Send back/ }).click()
    await ticket.getByRole('textbox', { name: 'What should change? (optional)' }).fill('Name one grower in the trenino paragraph.')
    await ticket.getByRole('button', { name: 'Send back with this note' }).click()
    // Answered, it moves under the (closed) "Resolved" list.
    await expect(inbox.locator('article[data-kind="publish-approval"]')).toContainText('Answered Send back by you.')
    await page.keyboard.press('p')
    await region(page, 'Media & publishing plan').getByRole('button', { name: 'Harvest week in Manarola', exact: true }).click()
    const note = page.locator('li.post[data-type="send-back-note"]')
    await expect(note).toContainText('Name one grower in the trenino paragraph.')
    // The thread's pull-request post opens the same preview.
    await page.locator('li.post[data-type="artifact"]').getByRole('button', { name: 'Read article' }).click()
    await expect(page.frameLocator('.article-preview iframe').getByRole('heading', { level: 1 })).toHaveText('Crates, Ladders & Sweet Wine: Harvest Week in Manarola')
    expect(errors).toEqual([])
  })

  test('reads the live wasm sim by default', async ({ page }) => {
    const { errors } = await boot(page, '/?renderer=webgl&quality=low')
    await expect(page.locator('.hud-business')).toContainText('Cash')
    await page.keyboard.press('o')
    const org = region(page, 'Org chart')
    await expect(org.getByRole('button', { name: /Giulia/ })).toBeVisible()
    await page.keyboard.press('f')
    await expect(region(page, 'Finance')).toBeVisible()
    // Live data: revenue is a stub in the sim, and the panel says so.
    await expect(region(page, 'Finance').getByRole('note')).toContainText('Revenue is not modelled yet')
    await shot(page, 'live-finance')
    expect(await contrast(page), 'live finance contrast').toEqual([])
    // No KPI source live: the Performance panel is not offered, by button or by key.
    await expect(toolbar(page).getByRole('button')).toHaveCount(PANELS.length - 1)
    await expect(toolbar(page).getByRole('button', { name: /^Performance/ })).toHaveCount(0)
    await page.keyboard.press('k')
    await expect(region(page, 'Performance')).toHaveCount(0)
    await expect(region(page, 'Finance')).toBeVisible()
    // The plan shows the board alone: the sim exports nothing for the other views.
    await page.keyboard.press('p')
    await expect(region(page, 'Media & publishing plan')).toBeVisible()
    await expect(region(page, 'Media & publishing plan').getByRole('tab')).toHaveCount(0)
    expect(errors).toEqual([])
  })

  test('stays out of frozen screenshot pages unless asked for', async ({ page }) => {
    await boot(page, '/?renderer=webgl&quality=low&t=13:00')
    await waitStill(page)
    await expect(toolbar(page)).toHaveCount(0)
    await expect(page.locator('.hud-business')).toHaveCount(0)
    await boot(page, '/?renderer=webgl&quality=low&t=13:00&ui=mock')
    await expect(toolbar(page)).toBeVisible()
  })

  test('stays usable at 1024 px wide', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 700 })
    await boot(page, '/?renderer=webgl&quality=low&ui=mock')
    await page.keyboard.press('p')
    const plan = region(page, 'Media & publishing plan')
    await expect(plan).toBeVisible()
    const box = (await plan.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(1024)
    const bar = (await toolbar(page).boundingBox())!
    expect(bar.x + bar.width).toBeLessThanOrEqual(1024)
    await shot(page, 'plan-1024')
  })
})
