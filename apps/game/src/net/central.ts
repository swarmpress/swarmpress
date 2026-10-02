/**
 * Typed client for the central swarm.press server (crates/server, ADR-0038/0039).
 *
 * - auth: dev login, `me`, logout (cookie session; same origin through the
 *   Vite proxy in dev/preview);
 * - companies: create/get, the executor lease with its fencing epoch
 *   (ADR-0045; `LeaseKeeper` renews it and reports its loss);
 * - the content gateway (`centralGateway`: the browser's orchestrator
 *   `Gateway`, with the fencing token in the lease header);
 * - the event inbox (`EventStream`: WebSocket `/ws/events` with a polling
 *   fallback; the cursor is persisted in the company store's kv);
 * - sync: command-log segments and the snapshot.
 *
 * Every non-2xx answer throws a `CentralError` carrying the status and the
 * server's `{error}` text. Nothing here holds secrets: GitHub writes happen
 * on the server.
 */

export const LEASE_HEADER = 'x-swarmpress-lease'
export const STEP_HEADER = 'x-swarmpress-step'
export const SHA_HEADER = 'x-swarmpress-sha256'

export interface CentralUser {
  id: string
  github_id: number | null
  login: string
  name: string | null
  avatar_url: string | null
}

export interface Company {
  id: string
  owner_user_id: string
  name: string
  seed: number
  /** `owner/name` of the site repo the gateway writes to. */
  site_repo: string
  site_base_branch: string
  created_at: number
}

export interface Me {
  user: CentralUser
  company: Company | null
}

export interface CreateCompany {
  name: string
  site_repo?: string
  base_branch?: string
}

/** `acquire` takes a free, expired, released or own lease; `request` also asks a holder to hand over; `force` takes over. */
export type LeaseMode = 'acquire' | 'request' | 'force'
export type ExecutorKind = 'browser' | 'self'

/** The sealed head of the company's history on its executor row: 0 and null until fenced sync moves it. */
export interface LogHead {
  number: number
  digest: string | null
}

/** The company's executor lease (ADR-0045). */
export interface Lease {
  /** Rises on every change of holder; never on a renew. */
  epoch: number
  lease_id: string
  /** The fencing token `<epoch>.<lease_id>`: the `x-swarmpress-lease` header of every fenced write. */
  token: string
  holder: string
  holder_kind: ExecutorKind | 'cloud'
  /** Time left, relative: never compared with the client's clock as a timestamp. */
  ttl_ms: number
  renewed: boolean
  /** Another executor asked this holder to hand over. */
  handover_requested: boolean
  handover_by: string | null
  head: LogHead
}

/** The body of the 409 a held lease answers with. */
export interface LeaseHeld {
  error: string
  epoch: number
  holder: string
  holder_kind: string
  ttl_ms: number
  handover_requested: boolean
}

/** The holder info of a "lease held" 409, or null for any other error. */
export function leaseHeld(e: unknown): LeaseHeld | null {
  if (!(e instanceof CentralError) || e.status !== 409) return null
  const b = e.body as Partial<LeaseHeld> | null
  return b && typeof b.holder === 'string' && typeof b.epoch === 'number' ? (b as LeaseHeld) : null
}

/**
 * Who did the work behind a gateway commit, and in which job (ADR-0056
 * decision 8, as narrowed by ADR-0058). The server writes the persona as git
 * author of draft commits and as `Co-authored-by` plus provenance trailers on
 * the squash commit; it synthesises the author's email itself. Every value is
 * one line; a malformed attribution is refused with 400.
 *
 * On a merge, `staff_id`/`name` name the article's author (the writer), and
 * `reviewed_by`/`approved_by` the editor and the CEO.
 */
export interface Attribution {
  /** The sim's staff id, e.g. `staff-1` (`[A-Za-z0-9._:-]`, at most 64). */
  staff_id: string
  /** The persona's display name: the git author name (at most 100, no `<` or `>`). */
  name: string
  /** Persona catalog slug, e.g. `giulia`. */
  persona?: string | null
  role?: string | null
  job_id?: number | string | null
  job_kind?: string | null
  revision?: number | null
  work_item?: string | null
  model?: string | null
  /** Defaults to the lease holder (`<kind> <holder> epoch <n>`) on the server. */
  executor?: string | null
  reviewed_by?: string | null
  approved_by?: string | null
}

export interface DraftRequest {
  content_id: string
  path: string
  page: unknown
  message: string
  work_item?: string | null
  attribution?: Attribution | null
}

export interface DraftResult {
  number: number
  branch: string
  head_sha: string
  created_pr: boolean
  committed: boolean
}

export interface CentralEvent {
  seq: number
  company_id: string
  /** `DeployLanded`, `DeployFailed`, ... */
  kind: string
  payload: Record<string, unknown>
  created_at: number
}

export interface EventsPage {
  events: CentralEvent[]
  last_seq: number
}

export interface SegmentInfo {
  segment: number
  sha256: string
  size: number
  created_at: number
}

export interface PutSegmentResult {
  segment: number
  sha256: string
  size: number
  /** 201 stored, 200 identical bytes already there. */
  status: 200 | 201
}

export interface SnapshotBlob {
  step: number
  sha256: string
  bytes: Uint8Array
}

export class CentralError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: unknown,
  ) {
    super(message)
    this.name = 'CentralError'
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface CentralClientOptions {
  /** Origin of the server; '' (default) = same origin (the Vite proxy). */
  baseUrl?: string
  fetch?: FetchLike
}

export class CentralClient {
  readonly baseUrl: string
  private fetchImpl: FetchLike

  constructor(opts: CentralClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? '').replace(/\/$/, '')
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init))
  }

  /** The WebSocket URL for `path` (ws/wss of the base URL or of the page). */
  wsUrl(path: string): string {
    const base = this.baseUrl || (typeof location !== 'undefined' ? location.origin : 'http://localhost')
    return base.replace(/^http/, 'ws') + path
  }

  private async request(method: string, path: string, init: { json?: unknown; body?: BodyInit; headers?: Record<string, string> } = {}) {
    const headers: Record<string, string> = { ...init.headers }
    let body = init.body
    if (init.json !== undefined) {
      headers['content-type'] = 'application/json'
      body = JSON.stringify(init.json)
    }
    const res = await this.fetchImpl(this.baseUrl + path, { method, headers, body, credentials: 'include' })
    if (!res.ok) {
      let parsed: unknown = null
      let text = ''
      try {
        text = await res.text()
        parsed = text ? JSON.parse(text) : null
      } catch {
        parsed = text
      }
      const msg =
        parsed && typeof parsed === 'object' && 'error' in parsed ? String((parsed as { error: unknown }).error) : text || res.statusText
      throw new CentralError(res.status, `${method} ${path}: ${res.status} ${msg}`, parsed)
    }
    return res
  }

  private async json<T>(method: string, path: string, init?: Parameters<CentralClient['request']>[2]): Promise<T> {
    const res = await this.request(method, path, init)
    return (await res.json()) as T
  }

  // ------------------------------------------------------------ auth

  /** `POST /auth/dev/login` (only with SWARMPRESS_DEV_AUTH=1 on the server). */
  devLogin(login: string): Promise<{ user: CentralUser }> {
    return this.json('POST', '/auth/dev/login', { json: { login } })
  }

  async logout(): Promise<void> {
    await this.request('POST', '/auth/logout')
  }

  /** `GET /api/me`; `null` when signed out (401). */
  async me(): Promise<Me | null> {
    try {
      return await this.json<Me>('GET', '/api/me')
    } catch (e) {
      if (e instanceof CentralError && e.status === 401) return null
      throw e
    }
  }

  // ------------------------------------------------------------ companies + lease

  createCompany(body: CreateCompany): Promise<Company> {
    return this.json('POST', '/api/companies', { json: body })
  }

  /** The caller's company, or `null` (404). */
  async myCompany(): Promise<Company | null> {
    try {
      return await this.json<Company>('GET', '/api/companies/me')
    } catch (e) {
      if (e instanceof CentralError && e.status === 404) return null
      throw e
    }
  }

  /**
   * Take the company lease (epoch + 1). Another executor's unexpired lease
   * answers 409: a `CentralError` whose body is a `LeaseHeld` (see `leaseHeld`).
   */
  acquireLease(companyId: string, deviceId: string, mode: LeaseMode = 'acquire', kind: ExecutorKind = 'browser'): Promise<Lease> {
    return this.json('POST', `/api/companies/${encodeURIComponent(companyId)}/lease`, { json: { device_id: deviceId, mode, kind } })
  }

  /** Extend the lease `token` names (epoch unchanged); 409 once it was released or taken. */
  renewLease(companyId: string, deviceId: string, token: string): Promise<Lease> {
    return this.json('POST', `/api/companies/${encodeURIComponent(companyId)}/lease`, {
      json: { device_id: deviceId, mode: 'renew' },
      headers: { [LEASE_HEADER]: token },
    })
  }

  async releaseLease(companyId: string, token: string): Promise<void> {
    await this.request('DELETE', `/api/companies/${encodeURIComponent(companyId)}/lease`, { headers: { [LEASE_HEADER]: token } })
  }

  // ------------------------------------------------------------ gateway

  /** `token`: the lease's fencing token (`Lease.token`). */
  draft(token: string, body: DraftRequest): Promise<DraftResult> {
    return this.json('POST', '/api/gateway/draft', { json: body, headers: { [LEASE_HEADER]: token } })
  }

  merge(token: string, number: number, headSha: string, attribution?: Attribution | null): Promise<{ merged_sha: string }> {
    const body: { number: number; head_sha: string; attribution?: Attribution } = { number, head_sha: headSha }
    if (attribution) body.attribution = attribution
    return this.json('POST', '/api/gateway/merge', { json: body, headers: { [LEASE_HEADER]: token } })
  }

  // ------------------------------------------------------------ events

  events(after = 0, limit?: number): Promise<EventsPage> {
    const q = new URLSearchParams({ after: String(after) })
    if (limit != null) q.set('limit', String(limit))
    return this.json('GET', `/api/events?${q}`)
  }

  // ------------------------------------------------------------ sync

  private syncPath(companyId: string, rest: string) {
    return `/api/sync/${encodeURIComponent(companyId)}/${rest}`
  }

  /** Segments are immutable: identical bytes answer 200, different bytes 409. */
  async putLogSegment(companyId: string, segment: number, bytes: Uint8Array): Promise<PutSegmentResult> {
    const res = await this.request('PUT', this.syncPath(companyId, `log/${segment}`), {
      body: bytes as BodyInit,
      headers: { 'content-type': 'application/octet-stream' },
    })
    const body = (await res.json()) as Omit<PutSegmentResult, 'status'>
    return { ...body, status: res.status === 201 ? 201 : 200 }
  }

  async getLogSegment(companyId: string, segment: number): Promise<Uint8Array | null> {
    try {
      const res = await this.request('GET', this.syncPath(companyId, `log/${segment}`))
      return new Uint8Array(await res.arrayBuffer())
    } catch (e) {
      if (e instanceof CentralError && e.status === 404) return null
      throw e
    }
  }

  async listLogSegments(companyId: string): Promise<SegmentInfo[]> {
    return (await this.json<{ segments: SegmentInfo[] }>('GET', this.syncPath(companyId, 'log'))).segments
  }

  putSnapshot(companyId: string, step: number, bytes: Uint8Array): Promise<{ step: number; sha256: string; size: number }> {
    return this.json('PUT', this.syncPath(companyId, 'snapshot'), {
      body: bytes as BodyInit,
      headers: { 'content-type': 'application/octet-stream', [STEP_HEADER]: String(step) },
    })
  }

  async getSnapshot(companyId: string): Promise<SnapshotBlob | null> {
    try {
      const res = await this.request('GET', this.syncPath(companyId, 'snapshot'))
      return {
        step: Number(res.headers.get(STEP_HEADER) ?? 0),
        sha256: res.headers.get(SHA_HEADER) ?? '',
        bytes: new Uint8Array(await res.arrayBuffer()),
      }
    } catch (e) {
      if (e instanceof CentralError && e.status === 404) return null
      throw e
    }
  }
}

// ---------------------------------------------------------------- lease keeper

export interface LeaseKeeperOptions {
  /** How `start()` takes the lease. Default `acquire`: never over another executor's live lease. */
  mode?: LeaseMode
  kind?: ExecutorKind
  /**
   * Called once when the lease is gone for good: a renew was refused (released
   * or taken by another executor), or `revoked()` was told so. The executor
   * must halt (ADR-0045 decision 10).
   */
  onLost?: (e: unknown) => void
  /** Called when a renew reply first shows that another executor asked this one to hand over. */
  onHandoverRequested?: (by: string | null) => void
  /** Renew when this fraction of the lease time has passed. Default 1/3. */
  renewFraction?: number
  /** Wait before renewing again after a renew that failed without an answer (network). Default 5000 ms. */
  retryMs?: number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (h: unknown) => void
}

/**
 * Holds the company lease: acquire, renew in the background, release.
 *
 * The lease is lost only when the server says so (409 on a renew, or a
 * `LeaseRevoked` event passed to `revoked()`). A renew that got no answer is
 * retried: expiry alone does not end a lease, and the server accepts a renew
 * past expiry as long as nobody else took it.
 */
export class LeaseKeeper {
  private lease: Lease | null = null
  private timer: unknown = null
  private stopped = false
  private handoverSeen = false
  private setTimer: (fn: () => void, ms: number) => unknown
  private clearTimer: (h: unknown) => void

  constructor(
    private client: CentralClient,
    readonly companyId: string,
    readonly deviceId: string,
    private opts: LeaseKeeperOptions = {},
  ) {
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
    this.clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))
  }

  /** The fencing token of the lease held (`<epoch>.<lease_id>`); throws when the lease is not held. */
  get token(): string {
    if (!this.lease) throw new Error('company lease not held')
    return this.lease.token
  }

  get held(): boolean {
    return this.lease != null
  }

  get current(): Lease | null {
    return this.lease
  }

  /** Takes the lease (`opts.mode`); a held lease rejects with the 409 `CentralError` (see `leaseHeld`). */
  async start(): Promise<Lease> {
    this.stopped = false
    this.handoverSeen = false
    const l = await this.client.acquireLease(this.companyId, this.deviceId, this.opts.mode ?? 'acquire', this.opts.kind ?? 'browser')
    this.lease = l
    this.schedule(l.ttl_ms * (this.opts.renewFraction ?? 1 / 3))
    return l
  }

  /** Renews now (also called by the timer). */
  async renew(): Promise<Lease> {
    const held = this.lease
    if (!held) throw new Error('company lease not held')
    try {
      const l = await this.client.renewLease(this.companyId, this.deviceId, held.token)
      if (this.lease !== held) return l // lost or stopped while the renew was in flight
      this.lease = l
      this.schedule(l.ttl_ms * (this.opts.renewFraction ?? 1 / 3))
      if (l.handover_requested && !this.handoverSeen) {
        this.handoverSeen = true
        this.opts.onHandoverRequested?.(l.handover_by)
      }
      return l
    } catch (e) {
      // 4xx: the server refused this lease. Anything else got no verdict.
      if (e instanceof CentralError && e.status >= 400 && e.status < 500) this.lose(e)
      else if (this.lease === held) this.schedule(this.opts.retryMs ?? 5000)
      throw e
    }
  }

  /**
   * A `LeaseRevoked` event for `epoch` arrived: if that is the lease held, it
   * is lost now, without waiting for the next renew.
   */
  revoked(epoch: number, by?: string): boolean {
    if (!this.lease || this.lease.epoch !== epoch) return false
    this.lose(new Error(`the company lease (epoch ${epoch}) was taken over${by ? ` by ${by}` : ''}`))
    return true
  }

  private lose(e: unknown) {
    if (!this.lease) return
    this.lease = null
    this.cancel()
    if (!this.stopped) this.opts.onLost?.(e)
  }

  private schedule(afterMs: number) {
    this.cancel()
    if (this.stopped) return
    this.timer = this.setTimer(
      () => {
        this.timer = null
        this.renew().catch(() => undefined)
      },
      Math.max(Math.floor(afterMs), 1000),
    )
  }

  private cancel() {
    if (this.timer != null) this.clearTimer(this.timer)
    this.timer = null
  }

  /** Stops renewing and (by default) releases the lease. */
  async stop(release = true): Promise<void> {
    this.stopped = true
    this.cancel()
    const l = this.lease
    this.lease = null
    if (release && l) await this.client.releaseLease(this.companyId, l.token).catch(() => undefined)
  }
}

// ---------------------------------------------------------------- gateway (orchestrator)

/**
 * The orchestrator-wasm `OrchestratorGateway` over the central gateway.
 *
 * `attribution` is the optional last argument of both calls: an `Attribution`
 * or its JSON text (the wasm side passes text, as it does for the page).
 * Left out, null or empty, the request is exactly what it was before
 * attribution existed.
 */
export interface OrchestratorGateway {
  openDraft(
    contentId: string,
    path: string,
    pageJson: string,
    message: string,
    workItem: string | null,
    attribution?: Attribution | string | null,
  ): Promise<{ number: number; branch: string; head_sha: string }>
  merge(number: number, headSha: string, attribution?: Attribution | string | null): Promise<string>
}

function attributionOf(a: Attribution | string | null | undefined): Attribution | null {
  if (a == null || a === '') return null
  return typeof a === 'string' ? (JSON.parse(a) as Attribution) : a
}

/** `token`: the current fencing token (`LeaseKeeper.token`; it throws once the lease is lost). */
export function centralGateway(client: CentralClient, token: () => string): OrchestratorGateway {
  return {
    async openDraft(contentId, path, pageJson, message, workItem, attribution) {
      const body: DraftRequest = {
        content_id: contentId,
        path,
        page: JSON.parse(pageJson),
        message,
        work_item: workItem,
      }
      const who = attributionOf(attribution)
      if (who) body.attribution = who
      const r = await client.draft(token(), body)
      return { number: r.number, branch: r.branch, head_sha: r.head_sha }
    },
    async merge(number, headSha, attribution) {
      return (await client.merge(token(), number, headSha, attributionOf(attribution))).merged_sha
    },
  }
}

// ---------------------------------------------------------------- events

/** Where the event cursor lives (CompanyStore implements it). */
export interface CursorKv {
  getKv(key: string): Promise<string | null>
  setKv(key: string, value: string): Promise<void>
}

export interface WebSocketLike {
  onopen: ((ev: unknown) => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onerror: ((ev: unknown) => void) | null
  onclose: ((ev: unknown) => void) | null
  close(): void
}

export interface EventStreamOptions {
  /** Polling interval while the socket is down. Default 2000 ms. */
  pollMs?: number
  /** Retry the socket after this many polls. Default 5. */
  wsRetryPolls?: number
  /** `null` disables the socket (poll only). Default: the global WebSocket. */
  WebSocket?: (new (url: string) => WebSocketLike) | null
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (h: unknown) => void
  onError?: (e: unknown) => void
}

export type EventTransport = 'ws' | 'poll' | 'stopped'

/**
 * Delivers inbox events in `seq` order, each exactly once per cursor: the
 * cursor (`events.cursor.<company>` in the kv) advances only after the
 * handler resolves, so a reload replays nothing it already handled and
 * misses nothing it did not.
 */
export class EventStream {
  private cursor = 0
  private ws: WebSocketLike | null = null
  private timer: unknown = null
  private polls = 0
  private chain: Promise<void> = Promise.resolve()
  private _transport: EventTransport = 'stopped'
  private running = false
  private setTimer: (fn: () => void, ms: number) => unknown
  private clearTimer: (h: unknown) => void

  constructor(
    private client: CentralClient,
    readonly companyId: string,
    private kv: CursorKv,
    private onEvent: (ev: CentralEvent) => void | Promise<void>,
    private opts: EventStreamOptions = {},
  ) {
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
    this.clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))
  }

  get key(): string {
    return `events.cursor.${this.companyId}`
  }

  get transport(): EventTransport {
    return this._transport
  }

  get lastSeq(): number {
    return this.cursor
  }

  async start(): Promise<void> {
    this.running = true
    this.cursor = Number((await this.kv.getKv(this.key)) ?? 0) || 0
    // Catch up by polling first, then go live.
    await this.pollOnce()
    this.connect()
  }

  stop(): void {
    this.running = false
    this._transport = 'stopped'
    if (this.timer != null) this.clearTimer(this.timer)
    this.timer = null
    const ws = this.ws
    this.ws = null
    if (ws) {
      ws.onclose = null
      ws.onerror = null
      ws.close()
    }
  }

  /** Waits until every received event has been handled. */
  idle(): Promise<void> {
    return this.chain
  }

  private deliver(ev: CentralEvent) {
    this.chain = this.chain.then(async () => {
      if (ev.company_id !== this.companyId || ev.seq <= this.cursor) return
      try {
        await this.onEvent(ev)
        this.cursor = ev.seq
        await this.kv.setKv(this.key, String(ev.seq))
      } catch (e) {
        this.opts.onError?.(e)
      }
    })
  }

  private wsCtor(): (new (url: string) => WebSocketLike) | null {
    if (this.opts.WebSocket !== undefined) return this.opts.WebSocket
    return typeof WebSocket !== 'undefined' ? (WebSocket as unknown as new (url: string) => WebSocketLike) : null
  }

  private connect() {
    if (!this.running) return
    const Ctor = this.wsCtor()
    if (!Ctor) return this.startPolling()
    let opened = false
    let ws: WebSocketLike
    try {
      ws = new Ctor(this.client.wsUrl(`/ws/events?after=${this.cursor}`))
    } catch (e) {
      this.opts.onError?.(e)
      return this.startPolling()
    }
    this.ws = ws
    ws.onopen = () => {
      opened = true
      this._transport = 'ws'
      this.polls = 0
      if (this.timer != null) this.clearTimer(this.timer)
      this.timer = null
    }
    ws.onmessage = (m) => {
      try {
        this.deliver(JSON.parse(String(m.data)) as CentralEvent)
      } catch (e) {
        this.opts.onError?.(e)
      }
    }
    ws.onerror = (e) => {
      if (!opened) this.opts.onError?.(e)
    }
    ws.onclose = () => {
      if (this.ws !== ws) return
      this.ws = null
      this.startPolling()
    }
  }

  private startPolling() {
    if (!this.running) return
    this._transport = 'poll'
    this.polls = 0
    this.schedulePoll()
  }

  private schedulePoll() {
    if (this.timer != null) this.clearTimer(this.timer)
    this.timer = this.setTimer(() => {
      this.timer = null
      void this.tick()
    }, this.opts.pollMs ?? 2000)
  }

  private async tick() {
    if (!this.running || this._transport !== 'poll') return
    await this.pollOnce()
    this.polls++
    if (this.polls >= (this.opts.wsRetryPolls ?? 5) && this.wsCtor()) {
      this.polls = 0
      this.connect()
    }
    if (this.running && this._transport === 'poll' && this.timer == null) this.schedulePoll()
  }

  /** One `GET /api/events` round (all pages). */
  async pollOnce(): Promise<void> {
    try {
      for (;;) {
        await this.chain
        const page = await this.client.events(this.cursor)
        for (const ev of page.events) this.deliver(ev)
        await this.chain
        if (page.events.length < 500) break
      }
    } catch (e) {
      this.opts.onError?.(e)
    }
  }
}
