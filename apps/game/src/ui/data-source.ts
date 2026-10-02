import type { CommandResult } from './commands'
import type { Persona } from './personas'
import type { PlanStore } from './plan-store'
import type { PlanJson } from './plan-types'
import type { FinanceJson, InboxJson, OrgJson, PerformanceJson } from './types'

/**
 * Where the overlay reads the company from and sends CEO commands to.
 * `MockDataSource` (fixtures) and `WasmDataSource` (the sim) implement it;
 * panels only ever talk to this interface (ADR-0018: the overlay never
 * mutates the sim directly).
 */
export interface GameDataSource {
  getOrg(): OrgJson
  getFinance(): FinanceJson
  getInbox(): InboxJson
  /** `Sim.plan_json()`: the deterministic plan skeleton (publishing-plan.md §7). */
  getPlan(): PlanJson
  /** Plan text (titles, briefs, threads) keyed by the skeleton's ids. */
  readonly planStore: PlanStore
  /** KPIs from the first-party tracker + the latest KpiReport (organization.md §6a). */
  getPerformance(): PerformanceJson
  getPersona(slug: string): Persona | undefined
  listPersonas(): Persona[]
  /** Apply a command (JSON, serde external tagging; see commands.ts). */
  apply(commandJson: string): CommandResult
  /** Would the command apply? Never mutates. */
  validate(commandJson: string): CommandResult
  /** Called whenever org/finance/inbox may have changed. Returns an unsubscribe function. */
  subscribe(onChange: () => void): () => void
  /** Absolute game minute (day * 1440 + minute of day), for ticket deadlines. */
  now(): number
}
