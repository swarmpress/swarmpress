/**
 * The session's WordPress (FEAT-105): the engine choice is kept per company, a new site is
 * installed and its repository records reach the company store in order, a restored site starts
 * from them, and a failed start is retried from the first stage.
 */
import { describe, expect, it } from 'vitest'
import { toResponse, type PhpBackend } from '../php/types'
import { resolveSiteEngine, SITE_ENGINE_KEY, WordPressRuntime } from './wordpress-runtime'

const enc = (s: string) => new TextEncoder().encode(s)

function memoryStore() {
  const kv = new Map<string, string>()
  const records: unknown[] = []
  return {
    kv,
    records,
    getKv: async (k: string) => kv.get(k) ?? null,
    setKv: async (k: string, v: string) => void kv.set(k, v),
    repoRecords: async () => [...records],
    appendRepoRecords: async (r: unknown[]) => void records.push(...r),
  }
}

const php = (fail = false): PhpBackend => ({
  id: 'fake',
  boot: async () => ({ php: '8.4', files: 1, ms: 1 }),
  async request(r) {
    if (fail) return toResponse(500, {}, enc('fatal'))
    if (r.url.startsWith('/wp-admin/install.php')) return toResponse(200, {}, enc('Success'))
    return toResponse(200, {}, enc('{"name":"Cinque Terre"}'))
  },
  stop() {},
})

/** A storage endpoint whose `live` has a head once records exist, and which hands records back on import. */
function storage(onRecords: (r: unknown[]) => void, restored: unknown[][]) {
  let live = ''
  return {
    init: async (records: unknown[]) => {
      restored.push(records)
      live = records.length ? 'c1' : ''
      return [{ name: 'live', head: live }]
    },
    storage: async () => '{}',
    repo: async <T,>(m: Record<string, unknown>) => {
      if (m.op === 'import.finish') onRecords([{ r: 'commit', id: 'c1' }, { r: 'ref', name: 'live', head: 'c1' }])
      return {} as T
    },
  }
}

describe('the session WordPress runtime', () => {
  it('?site=wordpress opts the company in and the choice is kept', async () => {
    const s = memoryStore()
    expect(await resolveSiteEngine('', s)).toBe('astro')
    expect(await resolveSiteEngine('?site=wordpress', s)).toBe('wordpress')
    expect(s.kv.get(SITE_ENGINE_KEY)).toBe('wordpress')
    expect(await resolveSiteEngine('', s)).toBe('wordpress')
  })

  it('installs a new site, stores its records, and a later session restores from them', async () => {
    const store = memoryStore()
    const restored: unknown[][] = []
    const site = { title: 'Cinque Terre', adminEmail: 'ceo@example.org' }
    const a = await WordPressRuntime.open({ companyId: 'c1', store, site, storage: (on) => storage(on, restored), backend: () => php() })
    const phases: string[] = []
    a.onChange((i) => phases.push(i.phase))
    await a.start()
    await a.flushed()
    expect(a.info()).toMatchObject({ phase: 'ready', name: 'Cinque Terre', backend: 'php-wasm' })
    expect(a.info().stages.install.state).toBe('done')
    expect(store.records).toEqual([{ r: 'commit', id: 'c1' }, { r: 'ref', name: 'live', head: 'c1' }])

    const b = await WordPressRuntime.open({ companyId: 'c1', store, site, storage: (on) => storage(on, restored), backend: () => php() })
    await b.start()
    expect(restored[1]).toEqual(store.records)
    expect(b.info().stages.install.state).toBe('skipped')
  })

  it('a failed start says which stage, and a retry starts over', async () => {
    const store = memoryStore()
    let fail = true
    const rt = await WordPressRuntime.open({ companyId: 'c1', store, site: { title: 'x', adminEmail: 'x@example.org' }, storage: (on) => storage(on, []), backend: () => php(fail) })
    await expect(rt.start()).rejects.toMatchObject({ stage: 'install' })
    expect(rt.info()).toMatchObject({ phase: 'failed' })
    fail = false
    await rt.retry()
    expect(rt.info().phase).toBe('ready')
  })
})
