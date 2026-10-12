/**
 * The bridge between build mode's UI (the Build section, ADR-0087) and the
 * renderer: picking on the stud grid, the ghost preview, the highlight, the
 * camera. The renderer implements it (`render/build-mode/bridge.ts`) and `main.ts`
 * publishes it here once the scene is up, and again after every rebuild.
 * The UI decides nothing by it either: every action is still a sim command.
 */
import { signal } from '@preact/signals'

/** What a pick lands on, or what is highlighted: a piece of equipment, a placed object (K-4), a town item, a room. */
export type BuildTarget = { kind: 'equipment'; id: string } | { kind: 'object'; id: string } | { kind: 'town'; id: string } | { kind: 'room'; id: string }

export interface GhostSpec {
  /** An equipment kind (sim EquipmentKind name, e.g. 'Desk') or a town kind ('Tree'). */
  kind: string
  family: 'equipment' | 'town'
  /** Metres, footprint centre; rot in quarter turns. */
  x: number
  z: number
  rot: 0 | 1 | 2 | 3
  /** Green when the sim would accept, red when not. */
  ok: boolean
  /**
   * A design of the player's own (K-4): its design JSON, compiled by the renderer with the kit and
   * drawn instead of the kit mapping's design for `kind`. It stands on the floor unless `onDesk`.
   */
  design?: string
  /**
   * On a desk (a monitor, a lamp, a desk-top design of the player's, ADR-0088): the desk and the
   * slot. The ghost then stands at that desk's slot port, where the office draws what is on it;
   * `x`, `z` and `rot` are ignored.
   */
  onDesk?: { desk: string; slot: 'screen' | 'lamp' }
}

/**
 * One item of a room plan shown as a ghost (the office designer's plan, FEAT-084): an equipment
 * kind or a kit design ('Desk', 'MeetingTable'), metres and quarter turns like `GhostSpec`. An item
 * on a desk names the desk: by its index in the same list (a desk of the plan) or by its id (a desk
 * that stands already); it then stands where that desk does, at its port's height.
 */
export interface PlanGhost {
  kind: string
  x: number
  z: number
  rot: 0 | 1 | 2 | 3
  onDesk?: number | string
}

export interface BuildBridge {
  /** The floor point under a client pixel, snapped to the stud grid (1/16 m), metres; the room it is in; what is under it. */
  pick(clientX: number, clientY: number): { x: number; z: number; room: string | null; target: BuildTarget | null } | null
  ghost(g: GhostSpec | null): void
  /** A whole plan as green ghosts at once (the Build Approval's preview); null hides them. Independent of `ghost`. */
  ghostPlan(items: PlanGhost[] | null): void
  /** A room's rect while the player picks its corners (metres, north-west corner and size): a green or red slab; null hides it. */
  ghostRect(r: { x: number; z: number; w: number; d: number; ok: boolean } | null): void
  highlight(t: BuildTarget | null): void
  /** While on, a left drag does not pan the camera (build gestures own it). */
  setCapture(on: boolean): void
  /** Frame a room or the whole town. */
  focus(t: { room: string } | { town: true }): void
  canvas(): HTMLCanvasElement
}

/** Set by main.ts once the scene is up (and again after a rebuild); null on pages without a scene. */
export const buildBridge = signal<BuildBridge | null>(null)
