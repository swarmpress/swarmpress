/**
 * CEO commands (docs/game-design/organization.md §5) as the JSON the overlay
 * hands to `Sim.apply_command_json()` / `Sim.validate_command_json()`.
 *
 * Encoding: serde's default **external tagging** of `sim_core::Command`, as
 * documented in crates/client-wasm/README.md ("JSON commands"):
 * - struct variant  → `{ "AssignToProject": { "staff": "staff-1", "project": "project-1", "allocation_pct": 80 } }`
 * - unit variant    → `"TriageInbox"`
 * Field names are the Rust field names (snake_case); enum values are the Rust
 * variant names (PascalCase) or the kebab-case slugs of the JSON views. Ids
 * are the strings the JSON views use (`staff-1`, `project-1`, `ticket-3`,
 * `candidate-4`). Money is integer cents.
 *
 * This module is the only place that knows the wire shape; every panel builds
 * commands through the constructors in `cmd`. The organization commands
 * match the README; the plan commands (`UpdateWorkItem`, `AssignPhase`,
 * `AcceptProposal`, `CompleteTodo`, `SendToAgency`) follow
 * publishing-plan.md §6 and are not in `sim_core::Command` yet. Which
 * commands a data source has is its `capabilities().commands`
 * (`SIM_COMMANDS` for the live sim); the store never sends one that is
 * missing and the panels disable its control with `NOT_AVAILABLE`.
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

/** `sim_core::DelegationPolicy` (§7), as the views' slug. */
export type DelegationSlug = 'off' | 'low' | 'low-and-medium'

/** `sim_core::Role` variant name, e.g. `Photographer`, `EditorInChief`. */
export type RoleVariant = string


/** `sim_core::SecretaryTaskKind` — the payload of `Delegate{task}` (§7). */
export type SecretaryTask =
  | 'TriageInbox'
  /** `agenda` is a UI extension (the sim ignores unknown fields). */
  | { ScheduleMeeting: { attendees: StaffRef[]; agenda?: string; project: ProjectRef | null } }
  | { PrepareBriefing: { project: ProjectRef | null } }
  | { DraftReply: { ticket: TicketRef } }
  | { ArrangeHiring: { role: RoleVariant; project: ProjectRef | null } }
  | { FollowUp: { staff: StaffRef; topic: string } }


/** Millimetres on the floor plan (`sim_core::geom::PosMm`). */
export interface PosMm {
  x: number
  z: number
}
/** `sim_core::Placement`: on the floor turned `rot` quarter turns (0..=3), or on a desk. */
export type EquipmentPlacement = { Floor: { pos: PosMm; rot: number } } | { OnDesk: string }
/** `sim_core::town::TownKind` (ADR-0087); only the furniture kinds can be placed or removed. */
export type TownKindVariant = 'PlanHouse' | 'BuildingHouse' | 'FactoryHouse' | 'ProjectsHouse' | 'Tree' | 'StreetLamp' | 'Bench'
/** `sim_core::RoomKind` variant name or slug (`Kitchen`, `meeting-room`). */
export type RoomKindVariant = string
/** `sim_core::EquipmentKind` variant name or slug (`Desk`, `coffee-machine`). */
export type EquipmentKindVariant = string
export type SideVariant = 'North' | 'East' | 'South' | 'West'
/**
 * `sim_core::objects::ObjectSummary`: the numbers of a design's compiled kit
 * summary (studs, plates, stud², cents). `Floor` designs go with
 * `PlaceObject`, `Surface` ones on a desk with `PlaceObjectOnDesk`; `Ceiling`
 * is not placeable yet. The kit's kebab-case mounts (`floor`) are accepted
 * too. `seat_at` is a workstation's seat (mm from the footprint centre at
 * turn 0; required when `workstation`, null otherwise, ADR-0088).
 */
export interface ObjectSummaryWire {
  footprint: [number, number]
  height: number
  mount: 'Floor' | 'Surface' | 'Ceiling'
  seats: number
  workstation: boolean
  seat_at?: [number, number] | null
  lights: number
  storage: number
  screens: number
  parts: number
  cost: number
}

export type Command =
  | { Hire: { candidate: CandidateRef } }
  | { Fire: { staff: StaffRef } }
  | { Promote: { staff: StaffRef } }
  | { SetSalary: { staff: StaffRef; cents_per_day: number } }
  | { AssignToProject: { staff: StaffRef; project: ProjectRef; allocation_pct: number } }
  | { RemoveFromProject: { staff: StaffRef; project: ProjectRef } }
  | { SetProjectLead: { project: ProjectRef; staff: StaffRef } }
  | { CreateProject: { slug: string; name: string; domain: string } }
  | { SetProjectStatus: { project: ProjectRef; status: ProjectStatusVariant } }
  | { SetProjectBudget: { project: ProjectRef; monthly_cents: number } }
  | { AnswerTicket: { ticket: TicketRef; option: string } }
  | { Delegate: { task: SecretaryTask } }
  | { Praise: { staff: StaffRef } }
  | { SetDelegation: { policy: DelegationSlug } }
  // Publishing plan (publishing-plan.md §6, ADR-0031)
  | { UpdateWorkItem: { item: WorkItemRef; update: WorkItemUpdate } }
  /** Run an installed tool now (ADR-0072): `tool_ref` is 6 bytes of its hash. */
  | { RunTool: { tool_ref: number } }
  | { AssignPhase: { item: WorkItemRef; phase: number; staff: StaffRef } }
  | { AcceptProposal: { item: WorkItemRef; post: string } }
  | { CompleteTodo: { item: WorkItemRef; todo: string } }
  /** Proposed (not yet in §6): outsource a phase to the Agency (Claude), billed as an in-game fee. */
  | { SendToAgency: { item: WorkItemRef; phase: number } }
  // Building (ADR-0087): tile rects in metres-as-tiles, positions in millimetres, ids as strings.
  | {
      PlaceRoom: {
        kind: RoomKindVariant
        rect: { x: number; z: number; w: number; d: number }
        floor: number
        doors: Array<{ side: SideVariant; at: number }>
        windows: Array<{ side: SideVariant; at_mm: number; width_mm: number }>
      }
    }
  | { Demolish: { Room: string } | { Equipment: string } }
  | { PlaceEquipment: { kind: EquipmentKindVariant; placement: EquipmentPlacement } }
  /** Keeps the id and the desk assignment; what sits on a desk moves with it. */
  | { MoveEquipment: { equipment: string; placement: EquipmentPlacement } }
  | { PlaceTownItem: { kind: TownKindVariant; pos: PosMm; rot: number } }
  | { MoveTownItem: { item: string; pos: PosMm; rot: number } }
  | { RemoveTownItem: { item: string } }
  /**
   * The office designer furnishes a room (ADR-0087 decision 6, FEAT-084): the
   * CEO's words and brief are a store record under `brief_ref` (written first,
   * `blueprint/interior.ts`); the sim makes an `Interior` work item.
   */
  | { CommissionInterior: { room: string; brief_ref: number } }
  /**
   * A player's own kit design placed in a room (ADR-0065 §4, ADR-0087 decision 7):
   * `design` is its 64-hex hash, `pos` the footprint centre in mm, `rot` quarter
   * turns. Economic: costs `summary.cost`; moving 10% of it; removing is free.
   */
  | { PlaceObject: { design: string; pos: PosMm; rot: number; summary: ObjectSummaryWire } }
  | { MoveObject: { object: string; pos: PosMm; rot: number } }
  | { RemoveObject: { object: string } }
  /**
   * A desk-top design (`mount: 'Surface'`) on a built-in desk (ADR-0088): it
   * takes the desk's screen slot when `summary.screens > 0`, its lamp slot
   * otherwise; refused when that slot is taken. It moves and goes with the
   * desk. Economic: costs `summary.cost`.
   */
  | { PlaceObjectOnDesk: { design: string; desk: string; summary: ObjectSummaryWire } }

export type CommandName = Command extends infer C ? (C extends Record<infer K, unknown> ? K : never) : never

/**
 * The commands of this module that `sim_core::Command` has
 * (crates/sim-core/src/commands.rs). The sim rejects any other variant with
 * "unknown variant"; wasm-live.test.tsx holds this list against the real sim.
 */
export const SIM_COMMANDS: readonly CommandName[] = [
  'Hire',
  'Fire',
  'Promote',
  'SetSalary',
  'AssignToProject',
  'RemoveFromProject',
  'SetProjectLead',
  'CreateProject',
  'SetProjectStatus',
  'SetProjectBudget',
  'AnswerTicket',
  'Delegate',
  'Praise',
  'SetDelegation',
  'UpdateWorkItem',
  'RunTool',
  // building (ADR-0087)
  'PlaceRoom',
  'Demolish',
  'PlaceEquipment',
  'MoveEquipment',
  'PlaceTownItem',
  'MoveTownItem',
  'RemoveTownItem',
  // the office designer (ADR-0087 decision 6)
  'CommissionInterior',
  // players' own designs (ADR-0065 §4, ADR-0087 decision 7)
  'PlaceObject',
  'MoveObject',
  'RemoveObject',
  // staff use what the bricks provide (ADR-0088)
  'PlaceObjectOnDesk',
]

/** Plan commands of publishing-plan.md §6 the sim does not have yet (the mock source applies them). */
export const PLAN_COMMANDS: readonly CommandName[] = ['AssignPhase', 'AcceptProposal', 'CompleteTodo', 'SendToAgency']

/** Every command the overlay can build. */
export const ALL_COMMANDS: readonly CommandName[] = [...SIM_COMMANDS, ...PLAN_COMMANDS]

/** Tooltip and rejection reason of an action whose command the data source does not have. */
export const NOT_AVAILABLE = 'Not available yet'

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
  /** The budget is a separate `SetProjectBudget` once the project exists. */
  createProject: (p: { name: string; slug: string; domain: string }): Command => ({
    CreateProject: { slug: p.slug, name: p.name, domain: p.domain },
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
  /** The day (0-based game day) the item should be ready; it publishes the day after (ADR-0069). */
  setDueDay: (item: WorkItemRef, day: number): Command => ({ UpdateWorkItem: { item, update: { DueDay: day } } }),
  setItemStatus: (item: WorkItemRef, status: string): Command => ({
    UpdateWorkItem: { item, update: { Status: pascal(status) as WorkItemStatusVariant } },
  }),
  assignPhase: (item: WorkItemRef, phase: number, staff: StaffRef): Command => ({ AssignPhase: { item, phase, staff } }),
  acceptProposal: (item: WorkItemRef, post: string): Command => ({ AcceptProposal: { item, post } }),
  completeTodo: (item: WorkItemRef, todo: string): Command => ({ CompleteTodo: { item, todo } }),
  sendToAgency: (item: WorkItemRef, phase: number): Command => ({ SendToAgency: { item, phase } }),
  setDelegation: (policy: DelegationSlug): Command => ({ SetDelegation: { policy } }),
}

/** Back to the wire forms used in the JSON views. */
export const statusFromVariant = (v: ProjectStatusVariant) => v.toLowerCase() as 'proposed' | 'active' | 'paused' | 'archived'

export const toJson = (c: Command) => JSON.stringify(c)

/** Variant name of a command (`AssignToProject`). */
export const commandName = (c: Command): CommandName => Object.keys(c)[0] as CommandName
