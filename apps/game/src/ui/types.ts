/**
 * The UI-facing data contract of the CEO overlay
 * (docs/game-design/organization.md §9). Shapes mirror `Sim.org_json()`,
 * `Sim.finance_json()` and `Sim.inbox_json()`: metres and euros at the
 * boundary, ids as strings (`staff-1`, `project-1`, `ticket-3`).
 *
 * Fields marked "UI extension" are not in the §9 sketch yet. They are optional
 * so the overlay works without them; the sim may add them later.
 */

export type DepartmentId =
  | 'executive'
  | 'strategy'
  | 'editorial'
  | 'photo-video'
  | 'web-development'
  | 'it-operations'
  | 'seo-marketing'

export type Seniority = 'junior' | 'mid' | 'senior' | 'star'

/** Wire form of the secretary delegation policy (§7). */
export type Delegation = 'off' | 'low' | 'low-and-medium'

export type ProjectStatus = 'proposed' | 'active' | 'paused' | 'archived'

export type Priority = 'high' | 'medium' | 'low'

export interface Allocation {
  project: string
  allocation: number
}

export interface StaffJson {
  id: string
  /** Persona slug in the catalog (crates/agents/personas/<slug>.toml). */
  persona: string
  /** Sim `Role` as the views' kebab-case slug (`writer`, `editor-in-chief`, `data-scientist`). */
  role: string
  department: DepartmentId | string
  seniority: Seniority
  salaryEurMonth: number
  /** 0..1 */
  morale: number
  /** 0..1 */
  fatigue: number
  activity: string
  projects: Allocation[]
}

export interface DepartmentJson {
  id: DepartmentId | string
  name: string
  head: string | null
  members: string[]
}

export interface TeamMember {
  staff: string
  allocation: number
}

export interface ProjectJson {
  id: string
  slug: string
  name: string
  domain: string
  status: ProjectStatus
  lead: string | null
  team: TeamMember[]
  budgetEurMonth: number
  missingRoles: string[]
  /** First-party tracker summary (organization.md §6a, ADR-0032). */
  analytics?: ProjectAnalyticsJson
}

export interface ProjectAnalyticsJson {
  /** false until the site's own tracker has reported data. */
  connected: boolean
  sessions7d: number
  visitors7d: number
  pageviews7d: number
  /** 0..1 */
  engagementRate: number
}

export interface CandidateJson {
  /** Command id for `Hire{candidate}`. */
  id: string
  persona: string
  askingEurMonth: number
  /** CFO `HiringAffordability` note, when a CFO is employed. */
  affordability?: string | null
}

export interface OrgJson {
  ceo: { name: string }
  executive: { cfo: string | null; secretary: string | null; delegation: Delegation }
  departments: DepartmentJson[]
  staff: StaffJson[]
  projects: ProjectJson[]
  /** UI extension: company level and the project cap it unlocks (§4). */
  company?: { level: number; maxProjects: number }
  /** UI extension: the current hiring pool; otherwise derived from the catalog (ids ≥ 100). */
  candidates?: CandidateJson[]
}

export interface CompanyPnl {
  revenueEur: number
  salariesEur: number
  rentEur: number
  upkeepEur: number
  agencyEur: number
}

export interface ProjectFinance {
  id: string
  budgetEurMonth: number
  spentEurMonth: number
  revenueEurMonth: number
  overBudget: boolean
}

export type AlertKind = 'runway-low' | 'budget-overrun' | 'payroll-jump' | 'cash-negative' | string

export interface FinanceAlert {
  kind: AlertKind
  project: string | null
  ticket: string | null
}

export interface FinanceJson {
  cashEur: number
  runwayDays: number | null
  dailyBurnEur: number
  month: number
  company: CompanyPnl
  projects: ProjectFinance[]
  alerts: FinanceAlert[]
  /** Sim (client-wasm README): true when nobody keeps the books (no CFO, §6). */
  booksUnkept?: boolean
  /** Mock fixtures' older spelling of `!booksUnkept`. */
  booksKept?: boolean
  /** UI extension: the CFO's monthly narrative (`FinanceReport`). */
  report?: string | null
}

export type TicketStatus = 'open' | 'resolved' | string

export interface TicketJson {
  id: string
  kind: string
  priority: Priority
  project: string | null
  from: string | null
  status: TicketStatus
  routedViaSecretary: boolean
  options: string[]
  defaultOption: string | null
  /** Absolute game minute (day * 1440 + minute of day) the default option fires. */
  deadlineMinute: number | null
  /** UI extension: the secretary's one-paragraph summary (resolved from `summary_ref`). */
  summary?: string | null
  /** UI extension: who answered a resolved ticket. */
  resolvedBy?: 'ceo' | 'secretary' | 'default' | null
  /** UI extension: the option that was taken. */
  answer?: string | null
  /** UI extension: the option the secretary proposes. */
  proposedOption?: string | null
}

export interface SecretaryTaskJson {
  id: string
  kind: string
  status: 'queued' | 'working' | 'done' | string
  /** UI extension: human-readable detail ("Briefing for cinqueterre.travel"). */
  detail?: string | null
}

export interface InboxJson {
  delegation: Delegation
  tickets: TicketJson[]
  secretaryQueue: SecretaryTaskJson[]
}

/* ------------------------------------------------------------------------
 * Performance (KPIs from the first-party tracker; organization.md §6a,
 * ADR-0032). Server data (analytics_daily + the data scientist's KpiReport);
 * not part of the deterministic sim.
 * --------------------------------------------------------------------- */

export interface KpiWindow {
  sessions: number
  visitors: number
  pageviews: number
  /** 0..1 */
  engagementRate: number
  /** Average scroll depth, 0..1 */
  scrollDepth: number
  outboundClicks: number
}

export interface PageKpi {
  path: string
  views: number
  engagementRate: number
}

export interface ProjectPerformanceJson {
  project: string
  connected: boolean
  /** Game days of the daily series (oldest first). */
  days?: number[]
  daily?: { sessions: number[]; visitors: number[]; pageviews: number[]; engagementRate: number[] }
  last7?: KpiWindow
  prev7?: KpiWindow
  last30?: KpiWindow
  topPages?: PageKpi[]
  bottomPages?: PageKpi[]
  languages?: Array<{ lang: string; share: number }>
  sources?: Array<{ source: string; share: number }>
}

export interface KpiReportJson {
  author: string
  week: number
  day: number
  project: string | null
  headline: string
  observations: string[]
  recommendations: string[]
}

export interface PerformanceJson {
  asOfDay: number
  projects: ProjectPerformanceJson[]
  /** Latest `KpiReport` from the data scientist; null when none is employed. */
  report: KpiReportJson | null
}
