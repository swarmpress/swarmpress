/**
 * The game's storage API on the real `storage-api-wasm` and sqlite-wasm (FEAT-107): MySQL as
 * WordPress's installer and REST API send it, the commits it makes, uploads, mail, refused
 * outgoing HTTP, a merged change request, and a restore from the records. Needs
 * `cargo xtask wasm`; skipped without crates/storage-api-wasm/pkg.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { loadSqlite } from '../store/sqlite-core'
import { GameStorage, type StorageWasm } from './storage-host'

const PKG = resolve(process.cwd(), '../../crates/storage-api-wasm/pkg') + '/'
const built = existsSync(`${PKG}storage_api_wasm.js`)

let wasm: StorageWasm & { initSync(m: { module: BufferSource }): unknown }
let sqlite3: Awaited<ReturnType<typeof loadSqlite>>

const q = async (s: GameStorage, sql: string) => JSON.parse(await s.storage(JSON.stringify({ op: 'query', rid: 'r1', sql }))) as { error?: string; rows?: string[][]; insert_id?: number }
const end = async (s: GameStorage) => JSON.parse(await s.storage(JSON.stringify({ op: 'end', rid: 'r1', uri: '/', method: 'POST' }))) as { commit: string | null; error?: string }

const OPTIONS_DDL = `CREATE TABLE wp_options (
 option_id bigint(20) unsigned NOT NULL auto_increment,
 option_name varchar(191) NOT NULL default '',
 option_value longtext NOT NULL,
 autoload varchar(20) NOT NULL default 'yes',
 PRIMARY KEY  (option_id),
 UNIQUE KEY option_name (option_name),
 KEY autoload (autoload)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_520_ci`

async function installed(): Promise<GameStorage> {
  const s = new GameStorage({ wasm, sqlite3 })
  expect((await q(s, OPTIONS_DDL)).error).toBeUndefined()
  for (const [k, v] of [['blogname', 'Cinque Terre'], ['siteurl', 'http://sandbox.invalid'], ['_transient_doing_cron', '1']]) {
    expect((await q(s, `INSERT INTO \`wp_options\` (\`option_name\`, \`option_value\`, \`autoload\`) VALUES ('${k}', '${v}', 'yes') ON DUPLICATE KEY UPDATE \`option_name\` = VALUES(\`option_name\`), \`option_value\` = VALUES(\`option_value\`)`)).error).toBeUndefined()
  }
  expect((await end(s)).commit).toBeTruthy()
  s.repo({ op: 'import.finish' })
  return s
}

describe.skipIf(!built)('the game storage API (storage-api-wasm on sqlite-wasm)', () => {
  beforeAll(async () => {
    wasm = (await import(/* @vite-ignore */ pathToFileURL(`${PKG}storage_api_wasm.js`).href)) as typeof wasm
    wasm.initSync({ module: readFileSync(`${PKG}storage_api_wasm_bg.wasm`) })
    sqlite3 = await loadSqlite()
  })

  it("imports the installer's writes onto live, governed only", async () => {
    const s = await installed()
    const objects = s.repo<{ key: string; value: { value: string } }[]>({ op: 'objects', branch: 'live', prefix: 'option:' })
    expect(objects.map((o) => o.key).sort()).toEqual(['option:blogname', 'option:siteurl'])
    expect((await q(s, "SELECT option_value FROM wp_options WHERE option_name = 'blogname'")).rows).toEqual([['Cinque Terre']])
  })

  it("commits a branch's writes as the session's author, and refuses governed writes on live", async () => {
    const s = await installed()
    expect((await q(s, "UPDATE wp_options SET option_value = 'x' WHERE option_name = 'blogname'")).error).toMatch(/live is read-only/)
    s.repo({ op: 'branch.create', name: 'wi-1' })
    s.repo({ op: 'session.set', branch: 'wi-1', user_id: 1, author: { kind: 'agent', id: 'writer-1', job: 'job-3', model: 'gpt-6-luna' } })
    await q(s, "UPDATE wp_options SET option_value = 'Cinque Terre Travel' WHERE option_name = 'blogname'")
    const head = (await end(s)).commit
    const log = s.repo<{ id: string; author: { id: string; job: string } }[]>({ op: 'log', branch: 'wi-1', limit: 1 })
    expect(log[0]).toMatchObject({ id: head, author: { id: 'writer-1', job: 'job-3' } })
  })

  it('keeps upload bytes by digest with a sidecar, queues mail, and refuses outgoing HTTP loudly', async () => {
    const s = await installed()
    s.repo({ op: 'branch.create', name: 'wi-1' })
    s.repo({ op: 'session.set', branch: 'wi-1', user_id: 1 })
    const put = JSON.parse(await s.storage(JSON.stringify({ op: 'asset.put', rid: 'r1', path: '2026/10/dot.png', mime: 'image/png', data: btoa('PNGDATA') }))) as { sha256: string }
    expect(put.sha256).toMatch(/^[0-9a-f]{64}$/)
    const got = JSON.parse(await s.storage(JSON.stringify({ op: 'asset.get', rid: 'r2', path: '2026/10/dot.png' }))) as { data: string }
    expect(atob(got.data)).toBe('PNGDATA')
    await s.storage(JSON.stringify({ op: 'mail', rid: 'r1', to: ['ceo@example.org'], subject: 'New comment', message: 'Hi', headers: [] }))
    expect(s.takeOutbox()).toMatchObject([{ to: ['ceo@example.org'], subject: 'New comment', branch: 'wi-1' }])
    const http = JSON.parse(await s.storage(JSON.stringify({ op: 'http', rid: 'r1', method: 'GET', url: 'https://api.wordpress.org/x', headers: {}, body: '', timeout: 5 }))) as { error: string }
    expect(http.error).toMatch(/needs a grant/)
    await end(s)
    const assets = s.repo<{ key: string; value: { sha256: string; size: number } }[]>({ op: 'objects', branch: 'wi-1', prefix: 'asset:' })
    expect(assets).toEqual([{ key: 'asset:2026/10/dot.png', value: { sha256: put.sha256, mime: 'image/png', size: 7 } }])
  })

  it('merges a change request into live, and restores the same repository from its records', async () => {
    const s = await installed()
    s.repo({ op: 'branch.create', name: 'wi-1' })
    s.repo({ op: 'session.set', branch: 'wi-1', user_id: 1 })
    await q(s, "UPDATE wp_options SET option_value = 'Cinque Terre Travel' WHERE option_name = 'blogname'")
    await end(s)
    const { id } = s.repo<{ id: number }>({ op: 'cr.open', source: 'wi-1', title: 'Rename' })
    const merged = s.repo<{ head: string }>({ op: 'cr.merge', id })
    expect(merged.head).toBeTruthy()
    s.repo({ op: 'session.set', branch: 'live', user_id: 0 })
    expect((await q(s, "SELECT option_value FROM wp_options WHERE option_name = 'blogname'")).rows).toEqual([['Cinque Terre Travel']])
    const restored = new GameStorage({ wasm, sqlite3, records: s.takeRecords() })
    expect(restored.repo<{ name: string; head: string }[]>({ op: 'branches' }).find((b) => b.name === 'live')?.head).toBe(merged.head)
  })
})
