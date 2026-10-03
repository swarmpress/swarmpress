import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { electLeader, electResident, lockName, RESIDENT_LOCK, type ChannelLike, type LeadershipChange, type LockManagerLike } from './leader'
import { channelHub as sharedHub, FakeLocks as SharedLocks, flushMicrotasks } from './testing/fake-locks'

/** In-memory navigator.locks: exclusive FIFO per name, honours AbortSignal for queued requests. */
class FakeLocks implements LockManagerLike {
  private held = new Map<string, boolean>()
  private queues = new Map<string, Array<{ cb: (l: unknown) => Promise<unknown>; resolve: (v: unknown) => void; reject: (e: unknown) => void; signal?: AbortSignal }>>()

  request(name: string, options: { signal?: AbortSignal }, cb: (lock: unknown) => Promise<unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const entry = { cb, resolve, reject, signal: options.signal }
      const q = this.queues.get(name) ?? []
      this.queues.set(name, q)
      q.push(entry)
      options.signal?.addEventListener('abort', () => {
        const i = q.indexOf(entry)
        if (i >= 0) {
          q.splice(i, 1)
          reject(new DOMException('aborted', 'AbortError'))
        }
      })
      this.pump(name)
    })
  }

  private pump(name: string) {
    if (this.held.get(name)) return
    const next = this.queues.get(name)?.shift()
    if (!next) return
    this.held.set(name, true)
    next
      .cb({ name })
      .then(next.resolve, next.reject)
      .finally(() => {
        this.held.set(name, false)
        this.pump(name)
      })
  }
}

/** In-memory BroadcastChannel hub (delivers async, never to the sender). */
function channelHub() {
  const members = new Map<string, Set<ChannelLike>>()
  return (name: string): ChannelLike => {
    const set = members.get(name) ?? new Set()
    members.set(name, set)
    const ch: ChannelLike = {
      onmessage: null,
      postMessage(msg) {
        const data = structuredClone(msg)
        for (const other of set) if (other !== ch) queueMicrotask(() => other.onmessage?.({ data }))
      },
      close() {
        set.delete(ch)
      },
    }
    set.add(ch)
    return ch
  }
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

describe('leader election with Web Locks', () => {
  it('first tab leads, second follows, takes over on release', async () => {
    const locks = new FakeLocks()
    const hub = channelHub()
    const a = electLeader({ companyId: 'c1', tabId: 'A', locks, createChannel: hub })
    await flush()
    const b = electLeader({ companyId: 'c1', tabId: 'B', locks, createChannel: hub })
    await flush()
    expect(a.mechanism).toBe('web-locks')
    expect(a.isLeader).toBe(true)
    expect(b.isLeader).toBe(false)
    expect(b.leaderTabId).toBe('A') // learned via "who" → "leader"

    const changes: boolean[] = []
    b.onChange((e) => changes.push(e.isLeader))
    const became = b.whenLeader()
    await a.release()
    await became
    expect(b.isLeader).toBe(true)
    expect(a.isLeader).toBe(false)
    expect(changes).toContain(true)
  })

  it('different companies do not contend', async () => {
    const locks = new FakeLocks()
    const a = electLeader({ companyId: 'c1', tabId: 'A', locks, createChannel: null })
    const b = electLeader({ companyId: 'c2', tabId: 'B', locks, createChannel: null })
    await flush()
    expect(a.isLeader && b.isLeader).toBe(true)
    expect(lockName('c1')).toBe('swarmpress-llm-worker:c1')
  })

  it('leader status is broadcast to followers; followers cannot publish', async () => {
    const locks = new FakeLocks()
    const hub = channelHub()
    const a = electLeader({ companyId: 'c1', tabId: 'A', locks, createChannel: hub })
    const b = electLeader({ companyId: 'c1', tabId: 'B', locks, createChannel: hub })
    await flush()
    const seenByB: string[] = []
    const seenByA: string[] = []
    b.onStatus((s) => seenByB.push(`${s.tabId}:${s.state}:${s.jobId}`))
    a.onStatus((s) => seenByA.push(`${s.tabId}:${s.state}`))
    a.publishStatus({ state: 'generating', modelId: 'qwen3-4b-q4f16', jobId: 'job-7' })
    b.publishStatus({ state: 'idle' })
    await flush()
    expect(seenByB).toEqual(['A:generating:job-7'])
    expect(seenByA).toEqual(['A:generating'])
  })

  it('a follower that releases before ever leading leaves the queue', async () => {
    const locks = new FakeLocks()
    const a = electLeader({ companyId: 'c1', tabId: 'A', locks, createChannel: null })
    const b = electLeader({ companyId: 'c1', tabId: 'B', locks, createChannel: null })
    const c = electLeader({ companyId: 'c1', tabId: 'C', locks, createChannel: null })
    await flush()
    await b.release()
    await a.release()
    await flush()
    expect(b.isLeader).toBe(false)
    expect(c.isLeader).toBe(true)
  })
})

describe('the resident model lock (one model per origin, ADR-0057)', () => {
  it('is one origin-wide lock: tabs of different companies contend for it', async () => {
    const locks = new SharedLocks()
    const hub = sharedHub()
    const a = electResident({ tabId: 'A', locks, createChannel: hub })
    expect(await a.settled()).toBe(true)
    expect(a.isLeader).toBe(true)
    expect(locks.held(RESIDENT_LOCK)).toBe(true)
    // A second tab (whatever company it shows) learns at once that the model is elsewhere, and waits in line.
    const b = electResident({ tabId: 'B', locks, createChannel: hub })
    expect(await b.settled()).toBe(false)
    expect(b.isLeader).toBe(false)
    await flushMicrotasks()
    expect(b.leaderTabId).toBe('A')
    expect(locks.waiting(RESIDENT_LOCK)).toBe(1)
    // When A closes, B gets the lock without asking again.
    const became = b.whenLeader()
    await a.release()
    await became
    expect(b.isLeader).toBe(true)
  })

  it('a takeover steals the lock; the tab that had it is told and waits in line again', async () => {
    const locks = new SharedLocks()
    const hub = sharedHub()
    const a = electResident({ tabId: 'A', locks, createChannel: hub })
    await a.settled()
    const b = electResident({ tabId: 'B', locks, createChannel: hub })
    await b.settled()
    const aChanges: LeadershipChange[] = []
    a.onChange((e) => aChanges.push(e))
    expect(b.canTakeOver).toBe(true)
    await b.takeOver()
    await flushMicrotasks()
    expect(b.isLeader).toBe(true)
    expect(a.isLeader).toBe(false)
    expect(aChanges.filter((e) => e.stolen)).toHaveLength(1)
    // A is back in line (B's own waiting request was withdrawn before the steal), and gets it when B closes.
    expect(locks.waiting(RESIDENT_LOCK)).toBe(1)
    const back = a.whenLeader()
    await b.release()
    await back
    expect(a.isLeader).toBe(true)
  })

  it('without Web Locks there is no takeover; a solo tab holds it', async () => {
    const solo = electResident({ tabId: 'S', locks: null, createChannel: null })
    expect(solo.canTakeOver).toBe(false)
    expect(await solo.settled()).toBe(true)
    await solo.takeOver()
    expect(solo.isLeader).toBe(true)
    expect(() => electLeader({ lockName: 'x' })).toThrow(/needs a companyId/)
  })
})

describe('fallbacks without Web Locks', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const timers = {
    setInterval: (fn: () => void, ms: number) => setInterval(fn, ms),
    clearInterval: (h: unknown) => clearInterval(h as ReturnType<typeof setInterval>),
    now: () => Date.now(),
  }

  it('heartbeat election: smallest live tab id leads, next one takes over after timeout', async () => {
    const hub = channelHub()
    const opts = { companyId: 'c1', locks: null, createChannel: hub, heartbeatMs: 100, timeoutMs: 350, timers }
    const b = electLeader({ ...opts, tabId: 'tab-b' })
    const a = electLeader({ ...opts, tabId: 'tab-a' })
    expect(a.mechanism).toBe('broadcast')
    for (let i = 0; i < 6; i++) {
      await vi.advanceTimersByTimeAsync(100)
    }
    expect(a.isLeader).toBe(true)
    expect(b.isLeader).toBe(false)
    expect(b.leaderTabId).toBe('tab-a')

    await a.release() // sends "bye"
    for (let i = 0; i < 6; i++) await vi.advanceTimersByTimeAsync(100)
    expect(b.isLeader).toBe(true)
  })

  it('a crashed leader (no bye) is replaced after the heartbeat timeout', async () => {
    const hub = channelHub()
    const opts = { companyId: 'c1', locks: null, createChannel: hub, heartbeatMs: 100, timeoutMs: 350, timers }
    const a = electLeader({ ...opts, tabId: 'tab-a' })
    const b = electLeader({ ...opts, tabId: 'tab-b' })
    for (let i = 0; i < 6; i++) await vi.advanceTimersByTimeAsync(100)
    expect(a.isLeader).toBe(true)
    expect(b.isLeader).toBe(false)
    // Tabs A and B freeze/crash: no more heartbeats, no "bye". A new tab C opens.
    vi.clearAllTimers()
    const c = electLeader({ ...opts, tabId: 'tab-c' })
    for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(100)
    expect(c.isLeader).toBe(true)
  })

  it('solo when neither Web Locks nor BroadcastChannel exist', () => {
    const h = electLeader({ companyId: 'c1', locks: null, createChannel: null })
    expect(h.mechanism).toBe('solo')
    expect(h.isLeader).toBe(true)
  })
})
