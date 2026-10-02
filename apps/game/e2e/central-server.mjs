// Starts the real central server for e2e/orchestrator.spec.ts (Playwright
// `webServer`): builds `simpress-server`, then runs it on a throwaway SQLite
// database and data dir with dev auth, the fake GitHub and simulated deploys.
//
//   SIMPRESS_E2E_BIND (default 127.0.0.1:18080; not 8080, so a dev server can keep running)
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)))
const bind = process.env.SIMPRESS_E2E_BIND ?? '127.0.0.1:18080'
const cargo = process.env.CARGO ?? 'cargo'

const build = spawnSync(cargo, ['build', '-p', 'server', '--bin', 'simpress-server', '--manifest-path', join(root, 'Cargo.toml')], {
  cwd: root,
  stdio: 'inherit',
})
if (build.status !== 0) process.exit(build.status ?? 1)

const target = process.env.CARGO_TARGET_DIR ? resolve(root, process.env.CARGO_TARGET_DIR) : join(root, 'target')
const bin = join(target, 'debug', 'simpress-server')
const dir = mkdtempSync(join(tmpdir(), 'simpress-e2e-'))
const child = spawn(bin, [], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    SIMPRESS_BIND: bind,
    SIMPRESS_DEV_AUTH: '1',
    SIMPRESS_GITHUB: 'fake',
    SIMPRESS_SIMULATE_DEPLOY: '1',
    SIMPRESS_STATIC_DIR: '',
    DATABASE_URL: `sqlite://${dir}/s.db?mode=rwc`,
    SIMPRESS_DATA_DIR: dir,
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
