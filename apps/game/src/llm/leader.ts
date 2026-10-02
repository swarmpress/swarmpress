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
}

export interface LeaderHandle {
  readonly tabId: string
  readonly mechanism: 'web-locks' | 'broadcast' | 'solo'
  readonly isLeader: boolean
  readonly leaderTabId: string | null
  onChange(fn: (e: LeadershipChange) => void): () => void
  /** Status published by the leader (received in every tab, including the leader). */
  onStatus(fn: (s: LeaderStatus) => void): () => void
  /** Leader only: broadcast the worker status. No-op in followers. */
  publishStatus(s: Omit<LeaderStatus, 'tabId' | 'at'>): void
  /** Resolves once this tab is the leader. */
  whenLeader(): Promise<void>
  release(): Promise<void>
}

export interface LockManagerLike {
  request(name: string, options: { mode?: 'exclusive' | 'shared'; signal?: AbortSignal }, cb: (lock: unknown) => Promise<unknown>): Promise<unknown>
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
  companyId: string
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
  const channel = createChannel ? createChannel(channelName(opts.companyId)) : null
  const mechanism: LeaderHandle['mechanism'] = locks ? 'web-locks' : channel ? 'broadcast' : 'solo'

  const post = (m: Msg) => channel?.postMessage(m)
  const setLeader = (leader: boolean, leaderId: string | null) => {
    if (leader === isLeader && leaderId === leaderTabId) return
    isLeader = leader
    leaderTabId = leaderId
    if (leader) leaderWaiters.splice(0).forEach((r) => r())
    for (const l of changeListeners) l({ isLeader, leaderTabId })
  }

  // ---- heartbeat fallback state
  const peers = new Map<string, { at: number; leader: boolean }>()
  const startedAt = timers.now()
  let hbTimer: unknown = null

  const onMessage = (m: Msg) => {
    if (released) return
    switch (m.t) {
      case 'leader':
        if (m.tabId !== tabId && mechanism === 'web-locks') setLeader(false, m.tabId)
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
  }

  // ---- Web Locks path
  let releaseLock: (() => void) | null = null
  const abort = typeof AbortController === 'function' ? new AbortController() : null
  if (mechanism === 'web-locks') {
    locks!
      .request(lockName(opts.companyId), { mode: 'exclusive', signal: abort?.signal }, async () => {
        if (released) return
        setLeader(true, tabId)
        post({ t: 'leader', tabId })
        await new Promise<void>((r) => (releaseLock = r))
      })
      .catch(() => {
        /* aborted on release() */
      })
    post({ t: 'who', tabId })
  } else if (mechanism === 'broadcast') {
    hbTimer = timers.setInterval(() => {
      post({ t: 'hb', tabId, leader: isLeader })
      evaluateHeartbeat()
    }, heartbeatMs)
    post({ t: 'hb', tabId, leader: false })
  } else {
    setLeader(true, tabId)
  }

  return {
    tabId,
    mechanism,
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
    async release() {
      if (released) return
      released = true
      if (hbTimer !== null) timers.clearInterval(hbTimer)
      post({ t: 'bye', tabId })
      setLeader(false, null)
      if (releaseLock) (releaseLock as () => void)()
      else abort?.abort()
      channel?.close()
    },
  }
}
