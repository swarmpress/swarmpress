/**
 * Typed client for the central swarm.press server (crates/server, ADR-0038/0039).
 *
 * - auth: dev login, `me`, logout (cookie session; same origin through the
 *   Vite proxy in dev/preview);
 * - companies: create/get, the executor lease with its fencing epoch
 *   (ADR-0045; `LeaseKeeper` renews it and reports its loss);
 * - the content gateway (`centralGateway`: the browser's orchestrator
 *   `Gateway`, with the fencing token in the lease header) and the site's
 *   knowledge pack (`knowledge`, ETag / 304);
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

/** Which repository and base branch a company's gateway writes to. */
export interface SiteBinding {
  /** `owner/name`. */
  site_repo: string
  base_branch: string
}

export interface Me {
  user: CentralUser
  company: Company | null
  /**
   * The binding the owner configured on the server for new companies
   * (`SWARMPRESS_DEFAULT_SITE_REPO`, `SWARMPRESS_DEFAULT_BASE_BRANCH`). Never
   * from the URL: a write target is the server's configuration. Absent from
   * servers before increment G2.
   */
  default_binding?: SiteBinding | null
}

export interface CreateCompany {
  name: string
  site_repo?: string
  base_branch?: string
}

/**
 * The signed-in player's company, founded on first use (G2). The founding
 * request names its binding explicitly: the repository and base branch the
 * owner configured on the server (`me.default_binding`), so the write target
 * is a deliberate choice of the server's owner and never a URL parameter.
 * The server checks it against `SWARMPRESS_ALLOWED_SITE_REPOS` either way.
 */
export async function companyFor(client: CentralClient, me: Me, name: string): Promise<Company> {
  if (me.company) return me.company
  const existing = await client.myCompany()
  if (existing) return existing
  const b = me.default_binding
  return client.createCompany(b ? { name, site_repo: b.site_repo, base_branch: b.base_branch } : { name })
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
  /** An update of an existing article (ADR-0070): the blob sha it replaces. */
  update?: string | null
}

/** `GET /api/gateway/file`: a `content/pages/` file at the base head with its blob sha (ADR-0070). */
export interface GatewayFile {
  path: string
  sha: string
  commit: string
  page: unknown
}

/** `GET /api/analytics` (ADR-0032): a project's aggregates. */
export interface AnalyticsSummary {
  from: string
  to: string
  days: { day: string; sessions: number; visitors: number; pageviews: number; engagedSessions: number; engagementRate: number }[]
  totals: { sessions: number; visitors: number; pageviews: number; engagedSessions: number; engagementPm: number }
  topPages: { path: string; pageviews: number; sessions: number; avgEngagedMs: number }[]
  languages: { lang: string; pageviews: number }[]
  sources: { source: string; sessions: number; pageviews: number }[]
}

/** A pending analytics signal (ADR-0071). */
export interface AnalyticsSignalRow {
  project_key: string
  day: string
  project: string
  sessions: number
  visitors: number
  pageviews: number
  engagement_pm: number
  /** A u64 as decimal text. */
  top_pages_digest: string
}

/** `GET /api/analytics/page` (ADR-0071). */
export interface AnalyticsPage {
  path: string
  pageviews: number
  sessions: number
  avg_engaged_ms: number
  scroll_75: number
  days: number
  median_pageviews: number
  pages: number
}

/** `GET /api/site/audit` (ADR-0070): the site's health at the base head. */
export interface SiteAudit {
  commit: string
  pages: number
  links_checked: number
  broken_links: number
  broken_pages: { path: string; title: string; broken: number }[]
  orphans: { path: string; title: string }[]
  orphan_count: number
  policy: { path: string; pointer: string; block: string; links: number; min: number; max: number | null }[]
  policy_count: number
  stale: { path: string; title: string; date: string; age_days: number }[]
  stale_count: number
  stale_days: number
  articles: number
  /** `ServerCommand::SiteSignals`, as the sim takes it. */
  signals: {
    live_pages: number
    languages: number
    broken_links: number
    media_count: number
    lighthouse_performance: number
    lighthouse_accessibility: number
    lighthouse_seo: number
  }
}

export interface DraftResult {
  number: number
  branch: string
  head_sha: string
  created_pr: boolean
  committed: boolean
}

/** What became of a gateway pull request (`GET /api/gateway/deploy-status`). */
export type DeployState = 'open' | 'closed' | 'pending' | 'landed' | 'failed' | 'unknown'

export interface DeployStatus {
  number: number
  content_id: string
  work_item: string | null
  path: string
  state: DeployState
  merged_sha: string | null
  merged_at: number | null
  landed_at: number | null
  closed_at: number | null
  detail: string | null
  checked_at: number | null
  now: number
}

/** The answer of `POST /api/gateway/redeploy` (FEAT-085). */
export interface RedeployResult {
  number: number
  work_item: string | null
  /** `pending` after a redeploy. */
  state: DeployState
  /** Whether GitHub was asked to re-run the failed deploy (`false`: it was waiting for a deployment already). */
  requested: boolean
  run_id: number | null
  run_attempt: number | null
  /** Redeploys of this merge so far. */
  attempt: number
  detail: string | null
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

/** A knowledge pack as `GET /api/gateway/knowledge` answered it. */
export interface KnowledgeFetch {
  /** The pack's JSON text (`{commit, files, manifest, pages}`), verbatim. */
  pack: string
  /** The strong ETag, `"<commit>"`: send it back as `If-None-Match`. */
  etag: string
  /** The site commit the pack was built from (the base head). */
  commit: string
}

/** The commit an ETag (`"<sha>"`, possibly weak) names. */
export function etagCommit(etag: string | null | undefined): string | null {
  const m = /^(?:W\/)?"?([0-9a-fA-F]{7,64})"?$/.exec((etag ?? '').trim())
  return m ? m[1].toLowerCase() : null
}

/** `commit` of a pack's JSON text, without parsing the whole pack (it is the first key). */
export function packCommit(packJson: string): string | null {
  const m = /^\s*\{\s*"commit"\s*:\s*"([^"]+)"/.exec(packJson)
  return m ? m[1] : null
}

/** `POST /api/llm/generate` (ADR-0067, FEAT-086): one model turn on the server's hosted model. */
export interface LlmGenerateRequest {
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
  /** What the call is for (the server's job record). */
  kind?: string
  /** Answer and reasoning tokens together. */
  max_output_tokens?: number
  reasoning_effort?: 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  /** `flex` (default) for queued work, `default` (Standard) where the player waits. */
  service_tier?: 'flex' | 'default'
  json_schema?: Record<string, unknown>
  /** Search the web while answering (ADR-0068). */
  web_search?: { context_size?: 'low' | 'medium' | 'high'; country?: string; region?: string }
}

export interface LlmCitation {
  url: string
  title: string
  start: number
  end: number
  /** The URL is among the sources the searches returned. */
  verified: boolean
}

export interface LlmGenerateReply {
  job_id: string
  text: string
  finish: 'stop' | 'length'
  model: string
  service_tier: string
  usage: { input_tokens: number; cached_input_tokens: number; output_tokens: number; reasoning_tokens: number }
  cost_micros: number
  duration_ms: number
  /** With `web_search`: searches run, every source they returned, the answer's citations. */
  searches?: number
  sources?: string[]
  citations?: LlmCitation[]
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

  private async request(method: string, path: string, init: { json?: unknown; body?: BodyInit; headers?: Record<string, string>; signal?: AbortSignal } = {}) {
    const headers: Record<string, string> = { ...init.headers }
    let body = init.body
    if (init.json !== undefined) {
      headers['content-type'] = 'application/json'
      body = JSON.stringify(init.json)
    }
    const res = await this.fetchImpl(this.baseUrl + path, { method, headers, body, credentials: 'include', ...(init.signal ? { signal: init.signal } : {}) })
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

  // ------------------------------------------------------------ hosted model

  /** One model turn on the server's hosted model; fenced by the lease (the spend is the company's). */
  llmGenerate(token: string, body: LlmGenerateRequest, signal?: AbortSignal): Promise<LlmGenerateReply> {
    return this.json('POST', '/api/llm/generate', { json: body, headers: { [LEASE_HEADER]: token }, ...(signal ? { signal } : {}) })
  }

  // ------------------------------------------------------------ gateway

  /** A page of the base branch with its blob sha; `null` when it does not exist (ADR-0070). */
  async gatewayFile(token: string, path: string): Promise<GatewayFile | null> {
    try {
      return await this.json('GET', `/api/gateway/file?path=${encodeURIComponent(path)}`, { headers: { [LEASE_HEADER]: token } })
    } catch (e) {
      if (e instanceof CentralError && e.status === 404) return null
      throw e
    }
  }

  /** `GET /api/analytics`: a project's aggregates over the last `days` (the read model of ADR-0032). */
  analytics(project: string, days: number): Promise<AnalyticsSummary> {
    return this.json('GET', `/api/analytics?project=${encodeURIComponent(project)}&days=${days}`)
  }

  /** The company's pending analytics signals (ADR-0071); `top_pages_digest` is a u64 as text. */
  async analyticsSignals(token: string): Promise<AnalyticsSignalRow[]> {
    const r = await this.json<{ signals: AnalyticsSignalRow[] }>('GET', '/api/analytics/signals', { headers: { [LEASE_HEADER]: token } })
    return r.signals
  }

  /** Marks signals the host logged as applied (ADR-0071). */
  ackAnalyticsSignals(token: string, rows: { project_key: string; day: string }[]): Promise<{ applied: number }> {
    return this.json('POST', '/api/analytics/signals/ack', { json: { rows }, headers: { [LEASE_HEADER]: token } })
  }

  /** One page's numbers since `from` (YYYY-MM-DD) and the per-page median (ADR-0071); `null` without a tracker project. */
  async analyticsPage(token: string, path: string, from: string): Promise<AnalyticsPage | null> {
    try {
      return await this.json('GET', `/api/analytics/page?path=${encodeURIComponent(path)}&from=${from}`, { headers: { [LEASE_HEADER]: token } })
    } catch (e) {
      if (e instanceof CentralError && e.status === 404) return null
      throw e
    }
  }

  /** The site audit of the base head (ADR-0070). */
  siteAudit(token: string): Promise<SiteAudit> {
    return this.json('GET', '/api/site/audit', { headers: { [LEASE_HEADER]: token } })
  }

  /** `token`: the lease's fencing token (`Lease.token`). */
  draft(token: string, body: DraftRequest): Promise<DraftResult> {
    return this.json('POST', '/api/gateway/draft', { json: body, headers: { [LEASE_HEADER]: token } })
  }

  merge(token: string, number: number, headSha: string, attribution?: Attribution | null): Promise<{ merged_sha: string }> {
    const body: { number: number; head_sha: string; attribution?: Attribution } = { number, head_sha: headSha }
    if (attribution) body.attribution = attribution
    return this.json('POST', '/api/gateway/merge', { json: body, headers: { [LEASE_HEADER]: token } })
  }

  /** `GET /api/gateway/deploy-status?number=`: a read, no lease; `null` for a pull request the server does not know (404). */
  async deployStatus(number: number): Promise<DeployStatus | null> {
    try {
      return await this.json<DeployStatus>('GET', `/api/gateway/deploy-status?number=${encodeURIComponent(String(number))}`)
    } catch (e) {
      if (e instanceof CentralError && e.status === 404) return null
      throw e
    }
  }

  /**
   * `POST /api/gateway/redeploy {number}` (FEAT-085): deploy a merge whose deployment failed
   * again (the server re-runs the failed jobs of its deploy workflow run). Idempotent while the
   * merge waits for a deployment. Refusals throw a `CentralError`: 409 landed, not merged or
   * nothing to re-run (or the lease is not held), 403 GitHub refused the re-run.
   */
  redeploy(token: string, number: number): Promise<RedeployResult> {
    return this.json('POST', '/api/gateway/redeploy', { json: { number }, headers: { [LEASE_HEADER]: token } })
  }

  /**
   * `GET /api/gateway/knowledge` (ADR-0061): the knowledge pack of the site at
   * the head of the company's base branch. `etag` is the ETag of the pack
   * held (`"<commit>"`); while the head has not moved the server answers 304
   * and this resolves to `'not-modified'`. Otherwise the pack's JSON text
   * (kept verbatim: it is what orchestrator-wasm loads), its ETag and the
   * commit it names. Other statuses throw a `CentralError` (413: the site is
   * over the snapshot caps; 409/428: the lease is not held).
   */
  async knowledge(token: string, etag?: string | null): Promise<KnowledgeFetch | 'not-modified'> {
    const headers: Record<string, string> = { [LEASE_HEADER]: token }
    if (etag) headers['if-none-match'] = etag
    const res = await this.fetchImpl(this.baseUrl + '/api/gateway/knowledge', { method: 'GET', headers, credentials: 'include', cache: 'no-store' })
    if (res.status === 304) return 'not-modified'
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      let parsed: unknown = text
      try {
        parsed = text ? JSON.parse(text) : null
      } catch {
        /* not JSON */
      }
      const msg = parsed && typeof parsed === 'object' && 'error' in parsed ? String((parsed as { error: unknown }).error) : text || res.statusText
      throw new CentralError(res.status, `GET /api/gateway/knowledge: ${res.status} ${msg}`, parsed)
    }
    const tag = res.headers.get('etag') ?? ''
    const pack = await res.text()
    const commit = etagCommit(tag) ?? packCommit(pack)
    if (!commit) throw new CentralError(res.status, 'GET /api/gateway/knowledge: the answer names no commit', null)
    return { pack, etag: tag || `"${commit}"`, commit }
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
  /** The deploy state of a merged pull request, `null` when not observed (FEAT-085). Optional. */
  deployState?(number: number): Promise<DeployState | null>
  /** Deploy a merge whose deployment failed again (FEAT-085). Optional; rejects when refused. */
  redeploy?(number: number): Promise<RedeployResult>
  /** A page of the base branch with its blob sha, `null` when absent (ADR-0070). Optional. */
  readPage?(path: string): Promise<{ page: unknown; sha: string } | null>
  /** An update of an existing article naming the blob it replaces (ADR-0070). Optional. */
  openUpdate?(
    contentId: string,
    path: string,
    pageJson: string,
    message: string,
    workItem: string | null,
    attribution: Attribution | string | null,
    blobSha: string,
  ): Promise<{ number: number; branch: string; head_sha: string }>
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
    async deployState(number) {
      return (await client.deployStatus(number))?.state ?? null
    },
    redeploy(number) {
      return client.redeploy(token(), number)
    },
    async readPage(path) {
      const f = await client.gatewayFile(token(), path)
      return f ? { page: f.page, sha: f.sha } : null
    },
    async openUpdate(contentId, path, pageJson, message, workItem, attribution, blobSha) {
      const body: DraftRequest = { content_id: contentId, path, page: JSON.parse(pageJson), message, work_item: workItem, update: blobSha }
      const who = attributionOf(attribution)
      if (who) body.attribution = who
      const r = await client.draft(token(), body)
      return { number: r.number, branch: r.branch, head_sha: r.head_sha }
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
