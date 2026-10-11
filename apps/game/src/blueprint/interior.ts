/**
 * The CEO asks the office designer to furnish a room (ADR-0087 decision 6,
 * FEAT-084). The request is text, so it goes to the company store as the
 * item's brief (`orchestrator::interior_brief`: `{words, brief}`), and only
 * its ref enters the sim, in `Command::CommissionInterior{room, brief_ref}`
 * (CLAUDE.md rule 2). The sim staffs the Draft with the office designer
 * (or asks the CEO to hire one), the designer's job stores a room plan
 * (`orchestrator::RoomPlan`) as the item's artifact, and the sim builds it
 * item by item after the CEO's Build (economic) or at once (sandbox).
 */
import type { CommandResult } from '../ui/commands'
import { newBriefRef } from './commission'

/** `office_designer::Brief`: what the room must offer once built; counts include what it already has. */
export interface InteriorBrief {
  workstations: number
  /** Seats at the room's table: set by the room's size (meeting rooms, strategy rooms, kitchens). */
  meeting_seats: number
  storage: number
  writing_surfaces: number
  coffee: number
  plants: number
  /** The most the plan may cost, cents; absent or null: no budget. */
  max_cost_cents?: number | null
}

/** The desk an item of a room plan goes on: a desk of the same plan (its index in `items`) or one in the room. */
export type RoomPlanDesk = { planned: number } | { existing: string }

/** One item of a room plan, in build order (`orchestrator::RoomPlanItem`). */
export interface RoomPlanItem {
  /** The sim's equipment slug (`desk`, `desk-lamp`). */
  design: string
  /** Millimetres; 0 for an item on a desk (it takes its desk's position). */
  x_mm: number
  z_mm: number
  /** Quarter turns. */
  rot: 0 | 1 | 2 | 3
  on_desk: RoomPlanDesk | null
}

/** A checker's issue (`office_designer::Issue`): `I1`, its closed code, and a message written for the model. */
export interface RoomPlanIssue {
  id: string
  /** `collision`, `unreachable`, … (`office_designer::IssueCode`). */
  code: string
  severity: 'error' | 'warning'
  /** The placement of the plan by relation it belongs to, if any. */
  placement?: number
  message: string
}

/** The office designer's artifact (`orchestrator::RoomPlan`), as the CEO approves it and the sim builds it. */
export interface RoomPlan {
  kind: 'room-plan'
  /** `room-6`. */
  room: string
  /** In build order: a desk before what goes on it. The sim places them in this order. */
  items: RoomPlanItem[]
  /** The sim's price of every item, cents (an economic build costs this). */
  cost_cents: number
  /** Kit parts the plan adds. */
  parts: number
  /** One line for the CEO (generated, not model text). */
  summary: string
  /** The checker's warnings: what the room already had wrong (a stored plan has no errors). */
  issues: RoomPlanIssue[]
  /** Repair rounds the plan took. */
  repairs?: number
}

/** The longest request kept. */
export const WORDS_MAX = 800

/** The brief record of an interior item: `orchestrator::interior_brief(words, brief)`. */
export function interiorBrief(words: string, brief: InteriorBrief): Record<string, unknown> {
  return { words: words.trim(), brief }
}

/** `{"CommissionInterior": {room, brief_ref}}`. */
export function commissionInteriorCommand(room: string, briefRef: number): string {
  return JSON.stringify({ CommissionInterior: { room, brief_ref: briefRef } })
}

/** What `commissionInterior` needs: the sim's validation, the loop's apply, and the store's brief write. */
export interface InteriorDeps {
  /** `sim.validate_command_json`: undefined when the command would apply, else why not. */
  validate(json: string): string | undefined | null
  /** Logs and applies a command (the loop's `apply`). */
  apply(json: string): CommandResult | Promise<CommandResult>
  putBrief(briefRef: string, recordJson: string): Promise<void>
}

const COUNTS: (keyof InteriorBrief)[] = ['workstations', 'meeting_seats', 'storage', 'writing_surfaces', 'coffee', 'plants']

/** Why a brief cannot be sent, or null: counts are whole numbers 0..=64, the budget a positive whole number of cents. */
export function briefProblem(brief: InteriorBrief): string | null {
  for (const k of COUNTS) {
    const v = brief[k]
    if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > 64) return `${k.replace('_', ' ')} is a whole number from 0 to 64.`
  }
  if (brief.max_cost_cents != null && (!Number.isInteger(brief.max_cost_cents) || brief.max_cost_cents <= 0)) return 'The budget is a positive amount.'
  return null
}

/**
 * Stores the CEO's words and the brief, then logs `CommissionInterior`. A
 * command the sim would refuse (an unknown room, a room already being
 * designed) is refused before anything is stored.
 */
export async function commissionInterior(
  deps: InteriorDeps,
  input: { room: string; words: string; brief: InteriorBrief },
  ref = newBriefRef(),
): Promise<CommandResult> {
  const why = briefProblem(input.brief)
  if (why) return { ok: false, reason: why }
  const cmd = commissionInteriorCommand(input.room, ref)
  const refused = deps.validate(cmd)
  if (refused) return { ok: false, reason: refused }
  const brief: InteriorBrief = { ...input.brief }
  // No budget: the field is left out (the designer's brief has no null).
  if (brief.max_cost_cents == null) delete brief.max_cost_cents
  await deps.putBrief(String(ref), JSON.stringify(interiorBrief(input.words.slice(0, WORDS_MAX), brief)))
  return deps.apply(cmd)
}

/** The room plan of an artifact record (`ArtifactRecord.room_plan`), or null when it has none or it is malformed. */
export function roomPlanOfArtifact(artifact: unknown): RoomPlan | null {
  const a = artifact && typeof artifact === 'object' ? (artifact as Record<string, unknown>) : null
  const p = a?.room_plan && typeof a.room_plan === 'object' ? (a.room_plan as Record<string, unknown>) : null
  if (!p || p.kind !== 'room-plan' || typeof p.room !== 'string' || !Array.isArray(p.items)) return null
  const items: RoomPlanItem[] = []
  for (const x of p.items as unknown[]) {
    const i = x && typeof x === 'object' ? (x as Record<string, unknown>) : null
    if (!i || typeof i.design !== 'string') return null
    const d = i.on_desk && typeof i.on_desk === 'object' ? (i.on_desk as Record<string, unknown>) : null
    const on_desk: RoomPlanDesk | null =
      d && typeof d.planned === 'number' ? { planned: d.planned } : d && typeof d.existing === 'string' ? { existing: d.existing } : null
    const rot = (Number(i.rot) & 3) as RoomPlanItem['rot']
    items.push({ design: i.design, x_mm: Number(i.x_mm) || 0, z_mm: Number(i.z_mm) || 0, rot, on_desk })
  }
  return {
    kind: 'room-plan',
    room: p.room,
    items,
    cost_cents: Number(p.cost_cents) || 0,
    parts: Number(p.parts) || 0,
    summary: typeof p.summary === 'string' ? p.summary : '',
    issues: Array.isArray(p.issues) ? (p.issues as unknown[]).flatMap(toIssue) : [],
    ...(typeof p.repairs === 'number' ? { repairs: p.repairs } : {}),
  }
}

function toIssue(v: unknown): RoomPlanIssue[] {
  const i = v && typeof v === 'object' ? (v as Record<string, unknown>) : null
  if (!i || typeof i.message !== 'string') return []
  return [
    {
      id: typeof i.id === 'string' ? i.id : '',
      code: typeof i.code === 'string' ? i.code : '',
      severity: i.severity === 'error' ? 'error' : 'warning',
      ...(typeof i.placement === 'number' ? { placement: i.placement } : {}),
      message: i.message,
    },
  ]
}
