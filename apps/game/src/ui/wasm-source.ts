import type { CommandResult } from './commands'
import type { GameDataSource } from './data-source'
import { loadPersonaCatalog, type Persona } from './personas'
import { MemoryPlanStore, type PlanStore } from './plan-store'
import type { PlanJson } from './plan-types'
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
  /** Applies a JSON command (serde external tagging); throws the reason string when rejected. */
  apply_command_json(json: string): void
  /** `undefined` when the command would apply, else the reason. */
  validate_command_json(json: string): string | undefined
  /** Plan skeleton; optional until the plan lands in sim-core. */
  plan_json?(project?: string): string
  day(): number
  minute_of_day(): number
  step?(): bigint
}

export function hasOrgApi(sim: unknown): sim is SimOrgApi {
  const s = sim as Partial<Record<keyof SimOrgApi, unknown>> | null
  return (
    !!s &&
    typeof s.org_json === 'function' &&
    typeof s.finance_json === 'function' &&
    typeof s.inbox_json === 'function' &&
    typeof s.apply_command_json === 'function' &&
    typeof s.validate_command_json === 'function'
  )
}

const EMPTY_PLAN: PlanJson = { goals: [], workstreams: [], items: [] }
const EMPTY_PERFORMANCE: PerformanceJson = { asOfDay: 0, projects: [], report: null }

export interface WasmOptions {
  personas?: Persona[]
  /** Plan text: the server's plan store online, an in-memory store offline. */
  planStore?: PlanStore
  /** KPIs come from the server (analytics_daily + KpiReport), not the sim. */
  performance?: () => PerformanceJson
  /** Poll interval for change detection (the sim has no change events). */
  pollMs?: number
}

/** Reads the company from the wasm sim replica; every action goes through `apply_command_json`. */
export class WasmDataSource implements GameDataSource {
  readonly planStore: PlanStore
  private personas: Persona[]
  private listeners = new Set<() => void>()
  private cache: { org: string; finance: string; inbox: string; plan: string } = { org: '', finance: '', inbox: '', plan: '' }
  private parsed!: { org: OrgJson; finance: FinanceJson; inbox: InboxJson; plan: PlanJson }
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(
    private sim: SimOrgApi,
    private opts: WasmOptions = {},
  ) {
    this.personas = opts.personas ?? loadPersonaCatalog().personas
    this.planStore = opts.planStore ?? new MemoryPlanStore({ items: {}, todos: {}, workstreams: {}, goals: {}, posts: {} })
    this.planStore.subscribe(() => this.emit())
    this.refresh()
  }

  getOrg() {
    return this.parsed.org
  }
  getFinance() {
    return this.parsed.finance
  }
  getInbox() {
    return this.parsed.inbox
  }
  getPlan() {
    return this.parsed.plan
  }
  getPerformance() {
    return this.opts.performance?.() ?? EMPTY_PERFORMANCE
  }
  getPersona(slug: string) {
    return this.personas.find((p) => p.slug === slug)
  }
  listPersonas() {
    return this.personas
  }
  now() {
    return this.sim.day() * 1440 + this.sim.minute_of_day()
  }

  validate(commandJson: string): CommandResult {
    const reason = this.sim.validate_command_json(commandJson)
    return reason == null ? { ok: true } : { ok: false, reason }
  }

  apply(commandJson: string): CommandResult {
    try {
      this.sim.apply_command_json(commandJson)
    } catch (e) {
      return { ok: false, reason: typeof e === 'string' ? e : (e as Error).message }
    }
    if (this.refresh()) this.emit()
    return { ok: true }
  }

  subscribe(onChange: () => void) {
    this.listeners.add(onChange)
    if (!this.timer)
      this.timer = setInterval(() => {
        if (this.refresh()) this.emit()
      }, this.opts.pollMs ?? 1000)
    return () => {
      this.listeners.delete(onChange)
      if (this.listeners.size === 0 && this.timer) {
        clearInterval(this.timer)
        this.timer = null
      }
    }
  }

  /** Re-read the JSON views; true when anything changed. */
  private refresh(): boolean {
    const next = {
      org: this.sim.org_json(),
      finance: this.sim.finance_json(),
      inbox: this.sim.inbox_json(),
      plan: this.sim.plan_json?.() ?? '',
    }
    const changed = (Object.keys(next) as Array<keyof typeof next>).filter((k) => next[k] !== this.cache[k])
    if (changed.length === 0 && this.parsed) return false
    this.cache = next
    this.parsed = {
      org: JSON.parse(next.org) as OrgJson,
      finance: JSON.parse(next.finance) as FinanceJson,
      inbox: JSON.parse(next.inbox) as InboxJson,
      plan: next.plan ? (JSON.parse(next.plan) as PlanJson) : EMPTY_PLAN,
    }
    return true
  }

  private emit() {
    this.listeners.forEach((l) => l())
  }
}
