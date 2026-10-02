// Sealing to and restoring from the central sync API (FEAT-012): the real
// CentralClient against a fake fetch that behaves like crates/server's sync
// routes (README: 201 stored, 200 identical, 409 different bytes; the snapshot
// needs x-simpress-step), over the real CompanyStore on the memory engine.
import { describe, expect, it } from 'vitest'
import { commandKind, type LoggedCommand } from '../catchup/replay'
import { CentralClient, CentralError, STEP_HEADER } from '../net/central'
import { CompanyStore } from '../store'
import { MemorySqliteDriver } from '../store/sqlite-driver'
import { CHECKPOINT_FORMAT, commandBytes, decodeCheckpoint, decodeSegment, encodeCheckpoint, encodeSegment } from './segments'
import { fetchRemote, NEXT_SEGMENT_KEY, SEALED_SEQ_KEY, SyncUploader, toLogged, type SyncStore } from './uploader'

const BASE = 'http://central.test'
const CO = 'co-1'

interface Call {
  method: string
  path: string
  headers: Record<string, string>
  body: Uint8Array | null
}

type Hook = (call: Call) => void | Response | Promise<void | Response>

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i])

/** The sync routes of the central server, in memory. */
function server() {
  const segments = new Map<string, Uint8Array>()
  const snapshots = new Map<string, { step: number; bytes: Uint8Array }>()
  const calls: Call[] = []
  const hooks: { before?: Hook; after?: Hook } = {}

  const route = (c: Call): Response => {
    const m = /^\/api\/sync\/([^/]+)\/(log|snapshot)(?:\/(\d+))?$/.exec(c.path)
    if (!m) return json({ error: 'not found' }, 404)
    const [, company, what, n] = m
    if (what === 'log' && n != null) {
      const key = `${company}/${n}`
      if (c.method === 'PUT') {
        const have = segments.get(key)
        const info = { segment: Number(n), sha256: 'sha', size: c.body!.length }
        if (!have) {
          segments.set(key, c.body!)
          return json(info, 201)
        }
        return same(have, c.body!) ? json(info, 200) : json({ error: `segment ${n} is immutable` }, 409)
      }
      const have = segments.get(key)
      return have ? new Response(have as BodyInit) : json({ error: `no segment ${n}` }, 404)
    }
    if (what === 'log') {
      const list = [...segments.keys()]
        .filter((k) => k.startsWith(`${company}/`))
        .map((k) => ({ segment: Number(k.split('/')[1]), sha256: 'sha', size: segments.get(k)!.length, created_at: 1 }))
      return json({ segments: list })
    }
    if (c.method === 'PUT') {
      const step = c.headers[STEP_HEADER]
      if (step == null) return json({ error: 'x-simpress-step required' }, 400)
      snapshots.set(company, { step: Number(step), bytes: c.body! })
      return json({ step: Number(step), sha256: 'sha', size: c.body!.length })
    }
    const snap = snapshots.get(company)
    return snap ? new Response(snap.bytes as BodyInit, { headers: { [STEP_HEADER]: String(snap.step), 'x-simpress-sha256': 'sha' } }) : json({ error: 'no snapshot' }, 404)
  }

  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    const body = init?.body == null ? null : new Uint8Array(init.body as Uint8Array)
    const call: Call = { method: init?.method ?? 'GET', path: url.slice(BASE.length), headers: (init?.headers ?? {}) as Record<string, string>, body }
    calls.push(call)
    const early = await hooks.before?.(call)
    if (early) return early
    const res = route(call)
    const late = await hooks.after?.(call)
    return late ?? res
  }

  const puts = (what: 'log' | 'snapshot') => calls.filter((c) => c.method === 'PUT' && c.path.includes(`/${what}`))
  return { fetch, calls, hooks, segments, snapshots, puts }
}

async function setup() {
  const store = await CompanyStore.open(await MemorySqliteDriver.open())
  const srv = server()
  const client = new CentralClient({ baseUrl: BASE, fetch: srv.fetch })
  return { store, srv, client, up: new SyncUploader(client, store, CO) }
}

/** Appends commands to the store's log the way the orchestration loop does. */
async function log(store: CompanyStore, ...cmds: [step: number, json: string][]) {
  await store.appendCommands(cmds.map(([step, json]) => ({ step, kind: commandKind(json), payload: commandBytes(json) })))
}

const localLog = async (store: CompanyStore): Promise<LoggedCommand[]> => (await store.commandsAfter(-1)).map(toLogged)
const cp = (step: number) => ({ scenario: 'cinqueterre', seed: '7', step, hash: String(1_000_000 + step) })

const PRAISE = '{"Praise":{"staff":"staff-1"}}'
const OUTCOME = '{"MeetingOutcome":{"job_id":1,"briefs":[{"brief_ref":18446744073709551615,"writer":"staff-1","editor":"staff-5"}]}}'
const TRIAGE = '"TriageInbox"'
const LANDED = '{"DeployLanded":{"work_item":"work-item-1"}}'

describe('toLogged', () => {
  it('turns a stored command into a logged one with the payload as text', () => {
    expect(toLogged({ seq: 3, step: 540, kind: 'MeetingOutcome', payload: commandBytes(OUTCOME) })).toEqual({ seq: 3, step: 540, kind: 'MeetingOutcome', json: OUTCOME })
  })
})

describe('SyncUploader.seal', () => {
  it('uploads the log as segment 0, then the checkpoint, to the documented endpoints', async () => {
    const { store, srv, up } = await setup()
    await log(store, [540, PRAISE], [540, OUTCOME])

    expect(await up.seal(cp(600))).toEqual({ segment: 0, commands: 2, step: 600 })

    expect(srv.calls.map((c) => `${c.method} ${c.path}`)).toEqual([`PUT /api/sync/${CO}/log/0`, `PUT /api/sync/${CO}/snapshot`])
    const [seg, snap] = srv.calls
    expect(seg.headers['content-type']).toBe('application/octet-stream')
    expect(decodeSegment(seg.body!)).toEqual([
      { seq: 1, step: 540, kind: 'Praise', json: PRAISE },
      { seq: 2, step: 540, kind: 'MeetingOutcome', json: OUTCOME },
    ])
    expect(snap.headers[STEP_HEADER]).toBe('600')
    expect(snap.headers['content-type']).toBe('application/octet-stream')
    expect(decodeCheckpoint(snap.body!)).toEqual({ format: CHECKPOINT_FORMAT, scenario: 'cinqueterre', seed: '7', step: 600, hash: '1000600', lastSeq: 2 })
    expect(await store.getKv(SEALED_SEQ_KEY)).toBe('2')
    expect(await store.getKv(NEXT_SEGMENT_KEY)).toBe('1')
  })

  it('sends the segment in the stable wire encoding (so a re-send is byte-identical)', async () => {
    const { store, srv, up } = await setup()
    await log(store, [540, PRAISE], [540, OUTCOME])
    await up.seal(cp(600))
    expect(Array.from(srv.calls[0].body!)).toEqual(Array.from(encodeSegment(await localLog(store))))
  })

  it('uploads only the checkpoint when the log is empty', async () => {
    const { store, srv, up } = await setup()
    expect(await up.seal(cp(60))).toEqual({ segment: null, commands: 0, step: 60 })
    expect(srv.puts('log')).toHaveLength(0)
    expect(decodeCheckpoint(srv.puts('snapshot')[0].body!).lastSeq).toBe(0)
    expect(await store.getKv(NEXT_SEGMENT_KEY)).toBeNull()
  })

  it('uploads only the checkpoint when nothing was logged since the last seal', async () => {
    const { store, srv, up } = await setup()
    await log(store, [540, PRAISE])
    await up.seal(cp(600))
    expect(await up.seal(cp(1440))).toEqual({ segment: null, commands: 0, step: 1440 })
    expect(srv.puts('log')).toHaveLength(1)
    expect(srv.puts('snapshot')).toHaveLength(2)
    expect(decodeCheckpoint(srv.snapshots.get(CO)!.bytes)).toMatchObject({ step: 1440, lastSeq: 1 })
    expect(srv.snapshots.get(CO)!.step).toBe(1440)
  })

  it('numbers segments 0, 1, 2 … and never re-uploads an acknowledged command', async () => {
    const { store, srv, up } = await setup()
    await log(store, [540, PRAISE], [540, OUTCOME])
    expect((await up.seal(cp(600))).segment).toBe(0)
    await log(store, [700, TRIAGE])
    expect(await up.seal(cp(800))).toEqual({ segment: 1, commands: 1, step: 800 })
    await log(store, [900, LANDED], [900, PRAISE])
    expect(await up.seal(cp(1000))).toEqual({ segment: 2, commands: 2, step: 1000 })

    const puts = srv.puts('log')
    expect(puts.map((c) => c.path)).toEqual([0, 1, 2].map((n) => `/api/sync/${CO}/log/${n}`))
    expect(puts.map((c) => decodeSegment(c.body!).map((x) => x.seq))).toEqual([[1, 2], [3], [4, 5]])
    expect(decodeCheckpoint(srv.snapshots.get(CO)!.bytes).lastSeq).toBe(5)
  })

  it('seals a single command as its own segment', async () => {
    const { store, srv, up } = await setup()
    await log(store, [0, TRIAGE])
    expect(await up.seal(cp(0))).toEqual({ segment: 0, commands: 1, step: 0 })
    expect(decodeSegment(srv.segments.get(`${CO}/0`)!)).toEqual([{ seq: 1, step: 0, kind: 'TriageInbox', json: TRIAGE }])
  })

  it('keeps its progress in the store: a new uploader (reload) continues the numbering', async () => {
    const { store, srv, client, up } = await setup()
    await log(store, [540, PRAISE])
    await up.seal(cp(600))
    await log(store, [700, TRIAGE])
    const reloaded = new SyncUploader(client, store, CO)
    expect(await reloaded.seal(cp(800))).toEqual({ segment: 1, commands: 1, step: 800 })
    expect(decodeSegment(srv.segments.get(`${CO}/1`)!).map((c) => c.seq)).toEqual([2])
  })

  it('serializes concurrent seals: no overlap, no duplicate segment', async () => {
    const { store, srv, up } = await setup()
    await log(store, [540, PRAISE], [540, OUTCOME])
    let inFlight = 0
    let maxInFlight = 0
    srv.hooks.before = async () => {
      maxInFlight = Math.max(maxInFlight, ++inFlight)
      await new Promise((r) => setTimeout(r, 2))
    }
    srv.hooks.after = () => void inFlight--
    const [a, b, c] = await Promise.all([up.seal(cp(600)), up.seal(cp(601)), up.seal(cp(602))])
    expect(maxInFlight).toBe(1)
    expect([a.segment, b.segment, c.segment]).toEqual([0, null, null])
    expect(srv.calls.map((x) => x.path.split('/').slice(4).join('/'))).toEqual(['log/0', 'snapshot', 'snapshot', 'snapshot'])
    expect(srv.snapshots.get(CO)!.step).toBe(602)
  })

  it('puts commands logged while a seal is in flight into the next segment', async () => {
    const { store, srv, up } = await setup()
    await log(store, [540, PRAISE])
    let once = true
    srv.hooks.before = async (c) => {
      if (once && c.path.endsWith('/log/0')) {
        once = false
        await log(store, [541, TRIAGE])
      }
    }
    const first = up.seal(cp(600))
    const second = up.seal(cp(700))
    expect((await first).segment).toBe(0)
    expect(await second).toEqual({ segment: 1, commands: 1, step: 700 })
    expect(srv.puts('log').map((c) => decodeSegment(c.body!).map((x) => x.seq))).toEqual([[1], [2]])
  })

  describe('failures', () => {
    it('a failed segment upload rejects, uploads no checkpoint and records no progress', async () => {
      const { store, srv, up } = await setup()
      await log(store, [540, PRAISE])
      srv.hooks.before = (c) => (c.path.includes('/log/') ? json({ error: 'boom' }, 500) : undefined)
      const err = await up.seal(cp(600)).catch((e) => e)
      expect(err).toBeInstanceOf(CentralError)
      expect((err as CentralError).status).toBe(500)
      // The server must never hold a checkpoint whose log it does not have.
      expect(srv.puts('snapshot')).toHaveLength(0)
      expect(await store.getKv(SEALED_SEQ_KEY)).toBeNull()
      expect(await store.getKv(NEXT_SEGMENT_KEY)).toBeNull()
    })

    it('retries a failed segment under the same number, and one failure does not block later seals', async () => {
      const { store, srv, up } = await setup()
      await log(store, [540, PRAISE])
      let fail = true
      srv.hooks.before = (c) => {
        if (fail && c.path.includes('/log/')) {
          fail = false
          throw new TypeError('network down')
        }
      }
      const first = up.seal(cp(600))
      const second = up.seal(cp(601)) // queued behind the failing one
      await expect(first).rejects.toThrow(/network down/)
      expect(await second).toEqual({ segment: 0, commands: 1, step: 601 })
      expect(srv.puts('log').map((c) => c.path)).toEqual([`/api/sync/${CO}/log/0`, `/api/sync/${CO}/log/0`])
      expect(Array.from(srv.puts('log')[1].body!)).toEqual(Array.from(srv.puts('log')[0].body!))
    })

    it('is idempotent when the acknowledgement was lost: the identical re-send answers 200', async () => {
      const { store, srv, up } = await setup()
      await log(store, [540, PRAISE], [540, OUTCOME])
      let drop = true
      srv.hooks.after = (c) => {
        if (drop && c.path.includes('/log/')) {
          drop = false
          throw new TypeError('connection reset')
        }
      }
      await expect(up.seal(cp(600))).rejects.toThrow(/connection reset/)
      expect(srv.segments.has(`${CO}/0`)).toBe(true) // stored, but the browser never heard
      expect(await up.seal(cp(600))).toEqual({ segment: 0, commands: 2, step: 600 })
      expect(srv.segments.size).toBe(1)
      expect(await store.getKv(NEXT_SEGMENT_KEY)).toBe('1')
    })

    // The planned range is kept in `sync.pending_segment` and re-sent byte for byte, so more commands
    // logged before the retry cannot change segment N; they go into segment N + 1.
    it('recovers when the acknowledgement was lost and more commands were logged before the retry', async () => {
      const { store, srv, client, up } = await setup()
      await log(store, [540, PRAISE], [540, OUTCOME])
      let drop = true
      srv.hooks.after = (c) => {
        if (drop && c.path.includes('/log/')) {
          drop = false
          throw new TypeError('connection reset')
        }
      }
      await expect(up.seal(cp(600))).rejects.toThrow(/connection reset/)
      await log(store, [700, TRIAGE])

      await up.seal(cp(800)) // must not be stuck on an immutable segment 0
      const remote = await fetchRemote(client, CO)
      expect(remote!.commands).toEqual(await localLog(store))
      expect(remote!.checkpoint).toMatchObject({ step: 800, lastSeq: 3 })
    })

    // sealed_seq and next_segment are two kv writes; the pending segment is cleared only after both, so a
    // seal cut off between them is finished by the next one before it numbers anything new.
    it('recovers when progress was only half recorded (sealed_seq written, next_segment not)', async () => {
      const { store, srv, client } = await setup()
      let failNext = true
      const flaky: SyncStore = {
        commandsAfter: (s) => store.commandsAfter(s),
        getKv: (k) => store.getKv(k),
        setKv: async (k, v) => {
          if (failNext && k === NEXT_SEGMENT_KEY) {
            failNext = false
            throw new Error('tab closed')
          }
          await store.setKv(k, v)
        },
      }
      await log(store, [540, PRAISE])
      await expect(new SyncUploader(client, flaky, CO).seal(cp(600))).rejects.toThrow(/tab closed/)
      await log(store, [700, TRIAGE])

      await new SyncUploader(client, flaky, CO).seal(cp(800))
      const remote = await fetchRemote(client, CO)
      expect(remote!.commands).toEqual(await localLog(store))
      expect(srv.segments.size).toBe(2)
    })

    it('rejects on 409 (another device wrote that segment) without touching the snapshot or its progress', async () => {
      const { store, srv, up } = await setup()
      // Another device (the lease holder) already sealed segment 0 and a checkpoint.
      const theirs = encodeSegment([{ seq: 1, step: 10, kind: 'TriageInbox', json: TRIAGE }])
      srv.segments.set(`${CO}/0`, theirs)
      srv.snapshots.set(CO, { step: 10, bytes: encodeCheckpoint({ scenario: 'cinqueterre', seed: '7', step: 10, hash: '5', lastSeq: 1 }) })
      await log(store, [540, PRAISE])

      const err = await up.seal(cp(600)).catch((e) => e)
      expect(err).toBeInstanceOf(CentralError)
      expect((err as CentralError).status).toBe(409)
      expect(Array.from(srv.segments.get(`${CO}/0`)!)).toEqual(Array.from(theirs))
      expect(srv.snapshots.get(CO)!.step).toBe(10)
      expect(srv.puts('snapshot')).toHaveLength(0)
      expect(await store.getKv(SEALED_SEQ_KEY)).toBeNull()
      expect(await store.getKv(NEXT_SEGMENT_KEY)).toBeNull()
    })

    it('after a failed checkpoint upload the retry sends only the checkpoint, not the acknowledged segment', async () => {
      const { store, srv, up } = await setup()
      await log(store, [540, PRAISE], [540, OUTCOME])
      let fail = true
      srv.hooks.before = (c) => {
        if (fail && c.path.endsWith('/snapshot')) {
          fail = false
          return json({ error: 'disk full' }, 500)
        }
      }
      await expect(up.seal(cp(600))).rejects.toThrow(/disk full/)
      expect(await store.getKv(SEALED_SEQ_KEY)).toBe('2')

      expect(await up.seal(cp(600))).toEqual({ segment: null, commands: 0, step: 600 })
      expect(srv.puts('log')).toHaveLength(1)
      expect(decodeCheckpoint(srv.snapshots.get(CO)!.bytes)).toMatchObject({ step: 600, lastSeq: 2 })
    })
  })
})

describe('fetchRemote', () => {
  it('is null when the server holds nothing for the company', async () => {
    const { srv, client } = await setup()
    expect(await fetchRemote(client, CO)).toBeNull()
    expect(srv.calls.map((c) => `${c.method} ${c.path}`)).toEqual([`GET /api/sync/${CO}/log`, `GET /api/sync/${CO}/snapshot`])
  })

  it('gives a fresh device the whole log in seq order, the checkpoint and the next segment number', async () => {
    const { store, client, up } = await setup()
    await log(store, [540, PRAISE], [540, OUTCOME])
    await up.seal(cp(600))
    await log(store, [700, TRIAGE])
    await up.seal(cp(800))
    await log(store, [900, LANDED])
    await up.seal(cp(1000))

    const remote = await fetchRemote(client, CO)
    expect(remote!.commands).toEqual(await localLog(store))
    expect(remote!.commands.map((c) => c.json)).toEqual([PRAISE, OUTCOME, TRIAGE, LANDED]) // u64 ref intact
    expect(remote!.checkpoint).toEqual({ format: CHECKPOINT_FORMAT, scenario: 'cinqueterre', seed: '7', step: 1000, hash: '1001000', lastSeq: 4 })
    expect(remote!.segments).toBe(3)
  })

  it('reads segments in numeric order however the server lists them, and drops re-sent commands', async () => {
    const { srv, client } = await setup()
    const c = (seq: number, step: number): LoggedCommand => ({ seq, step, kind: 'TriageInbox', json: TRIAGE })
    // Insertion order 10, 2, 0, 1: a lexicographic or listing-order read would scramble the log.
    srv.segments.set(`${CO}/10`, encodeSegment([c(6, 60)]))
    srv.segments.set(`${CO}/2`, encodeSegment([c(4, 40), c(5, 50)]))
    srv.segments.set(`${CO}/0`, encodeSegment([c(1, 10), c(2, 20)]))
    srv.segments.set(`${CO}/1`, encodeSegment([c(2, 20), c(3, 30)]))
    srv.segments.set('co-2/0', encodeSegment([c(99, 1)]))
    const remote = await fetchRemote(client, CO)
    expect(remote!.commands.map((x) => x.seq)).toEqual([1, 2, 3, 4, 5, 6])
    expect(remote!.checkpoint).toBeNull()
    expect(remote!.segments).toBe(11)
    expect(srv.calls.filter((x) => /\/log\/\d+$/.test(x.path)).map((x) => x.path.split('/').pop())).toEqual(['0', '1', '2', '10'])
  })

  it('returns a checkpoint without a log (a company sealed before its first command)', async () => {
    const { client, up } = await setup()
    await up.seal(cp(60))
    expect(await fetchRemote(client, CO)).toEqual({
      commands: [],
      checkpoint: { format: CHECKPOINT_FORMAT, scenario: 'cinqueterre', seed: '7', step: 60, hash: '1000060', lastSeq: 0 },
      segments: 0,
    })
  })

  it('lets the restored device continue sealing where the first one stopped', async () => {
    const a = await setup()
    await log(a.store, [540, PRAISE], [540, OUTCOME])
    await a.up.seal(cp(600))

    // Device B: empty store, same server (what session.ts restore() does with the result).
    const store = await CompanyStore.open(await MemorySqliteDriver.open())
    const remote = (await fetchRemote(a.client, CO))!
    await store.appendCommands(remote.commands.map((c) => ({ seq: c.seq, step: c.step, kind: c.kind, payload: commandBytes(c.json) })))
    await store.setKv(SEALED_SEQ_KEY, String(remote.commands[remote.commands.length - 1].seq))
    await store.setKv(NEXT_SEGMENT_KEY, String(remote.segments))
    await log(store, [700, TRIAGE])
    const b = new SyncUploader(a.client, store, CO)
    expect(await b.seal(cp(800))).toEqual({ segment: 1, commands: 1, step: 800 })
    expect((await fetchRemote(a.client, CO))!.commands).toEqual(await localLog(store))
    expect(a.srv.puts('log').map((c) => c.path.split('/').pop())).toEqual(['0', '1'])
  })

  it('propagates server errors other than 404', async () => {
    const { srv, client } = await setup()
    srv.hooks.before = () => json({ error: 'forbidden' }, 403)
    const err = await fetchRemote(client, CO).catch((e) => e)
    expect(err).toBeInstanceOf(CentralError)
    expect((err as CentralError).status).toBe(403)
  })

  // SUSPECTED BUG (uploader.ts fetchRemote): a listed segment whose bytes are gone is skipped silently,
  // so the device would replay a log with a hole in it instead of refusing to restore.
  it('refuses a log with a missing segment instead of returning a holed log', async () => {
    const { srv, client } = await setup()
    const c = (seq: number, step: number): LoggedCommand => ({ seq, step, kind: 'TriageInbox', json: TRIAGE })
    srv.segments.set(`${CO}/0`, encodeSegment([c(1, 10)]))
    srv.segments.set(`${CO}/1`, encodeSegment([c(2, 20)]))
    srv.segments.set(`${CO}/2`, encodeSegment([c(3, 30)]))
    srv.hooks.before = (call) => (call.method === 'GET' && call.path.endsWith('/log/1') ? json({ error: 'no segment 1' }, 404) : undefined)
    await expect(fetchRemote(client, CO)).rejects.toThrow()
  })
})
