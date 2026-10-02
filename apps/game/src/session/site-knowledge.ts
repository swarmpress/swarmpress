/**
 * The site's knowledge in the session (ADR-0061, increment K2;
 * docs/design/mvp-pipeline.md section 3): the knowledge pack of the site at
 * its base head, from `GET /api/gateway/knowledge`, cached in the company
 * store by commit (`site_knowledge`), and the orchestrator bound to it.
 *
 * - `SiteKnowledgeKeeper` holds the pack in use. `refresh(reason)` asks the
 *   server with `If-None-Match` (the ETag is the commit): a 304 keeps the
 *   pack, a 200 stores and uses the new one. A refresh that fails (network,
 *   server, lease) keeps the last good pack: this session's, or the store's
 *   from an earlier session. It never rejects; the failure is in `status()`
 *   and reported once per failure streak through `onError` (the HUD toast).
 * - `SiteOrchestrator` is the `OrchestratorLike` the loop runs jobs on. It
 *   refreshes before every standup job, and before any job when it has no
 *   pack yet; it rebinds orchestrator-wasm (a new `OrchestratorHandle` with
 *   `knowledge_pack`) at the next job after the pack changed. Without any
 *   pack a standup, draft or review job fails loudly (CLAUDE.md rule 11:
 *   the loop retries, then reports it failed); a publish job runs without.
 * - `refetchAfterMerge` refreshes after each merge through the gateway; the
 *   session also refreshes when a `DeployLanded` event arrives.
 *
 * The refetch points: session start (before the first standup), every
 * standup job, every merge, every `DeployLanded`.
 */
import type { KnowledgeFetch, OrchestratorGateway } from '../net/central'
import type { OrchestratorLike, SiteBindingJson } from '../orchestrator/bridge'
import type { SiteKnowledgeRow } from '../store/company-store'

/** The site's house style inside a pack. */
export const STYLE_GUIDE_PATH = 'content/config/style-guide.json'

/** What a keeper fetches with: the central client with the lease token bound. */
export interface KnowledgeClient {
  knowledge(etag?: string | null): Promise<KnowledgeFetch | 'not-modified'>
}

/** Where packs are kept (CompanyStore). */
export interface KnowledgeStore {
  putKnowledge(row: { commit: string; etag: string; pack: string }): Promise<void>
  latestKnowledge(): Promise<SiteKnowledgeRow | null>
}

export type KnowledgeReason = 'start' | 'standup' | 'job' | 'merge' | 'deploy'
export type RefreshResult = 'fetched' | 'not-modified' | 'failed'

/** The pack in use. */
export interface SitePack {
  commit: string
  etag: string
  /** The pack's JSON text, verbatim (what orchestrator-wasm loads). */
  text: string
  fetchedAt: number
  /** `content/config/style-guide.json` of the pack, parsed; null when the site has none. */
  styleGuide: unknown | null
}

export interface KnowledgeStatus {
  commit: string | null
  /** Where the pack in use came from: fetched by this session, or the store's (an earlier session's); null without one. */
  source: 'network' | 'store' | null
  fetchedAt: number | null
  /** Why the last refresh failed; null after one that worked. */
  error: string | null
  /** The last refreshes, oldest first (at most 20). */
  refreshes: { reason: KnowledgeReason; result: RefreshResult }[]
}

export interface KeeperOptions {
  /** A refresh that takes longer counts as failed (the job then runs on the last good pack). Default 15 s. */
  timeoutMs?: number
  /** Called once per failure streak (and on every failure while there is no pack at all). */
  onError?: (message: string) => void
  log?: (line: string) => void
}

const KEEP_REFRESHES = 20

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** The style guide file of a pack's JSON text, parsed; null when absent or not JSON. */
export function packStyleGuide(packText: string): unknown | null {
  try {
    const files = (JSON.parse(packText) as { files?: Record<string, unknown> }).files
    const text = files?.[STYLE_GUIDE_PATH]
    return typeof text === 'string' ? (JSON.parse(text) as unknown) : null
  } catch {
    return null
  }
}

const short = (commit: string) => commit.slice(0, 7)

export class SiteKnowledgeKeeper {
  private pack: SitePack | null = null
  private source: KnowledgeStatus['source'] = null
  private error: string | null = null
  private refreshes: KnowledgeStatus['refreshes'] = []
  private inFlight: Promise<RefreshResult> | null = null
  private queued: Promise<RefreshResult> | null = null
  private listeners = new Set<(pack: SitePack) => void>()
  private log: (line: string) => void

  /** `client` null: this session may not fetch (read-only); only the store's pack is used. */
  constructor(
    private client: KnowledgeClient | null,
    private store: KnowledgeStore,
    private opts: KeeperOptions = {},
  ) {
    this.log = opts.log ?? (() => undefined)
  }

  get current(): SitePack | null {
    return this.pack
  }

  status(): KnowledgeStatus {
    return {
      commit: this.pack?.commit ?? null,
      source: this.source,
      fetchedAt: this.pack?.fetchedAt ?? null,
      error: this.error,
      refreshes: this.refreshes.map((r) => ({ ...r })),
    }
  }

  /** Called with the new pack whenever the pack in use changes. */
  onChange(fn: (pack: SitePack) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /** Takes the newest pack of the store (an earlier session's), if there is one and none is held. */
  async load(): Promise<SitePack | null> {
    if (this.pack) return this.pack
    const row = await this.store.latestKnowledge()
    if (row && !this.pack) {
      this.use({ commit: row.commit, etag: row.etag, text: row.pack, fetchedAt: row.fetchedAt }, 'store')
      this.log(`site knowledge: the stored pack of ${short(row.commit)}`)
    }
    return this.pack
  }

  /**
   * Asks the server for the pack (with `If-None-Match`). Never rejects. A
   * refresh asked for while one is in flight runs after it, since that one
   * may have started before the change that prompted this one (a merge);
   * every further call until then shares that follow-up.
   */
  refresh(reason: KnowledgeReason): Promise<RefreshResult> {
    if (!this.inFlight) return this.start(reason)
    this.queued ??= this.inFlight.then(() => {
      this.queued = null
      return this.start(reason)
    })
    return this.queued
  }

  /** Resolves once no refresh is in flight or queued. */
  async idle(): Promise<void> {
    while (this.inFlight || this.queued) await (this.queued ?? this.inFlight)
  }

  private start(reason: KnowledgeReason): Promise<RefreshResult> {
    const p: Promise<RefreshResult> = this.fetch(reason).finally(() => {
      if (this.inFlight === p) this.inFlight = null
    })
    this.inFlight = p
    return p
  }

  private async fetch(reason: KnowledgeReason): Promise<RefreshResult> {
    let result: RefreshResult
    try {
      if (!this.client) throw new Error('this session does not run the company (read-only)')
      const client = this.client
      const timeoutMs = this.opts.timeoutMs ?? 15_000
      let timer: ReturnType<typeof setTimeout> | undefined
      const answer = await Promise.race([
        client.knowledge(this.pack?.etag ?? null),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`no answer within ${Math.round(timeoutMs / 1000)} s`)), timeoutMs)
        }),
      ]).finally(() => clearTimeout(timer))
      if (answer === 'not-modified') {
        // The pack held is the head's: from the store, it is now confirmed.
        if (this.pack) this.source = 'network'
        result = 'not-modified'
      } else {
        await this.store.putKnowledge({ commit: answer.commit, etag: answer.etag, pack: answer.pack })
        const changed = answer.commit !== this.pack?.commit
        this.use({ commit: answer.commit, etag: answer.etag, text: answer.pack, fetchedAt: Date.now() }, 'network', changed)
        if (changed) this.log(`site knowledge: the pack of ${short(answer.commit)} (${reason})`)
        result = 'fetched'
      }
      this.error = null
    } catch (e) {
      result = 'failed'
      const first = this.error == null
      this.error = message(e)
      const held = this.pack
        ? `working from the pack of commit ${short(this.pack.commit)}${this.source === 'store' ? ' (stored by an earlier session)' : ''}`
        : 'there is no site knowledge yet: standups, drafts and reviews wait for it'
      const text = `Site knowledge was not refreshed (${reason}): ${this.error}; ${held}.`
      this.log(text)
      if (first || !this.pack) this.opts.onError?.(text)
    }
    this.refreshes.push({ reason, result })
    if (this.refreshes.length > KEEP_REFRESHES) this.refreshes.splice(0, this.refreshes.length - KEEP_REFRESHES)
    return result
  }

  private use(p: Omit<SitePack, 'styleGuide'>, source: 'network' | 'store', changed = true) {
    const styleGuide = changed || !this.pack ? packStyleGuide(p.text) : this.pack.styleGuide
    this.pack = { ...p, styleGuide }
    this.source = source
    if (changed) this.listeners.forEach((l) => l(this.pack!))
  }
}

/** An orchestrator-wasm handle (`OrchestratorHandle`). */
export type OrchestratorHandleLike = OrchestratorLike & { free?(): void; siteSummary?(): string }

export interface SiteOrchestratorOptions {
  keeper: SiteKnowledgeKeeper
  /** The binding without a pack; `knowledge_pack` is added from the keeper. */
  site: SiteBindingJson
  /** Builds a handle for a binding (`createOrchestrator`). */
  create: (site: SiteBindingJson) => Promise<OrchestratorHandleLike>
  log?: (line: string) => void
}

/** What `siteSummary()` of orchestrator-wasm reports. */
export interface SiteSummary {
  site_id: string
  commit: string | null
  pages: number | null
  media: number | null
  entities: number | null
  blog_index: boolean | null
  style_guide: 'pack' | 'binding' | 'absent'
  writer_prompt: 'pack' | 'binding' | 'absent'
}

/** Job kinds that need the site's knowledge (a publish only merges). */
const NEEDS_KNOWLEDGE = new Set(['standup', 'draft', 'review'])

export class SiteOrchestrator implements OrchestratorLike {
  private handle: OrchestratorHandleLike | null = null
  /** The commit the handle was built with (null: without a pack). */
  private bound: string | null = null
  private log: (line: string) => void

  constructor(private o: SiteOrchestratorOptions) {
    this.log = o.log ?? (() => undefined)
  }

  /** The commit of the pack the orchestrator is bound to; null without one (or before the first bind). */
  get commit(): string | null {
    return this.handle ? this.bound : null
  }

  /** The bound handle's `siteSummary()`, parsed; null before the first bind. */
  summary(): SiteSummary | null {
    const text = this.handle?.siteSummary?.()
    return text ? (JSON.parse(text) as SiteSummary) : null
  }

  /** The handle for the keeper's current pack: the one held, or a new one when the pack changed. */
  async bind(): Promise<OrchestratorHandleLike> {
    const pack = this.o.keeper.current
    const commit = pack?.commit ?? null
    if (this.handle && this.bound === commit) return this.handle
    const next = await this.o.create({ ...this.o.site, knowledge_pack: pack?.text ?? null })
    const old = this.handle
    this.handle = next
    this.bound = commit
    // Jobs never overlap on one handle and the loop runs one at a time, so
    // nothing runs on the old handle here (a run that outlived its limit
    // keeps what it needs alive inside the wasm module).
    old?.free?.()
    this.log(commit ? `orchestrator bound to the site at ${short(commit)}` : 'orchestrator bound without site knowledge')
    return next
  }

  async run(jobJson: string): Promise<string> {
    const kind = (JSON.parse(jobJson) as { kind?: string }).kind ?? ''
    const keeper = this.o.keeper
    // Before each standup: what the site is now (another device, or a person, may have merged).
    if (kind === 'standup') await keeper.refresh('standup')
    if (NEEDS_KNOWLEDGE.has(kind) && !keeper.current) {
      await keeper.refresh('job')
      if (!keeper.current) {
        throw new Error(`no site knowledge for the ${kind} job: ${keeper.status().error ?? 'the knowledge pack was never fetched'}`)
      }
    }
    const handle = await this.bind()
    return handle.run(jobJson)
  }
}

/**
 * The session's event hook: a `DeployLanded` (a merge of this or another
 * executor went live) refreshes the pack, unless the session may not fetch.
 */
export function refetchOnDeploy(keeper: SiteKnowledgeKeeper, mayFetch: () => boolean): (ev: { kind: string }) => void {
  return (ev) => {
    if (ev.kind === 'DeployLanded' && mayFetch()) void keeper.refresh('deploy')
  }
}

/** The gateway with a knowledge refresh after every merge (the base head moved). */
export function refetchAfterMerge(inner: OrchestratorGateway, keeper: SiteKnowledgeKeeper): OrchestratorGateway {
  return {
    openDraft: (...args) => inner.openDraft(...args),
    async merge(number, headSha, attribution) {
      const sha = await inner.merge(number, headSha, attribution)
      void keeper.refresh('merge')
      return sha
    },
  }
}
