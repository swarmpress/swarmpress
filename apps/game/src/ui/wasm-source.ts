import type { CommandResult } from './commands'
import type { DataTopic, GameDataSource, NewPlanPost } from './data-source'
import { loadPersonaCatalog, type Persona } from './personas'
import { MemoryPlanStore, type PlanStore } from './plan-store'
import type { PlanJson, PlanPost, PlanText } from './plan-types'
import { EMPTY_PLAN, EMPTY_PLAN_TEXT, normalizePlanText, splitPlanJson, type PlanTextWire } from './plan-wire'
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

const EMPTY_PERFORMANCE: PerformanceJson = { asOfDay: 0, projects: [], report: null }

export interface WasmOptions {
  personas?: Persona[]
  /**
   * Plan text when it lives outside `plan_json` (the browser's Turso store or
   * the server's plan endpoint), in the orchestrator wire shape.
   */
  planText?: () => Promise<PlanTextWire | PlanText>
  /**
   * Persist a CEO post; defaults to an in-memory list next to the store's
   * text (the CompanyStore only accepts the orchestrator's post types).
   */
  appendPost?: (item: string, post: NewPlanPost) => Promise<PlanPost>
  /** KPIs come from the tracker + KpiReport, not the sim. */
  performance?: () => Promise<PerformanceJson>
  /** Poll interval for change detection (the sim has no change events). */
  pollMs?: number
}

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
  private timer: ReturnType<typeof setInterval> | null = null
  /** CEO posts and text when no external store is wired (offline sandbox). */
  private local: PlanStore = new MemoryPlanStore(EMPTY_PLAN_TEXT)

  constructor(
    private sim: SimOrgApi,
    private opts: WasmOptions = {},
  ) {
    this.personas = opts.personas ?? loadPersonaCatalog().personas
    this.local.subscribe(() => this.emit(['plan']))
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
    if (r.ok) this.poll()
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

  private poll() {
    const changed = this.refresh()
    if (changed.length) this.emit(changed)
    else if (this.listeners.size) this.emit(['clock'])
  }

  private read(): Parsed {
    if (!this.parsed) this.refresh()
    return this.parsed!
  }

  /** Re-read the JSON views; returns what changed. */
  private refresh(): DataTopic[] {
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
