/**
 * Where walls stand and where they open (FEAT-020). Pure geometry from the
 * sim's layout: the renderer invents no wall and no door.
 *
 * In sim-core every side of a room is a wall, a door is a one-tile opening a
 * room declares on one of its sides, and everything inside the lot that is not
 * a room is hallway. So the interior walls are the room sides that are not on
 * the lot boundary, merged where two rooms share one, minus the doors either
 * room declares there. The street door (`entrance`) and any room door on the
 * boundary open the exterior wall.
 */
import type { BuildingLayout, Opening, RoomLayout, Side } from '../state/render-state'

const EPS = 1e-6

/** A straight piece of wall on the floor plan, in metres. `axis` is the direction it runs in. */
export interface WallRun {
  axis: 'x' | 'z'
  /** The coordinate it stands on: z for a run along x, x for a run along z. */
  at: number
  from: number
  to: number
}

/** A door in the floor plan: an opening of `width` centred at (x, z) in a wall that runs along `axis`. */
export interface DoorGap {
  axis: 'x' | 'z'
  x: number
  z: number
  width: number
  /** The room that declares it, or null for the street entrance. */
  room: string | null
  /** In the lot boundary (the exterior wall). */
  exterior: boolean
}

interface Span {
  from: number
  to: number
}

/** The line a room side lies on and the span it covers. */
function sideLine(room: RoomLayout, side: Side): WallRun {
  switch (side) {
    case 'north':
      return { axis: 'x', at: room.z, from: room.x, to: room.x + room.w }
    case 'south':
      return { axis: 'x', at: room.z + room.d, from: room.x, to: room.x + room.w }
    case 'west':
      return { axis: 'z', at: room.x, from: room.z, to: room.z + room.d }
    case 'east':
      return { axis: 'z', at: room.x + room.w, from: room.z, to: room.z + room.d }
  }
}

/** The lot boundary side a line lies on, if any. */
function boundarySide(layout: BuildingLayout, line: { axis: 'x' | 'z'; at: number }): Side | null {
  const near = (a: number, b: number) => Math.abs(a - b) < EPS
  if (line.axis === 'x') {
    if (near(line.at, layout.originZ)) return 'north'
    if (near(line.at, layout.originZ + layout.depth)) return 'south'
  } else {
    if (near(line.at, layout.originX)) return 'west'
    if (near(line.at, layout.originX + layout.width)) return 'east'
  }
  return null
}

function doorSpan(room: RoomLayout, door: Opening): Span {
  const start = (door.side === 'north' || door.side === 'south' ? room.x : room.z) + door.at
  return { from: start, to: start + door.width }
}

/** Every door of the building, the street entrance included, each once. */
export function doorGaps(layout: BuildingLayout): DoorGap[] {
  const gaps: DoorGap[] = []
  const add = (g: DoorGap) => {
    if (!gaps.some((o) => o.axis === g.axis && Math.abs(o.x - g.x) < EPS && Math.abs(o.z - g.z) < EPS)) gaps.push(g)
  }
  const e = layout.entrance
  add({ axis: e.side === 'north' || e.side === 'south' ? 'x' : 'z', x: e.x, z: e.z, width: 1, room: null, exterior: true })
  for (const room of layout.rooms) {
    for (const door of room.doors) {
      const line = sideLine(room, door.side)
      const span = doorSpan(room, door)
      const mid = (span.from + span.to) / 2
      add({
        axis: line.axis,
        x: line.axis === 'x' ? mid : line.at,
        z: line.axis === 'x' ? line.at : mid,
        width: door.width,
        room: room.id,
        exterior: boundarySide(layout, line) !== null,
      })
    }
  }
  return gaps
}

/** Sorted union of spans. */
function union(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.from - b.from)
  const out: Span[] = []
  for (const s of sorted) {
    const last = out[out.length - 1]
    if (last && s.from <= last.to + EPS) last.to = Math.max(last.to, s.to)
    else out.push({ ...s })
  }
  return out
}

/** `spans` (a sorted union) minus `holes`. */
function subtract(spans: Span[], holes: Span[]): Span[] {
  let out = spans
  for (const h of holes) {
    const next: Span[] = []
    for (const s of out) {
      if (h.to <= s.from + EPS || h.from >= s.to - EPS) {
        next.push(s)
        continue
      }
      if (h.from > s.from + EPS) next.push({ from: s.from, to: h.from })
      if (h.to < s.to - EPS) next.push({ from: h.to, to: s.to })
    }
    out = next
  }
  return out
}

const lineKey = (axis: 'x' | 'z', at: number) => `${axis}:${Math.round(at * 1000)}`

/** The interior walls: room sides off the lot boundary, shared sides once, doors cut out. */
export function interiorWalls(layout: BuildingLayout): WallRun[] {
  const lines = new Map<string, { axis: 'x' | 'z'; at: number; walls: Span[]; doors: Span[] }>()
  const lineOf = (axis: 'x' | 'z', at: number) => {
    const key = lineKey(axis, at)
    let line = lines.get(key)
    if (!line) lines.set(key, (line = { axis, at, walls: [], doors: [] }))
    return line
  }
  for (const room of layout.rooms) {
    for (const side of ['north', 'south', 'west', 'east'] as Side[]) {
      const run = sideLine(room, side)
      if (boundarySide(layout, run)) continue
      lineOf(run.axis, run.at).walls.push({ from: run.from, to: run.to })
    }
    for (const door of room.doors) {
      const run = sideLine(room, door.side)
      if (boundarySide(layout, run)) continue
      lineOf(run.axis, run.at).doors.push(doorSpan(room, door))
    }
  }
  const runs: WallRun[] = []
  const keys = [...lines.keys()].sort()
  for (const key of keys) {
    const line = lines.get(key)!
    for (const s of subtract(union(line.walls), line.doors)) {
      if (s.to - s.from > 0.01) runs.push({ axis: line.axis, at: line.at, from: s.from, to: s.to })
    }
  }
  return runs
}

/**
 * Where rooms start and end along a line (x positions for a line along x):
 * a wall piece cut there touches the rooms of at most one span, which keeps
 * the lights that reach it within the per-mesh budget (ADR-0006).
 */
export function roomEdgesAlong(layout: BuildingLayout, axis: 'x' | 'z'): number[] {
  const edges = new Set<number>()
  for (const r of layout.rooms) {
    if (axis === 'x') edges.add(r.x).add(r.x + r.w)
    else edges.add(r.z).add(r.z + r.d)
  }
  return [...edges].sort((a, b) => a - b)
}

/** `[from, to]` cut at every point of `cuts` strictly inside it. */
export function splitSpan(from: number, to: number, cuts: readonly number[]): Array<[number, number]> {
  const out: Array<[number, number]> = []
  let a = from
  for (const c of cuts) {
    if (c <= a + EPS || c >= to - EPS) continue
    out.push([a, c])
    a = c
  }
  if (to - a > EPS) out.push([a, to])
  return out
}

/** A floor rectangle in metres. */
export interface FloorRect {
  x: number
  z: number
  w: number
  d: number
}

/**
 * The hallway: every tile of the lot no room covers (sim-core `Zone::Hallway`),
 * merged into as few rectangles as rows allow.
 */
export function hallwayRects(layout: BuildingLayout, tile = 1): FloorRect[] {
  const cols = Math.round(layout.width / tile)
  const rows = Math.round(layout.depth / tile)
  const inRoom = (x: number, z: number) => layout.rooms.some((r) => x >= r.x && x < r.x + r.w && z >= r.z && z < r.z + r.d)
  // Runs of hallway tiles per row, then runs with the same span stacked into rectangles.
  const open: FloorRect[] = []
  const done: FloorRect[] = []
  for (let row = 0; row < rows; row++) {
    const z = layout.originZ + row * tile
    const runs: FloorRect[] = []
    let start = -1
    for (let col = 0; col <= cols; col++) {
      const hall = col < cols && !inRoom(layout.originX + (col + 0.5) * tile, z + tile / 2)
      if (hall && start < 0) start = col
      if (!hall && start >= 0) {
        runs.push({ x: layout.originX + start * tile, z, w: (col - start) * tile, d: tile })
        start = -1
      }
    }
    for (let i = open.length - 1; i >= 0; i--) {
      const o = open[i]
      const k = runs.findIndex((r) => Math.abs(r.x - o.x) < EPS && Math.abs(r.w - o.w) < EPS)
      if (k >= 0) {
        o.d += tile
        runs.splice(k, 1)
      } else done.push(...open.splice(i, 1))
    }
    open.push(...runs)
  }
  return [...done, ...open].sort((a, b) => a.z - b.z || a.x - b.x)
}

/**
 * The direction a prop at (x, z) faces: away from the nearest side of its
 * room, into the room. A yaw (`rotation.y`) for a prop whose front is local +z.
 */
export function facingIntoRoom(room: RoomLayout, x: number, z: number): number {
  const d = [
    { gap: z - room.z, yaw: 0 }, // north wall: faces south (+z)
    { gap: room.z + room.d - z, yaw: Math.PI }, // south wall: faces north
    { gap: x - room.x, yaw: Math.PI / 2 }, // west wall: faces east (+x)
    { gap: room.x + room.w - x, yaw: -Math.PI / 2 }, // east wall: faces west
  ]
  return d.reduce((a, b) => (b.gap < a.gap - EPS ? b : a)).yaw
}

/** An opening in an exterior side, measured from the side's west or north end. */
export interface ExteriorOpening {
  from: number
  to: number
  kind: 'window' | 'door'
}

/** Windows and doors in each exterior side, sorted along it. Doors win where a window overlaps one. */
export function exteriorOpenings(layout: BuildingLayout): Record<Side, ExteriorOpening[]> {
  const windows: Record<Side, Span[]> = { north: [], south: [], west: [], east: [] }
  const doors: Record<Side, Span[]> = { north: [], south: [], west: [], east: [] }
  const start = (side: Side) => (side === 'north' || side === 'south' ? layout.originX : layout.originZ)
  for (const room of layout.rooms) {
    for (const w of room.windows) {
      const line = sideLine(room, w.side)
      const side = boundarySide(layout, line)
      if (!side) continue
      const s = doorSpan(room, w)
      windows[side].push({ from: s.from - start(side), to: s.to - start(side) })
    }
    for (const d of room.doors) {
      const side = boundarySide(layout, sideLine(room, d.side))
      if (!side) continue
      const s = doorSpan(room, d)
      doors[side].push({ from: s.from - start(side), to: s.to - start(side) })
    }
  }
  const e = layout.entrance
  const c = (e.side === 'north' || e.side === 'south' ? e.x : e.z) - start(e.side)
  doors[e.side].push({ from: c - 0.5, to: c + 0.5 })

  const out: Record<Side, ExteriorOpening[]> = { north: [], south: [], west: [], east: [] }
  for (const side of ['north', 'south', 'west', 'east'] as Side[]) {
    const d = union(doors[side])
    const w = subtract(union(windows[side]), d)
    out[side] = [...d.map((s) => ({ ...s, kind: 'door' as const })), ...w.map((s) => ({ ...s, kind: 'window' as const }))].sort((a, b) => a.from - b.from)
  }
  return out
}
