import type { CommandResult } from './commands'
import type { Persona } from './personas'
import type { PlanJson, PlanPost, PlanText } from './plan-types'
import type { FinanceJson, InboxJson, OrgJson, PerformanceJson } from './types'

/** What changed, so a subscriber can re-read only that (a hint; `undefined` = anything). */
export type DataTopic = 'org' | 'finance' | 'inbox' | 'plan' | 'performance' | 'clock'

/** A post the CEO adds to a work item's thread (the source assigns `id`, and game time if missing). */
export type NewPlanPost = Omit<PlanPost, 'id'>

/**
 * Where the overlay reads the company from and sends CEO commands to
 * (ADR-0018: the overlay never mutates the sim directly).
 *
 * Every read is async so the live implementation can sit on the browser's
 * authoritative wasm sim plus its Turso store (or a server) without changing
 * the panels. The shapes are the JSON contracts of
 * docs/game-design/organization.md §9 (`org_json`, `finance_json`,
 * `inbox_json`) and docs/game-design/publishing-plan.md §7 (`plan_json`),
 * with plan text in the orchestrator's `plan_json` shape
 * (`{items:{id:{title,brief}}, posts:{id:[{type,author,to?,text,payload}]}}`,
 * normalized by plan-wire.ts).
 *
 * Implementations: `MockDataSource` (fixtures, in-memory rules) and
 * `WasmDataSource` (feature-detected `Sim.*_json` + `apply_command_json`).
 */
export interface GameDataSource {
  /** `Sim.org_json()` (organization.md §9). */
  getOrg(): Promise<OrgJson>
  /** `Sim.finance_json()` (organization.md §9). */
  getFinance(): Promise<FinanceJson>
  /** `Sim.inbox_json()` (organization.md §9). */
  getInbox(): Promise<InboxJson>
  /** Plan skeleton (publishing-plan.md §7); empty `items` when the sim exports none yet. */
  getPlan(): Promise<PlanJson>
  /** Plan text: titles, briefs, todo text and work-item threads, keyed by the skeleton's ids. */
  getPlanText(): Promise<PlanText>
  /** KPIs from the first-party tracker + the latest KpiReport (organization.md §6a). */
  getPerformance(): Promise<PerformanceJson>
  getPersona(slug: string): Promise<Persona | undefined>
  listPersonas(): Promise<Persona[]>
  /** Absolute game minute (day * 1440 + minute of day), for ticket deadlines. */
  now(): Promise<number>
  /** Apply a CEO command (JSON, serde external tagging; see commands.ts). */
  apply(commandJson: string): Promise<CommandResult>
  /** Would the command apply? Never mutates. */
  validate(commandJson: string): Promise<CommandResult>
  /** Append a CEO comment (or other post) to a work item's thread. Text only, never enters the sim. */
  appendPost(item: string, post: NewPlanPost): Promise<PlanPost>
  /**
   * Called whenever data may have changed (after `apply`, sim ticks, store
   * writes). `topics` is a hint. Returns an unsubscribe function.
   */
  subscribe(onChange: (topics?: DataTopic[]) => void): () => void
}

/** Everything the overlay renders from, read in one go. */
export interface GameSnapshot {
  org: OrgJson
  finance: FinanceJson
  inbox: InboxJson
  plan: PlanJson
  planText: PlanText
  performance: PerformanceJson
  personas: Persona[]
  now: number
}

export async function readSnapshot(source: GameDataSource): Promise<GameSnapshot> {
  const [org, finance, inbox, plan, planText, performance, personas, now] = await Promise.all([
    source.getOrg(),
    source.getFinance(),
    source.getInbox(),
    source.getPlan(),
    source.getPlanText(),
    source.getPerformance(),
    source.listPersonas(),
    source.now(),
  ])
  return { org, finance, inbox, plan, planText, performance, personas, now }
}
