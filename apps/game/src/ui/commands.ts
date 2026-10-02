/**
 * CEO commands (docs/game-design/organization.md §5) as the JSON the overlay
 * hands to `Sim.apply_command_json()` / `Sim.validate_command_json()`.
 *
 * Encoding: serde's default **external tagging** of `sim_core::Command`.
 * - struct variant  → `{ "AssignToProject": { "staff": "staff-1", "project": "project-1", "allocation_pct": 80 } }`
 * - newtype variant → `{ "SetPolicy": { "Delegation": "Low" } }`
 * - unit variant    → `"TriageInbox"`
 * Field names are the Rust field names (snake_case); enum values are the Rust
 * variant names (PascalCase). Ids are the strings the JSON views use
 * (`staff-1`, `project-1`, `ticket-3`, `candidate-100`).
 *
 * INTEGRATION: this module is the only place that knows the wire shape. When
 * the sim lands, check every variant against crates/client-wasm/README.md
 * ("apply_command_json") and adjust here only; every panel builds commands
 * through the constructors in `cmd`.
 */

export type StaffRef = string
export type ProjectRef = string
export type TicketRef = string
export type CandidateRef = string
export type WorkItemRef = string

/** `sim_core::WorkItemStatus` */
export type WorkItemStatusVariant =
  | 'Backlog'
  | 'Planned'
  | 'InProgress'
  | 'InReview'
  | 'Approved'
  | 'Scheduled'
  | 'Published'
  | 'Blocked'
  | 'Cancelled'
/** `sim_core::Priority` */
export type WorkPriorityVariant = 'Urgent' | 'High' | 'Normal' | 'Low'
/** `UpdateWorkItem{priority|owner|due|status}`: one change per command. */
export type WorkItemUpdate =
  | { Priority: WorkPriorityVariant }
  | { Owner: StaffRef }
  | { DueDay: number }
  | { Status: WorkItemStatusVariant }

/** `sim_core::ProjectStatus` */
export type ProjectStatusVariant = 'Proposed' | 'Active' | 'Paused' | 'Archived'

/** `sim_core::DelegationPolicy` (§7) */
export type DelegationVariant = 'Off' | 'Low' | 'LowAndMedium'

/** `sim_core::Role` variant name, e.g. `Photographer`, `EditorInChief`. */
export type RoleVariant = string

export interface ProjectProposal {
  name: string
  slug: string
  domain: string
  monthly_budget_cents: number
}

/** `sim_core::SecretaryTaskKind` — the payload of `Delegate{task}` (§7). */
export type SecretaryTask =
  | 'TriageInbox'
  | { ScheduleMeeting: { attendees: StaffRef[]; agenda: string; project: ProjectRef | null } }
  | { PrepareBriefing: { project: ProjectRef | null } }
  | { DraftReply: { ticket: TicketRef } }
  | { ArrangeHiring: { role: RoleVariant; project: ProjectRef | null } }
  | { FollowUp: { staff: StaffRef; topic: string } }

/** `sim_core::Policy` variants the overlay sets. */
export type PolicyCommand = { Delegation: DelegationVariant }

export type Command =
  | { Hire: { candidate: CandidateRef } }
  | { Fire: { staff: StaffRef } }
  | { Promote: { staff: StaffRef } }
  | { SetSalary: { staff: StaffRef; cents_per_day: number } }
  | { AssignToProject: { staff: StaffRef; project: ProjectRef; allocation_pct: number } }
  | { RemoveFromProject: { staff: StaffRef; project: ProjectRef } }
  | { SetProjectLead: { project: ProjectRef; staff: StaffRef } }
  | { CreateProject: { proposal: ProjectProposal } }
  | { SetProjectStatus: { project: ProjectRef; status: ProjectStatusVariant } }
  | { SetProjectBudget: { project: ProjectRef; monthly_cents: number } }
  | { AnswerTicket: { ticket: TicketRef; option: string } }
  | { Delegate: { task: SecretaryTask } }
  | { Praise: { staff: StaffRef } }
  | { SetPolicy: PolicyCommand }
  // Publishing plan (publishing-plan.md §6, ADR-0031)
  | { UpdateWorkItem: { item: WorkItemRef; update: WorkItemUpdate } }
  | { AssignPhase: { item: WorkItemRef; phase: number; staff: StaffRef } }
  | { AcceptProposal: { item: WorkItemRef; post: string } }
  | { CompleteTodo: { item: WorkItemRef; todo: string } }
  /** Proposed (not yet in §6): outsource a phase to the Agency (Claude), billed as an in-game fee. */
  | { SendToAgency: { item: WorkItemRef; phase: number } }

export type CommandName = Command extends infer C ? (C extends Record<infer K, unknown> ? K : never) : never

export interface CommandResult {
  ok: boolean
  reason?: string
}

/** The sim's salary unit is cents per day; the UI speaks euros per month (30-day months, §6). */
export const eurMonthToCentsPerDay = (eur: number) => Math.round((eur * 100) / 30)
export const centsPerDayToEurMonth = (cents: number) => Math.round((cents * 30) / 100)

const STATUS: Record<string, ProjectStatusVariant> = {
  proposed: 'Proposed',
  active: 'Active',
  paused: 'Paused',
  archived: 'Archived',
}
const DELEGATION: Record<string, DelegationVariant> = { off: 'Off', low: 'Low', 'low-and-medium': 'LowAndMedium' }

/** `editor_in_chief` / `in-progress` → `EditorInChief` / `InProgress`. */
export const pascal = (role: string): string =>
  role
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join('')

export const roleVariant = (role: string): RoleVariant => pascal(role)

/** `InProgress` → `in-progress`. */
export const kebab = (variant: string) => variant.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()

/** Typed constructors; panels never write command literals themselves. */
export const cmd = {
  hire: (candidate: CandidateRef): Command => ({ Hire: { candidate } }),
  fire: (staff: StaffRef): Command => ({ Fire: { staff } }),
  promote: (staff: StaffRef): Command => ({ Promote: { staff } }),
  praise: (staff: StaffRef): Command => ({ Praise: { staff } }),
  setSalaryEurMonth: (staff: StaffRef, eurMonth: number): Command => ({
    SetSalary: { staff, cents_per_day: eurMonthToCentsPerDay(eurMonth) },
  }),
  assign: (staff: StaffRef, project: ProjectRef, allocationPct: number): Command => ({
    AssignToProject: { staff, project, allocation_pct: Math.round(allocationPct) },
  }),
  remove: (staff: StaffRef, project: ProjectRef): Command => ({ RemoveFromProject: { staff, project } }),
  setLead: (project: ProjectRef, staff: StaffRef): Command => ({ SetProjectLead: { project, staff } }),
  createProject: (p: { name: string; slug: string; domain: string; budgetEurMonth: number }): Command => ({
    CreateProject: {
      proposal: { name: p.name, slug: p.slug, domain: p.domain, monthly_budget_cents: Math.round(p.budgetEurMonth * 100) },
    },
  }),
  setStatus: (project: ProjectRef, status: string): Command => ({
    SetProjectStatus: { project, status: STATUS[status] ?? (status as ProjectStatusVariant) },
  }),
  setBudgetEurMonth: (project: ProjectRef, eur: number): Command => ({
    SetProjectBudget: { project, monthly_cents: Math.round(eur * 100) },
  }),
  answer: (ticket: TicketRef, option: string): Command => ({ AnswerTicket: { ticket, option } }),
  delegate: (task: SecretaryTask): Command => ({ Delegate: { task } }),
  setPriority: (item: WorkItemRef, priority: string): Command => ({
    UpdateWorkItem: { item, update: { Priority: pascal(priority) as WorkPriorityVariant } },
  }),
  setItemStatus: (item: WorkItemRef, status: string): Command => ({
    UpdateWorkItem: { item, update: { Status: pascal(status) as WorkItemStatusVariant } },
  }),
  assignPhase: (item: WorkItemRef, phase: number, staff: StaffRef): Command => ({ AssignPhase: { item, phase, staff } }),
  acceptProposal: (item: WorkItemRef, post: string): Command => ({ AcceptProposal: { item, post } }),
  completeTodo: (item: WorkItemRef, todo: string): Command => ({ CompleteTodo: { item, todo } }),
  sendToAgency: (item: WorkItemRef, phase: number): Command => ({ SendToAgency: { item, phase } }),
  setDelegation: (policy: string): Command => ({ SetPolicy: { Delegation: DELEGATION[policy] ?? (policy as DelegationVariant) } }),
}

/** Back to the wire forms used in the JSON views. */
export const statusFromVariant = (v: ProjectStatusVariant) => v.toLowerCase() as 'proposed' | 'active' | 'paused' | 'archived'
export const delegationFromVariant = (v: DelegationVariant) =>
  v === 'LowAndMedium' ? 'low-and-medium' : (v.toLowerCase() as 'off' | 'low')

export const toJson = (c: Command) => JSON.stringify(c)

/** Variant name of a command (`AssignToProject`). */
export const commandName = (c: Command): CommandName => Object.keys(c)[0] as CommandName
