/**
 * In-memory stand-ins for `navigator.locks` and `BroadcastChannel`, shared by
 * several tabs of one test (leader.test.ts, the session's model runtime).
 *
 * `FakeLocks` models what the resident lock relies on: exclusive FIFO per
 * name, `signal` aborting a queued request, `ifAvailable` (the callback gets
 * `null` when the lock is held or queued for), and `steal` (the holder's
 * request rejects with an AbortError and the stealer gets the lock at once).
 * Callbacks run in a later microtask, as the real API runs them in a later task.
 */
import type { ChannelLike, LockManagerLike } from '../leader'

interface Entry {
  cb: (lock: unknown) => Promise<unknown>
  resolve(v: unknown): void
  reject(e: unknown): void
  signal?: AbortSignal
}

interface Holder extends Entry {
  stolen: boolean
}

const abortError = (message: string) => Object.assign(new Error(message), { name: 'AbortError' })

export class FakeLocks implements LockManagerLike {
  private holders = new Map<string, Holder | null>()
  private queues = new Map<string, Entry[]>()

  request(
    name: string,
    options: { mode?: 'exclusive' | 'shared'; signal?: AbortSignal; ifAvailable?: boolean; steal?: boolean },
    cb: (lock: unknown) => Promise<unknown>,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const entry: Entry = { cb, resolve, reject, signal: options.signal }
      const q = this.queue(name)
      if (options.steal) {
        const h = this.holders.get(name)
        if (h) {
          h.stolen = true
          h.reject(abortError('the lock was stolen'))
        }
        this.grant(name, entry)
        return
      }
      if (options.ifAvailable && (this.holders.get(name) || q.length > 0)) {
        void Promise.resolve()
          .then(() => cb(null))
          .then(resolve, reject)
        return
      }
      q.push(entry)
      options.signal?.addEventListener('abort', () => {
        const i = q.indexOf(entry)
        if (i >= 0) {
          q.splice(i, 1)
          reject(abortError('the lock request was aborted'))
        }
      })
      this.pump(name)
    })
  }

  /** Whether some request holds the lock now. */
  held(name: string): boolean {
    return !!this.holders.get(name)
  }

  /** Requests waiting for the lock. */
  waiting(name: string): number {
    return this.queue(name).length
  }

  private queue(name: string): Entry[] {
    let q = this.queues.get(name)
    if (!q) this.queues.set(name, (q = []))
    return q
  }

  private grant(name: string, entry: Entry) {
    const holder: Holder = { ...entry, stolen: false }
    this.holders.set(name, holder)
    void Promise.resolve()
      .then(() => entry.cb({ name }))
      .then(
        (v) => {
          if (!holder.stolen) entry.resolve(v)
        },
        (e) => {
          if (!holder.stolen) entry.reject(e)
        },
      )
      .finally(() => {
        if (this.holders.get(name) === holder) {
          this.holders.set(name, null)
          this.pump(name)
        }
      })
  }

  private pump(name: string) {
    if (this.holders.get(name)) return
    const next = this.queue(name).shift()
    if (next) this.grant(name, next)
  }
}

/** In-memory BroadcastChannel hub: delivers asynchronously, never to the sender. */
export function channelHub(): (name: string) => ChannelLike {
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

/** Lets queued microtasks (lock grants, channel messages) run. */
export const flushMicrotasks = async (rounds = 20) => {
  for (let i = 0; i < rounds; i++) await Promise.resolve()
}
