/**
 * Placed objects (ADR-0065 §4, K-4; ADR-0087 decision 7): the player's own kit designs standing in
 * the office, as the sim lays them out (`Sim.layout_json().objects`). The sim knows each object by
 * its design's hash and the design's compiled summary (rule 2: no design text enters the sim); the
 * design itself is company text, resolved by its hash through the data source (`designOf`).
 *
 * The wire types are the render state's (`PlacedObjectLayout`, `ObjectSummary`), re-exported.
 */
import type { BuildingLayout, DeskLayout, ObjectSummary as WireSummary, PlacedObjectLayout as WireObject, RoomLayout } from '../../state/render-state'
import type { KitMapping } from './kit'
import { deskSlotAt, STUD, turnOf, turnXZ, type DesignInfoOf, type Turn } from './placements'

/**
 * ADR-0088 adds to the wire types (the sim agent's change to render-state.ts; until it lands they
 * are optional here, and absent means "not said"):
 * - the summary's `seat_at`: a workstation's seat port relative to its footprint centre, mm, unturned;
 * - the layout object's `seatAt` (the same in metres), `onDesk` (a desk-top object's desk and slot)
 *   and `assignedTo` (who calls a workstation object home).
 */
export type ObjectSummary = WireSummary & { seat_at?: [number, number] | null }
/** A desk's slot a desk-top object takes (ADR-0088 decision 3). */
export type DeskSlot = 'screen' | 'lamp'
export interface DeskTop {
  desk: string
  slot: DeskSlot
}
export type PlacedObjectLayout = Omit<WireObject, 'summary'> & {
  summary: ObjectSummary
  seatAt?: [number, number] | null
  onDesk?: DeskTop | null
  assignedTo?: string | null
}

/** A layout that may carry placed objects. */
export type LayoutWithObjects = BuildingLayout

/** The layout's placed objects (none before the sim lays any out). */
export function objectsOf(layout: BuildingLayout | null | undefined): PlacedObjectLayout[] {
  const list = (layout as LayoutWithObjects | null | undefined)?.objects as PlacedObjectLayout[] | undefined
  return Array.isArray(list) ? list.filter((o) => o && typeof o.id === 'string' && typeof o.design === 'string') : []
}

/** The desk and slot a desk-top object stands on, or null for one on the floor. */
export function deskTopOf(o: Pick<PlacedObjectLayout, 'onDesk'>): DeskTop | null {
  const d = o.onDesk
  return d && typeof d.desk === 'string' && (d.slot === 'screen' || d.slot === 'lamp') ? d : null
}

/** A workstation object's seat relative to its centre, metres, unturned (the layout's `seatAt`); null when it has none. */
export function seatAtOf(o: Pick<PlacedObjectLayout, 'seatAt'>): [number, number] | null {
  const s = o.seatAt
  return Array.isArray(s) && s.length === 2 && s.every((v) => typeof v === 'number' && Number.isFinite(v)) ? [s[0], s[1]] : null
}

/** Where a workstation object's seat is in the world: its position plus `seatAt` turned by its rot. */
export function objectSeat(o: Pick<PlacedObjectLayout, 'x' | 'z' | 'rot' | 'seatAt'>): [number, number] | null {
  const s = seatAtOf(o)
  if (!s) return null
  const [dx, dz] = turnXZ(s[0], s[1], turnOf(o.rot))
  return [o.x + dx, o.z + dz]
}

/** Who calls a workstation object home (`staff-N`), or null; undefined when the layout does not say. */
export function assignedOf(o: Pick<PlacedObjectLayout, 'assignedTo'>): string | null | undefined {
  return o.assignedTo === undefined ? undefined : typeof o.assignedTo === 'string' ? o.assignedTo : null
}

/** A desk of the layout by id, with its room. */
export function deskById(layout: BuildingLayout, id: string): { desk: DeskLayout; room: RoomLayout } | null {
  for (const room of layout.rooms) {
    const desk = room.desks.find((d) => d.id === id)
    if (desk) return { desk, room }
  }
  return null
}

/**
 * The world rect an object covers, turned: from its summary's footprint in studs (the design's
 * frame) when it has one, else the layout's footprint in metres taken in the design's frame too.
 */
export function objectRect(o: Pick<PlacedObjectLayout, 'x' | 'z' | 'rot' | 'footprint'> & { summary?: Pick<ObjectSummary, 'footprint'> }): { x: number; z: number; w: number; d: number } {
  const [w0, d0] = o.summary?.footprint ? [o.summary.footprint[0] * STUD, o.summary.footprint[1] * STUD] : o.footprint
  const odd = turnOf(o.rot) % 2 === 1
  const w = odd ? d0 : w0
  const d = odd ? w0 : d0
  return { x: o.x - w / 2, z: o.z - d / 2, w, d }
}

export const objectTurn = (o: Pick<PlacedObjectLayout, 'rot'>): Turn => turnOf(o.rot)

/**
 * How the renderer finds a design by its hash: the design JSON (text or object), `undefined` while
 * it is being read, `null` when the company has none.
 */
export type DesignResolver = (hash: string) => string | object | null | undefined

/** A resolved design as the kit's compiler takes it. */
export function designText(d: string | object | null | undefined): string | null {
  if (d == null) return null
  return typeof d === 'string' ? d : JSON.stringify(d)
}

/** Where an object stands as drawn: the footprint centre, the base height, the quarter turn, and the desk it is on. */
export interface ObjectSpot {
  x: number
  y: number
  z: number
  turn: Turn
  desk: string | null
}

/**
 * Where an object is drawn: a floor object at its layout position; a desk-top object (ADR-0088
 * decision 3) at its desk's slot port, the way the office draws a monitor or a lamp on that desk,
 * so it moves with the desk. Null when the desk or its port is not in the layout or the kit.
 */
export function objectSpot(o: PlacedObjectLayout, layout: BuildingLayout, mapping: KitMapping, infoOf: DesignInfoOf): ObjectSpot | null {
  const top = deskTopOf(o)
  if (!top) return { x: o.x, y: 0, z: o.z, turn: objectTurn(o), desk: null }
  const found = deskById(layout, top.desk)
  if (!found) return null
  const at = deskSlotAt(found.desk, top.slot, mapping, infoOf)
  return at ? { ...at, desk: top.desk } : null
}

/** The world rect of a footprint `[w, d]` in metres (the design's frame) centred at `(x, z)`, turned. */
export function rectAt(x: number, z: number, footprint: readonly [number, number], turn: number): { x: number; z: number; w: number; d: number } {
  const odd = turn % 2 === 1
  const w = odd ? footprint[1] : footprint[0]
  const d = odd ? footprint[0] : footprint[1]
  return { x: x - w / 2, z: z - d / 2, w, d }
}

/** An object's own footprint in metres at turn 0: its summary's studs, else the layout's. */
export function footprintM(o: Pick<PlacedObjectLayout, 'footprint'> & { summary?: Pick<ObjectSummary, 'footprint'> }): [number, number] {
  return o.summary?.footprint ? [o.summary.footprint[0] * STUD, o.summary.footprint[1] * STUD] : [o.footprint[0], o.footprint[1]]
}
