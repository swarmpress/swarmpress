// The central API client against a mocked fetch (routes and shapes from
// crates/server/README.md); the real server is exercised by
// e2e/orchestrator.spec.ts.
import { describe, expect, it, vi } from 'vitest'
import {
  CentralClient,
  CentralError,
  centralGateway,
  EventStream,
  LEASE_HEADER,
  LeaseKeeper,
  STEP_HEADER,
  type CentralEvent,
  type WebSocketLike,
} from './central'

type Handler = (req: { method: string; url: string; headers: Record<string, string>; body: unknown }) => Response | Promise<Response>

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
}

function mock(handler: Handler) {
  const calls: { method: string; url: string; headers: Record<string, string>; body: unknown }[] = []
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>
    let body: unknown = init?.body
    if (typeof body === 'string' && headers['content-type'] === 'application/json') body = JSON.parse(body)
    const req = { method: init?.method ?? 'GET', url, headers, body }
    calls.push(req)
    return handler(req)
  })
  return { client: new CentralClient({ baseUrl: 'http://central.test', fetch }), calls }
}

const COMPANY = { id: 'co-1', owner_user_id: 'u1', name: 'Dispatch', seed: 7, site_repo: 'simpress-sites/ada-site', site_base_branch: 'main', created_at: 1 }

describe('CentralClient', () => {
  it('signs in, reads me, creates and gets the company', async () => {
    const { client, calls } = mock(({ method, url }) => {
      if (url.endsWith('/auth/dev/login')) return json({ user: { id: 'u1', login: 'ada' } })
      if (url.endsWith('/api/me')) return json({ user: { id: 'u1', login: 'ada' }, company: null })
      if (method === 'POST' && url.endsWith('/api/companies')) return json(COMPANY, 201)
      if (url.endsWith('/api/companies/me')) return json({ error: 'create a company first' }, 404)
      return json({ error: 'nope' }, 500)
    })
    expect((await client.devLogin('ada')).user.login).toBe('ada')
    expect(calls[0]).toMatchObject({ method: 'POST', body: { login: 'ada' } })
    expect((await client.me())?.company).toBeNull()
    expect(await client.createCompany({ name: 'Dispatch' })).toEqual(COMPANY)
    expect(await client.myCompany()).toBeNull()
  })

  it('maps 401 on me to null and other errors to CentralError', async () => {
    const { client } = mock(({ url }) =>
      url.endsWith('/api/me') ? json({ error: 'unauthorized' }, 401) : json({ error: 'you already own a company' }, 409),
    )
    expect(await client.me()).toBeNull()
    const err = await client.createCompany({ name: 'x' }).catch((e) => e)
    expect(err).toBeInstanceOf(CentralError)
    expect(err.status).toBe(409)
    expect(err.message).toContain('you already own a company')
  })

  it('sends the lease header with gateway calls (the orchestrator gateway)', async () => {
    const { client, calls } = mock(({ url }) =>
      url.endsWith('/draft')
        ? json({ number: 3, branch: 'drafts/content-c1', head_sha: 'abc', created_pr: true, committed: true })
        : json({ merged_sha: 'def' }),
    )
    const gw = centralGateway(client, () => 'lease-9')
    expect(await gw.openDraft('c1', 'content/pages/a.json', '{"title":{"en":"A"}}', 'Draft: A', 'work-item-1')).toEqual({
      number: 3,
      branch: 'drafts/content-c1',
      head_sha: 'abc',
    })
    expect(calls[0].headers[LEASE_HEADER]).toBe('lease-9')
    expect(calls[0].body).toEqual({
      content_id: 'c1',
      path: 'content/pages/a.json',
      page: { title: { en: 'A' } },
      message: 'Draft: A',
      work_item: 'work-item-1',
    })
    expect(await gw.merge(3, 'abc')).toBe('def')
    expect(calls[1]).toMatchObject({ url: 'http://central.test/api/gateway/merge', body: { number: 3, head_sha: 'abc' } })
    expect(calls[1].headers[LEASE_HEADER]).toBe('lease-9')
  })

  it('syncs log segments and snapshots as raw bytes', async () => {
    const { client, calls } = mock(({ method, url }) => {
      if (method === 'PUT' && url.includes('/log/')) return json({ segment: 0, sha256: 's', size: 3 }, 201)
      if (method === 'GET' && url.endsWith('/log/0')) return new Response(new Uint8Array([1, 2, 3]))
      if (method === 'GET' && url.endsWith('/log/1')) return json({ error: 'no segment 1' }, 404)
      if (method === 'GET' && url.endsWith('/log')) return json({ segments: [{ segment: 0, sha256: 's', size: 3, created_at: 1 }] })
      if (method === 'PUT' && url.endsWith('/snapshot')) return json({ step: 120, sha256: 't', size: 2 })
      if (method === 'GET' && url.endsWith('/snapshot'))
        return new Response(new Uint8Array([9, 8]), { headers: { [STEP_HEADER]: '120', 'x-simpress-sha256': 't' } })
      return json({}, 500)
    })
    expect(await client.putLogSegment('co-1', 0, new Uint8Array([1, 2, 3]))).toEqual({ segment: 0, sha256: 's', size: 3, status: 201 })
    expect(calls[0].url).toBe('http://central.test/api/sync/co-1/log/0')
    expect(Array.from((await client.getLogSegment('co-1', 0))!)).toEqual([1, 2, 3])
    expect(await client.getLogSegment('co-1', 1)).toBeNull()
    expect((await client.listLogSegments('co-1'))[0].segment).toBe(0)
    await client.putSnapshot('co-1', 120, new Uint8Array([9, 8]))
    expect(calls.at(-1)!.headers[STEP_HEADER]).toBe('120')
    const snap = await client.getSnapshot('co-1')
    expect(snap).toMatchObject({ step: 120, sha256: 't' })
    expect(Array.from(snap!.bytes)).toEqual([9, 8])
  })

  it('derives the events socket URL', () => {
    expect(new CentralClient({ baseUrl: 'https://x.test' }).wsUrl('/ws/events?after=3')).toBe('wss://x.test/ws/events?after=3')
    expect(new CentralClient({ baseUrl: 'http://x.test/' }).wsUrl('/ws/events')).toBe('ws://x.test/ws/events')
  })
})

describe('LeaseKeeper', () => {
  it('acquires, renews before expiry, reports loss, and releases', async () => {
    let now = 1_000_000
    let renewals = 0
    let held = true
    const { client, calls } = mock(({ method }) => {
      if (method === 'DELETE') return new Response(null, { status: 204 })
      if (!held) return json({ error: 'another device holds this company', holder: 'other', expires_at: now + 5000 }, 409)
      renewals++
      return json({ lease_id: 'L1', holder: 'dev-1', expires_at: now + 90_000, renewed: renewals > 1 })
    })
    const timers: { fn: () => void; ms: number }[] = []
    const lost = vi.fn()
    const k = new LeaseKeeper(client, 'co-1', 'dev-1', {
      now: () => now,
      setTimer: (fn, ms) => timers.push({ fn, ms }),
      clearTimer: () => undefined,
      onLost: lost,
    })
    expect((await k.start()).lease_id).toBe('L1')
    expect(k.leaseId).toBe('L1')
    expect(timers.at(-1)!.ms).toBe(30_000)
    expect(calls[0].body).toEqual({ device_id: 'dev-1', force: false })
    now += 30_000
    await k.renew()
    expect(renewals).toBe(2)
    held = false
    await expect(k.renew()).rejects.toBeInstanceOf(CentralError)
    expect(lost).toHaveBeenCalledOnce()
    expect(() => k.leaseId).toThrow(/not held/)
    held = true
    await k.start()
    await k.stop()
    expect(calls.at(-1)).toMatchObject({ method: 'DELETE', url: 'http://central.test/api/companies/co-1/lease' })
    expect(calls.at(-1)!.headers[LEASE_HEADER]).toBe('L1')
  })
})

function ev(seq: number, kind = 'DeployLanded'): CentralEvent {
  return { seq, company_id: 'co-1', kind, payload: { work_item: 'w1' }, created_at: seq }
}

class MemKv {
  m = new Map<string, string>()
  async getKv(k: string) {
    return this.m.get(k) ?? null
  }
  async setKv(k: string, v: string) {
    this.m.set(k, v)
  }
}

describe('EventStream', () => {
  it('polls from the persisted cursor and advances it after handling', async () => {
    const inbox = [ev(1), ev(2), ev(3)]
    const { client, calls } = mock(({ url }) => {
      const after = Number(new URL(url).searchParams.get('after'))
      const events = inbox.filter((e) => e.seq > after)
      return json({ events, last_seq: events.at(-1)?.seq ?? after })
    })
    const kv = new MemKv()
    await kv.setKv('events.cursor.co-1', '1')
    const seen: number[] = []
    const timers: (() => void)[] = []
    const s = new EventStream(client, 'co-1', kv, (e) => void seen.push(e.seq), {
      WebSocket: null,
      setTimer: (fn) => timers.push(fn),
      clearTimer: () => undefined,
    })
    await s.start()
    expect(calls[0].url).toBe('http://central.test/api/events?after=1')
    expect(seen).toEqual([2, 3])
    expect(await kv.getKv('events.cursor.co-1')).toBe('3')
    expect(s.transport).toBe('poll')
    inbox.push(ev(4))
    timers.shift()!()
    await vi.waitFor(() => expect(seen).toEqual([2, 3, 4]))
    s.stop()
    expect(s.transport).toBe('stopped')
  })

  it('goes live over the socket, dedupes, and falls back to polling when it closes', async () => {
    const { client } = mock(() => json({ events: [ev(1)], last_seq: 1 }))
    const sockets: FakeSocket[] = []
    class FakeSocket implements WebSocketLike {
      onopen: ((ev: unknown) => void) | null = null
      onmessage: ((ev: { data: unknown }) => void) | null = null
      onerror: ((ev: unknown) => void) | null = null
      onclose: ((ev: unknown) => void) | null = null
      closed = false
      constructor(readonly url: string) {
        sockets.push(this)
      }
      close() {
        this.closed = true
      }
    }
    const seen: number[] = []
    const timers: (() => void)[] = []
    const s = new EventStream(client, 'co-1', new MemKv(), (e) => void seen.push(e.seq), {
      WebSocket: FakeSocket,
      setTimer: (fn) => timers.push(fn),
      clearTimer: () => undefined,
    })
    await s.start()
    expect(seen).toEqual([1])
    expect(sockets[0].url).toBe('ws://central.test/ws/events?after=1')
    sockets[0].onopen!({})
    expect(s.transport).toBe('ws')
    sockets[0].onmessage!({ data: JSON.stringify(ev(1)) }) // backlog overlap: deduped
    sockets[0].onmessage!({ data: JSON.stringify(ev(2)) })
    sockets[0].onmessage!({ data: JSON.stringify({ ...ev(3), company_id: 'other' }) })
    await s.idle()
    expect(seen).toEqual([1, 2])
    expect(s.lastSeq).toBe(2)
    sockets[0].onclose!({})
    expect(s.transport).toBe('poll')
    expect(timers.length).toBe(1)
    s.stop()
  })
})
