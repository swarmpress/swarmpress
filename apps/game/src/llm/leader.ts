/**
 * Job-worker leadership across tabs (plan D: "across multiple tabs, a Web
 * Locks API leader election picks one worker").
 *
 * Primary: `navigator.locks.request('swarmpress-llm-worker:<companyId>')`.
 * The holder is the leader; other tabs queue on the same lock and take over
 * automatically when the leader tab closes or releases (the browser drops
 * the lock with the tab, so there is no stale-leader window).
 *
 * Status (model loaded, current job, state) is shared on a BroadcastChannel
 * `swarmpress-llm-status:<companyId>` so follower tabs can show what the
 * newsroom's brains are doing.
 *
 * Fallbacks:
 *   - no Web Locks, BroadcastChannel available → heartbeat election: every
 *     tab heartbeats; if no leader heartbeat is seen for `timeoutMs`, the
 *     live tab with the smallest id claims; on a split-brain the larger id
 *     steps down.
 *   - neither → "solo": this tab is the leader.
 *
 * The resident model (ADR-0057, `electResident`): model residency is per
 * origin, not per company, so one origin-wide lock (`RESIDENT_LOCK`) decides
 * which tab may load the model. It tries the lock first (`tryFirst`), so a
 * tab knows at once that another tab has the model, then waits in line; the
 * player can take the model over (`takeOver`, a Web Locks steal), and the tab
 * that had it is told (`stolen`) and frees it.
 */

export interface LeaderStatus {
  tabId: string
  state: 'idle' | 'loading' | 'generating' | 'paused'
  modelId?: string | null
  jobId?: string | null
  at: number
}

export interface LeadershipChange {
  isLeader: boolean
  leaderTabId: string | null
  /** This tab held the lock and another tab took it over. */
  stolen?: boolean
}

export interface LeaderHandle {
  readonly tabId: string
  readonly mechanism: 'web-locks' | 'broadcast' | 'solo'
  readonly isLeader: boolean
  readonly leaderTabId: string | null
  /** The lock can be taken from the tab that holds it (Web Locks only). */
  readonly canTakeOver: boolean
  onChange(fn: (e: LeadershipChange) => void): () => void
  /** Status published by the leader (received in every tab, including the leader). */
  onStatus(fn: (s: LeaderStatus) => void): () => void
  /** Leader only: broadcast the worker status. No-op in followers. */
  publishStatus(s: Omit<LeaderStatus, 'tabId' | 'at'>): void
  /** Resolves once this tab is the leader. */
  whenLeader(): Promise<void>
  /**
   * Resolves once the first attempt decided: true when this tab got the lock
   * at once, false when another tab holds it (this tab then waits in line).
   */
  settled(): Promise<boolean>
  /** Take the lock from the tab that holds it; that tab's handle reports `stolen` and waits in line again. */
  takeOver(): Promise<void>
  release(): Promise<void>
}

export interface LockManagerLike {
  request(
    name: string,
    options: { mode?: 'exclusive' | 'shared'; signal?: AbortSignal; ifAvailable?: boolean; steal?: boolean },
    cb: (lock: unknown) => Promise<unknown>,
  ): Promise<unknown>
}

export interface ChannelLike {
  postMessage(msg: unknown): void
  onmessage: ((ev: { data: unknown }) => void) | null
  close(): void
}

interface Timers {
  setInterval(fn: () => void, ms: number): unknown
  clearInterval(h: unknown): void
  now(): number
}

export interface ElectOptions {
  /** Names the lock and channel per company (`lockName(companyId)`), unless `lockName`/`channelName` say otherwise. */
  companyId?: string
  /** The Web Lock's name; wins over `companyId`. */
  lockName?: string
  /** The status channel's name; wins over `companyId`. */
  channelName?: string
  /**
   * Web Locks: try the lock without waiting first (`ifAvailable`), so
   * `settled()` says at once whether another tab holds it; then wait in line.
   */
  tryFirst?: boolean
  tabId?: string
  /** Defaults to navigator.locks; pass null to force the fallback. */
  locks?: LockManagerLike | null
  /** Defaults to `new BroadcastChannel(name)`; pass null for none. */
  createChannel?: ((name: string) => ChannelLike) | null
  heartbeatMs?: number
  timeoutMs?: number
  timers?: Timers
}

type Msg =
  | { t: 'leader'; tabId: string }
  | { t: 'who'; tabId: string }
  | { t: 'status'; status: LeaderStatus }
  | { t: 'hb'; tabId: string; leader: boolean }
  | { t: 'bye'; tabId: string }

export const lockName = (companyId: string) => `swarmpress-llm-worker:${companyId}`
export const channelName = (companyId: string) => `swarmpress-llm-status:${companyId}`

/** The origin-wide lock of the resident model: one tab of this origin holds the model, whatever company it shows. */
export const RESIDENT_LOCK = 'swarmpress-llm-resident'
export const RESIDENT_CHANNEL = 'swarmpress-llm-resident-status'

/** Leadership over the origin's one resident model (ADR-0057). */
export function electResident(opts: Omit<ElectOptions, 'companyId' | 'lockName' | 'channelName' | 'tryFirst'> = {}): LeaderHandle {
  return electLeader({ ...opts, lockName: RESIDENT_LOCK, channelName: RESIDENT_CHANNEL, tryFirst: true })
}

function randomId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `tab-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`
}

const realTimers: Timers = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
  now: () => Date.now(),
}

export function electLeader(opts: ElectOptions): LeaderHandle {
  const tabId = opts.tabId ?? randomId()
  const locks =
    opts.locks === undefined ? ((globalThis.navigator as Navigator | undefined)?.locks as unknown as LockManagerLike | undefined) ?? null : opts.locks
  const createChannel =
    opts.createChannel === undefined
      ? typeof BroadcastChannel === 'function'
        ? (n: string) => new BroadcastChannel(n) as unknown as ChannelLike
        : null
      : opts.createChannel
  const timers = opts.timers ?? realTimers
  const heartbeatMs = opts.heartbeatMs ?? 1000
  const timeoutMs = opts.timeoutMs ?? 3500

  const changeListeners = new Set<(e: LeadershipChange) => void>()
  const statusListeners = new Set<(s: LeaderStatus) => void>()
  const leaderWaiters: Array<() => void> = []
  let isLeader = false
  let leaderTabId: string | null = null
  let released = false
  if (opts.companyId === undefined && (opts.lockName === undefined || opts.channelName === undefined)) {
    throw new Error('electLeader needs a companyId, or both a lockName and a channelName')
  }
  const theLock = opts.lockName ?? lockName(opts.companyId!)
  const channel = createChannel ? createChannel(opts.channelName ?? channelName(opts.companyId!)) : null
  const mechanism: LeaderHandle['mechanism'] = locks ? 'web-locks' : channel ? 'broadcast' : 'solo'

  let settledAs: boolean | null = null
  const settledWaiters: Array<(v: boolean) => void> = []
  const settle = (free: boolean) => {
    if (settledAs !== null) return
    settledAs = free
    settledWaiters.splice(0).forEach((r) => r(free))
  }

  const post = (m: Msg) => channel?.postMessage(m)
  const setLeader = (leader: boolean, leaderId: string | null, stolen = false) => {
    if (leader === isLeader && leaderId === leaderTabId && !stolen) return
    isLeader = leader
    leaderTabId = leaderId
    if (leader) leaderWaiters.splice(0).forEach((r) => r())
    const e: LeadershipChange = stolen ? { isLeader, leaderTabId, stolen: true } : { isLeader, leaderTabId }
    for (const l of changeListeners) l(e)
  }

  // ---- heartbeat fallback state
  const peers = new Map<string, { at: number; leader: boolean }>()
  const startedAt = timers.now()
  let hbTimer: unknown = null

  const onMessage = (m: Msg) => {
    if (released) return
    switch (m.t) {
      case 'leader':
        // Another tab holds the lock now; if this tab held it, it was taken over.
        if (m.tabId !== tabId && mechanism === 'web-locks') {
          if (holding) lostLock(m.tabId)
          else setLeader(false, m.tabId)
        }
        break
      case 'who':
        if (isLeader) post({ t: 'leader', tabId })
        break
      case 'status':
        if (m.status.tabId !== tabId) {
          if (!isLeader && mechanism === 'web-locks') setLeader(false, m.status.tabId)
          for (const l of statusListeners) l(m.status)
        }
        break
      case 'hb':
        peers.set(m.tabId, { at: timers.now(), leader: m.leader })
        if (mechanism === 'broadcast') evaluateHeartbeat()
        break
      case 'bye':
        peers.delete(m.tabId)
        if (leaderTabId === m.tabId && !isLeader) setLeader(false, null)
        if (mechanism === 'broadcast') evaluateHeartbeat()
        break
    }
  }
  if (channel) channel.onmessage = (ev) => onMessage(ev.data as Msg)

  function evaluateHeartbeat() {
    if (released) return
    const now = timers.now()
    for (const [id, p] of peers) if (now - p.at > timeoutMs) peers.delete(id)
    const liveLeaders = [...peers].filter(([, p]) => p.leader).map(([id]) => id)
    if (isLeader) {
      // Split brain: the smaller id wins.
      const smaller = liveLeaders.filter((id) => id < tabId).sort()[0]
      if (smaller) setLeader(false, smaller)
      return
    }
    if (liveLeaders.length) {
      setLeader(false, liveLeaders.sort()[0])
      return
    }
    // No leader seen. Wait one timeout after start to discover peers, then the smallest live id claims.
    if (now - startedAt < timeoutMs) return
    const candidates = [tabId, ...peers.keys()].sort()
    if (candidates[0] === tabId) {
      setLeader(true, tabId)
      post({ t: 'hb', tabId, leader: true })
    } else setLeader(false, null)
    settle(isLeader)
  }

  // ---- Web Locks path
  let releaseLock: (() => void) | null = null
  /** This tab holds the lock (it may have been stolen without the tab having been told yet). */
  let holding = false
  /** The waiting request, aborted on release() and before a takeover. */
  let queued: AbortController | null = null

  /** The lock is granted: hold it until release() (or until another tab steals it). */
  const hold = async (lock: unknown) => {
    if (lock === null || released) return
    settle(true)
    holding = true
    setLeader(true, tabId)
    post({ t: 'leader', tabId })
    await new Promise<void>((r) => (releaseLock = r))
  }

  /** Another tab took the lock: this tab is told, frees what it held, and waits in line again. */
  const lostLock = (newLeader: string | null) => {
    if (!holding || released) return
    holding = false
    releaseLock = null
    setLeader(false, newLeader, true)
    queue()
  }

  // A rejected request: aborted by release() or a takeover from this tab (nothing to do), or stolen while held.
  const onRequestEnded = () => lostLock(null)

  const queue = () => {
    queued = typeof AbortController === 'function' ? new AbortController() : null
    locks!.request(theLock, { mode: 'exclusive', signal: queued?.signal }, hold).catch(onRequestEnded)
  }

  if (mechanism === 'web-locks') {
    if (opts.tryFirst) {
      locks!
        .request(theLock, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
          settle(lock !== null)
          if (lock !== null) return hold(lock)
          if (!released) queue()
        })
        .catch(onRequestEnded)
    } else queue()
    post({ t: 'who', tabId })
  } else if (mechanism === 'broadcast') {
    hbTimer = timers.setInterval(() => {
      post({ t: 'hb', tabId, leader: isLeader })
      evaluateHeartbeat()
    }, heartbeatMs)
    post({ t: 'hb', tabId, leader: false })
  } else {
    setLeader(true, tabId)
    settle(true)
  }

  return {
    tabId,
    mechanism,
    canTakeOver: mechanism === 'web-locks',
    get isLeader() {
      return isLeader
    },
    get leaderTabId() {
      return leaderTabId
    },
    onChange(fn) {
      changeListeners.add(fn)
      return () => changeListeners.delete(fn)
    },
    onStatus(fn) {
      statusListeners.add(fn)
      return () => statusListeners.delete(fn)
    },
    publishStatus(s) {
      if (!isLeader) return
      const status: LeaderStatus = { ...s, tabId, at: timers.now() }
      post({ t: 'status', status })
      for (const l of statusListeners) l(status)
    },
    whenLeader() {
      return isLeader ? Promise.resolve() : new Promise<void>((r) => leaderWaiters.push(r))
    },
    settled() {
      return settledAs !== null ? Promise.resolve(settledAs) : new Promise<boolean>((r) => settledWaiters.push(r))
    },
    async takeOver() {
      if (mechanism !== 'web-locks' || released || holding) return
      // Leave the line first, or the waiting request would be granted again after this tab lets go.
      queued?.abort()
      queued = null
      await new Promise<void>((granted) => {
        locks!
          .request(theLock, { mode: 'exclusive', steal: true }, (lock) => {
            const held = hold(lock)
            granted()
            return held
          })
          .catch(onRequestEnded)
      })
    },
    async release() {
      if (released) return
      released = true
      if (hbTimer !== null) timers.clearInterval(hbTimer)
      post({ t: 'bye', tabId })
      holding = false
      setLeader(false, null)
      if (releaseLock) (releaseLock as () => void)()
      queued?.abort()
      channel?.close()
    },
  }
}
