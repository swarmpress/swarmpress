/**
 * A company's WordPress in the game (FEAT-105, FEAT-107; ADR-0078, ADR-0079, ADR-0084): the real
 * GPL sandbox (php-wasm and the fork) embedded from its own origin, its storage channel answered by
 * the game's storage worker (`storage-api-wasm` on sqlite-wasm). Only the two channels are used:
 * HTTP-shaped requests and the governed API.
 *
 * Needs the pinned sandbox release (`cargo xtask sandbox-fetch`) and `cargo xtask wasm`; skipped
 * without the release. Run with playwright.wordpress.config.ts. Writes the browser seam's benchmark
 * document, artifacts/bench/wp-seam-browser.json (evidence `bench/wp-seam`).
 */
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { arch, cpus, platform } from 'node:os'
import { expect, test, type Page } from '@playwright/test'

const VENDOR = new URL('../../../vendor/wp-sandbox/', import.meta.url).pathname
const fetched = existsSync(VENDOR) && readdirSync(VENDOR).some((d) => existsSync(`${VENDOR}${d}/.verified`))

interface Res {
  status: number
  text: string
}
const request = (page: Page, req: { method?: string; url: string; headers?: Record<string, string>; body?: string }) =>
  page.evaluate((r) => (window as unknown as { __wp: { request(r: unknown): Promise<Res> } }).__wp.request(r), req)
const repo = <T = any>(page: Page, msg: Record<string, unknown>) =>
  page.evaluate((m) => (window as unknown as { __wp: { repo(m: unknown): Promise<unknown> } }).__wp.repo(m), msg) as Promise<T>
const rest = (page: Page, route: string, body: unknown) => request(page, { method: 'POST', url: `/?rest_route=${route}`, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

const timings: Record<string, number[]> = {}
async function timed<T>(label: string, run: () => Promise<T>): Promise<T> {
  const t0 = performance.now()
  const r = await run()
  ;(timings[label] ??= []).push(performance.now() - t0)
  return r
}
const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.min(s.length - 1, Math.floor((s.length * p) / 100))] : 0
}
const channel = (page: Page) => page.evaluate(() => (window as unknown as { __wp: { channel(): { messages: number; micros: number[] } } }).__wp.channel())

const agent = { kind: 'agent', id: 'writer-1', job: 'e2e-1', model: 'scripted' }

test.describe.configure({ mode: 'serial' })
test.skip(!fetched, 'the sandbox release is not fetched (cargo xtask sandbox-fetch)')

test('WordPress installs, an agent writes on a work branch, and the merge reaches live', async ({ page }) => {
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`))
  await page.goto('/wordpress.html')
  await expect(page.locator('body')).toHaveAttribute('data-wp', /ready|failed/, { timeout: 240_000 })
  expect(await page.locator('#status').textContent()).not.toContain('failed')

  // The installer runs against the storage API and imports onto live.
  const form = await request(page, { url: '/wp-admin/install.php' })
  expect(form.status).toBe(200)
  const done = await timed('install', () => request(page, {
    method: 'POST',
    url: '/wp-admin/install.php?step=2',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'weblog_title=Cinque+Terre&user_name=admin&admin_password=e2e-pass-1&admin_password2=e2e-pass-1&pw_weak=on&admin_email=e2e%40example.org&blog_public=0&Submit=Install',
  }))
  expect(done.status, done.text.slice(0, 300)).toBe(200)
  expect(done.text).toContain('Success')
  const live = await repo<{ author: { id: string } }[]>(page, { op: 'log', branch: 'live' })
  expect(live.map((c) => c.author.id)).toEqual(['install'])
  await repo(page, { op: 'import.finish' })

  const before = (await channel(page)).messages
  const FRONT = 5
  for (let i = 0; i < FRONT; i++) {
    const front = await timed('front page', () => request(page, { url: '/' }))
    expect(front.status).toBe(200)
    expect(front.text).toContain('Cinque Terre')
  }
  const perFront = ((await channel(page)).messages - before) / FRONT

  // A REST post on a work branch is one commit by the session's author.
  await repo(page, { op: 'branch.create', name: 'wi-1' })
  await repo(page, { op: 'session.set', branch: 'wi-1', user_id: 1, author: agent })
  const created = await timed('REST create', () => rest(page, '/wp/v2/posts', {
    title: 'Harvest week in Manarola',
    status: 'publish',
    content: '<!-- wp:paragraph -->\n<p>The grapes come in by monorail.</p>\n<!-- /wp:paragraph -->',
  }))
  expect(created.status, created.text.slice(0, 300)).toBe(201)
  const post = (JSON.parse(created.text) as { id: number }).id
  const [head] = await repo<{ author: { id: string; job: string } }[]>(page, { op: 'log', branch: 'wi-1', limit: 1 })
  expect(head.author).toMatchObject({ id: 'writer-1', job: 'e2e-1' })

  // Live refuses governed writes.
  await repo(page, { op: 'session.set', branch: 'live', user_id: 1, author: agent })
  const refused = await rest(page, '/wp/v2/posts', { title: 'Straight to live', status: 'publish' })
  expect(refused.status).toBeGreaterThanOrEqual(400)

  // The change request merges, and live serves the post.
  const { id } = await repo<{ id: number }>(page, { op: 'cr.open', source: 'wi-1', title: 'Harvest week', author: agent, work_item: 1 })
  const merged = await repo<{ head?: string }>(page, { op: 'cr.merge', id, author: { kind: 'human', id: 'ceo' } })
  expect(merged.head).toBeTruthy()
  await repo(page, { op: 'session.set', branch: 'live', user_id: 0, author: { kind: 'system', id: 'visitor' } })
  const single = await timed('single post', () => request(page, { url: `/?p=${post}` }))
  expect(single.status).toBe(200)
  expect(single.text).toContain('The grapes come in by monorail.')

  // Every commit came back to the session as records for the company store.
  expect(await page.evaluate(() => (window as unknown as { __wp: { records(): number } }).__wp.records())).toBeGreaterThan(3)

  const { messages, micros } = await channel(page)
  const boot = await page.evaluate(() => (window as unknown as { __wp: { boot: { ms: number; php: string } } }).__wp.boot)
  writeBench({ boot, messages, micros, perFront })
})

function writeBench(r: { boot: { ms: number; php: string }; messages: number; micros: number[]; perFront: number }) {
  const git = (cmd: string) => execSync(`git ${cmd}`, { encoding: 'utf8' }).trim()
  const m = (name: string, subject: string, unit: string, value: number, extra: Record<string, unknown> = {}) => ({
    name,
    subject,
    unit,
    value: Math.round(value),
    determinism: 'environment-sensitive',
    direction: 'lower_is_better',
    status: 'pass',
    ...extra,
  })
  const subject = 'game → sandbox iframe → storage worker → JSON, per message'
  const median = (label: string) => pct(timings[label] ?? [], 50)
  const doc = {
    schema: 'cockpit.benchmark.v1',
    name: 'wp-seam-browser',
    feature_ids: ['FEAT-105', 'FEAT-107'],
    component: 'content',
    provenance: {
      commit: git('rev-parse HEAD'),
      branch: git('rev-parse --abbrev-ref HEAD'),
      dirty: git('status --porcelain') !== '',
      generated_at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
      tool: { name: 'apps/game e2e/wordpress.spec.ts', version: '1' },
    },
    build: { profile: 'harness' },
    machine: { os: platform() === 'darwin' ? 'macos' : platform(), arch: arch() === 'arm64' ? 'aarch64' : arch(), cpus: cpus().length, cpu_model: cpus()[0]?.model ?? '', runner: process.env.CI ? 'ci' : 'local' },
    workload: { php: `${r.boot.php} (php-wasm in the sandbox iframe)`, backend: 'php-wasm', storage: 'storage-api-wasm on sqlite-wasm (memory), in the storage worker', flows: 'install, front page x5, REST create on a work branch, refused write on live, merge, single post on live', messages: r.messages },
    metrics: [
      m('boundary.p50_us', subject, 'us', pct(r.micros, 50)),
      m('boundary.p95_us', subject, 'us', pct(r.micros, 95), { reason: 'go criterion: p95 < 2000 µs (M0)', status: pct(r.micros, 95) < 2000 ? 'pass' : 'fail' }),
      m('boundary.p99_us', subject, 'us', pct(r.micros, 99)),
      m('messages.per_front_page', 'storage messages per front page', 'count', r.perFront),
      m('sandbox.boot_ms', 'php-wasm and the fork, ready in the iframe', 'ms', r.boot.ms),
      m('page.install_ms', 'install.php?step=2', 'ms', median('install')),
      m('page.front_p50_ms', 'front page, installed site', 'ms', median('front page')),
      m('page.rest_create_ms', 'REST post on a work branch, one commit', 'ms', median('REST create')),
      m('page.single_ms', 'single post on live after the merge', 'ms', median('single post')),
    ],
  }
  const dir = new URL('../../../artifacts/bench/', import.meta.url).pathname
  mkdirSync(dir, { recursive: true })
  writeFileSync(`${dir}wp-seam-browser.json`, JSON.stringify(doc, null, 2) + '\n')
}
