/**
 * Where the kit's designs stand in a room (FEAT-081 spike, ADR-0065 section
 * 4 "MVP: no sim change"): each layout desk, its attachments, its chair, the
 * ceiling lights and the free-standing props, mapped to a shipped design by
 * `kit/mapping.json`, at the layout's position and quarter turn. Pure: the
 * design facts (bounds, ports) come in through `DesignInfo`, so this runs
 * without wasm in tests too.
 *
 * Frame: metres, x east, y up, z south (as the layout). A placement's `x`,
 * `z` is the world position of its design's footprint centre and `y` the
 * height of its base; `turn` follows the sim's `rot` (quarter turns
 * clockwise seen from above; at 0 the design's front faces south).
 */
import type { PropLayout, RoomLayout } from '../../state/render-state'
import type { KitMapping } from './kit'

/** 1 stud and 1 plate, metres (crates/kit `STUD_M`, `PLATE_M`). */
export const STUD = 0.0625
export const PLATE = 0.025
/** The shell's floor top above its base: a baseplate and a floor layer (crates/kit shell `FLOOR_Y` + 1). */
export const FLOOR_TOP = 2 * PLATE
/** The shell's wall height (crates/kit shell `WALL_TOP`), from the shell's base. */
export const WALL_TOP = 118 * PLATE

export type Turn = 0 | 1 | 2 | 3

export type PlacementRole = 'desk' | 'monitor' | 'desk-lamp' | 'seat' | 'ceiling-light' | 'prop' | 'board'

export interface Placement {
  /** The layout id it draws (`equip-17`), or a derived one (`equip-17/seat`). */
  id: string
  role: PlacementRole
  design: string
  /** Parameters as JSON (`{}` for the defaults). */
  params: string
  x: number
  y: number
  z: number
  turn: Turn
  /** The desk an attachment or chair belongs to. */
  desk?: string
  /** The surface this placement carries, if any (`monitor`, `whiteboard`). */
  surface?: string
  /** The renderer placed it: not in the sim's layout (the spike's stand-in board). */
  standIn?: boolean
}

export interface PortInfo {
  id: string
  /** `[x, z, y]`: studs east, studs south, plates up, from the design's min corner. */
  at: [number, number, number]
  accepts: string[]
  turn: number
}

export interface DesignInfo {
  /** `[w, d, h]`: footprint in studs, height in plates. */
  bounds: [number, number, number]
  mount: 'floor' | 'surface' | 'ceiling' | string
  ports: PortInfo[]
}

export type DesignInfoOf = (design: string, params: string) => DesignInfo

/** The sim's `rot` (radians) as a quarter turn. */
export function turnOf(rot: number): Turn {
  return ((Math.round(rot / (Math.PI / 2)) % 4) + 4) % 4 as Turn
}

/** `(x, z)` turned by `t` quarter turns clockwise seen from above (south → west → north → east). */
export function turnXZ(x: number, z: number, t: number): [number, number] {
  switch (((t % 4) + 4) % 4) {
    case 1:
      return [-z, x]
    case 2:
      return [-x, -z]
    case 3:
      return [z, -x]
    default:
      return [x, z]
  }
}

/** A point of a design (studs `[x, z]` from its min corner) in the world, for a placement of that design. */
export function portWorld(p: Placement, info: DesignInfo, at: [number, number]): [number, number] {
  const lx = (at[0] - info.bounds[0] / 2) * STUD
  const lz = (at[1] - info.bounds[1] / 2) * STUD
  const [dx, dz] = turnXZ(lx, lz, p.turn)
  return [p.x + dx, p.z + dz]
}

const DESK_TOP_PORTS = new Set(['monitor', 'color-monitor', 'desk-lamp'])

/**
 * The spike's whiteboard (FEAT-082): the room's own whiteboard from the
 * layout when it has one; otherwise, in the newsroom only, a stand-in board
 * against the north wall facing into the room, so the Plan has a surface.
 * The stand-in is the renderer's (marked `standIn`), not a sim fact: the sim
 * decides nothing by it, and a layout whiteboard replaces it.
 */
export function standInBoard(room: RoomLayout): Placement | null {
  if (room.kind !== 'newsroom' || room.props.some((p) => p.kind === 'whiteboard')) return null
  // Between the first two windows of the north wall if there are any, else the wall's middle; 0.45 m in.
  const north = room.windows.filter((w) => w.side === 'north').sort((a, b) => a.at - b.at)
  const along = north.length >= 2 ? (north[0].at + north[0].width + north[1].at) / 2 : room.w / 2
  return { id: `${room.id}/whiteboard`, role: 'board', design: 'whiteboard', params: '{}', x: room.x + along, y: 0, z: room.z + 0.45, turn: 0, surface: 'whiteboard', standIn: true }
}

/**
 * The placements of one room, in a fixed order: desks (each followed by its
 * attachments and chair, in layout order), ceiling lights, free props, then
 * the stand-in board. Unmapped kinds are skipped (and listed in `skipped`).
 */
export function roomPlacements(room: RoomLayout, mapping: KitMapping, infoOf: DesignInfoOf, wallTop = WALL_TOP - FLOOR_TOP): { placements: Placement[]; skipped: string[] } {
  const out: Placement[] = []
  const skipped: string[] = []
  const attached = new Map<string, PropLayout[]>()
  for (const p of room.props) if (p.attachedTo) attached.set(p.attachedTo, [...(attached.get(p.attachedTo) ?? []), p])

  for (const d of room.desks) {
    const desk: Placement = { id: d.id, role: 'desk', design: mapping.equipment.desk, params: '{}', x: d.x, y: 0, z: d.z, turn: turnOf(d.rot) }
    out.push(desk)
    const info = infoOf(desk.design, desk.params)
    for (const p of attached.get(d.id) ?? []) {
      const portId = mapping.desk_ports[p.kind]
      const design = mapping.equipment[p.kind]
      const port = info.ports.find((x) => x.id === portId)
      if (!design || !port || !DESK_TOP_PORTS.has(p.kind)) {
        skipped.push(p.id)
        continue
      }
      const [x, z] = portWorld(desk, info, [port.at[0], port.at[1]])
      out.push({
        id: p.id,
        role: p.kind === 'desk-lamp' ? 'desk-lamp' : 'monitor',
        design,
        params: '{}',
        x,
        y: port.at[2] * PLATE,
        z,
        turn: ((desk.turn + port.turn) % 4) as Turn,
        desk: d.id,
        ...(p.kind === 'desk-lamp' ? {} : { surface: 'monitor' }),
      })
    }
    const seat = info.ports.find((x) => x.accepts.includes('seat'))
    if (seat) {
      const [x, z] = portWorld(desk, info, [seat.at[0], seat.at[1]])
      out.push({ id: `${d.id}/seat`, role: 'seat', design: mapping.desk_seat, params: '{}', x, y: 0, z, turn: ((desk.turn + seat.turn) % 4) as Turn, desk: d.id })
    }
  }

  const light = mapping.equipment['ceiling-light']
  for (const l of room.ceilingLights) {
    if (!light) {
      skipped.push(l.id)
      continue
    }
    const h = infoOf(light, '{}').bounds[2] * PLATE
    out.push({ id: l.id, role: 'ceiling-light', design: light, params: '{}', x: l.x, y: wallTop - h, z: l.z, turn: 0 })
  }

  for (const p of room.props) {
    if (p.attachedTo) continue
    const design = mapping.equipment[p.kind]
    if (!design) {
      skipped.push(p.id)
      continue
    }
    out.push({ id: p.id, role: p.kind === 'whiteboard' ? 'board' : 'prop', design, params: '{}', x: p.x, y: 0, z: p.z, turn: turnOf(p.rot), ...(p.kind === 'whiteboard' ? { surface: 'whiteboard' } : {}) })
  }

  const board = standInBoard(room)
  if (board) out.push(board)
  return { placements: out, skipped }
}
