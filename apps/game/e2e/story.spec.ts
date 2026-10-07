// The story director (ADR-0074, FEAT-099) in the real game page against the
// real central server, with the fake model's fixed chapter (`?story=on`):
// a remark is logged and its bubble shows the chapter's words, read from the
// company store's kv by the remark's seq. Fast-forwarded past the 9:00 standup:
// a scene whose people are in a meeting is skipped. Normal speed: a remark lasts
// long enough in wall time for a slow software renderer to draw its bubble.
import { expect, test, type Page } from '@playwright/test'

const gameUrl = (engine: string, login: string) =>
  `/?central=1&login=${login}&llm=fake&store=${engine}&quality=low&ff=11:00&board=off&story=on`

async function boot(page: Page, url: string) {
  await page.goto(url)
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
}

const remarkCount = (page: Page) =>
  page.evaluate(async () => {
    const s = (window as unknown as { __swarmpress: { session: { commandLog(): Promise<{ kind: string }[]> } } }).__swarmpress.session
    return (await s.commandLog()).filter((c) => c.kind === 'Remark').length
  })

test('the story director plays a chapter as remark bubbles', async ({ page }, ti) => {
  const login = `story-${ti.project.name}-${Date.now().toString(36)}`
  await page.addInitScript(() => {
    const seen: { speaker: string; text: string }[] = []
    ;(window as unknown as { __bubbles: typeof seen }).__bubbles = seen
    new MutationObserver(() => {
      for (const el of document.querySelectorAll<HTMLElement>('.speech-bubble')) {
        const text = el.querySelector('.speech-bubble-full')?.textContent ?? ''
        if (text && !seen.some((s) => s.text === text)) seen.push({ speaker: el.dataset.speaker ?? '', text })
      }
    }).observe(document, { childList: true, subtree: true, characterData: true })
  })
  await boot(page, gameUrl(ti.project.name, login))

  // The fake chapter's first scene starts 30 running seconds in.
  await expect.poll(() => remarkCount(page), { timeout: 120_000 }).toBeGreaterThan(0)
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __bubbles: { text: string }[] }).__bubbles.map((b) => b.text)), { timeout: 30_000 })
    .toContainEqual(expect.stringContaining('the light over the harbour'))
})
