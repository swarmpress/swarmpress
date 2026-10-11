/**
 * The office designer (FEAT-084, ADR-0087 decision 6), the player's side: the brief the CEO asks
 * with, the room plan the designer's Draft returns, and what the Build Approval ticket and the
 * scene's preview make of it. The sim decides (rule 3): the brief goes to the source, which logs
 * `CommissionInterior`; the plan is text in the store (rule 2), read back through the source.
 *
 * The wire types are the session side's (`apps/game/src/blueprint/interior.ts`), re-exported.
 */
import type { PlanGhost } from '../../build-bridge'
import type { CommandResult } from '../commands'
import type { GameDataSource } from '../data-source'
import designs from './kit-designs'
import { pascal } from '../commands'

export type { InteriorBrief, RoomPlan, RoomPlanIssue, RoomPlanItem } from '../../blueprint/interior'
import type { InteriorBrief, RoomPlan } from '../../blueprint/interior'

/** The source's optional office-designer methods (the session side adds them to `GameDataSource`). */
export interface InteriorSource {
  commissionInterior?(input: { room: string; words: string; brief: InteriorBrief }): Promise<CommandResult>
  /** `undefined` while loading, `null` when the store has no plan for the item. */
  roomPlanOf?(item: string): RoomPlan | null | undefined
}

/** The source seen with the office designer's methods, whether or not its type has them yet. */
export const interiorSource = (s: GameDataSource) => s as GameDataSource & InteriorSource

/** The office designer's role as the views spell it (`OfficeDesigner` in the sim). */
export const OFFICE_DESIGNER_ROLE = 'office-designer'
export const isOfficeDesigner = (role: string) => role.replace(/[_\s]+/g, '-').replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase() === OFFICE_DESIGNER_ROLE

/** The brief's numbers, in the form's order, with their labels and limits. */
export const BRIEF_FIELDS: ReadonlyArray<{ key: Exclude<keyof InteriorBrief, 'max_cost_cents'>; label: string; max: number }> = [
  { key: 'workstations', label: 'Workstations', max: 24 },
  { key: 'meeting_seats', label: 'Meeting seats', max: 24 },
  { key: 'storage', label: 'Storage', max: 12 },
  { key: 'writing_surfaces', label: 'Writing surfaces', max: 6 },
  { key: 'coffee', label: 'Coffee', max: 4 },
  { key: 'plants', label: 'Plants', max: 12 },
]

export const EMPTY_BRIEF: InteriorBrief = { workstations: 0, meeting_seats: 0, storage: 0, writing_surfaces: 0, coffee: 0, plants: 0, max_cost_cents: null }

/** A kit design's readable name ('desk-lamp' → 'Desk lamp'), from the kit's own designs. */
export const designName = (design: string) => designs[design]?.name ?? design.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase())

/** The plan's items counted by design, in the order each first appears. */
export function itemCounts(plan: Pick<RoomPlan, 'items'>): Array<{ design: string; name: string; count: number }> {
  const out = new Map<string, number>()
  for (const i of plan.items) out.set(i.design, (out.get(i.design) ?? 0) + 1)
  return [...out].map(([design, count]) => ({ design, name: designName(design), count }))
}

/**
 * The plan as the bridge's ghosts: metres from millimetres, the design as the kind the bridge
 * knows (`desk-lamp` → `DeskLamp`), an item on a desk named by the planned desk's index or the
 * existing desk's id.
 */
export function planGhosts(plan: Pick<RoomPlan, 'items'>): PlanGhost[] {
  return plan.items.map((i) => ({
    kind: pascal(i.design),
    x: i.x_mm / 1000,
    z: i.z_mm / 1000,
    rot: i.rot,
    ...(i.on_desk ? { onDesk: 'planned' in i.on_desk ? i.on_desk.planned : i.on_desk.existing } : {}),
  }))
}
