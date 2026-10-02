// Starts the real central server for e2e/orchestrator.spec.ts (Playwright
// `webServer`): builds `swarmpress-server`, then runs it on a throwaway SQLite
// database and data dir with dev auth, the fake GitHub and simulated deploys.
//
//   SWARMPRESS_E2E_BIND (default 127.0.0.1:18080; not 8080, so a dev server can keep running)
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)))
const bind = process.env.SWARMPRESS_E2E_BIND ?? '127.0.0.1:18080'
const cargo = process.env.CARGO ?? 'cargo'

const build = spawnSync(cargo, ['build', '-p', 'server', '--bin', 'swarmpress-server', '--manifest-path', join(root, 'Cargo.toml')], {
  cwd: root,
  stdio: 'inherit',
})
if (build.status !== 0) process.exit(build.status ?? 1)

const target = process.env.CARGO_TARGET_DIR ? resolve(root, process.env.CARGO_TARGET_DIR) : join(root, 'target')
const bin = join(target, 'debug', 'swarmpress-server')
const dir = mkdtempSync(join(tmpdir(), 'swarmpress-e2e-'))
const child = spawn(bin, [], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    SWARMPRESS_BIND: bind,
    SWARMPRESS_DEV_AUTH: '1',
    SWARMPRESS_GITHUB: 'fake',
    SWARMPRESS_SIMULATE_DEPLOY: '1',
    // The scripted orchestrator still writes the pre-MVP article shape (no
    // hero, no closing note), which the gateway's article profile refuses
    // with 422 (ADR-0061). Remove this line when the orchestrator assembles
    // the new shape (increment P1): the e2e then exercises the profile too.
    // The server accepts `off` only with the fake GitHub. With the profile
    // off the closed-world check (links and media against the knowledge
    // pack) is off too.
    SWARMPRESS_ARTICLE_PROFILE: process.env.SWARMPRESS_ARTICLE_PROFILE ?? 'off',
    // Every fake site repo starts as the knowledge crate's cinqueterre-mini
    // fixture (the real site's style guide and writer prompt, 20 indexed
    // images, 9 pages), so GET /api/gateway/knowledge serves a real pack and
    // the session binds the site's own style guide from it (ADR-0061, K2).
    SWARMPRESS_FAKE_SITE: process.env.SWARMPRESS_FAKE_SITE ?? join(root, 'crates/knowledge/tests/fixtures/cinqueterre-mini'),
    SWARMPRESS_STATIC_DIR: '',
    DATABASE_URL: `sqlite://${dir}/s.db?mode=rwc`,
    SWARMPRESS_DATA_DIR: dir,
    RUST_LOG: process.env.RUST_LOG ?? 'info,sqlx=warn,tower_http=warn',
  },
})

const stop = () => {
  child.kill('SIGTERM')
}
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
child.on('exit', (code) => {
  rmSync(dir, { recursive: true, force: true })
  process.exit(code ?? 0)
})
