import { SIM_COMMANDS, type CommandResult } from './commands'
import {
  NO_SITE_LINKS,
  type ArticleBrief,
  type ArticleRecord,
  type ArticleReview,
  type DataTopic,
  type GameDataSource,
  type NewPlanPost,
  type SiteLinks,
  type SourceCapabilities,
} from './data-source'
import { loadPersonaCatalog, type Persona } from './personas'
import { MemoryPlanStore, type PlanStore } from './plan-store'
import type { PlanJson, PlanPost, PlanText } from './plan-types'
import { EMPTY_PLAN, EMPTY_PLAN_TEXT, normalizePlanText, normalizePost, splitPlanJson, toStorePost, type PlanTextWire } from './plan-wire'
import type { FinanceJson, InboxJson, OrgJson, PerformanceJson } from './types'

/**
 * The organization surface of `Sim` (client-wasm) the overlay needs
 * (organization.md §9, publishing-plan.md §7). Typed structurally here
 * because the generated client-wasm typings don't have these methods yet;
 * `hasOrgApi()` feature-detects them at runtime.
 */
export interface SimOrgApi {
  org_json(): string
  finance_json(): string
  inbox_json(): string
  /**
   * Applies a JSON command (serde external tagging). Rejections either throw
   * the reason or return it (a string, or `{"ok":false,"reason":…}` JSON);
   * `undefined`, `true`, `""` or `{"ok":true}` mean applied.
   */
  apply_command_json(json: string): unknown
  /** Same result convention as `apply_command_json`, never mutates. Optional. */
  validate_command_json?(json: string): unknown
  /**
   * The plan: either the skeleton (`items` array, publishing-plan.md §7) or
   * the text document in the orchestrator's shape (`items` map + `posts`).
   */
  plan_json?(): string
  day(): number
  minute_of_day(): number
  /** The sim step (the wasm `Sim` has it): the poll's default change key. */
  step?(): number | bigint
}

export function hasOrgApi(sim: unknown): sim is SimOrgApi {
  const s = sim as Partial<Record<keyof SimOrgApi, unknown>> | null
  return (
    !!s &&
    typeof s.org_json === 'function' &&
    typeof s.finance_json === 'function' &&
    typeof s.inbox_json === 'function' &&
    typeof s.apply_command_json === 'function'
  )
}

/** Interpret an `apply_command_json` / `validate_command_json` return value. */
export function toResult(v: unknown): CommandResult {
  if (v === undefined || v === null || v === true || v === '') return { ok: true }
  if (v === false) return { ok: false, reason: 'Rejected' }
  if (typeof v === 'string') {
    try {
      const o = JSON.parse(v) as unknown
      if (o && typeof o === 'object' && 'ok' in o) return toResult(o)
      if (o === null || o === true) return { ok: true }
    } catch {
      /* a plain reason string */
    }
    return { ok: false, reason: v }
  }
  if (typeof v === 'object' && 'ok' in v) {
    const r = v as { ok: unknown; reason?: unknown; error?: unknown }
    if (r.ok) return { ok: true }
    return { ok: false, reason: String(r.reason ?? r.error ?? 'Rejected') }
  }
  return { ok: true }
}

/**
 * Plan text from the browser's CompanyStore (apps/game/src/store), which
 * implements the orchestrator's `Store::plan_json` contract. Typed
 * structurally so the overlay does not depend on the store module.
 */
export const planTextFromStore =
  (store: { planJson(company: string): Promise<string> }, company: string) => async (): Promise<PlanTextWire> =>
    JSON.parse(await store.planJson(company)) as PlanTextWire

/** The part of the CompanyStore the overlay reads and writes plan text through. */
export interface PlanTextStore {
  planJson(company: string): Promise<string>
  /** `Store::append_post`: appends a post to an item's thread and returns its id. */
  appendPost(company: string, item: string, postJson: string): Promise<string>
}

/**
 * CEO posts kept in the CompanyStore through its post API, so they are part
 * of the plan text the next `planJson` returns (and survive a reload). See
 * `toStorePost` for how a comment fits the store's post types.
 */
export const ceoPostsToStore =
  (store: PlanTextStore, company: string) =>
  async (item: string, post: NewPlanPost): Promise<PlanPost> => {
    const wire = toStorePost(post)
    const id = await store.appendPost(company, item, JSON.stringify(wire))
    return normalizePost({ ...wire, id }, item, 0)
  }

/** The part of the CompanyStore an article is read from: the orchestrator's artifact and brief records, as JSON text. */
export interface ArticleStore {
  getArtifact(company: string, workItem: string): Promise<string | null>
  /** `briefRef` is the decimal text of the u64 reference. */
  getBrief(company: string, briefRef: string): Promise<string | null>
}

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null)
const strOrNull = (v: unknown) => (typeof v === 'string' && v ? v : null)
const numOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** A review issue: a string today, `{section, problem, fix}` once issues are tagged by section (increment P3). */
function issueText(v: unknown): string {
  if (typeof v === 'string') return v
  const o = obj(v)
  if (!o) return ''
  const where = strOrNull(o.section)
  const fix = strOrNull(o.fix)
  return `${where ? `[${where}] ` : ''}${strOrNull(o.problem) ?? ''}${fix ? ` Fix: ${fix}` : ''}`.trim()
}
const issues = (v: unknown) => (Array.isArray(v) ? v : []).map(issueText).filter(Boolean)

/**
 * The digits of the number under a top-level `key` of a JSON object, read
 * from the text. An artifact record's `brief_ref` is a u64, which
 * `JSON.parse` would round; the page inside the record may hold the same key
 * deeper down, so nesting is tracked.
 */
export function topLevelNumber(json: string, key: string): string | null {
  let depth = 0
  for (let i = 0; i < json.length; i++) {
    const c = json[i]
    if (c === '{' || c === '[') depth++
    else if (c === '}' || c === ']') depth--
    else if (c === '"') {
      const start = i + 1
      for (i = start; i < json.length && json[i] !== '"'; i++) if (json[i] === '\\') i++
      if (depth !== 1 || json.slice(start, i) !== key) continue
      const m = /^\s*:\s*(\d+)\s*[,}]/.exec(json.slice(i + 1, i + 48))
      if (m) return m[1]
    }
  }
  return null
}

function toReview(v: unknown): ArticleReview | null {
  const r = obj(v)
  if (!r) return null
  return { decision: strOrNull(r.decision) ?? '', score: numOrNull(r.score) ?? 0, notes: strOrNull(r.notes) ?? '', issues: issues(r.issues), highRisk: issues(r.high_risk) }
}

function toBrief(v: unknown): ArticleBrief | null {
  const b = obj(v)
  if (!b) return null
  const target = numOrNull(b.target_words)
  return {
    title: strOrNull(b.title) ?? '',
    angle: strOrNull(b.angle) ?? '',
    slug: strOrNull(b.slug),
    keywords: (Array.isArray(b.keywords) ? b.keywords : []).filter((k): k is string => typeof k === 'string'),
    targetWords: target != null && target > 0 ? target : null,
  }
}

/** An `ArtifactRecord` and its `BriefRecord` (crates/orchestrator/src/store.rs), as parsed JSON, in the overlay's shape. */
export function toArticleRecord(artifact: unknown, briefRecord: unknown): ArticleRecord {
  const a = obj(artifact) ?? {}
  const b = obj(briefRecord)
  return {
    page: a.page ?? null,
    review: toReview(a.review),
    revision: numOrNull(a.revision) ?? 0,
    path: strOrNull(a.path),
    branch: strOrNull(a.branch),
    pr: numOrNull(a.pr_number),
    headSha: strOrNull(a.head_sha),
    mergedSha: strOrNull(a.merged_sha),
    brief: toBrief(b?.brief),
    writer: strOrNull(b?.writer),
    editor: strOrNull(b?.editor),
  }
}

/**
 * Articles read from the CompanyStore. A record is parsed again only when its
 * text in the store changed, so an unchanged article is the same object on
 * every read (the overlay store re-renders on identity).
 */
export const articleFromStore = (store: ArticleStore, company: string) => {
  const seen = new Map<string, { text: string; record: ArticleRecord }>()
  return async (item: string): Promise<ArticleRecord | null> => {
    const text = await store.getArtifact(company, item)
    if (text == null) {
      seen.delete(item)
      return null
    }
    const have = seen.get(item)
    if (have?.text === text) return have.record
    const ref = topLevelNumber(text, 'brief_ref')
    const brief = ref ? await store.getBrief(company, ref) : null
    const record = toArticleRecord(JSON.parse(text), brief ? JSON.parse(brief) : null)
    seen.set(item, { text, record })
    return record
  }
}

/** The banned phrases of a site style guide (`vocabulary.avoid`, what `agents::StyleGuide::banned_phrases` reads); null without a list. */
export function bannedPhrasesOf(styleGuide: unknown): string[] | null {
  const avoid = obj(obj(styleGuide)?.vocabulary)?.avoid
  if (!Array.isArray(avoid)) return null
  return avoid.filter((p): p is string => typeof p === 'string' && p.trim() !== '')
}

/**
 * What a session's data source takes from its company: plan text read from
 * and CEO posts written to the CompanyStore, the articles (artifact and brief
 * records) when the store has them, the site repository of the company row
 * for pull-request links, and the banned phrases of the site binding's style
 * guide. The public address of the site is not part of the company row (see
 * `SiteLinks.publicBaseUrl`).
 */
export function companyStoreOptions(
  store: PlanTextStore & Partial<ArticleStore>,
  company: { id: string; site_repo?: string | null },
  site: { style_guide?: unknown } = {},
): Pick<WasmOptions, 'planText' | 'appendPost' | 'site' | 'article' | 'bannedPhrases'> {
  const articles =
    store.getArtifact && store.getBrief
      ? articleFromStore({ getArtifact: (c, w) => store.getArtifact!(c, w), getBrief: (c, r) => store.getBrief!(c, r) }, company.id)
      : undefined
  return {
    planText: planTextFromStore(store, company.id),
    appendPost: ceoPostsToStore(store, company.id),
    site: { repo: company.site_repo || null },
    article: articles,
    bannedPhrases: bannedPhrasesOf(site.style_guide),
  }
}

const EMPTY_PERFORMANCE: PerformanceJson = { asOfDay: 0, projects: [], report: null }

export interface WasmOptions {
  personas?: Persona[]
  /**
   * Plan text when it lives outside `plan_json` (the browser's Turso store or
   * the server's plan endpoint), in the orchestrator wire shape.
   */
  planText?: () => Promise<PlanTextWire | PlanText>
  /**
   * Persist a CEO post (`ceoPostsToStore` for the CompanyStore). Without it
   * posts stay in an in-memory list next to the store's text and are lost on
   * reload (the offline sandbox).
   */
  appendPost?: (item: string, post: NewPlanPost) => Promise<PlanPost>
  /** KPIs come from the tracker + KpiReport, not the sim. Without it the Performance panel is not offered. */
  performance?: () => Promise<PerformanceJson>
  /** Poll interval for change detection (the sim has no change events). */
  pollMs?: number
  /** Command variants the sim has; defaults to `SIM_COMMANDS` (commands.ts). */
  commands?: readonly string[]
  /** Where pull requests and published pages live (session: the company row). */
  site?: Partial<SiteLinks>
  /** The article of a work item (`articleFromStore` for the CompanyStore). Without it no article is known. */
  article?: (item: string) => Promise<ArticleRecord | null>
  /** The house style's banned phrases (session: the site binding's style guide). */
  bannedPhrases?: readonly string[] | null
  /**
   * A cheap value that changes whenever the sim's JSON views may have
   * changed; the poll re-serialises them only then. Defaults to `sim.step()`
   * when the sim has it. A session whose loop applies commands between steps
   * (outcomes at a held clock) passes step plus the loop's command count.
   * Without either, the poll re-reads every time.
   */
  changeKey?: () => unknown
}

/** No change key: the views are re-read on every poll. */
const NO_KEY = Symbol('no-change-key')

interface Parsed {
  org: OrgJson
  finance: FinanceJson
  inbox: InboxJson
  plan: PlanJson
  planText: PlanText | null
}

/** Reads the company from the wasm sim; every action goes through `apply_command_json`. */
export class WasmDataSource implements GameDataSource {
  private personas: Persona[]
  private listeners = new Set<(topics?: DataTopic[]) => void>()
  private cache = { org: '', finance: '', inbox: '', plan: '' }
  private parsed: Parsed | null = null
  /** The change key the cached views were read at. */
  private readAt: unknown = NO_KEY
  private caps: SourceCapabilities
  private timer: ReturnType<typeof setInterval> | null = null
  /** CEO posts and text when no external store is wired (offline sandbox). */
  private local: PlanStore = new MemoryPlanStore(EMPTY_PLAN_TEXT)

  constructor(
    private sim: SimOrgApi,
    private opts: WasmOptions = {},
  ) {
    this.personas = opts.personas ?? loadPersonaCatalog().personas
    this.caps = {
      commands: new Set(opts.commands ?? SIM_COMMANDS),
      performance: !!opts.performance,
      site: { ...NO_SITE_LINKS, ...opts.site },
      bannedPhrases: opts.bannedPhrases ?? null,
    }
    this.local.subscribe(() => this.emit(['plan']))
  }

  capabilities() {
    return this.caps
  }

  async getOrg() {
    return this.read().org
  }
  async getFinance() {
    return this.read().finance
  }
  async getInbox() {
    return this.read().inbox
  }
  async getPlan() {
    return this.read().plan
  }
  async getPlanText(): Promise<PlanText> {
    const fromSim = this.read().planText
    const external = this.opts.planText ? normalizePlanText(await this.opts.planText()) : null
    const base = external ?? fromSim ?? EMPTY_PLAN_TEXT
    const mine = this.local.text()
    if (!Object.keys(mine.posts).length) return base
    const posts = { ...base.posts }
    for (const [id, list] of Object.entries(mine.posts)) posts[id] = [...(posts[id] ?? []), ...list]
    return { ...base, posts }
  }
  async getArticle(item: string): Promise<ArticleRecord | null> {
    return (await this.opts.article?.(item)) ?? null
  }
  async getPerformance() {
    return (await this.opts.performance?.()) ?? EMPTY_PERFORMANCE
  }
  async getPersona(slug: string) {
    return this.personas.find((p) => p.slug === slug)
  }
  async listPersonas() {
    return this.personas
  }
  async now() {
    return this.sim.day() * 1440 + this.sim.minute_of_day()
  }

  async validate(commandJson: string): Promise<CommandResult> {
    // Without a validator the sim is still the judge: apply() reports the rejection.
    if (!this.sim.validate_command_json) return { ok: true }
    try {
      return toResult(this.sim.validate_command_json(commandJson))
    } catch (e) {
      return { ok: false, reason: typeof e === 'string' ? e : (e as Error).message }
    }
  }

  async apply(commandJson: string): Promise<CommandResult> {
    let r: CommandResult
    try {
      r = toResult(this.sim.apply_command_json(commandJson))
    } catch (e) {
      return { ok: false, reason: typeof e === 'string' ? e : (e as Error).message }
    }
    // A command changes the views without the step moving.
    if (r.ok) this.poll(true)
    return r
  }

  async appendPost(item: string, post: NewPlanPost): Promise<PlanPost> {
    const now = await this.now()
    const full = { day: Math.floor(now / 1440), minute: now % 1440, ...post }
    if (this.opts.appendPost) {
      const saved = await this.opts.appendPost(item, full)
      this.emit(['plan'])
      return saved
    }
    return this.local.addPost(item, full)
  }

  subscribe(onChange: (topics?: DataTopic[]) => void) {
    this.listeners.add(onChange)
    if (!this.timer) this.timer = setInterval(() => this.poll(), this.opts.pollMs ?? 1000)
    return () => {
      this.listeners.delete(onChange)
      if (this.listeners.size === 0 && this.timer) {
        clearInterval(this.timer)
        this.timer = null
      }
    }
  }

  private changeKey(): unknown {
    if (this.opts.changeKey) return this.opts.changeKey()
    return typeof this.sim.step === 'function' ? this.sim.step() : NO_KEY
  }

  /**
   * Change detection. The views are a pure function of the sim state, so
   * while the change key stands still (a paused, held or resting clock)
   * nothing is serialised or parsed; subscribers still get their clock tick.
   */
  private poll(force = false) {
    const key = this.changeKey()
    const unchanged = !force && this.parsed !== null && key !== NO_KEY && key === this.readAt
    const changed = unchanged ? [] : this.refresh(key)
    if (changed.length) this.emit(changed)
    else if (this.listeners.size) this.emit(['clock'])
  }

  private read(): Parsed {
    if (!this.parsed) this.refresh()
    return this.parsed!
  }

  /** Re-read the JSON views; returns what changed. */
  private refresh(key: unknown = this.changeKey()): DataTopic[] {
    this.readAt = key
    const next = {
      org: this.sim.org_json(),
      finance: this.sim.finance_json(),
      inbox: this.sim.inbox_json(),
      plan: this.sim.plan_json?.() ?? '',
    }
    const changed = (Object.keys(next) as Array<keyof typeof next>).filter((k) => next[k] !== this.cache[k])
    if (changed.length === 0 && this.parsed) return []
    this.cache = next
    const plan = next.plan ? splitPlanJson(JSON.parse(next.plan)) : { skeleton: null, text: null }
    this.parsed = {
      org: JSON.parse(next.org) as OrgJson,
      finance: JSON.parse(next.finance) as FinanceJson,
      inbox: JSON.parse(next.inbox) as InboxJson,
      plan: plan.skeleton ?? EMPTY_PLAN,
      planText: plan.text,
    }
    return changed
  }

  private emit(topics?: DataTopic[]) {
    this.listeners.forEach((l) => l(topics))
  }
}
