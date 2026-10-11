/**
 * The storage worker's platform calls (FEAT-107, ADR-0050): asset bytes and outgoing HTTP go
 * through the session (which holds the lease), answered by id; without a platform they fail loudly.
 */
import { describe, expect, it } from 'vitest'
import { StorageClient, type StoragePlatform } from './storage-client'

/** A worker stand-in: records what the client posts and lets the test speak for the worker. */
type WorkerLike = ConstructorParameters<typeof StorageClient>[0]

function fakeWorker() {
  const listeners: ((e: { data: unknown }) => void)[] = []
  const posted: unknown[] = []
  return {
    posted,
    postMessage: (m: unknown) => void posted.push(m),
    addEventListener: (_: string, fn: (e: { data: unknown }) => void) => void listeners.push(fn),
    terminate() {},
    emit: (data: unknown) => listeners.forEach((fn) => fn({ data })),
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

describe('StorageClient platform calls', () => {
  it('answers asset and http calls from the platform, by id', async () => {
    const w = fakeWorker()
    const seen: string[] = []
    const platform: StoragePlatform = {
      putAsset: async (sha, bytes, mime) => void seen.push(`put ${sha} ${bytes.length} ${mime}`),
      getAsset: async (sha) => (sha === 'aa' ? new Uint8Array([1, 2]) : null),
      http: async (r) => ({ status: 200, headers: {}, body: `fetched ${r.url}` }),
    }
    const c = new StorageClient(w as unknown as WorkerLike, () => {}, platform)
    void c.init([])
    expect(w.posted[0]).toMatchObject({ kind: 'init', platform: true })
    w.emit({ id: 7, kind: 'platform', call: { op: 'asset.put', sha256: 'aa', bytes: new Uint8Array([1, 2]), mime: 'image/png' } })
    w.emit({ id: 8, kind: 'platform', call: { op: 'asset.get', sha256: 'zz' } })
    w.emit({ id: 9, kind: 'platform', call: { op: 'http', request: { method: 'GET', url: 'https://api.example.org/', headers: {}, body: '', timeout: 5 } } })
    await tick()
    expect(seen).toEqual(['put aa 2 image/png'])
    expect(w.posted.slice(1)).toEqual([
      { id: 7, kind: 'platform-reply', ok: true, value: null },
      { id: 8, kind: 'platform-reply', ok: true, value: null },
      { id: 9, kind: 'platform-reply', ok: true, value: { status: 200, headers: {}, body: 'fetched https://api.example.org/' } },
    ])
  })

  it('without a platform, a call is refused with the reason', async () => {
    const w = fakeWorker()
    const c = new StorageClient(w as unknown as WorkerLike)
    void c.init([])
    expect(w.posted[0]).toMatchObject({ kind: 'init', platform: false })
    w.emit({ id: 1, kind: 'platform', call: { op: 'asset.get', sha256: 'aa' } })
    await tick()
    expect(w.posted[1]).toMatchObject({ id: 1, kind: 'platform-reply', ok: false, error: expect.stringContaining('asset.get needs the platform') })
  })
})
