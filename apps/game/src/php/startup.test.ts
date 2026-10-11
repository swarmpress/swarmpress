/**
 * Starting a company's WordPress (FEAT-105): a new company is installed onto live and qualified,
 * a restored one skips the installer, and a backend that cannot run here is `blocked` at boot.
 */
import { describe, expect, it } from 'vitest'
import { startWordPress, WpStartupError, type WordPressStartupDeps, type WpStartupEvent } from './startup'
import { PhpUnavailableError, toResponse, type PhpBackend, type PhpRequest } from './types'

const enc = (s: string) => new TextEncoder().encode(s)

function fakePhp(seen: PhpRequest[], opts: { boot?: () => Promise<never> } = {}): PhpBackend {
  return {
    id: 'fake',
    boot: opts.boot ?? (async () => ({ php: '8.4', files: 3, ms: 1 })),
    async request(r) {
      seen.push(r)
      if (r.url.startsWith('/wp-admin/install.php')) return toResponse(200, {}, enc('<h1>Success!</h1>'))
      if (r.url === '/?rest_route=/') return toResponse(200, { 'content-type': ['application/json'] }, enc('{"name":"Cinque Terre"}'))
      return toResponse(404, {}, enc(''))
    },
    stop() {},
  }
}

function deps(over: Partial<WordPressStartupDeps> & { branches?: { name: string; head: string }[] }, seen: PhpRequest[], repo: unknown[]): WordPressStartupDeps {
  return {
    records: async () => [],
    restore: async () => over.branches ?? [{ name: 'live', head: '' }],
    storage: {
      storage: async () => '{}',
      repo: async (m) => {
        repo.push(m)
        return {} as never
      },
    },
    backend: () => fakePhp(seen),
    site: { title: 'Cinque Terre', adminEmail: 'ceo@example.org' },
    password: () => 'pw-1',
    ...over,
  }
}

describe('startWordPress', () => {
  it('installs a new company onto live, finishes the import and qualifies with the REST index', async () => {
    const seen: PhpRequest[] = []
    const repo: unknown[] = []
    const events: WpStartupEvent[] = []
    const wp = await startWordPress(deps({}, seen, repo), (e) => events.push(e))
    expect(wp).toMatchObject({ installed: true, name: 'Cinque Terre' })
    expect(seen.map((r) => r.url)).toEqual(['/wp-admin/install.php?step=2', '/?rest_route=/'])
    expect(String(seen[0].body)).toContain('weblog_title=Cinque%20Terre')
    expect(String(seen[0].body)).toContain('admin_password=pw-1')
    expect(repo).toEqual([{ op: 'import.finish' }])
    expect(events.filter((e) => e.state === 'done').map((e) => e.stage)).toEqual(['storage', 'boot', 'install', 'qualify'])
  })

  it('a restored company skips the installer', async () => {
    const seen: PhpRequest[] = []
    const events: WpStartupEvent[] = []
    const wp = await startWordPress(deps({ branches: [{ name: 'live', head: 'abc' }, { name: 'wi-1', head: 'def' }] }, seen, []), (e) => events.push(e))
    expect(wp.installed).toBe(false)
    expect(seen.map((r) => r.url)).toEqual(['/?rest_route=/'])
    expect(events.find((e) => e.stage === 'install')?.state).toBe('skipped')
  })

  it('a backend that cannot run here is blocked at boot; nothing else is tried', async () => {
    const seen: PhpRequest[] = []
    const events: WpStartupEvent[] = []
    const err = await startWordPress(
      deps({ backend: () => fakePhp(seen, { boot: async () => Promise.reject(new PhpUnavailableError('the sandbox did not load')) }) }, seen, []),
      (e) => events.push(e),
    ).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(WpStartupError)
    expect(err).toMatchObject({ stage: 'boot', kind: 'blocked' })
    expect(events.at(-1)).toMatchObject({ stage: 'boot', state: 'failed' })
    expect(seen).toEqual([])
  })

  it('a qualification answer without the site index fails the startup', async () => {
    const php = fakePhp([])
    const broken: PhpBackend = { ...php, request: async (r) => (r.url === '/?rest_route=/' ? toResponse(500, {}, enc('fatal')) : php.request(r)) }
    const err = await startWordPress(deps({ backend: () => broken }, [], [])).catch((e: unknown) => e)
    expect(err).toMatchObject({ stage: 'qualify', kind: 'failed' })
  })
})
