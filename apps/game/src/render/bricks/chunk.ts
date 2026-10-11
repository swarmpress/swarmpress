/**
 * Room chunks of the brick office (FEAT-081 spike, ADR-0063 decision 1):
 * the kit's instance buffers (`KitBuild.groupTransforms`, `studPositions`)
 * of a room's shell chunks and placements, gathered into one buffer of 4×4
 * matrices per region, colour and template shape, plus one stud buffer per
 * region and colour, so the renderer draws one thin-instanced mesh each and
 * can drop the studs wholesale.
 *
 * Regions serve the cutaway (ADR-0005), the same way the box office treats
 * its walls: a wall on the lot's boundary is its side's region and is hidden
 * when its outside faces the camera; walls inside the lot are cut to
 * partition height (the part above is the `upper` region, built but not
 * drawn); everything else (floor, furniture, low partitions) is `base`.
 *
 * Pure and deterministic: no Babylon, no wasm, no clocks. The same layout
 * and the same kit give byte-identical buffers.
 */
import type { BuildingLayout, RoomLayout, Side } from '../../state/render-state'
import type { KitBuildLike } from './kit'
import { FLOOR_TOP, PLATE, STUD, turnXZ, type Placement } from './placements'

/** Interior walls are drawn up to this height (the box office's `PARTITION_HEIGHT`). */
export const PARTITION_TOP = 1.1
/** Seams between neighbouring bricks, metres (the prototype's gap at this scale). */
export const GAP = 0.0016
export const GAP_Y = 0.001
/** Stud cylinder, metres (the prototype's proportions: radius 0.3 stud, height ≈ 0.53 plate). */
export const STUD_RADIUS = 0.3 * STUD
export const STUD_HEIGHT = 0.0133

/** The colour window modules are drawn in. */
export const WINDOW_COLOUR = 'glass'

export type Region = 'base' | 'upper' | `wall-${Side}`
export type Shape = 'box' | 'cylinder'

/** Geometry templates drawn as an upright cylinder; every other template is a box. */
const CYLINDERS = new Set(['round', 'round-tile'])
export const shapeOf = (template: string): Shape => (CYLINDERS.has(template) ? 'cylinder' : 'box')

export interface InstanceBatch {
  key: string
  region: Region
  colour: string
  shape: Shape
  /** 16 floats per instance (Babylon's row-vector world matrix: scale, quarter turn, translation). */
  matrices: Float32Array
  count: number
}

export interface StudBatch {
  key: string
  region: Region
  colour: string
  matrices: Float32Array
  count: number
}

export interface SurfaceAnchor {
  /** The placement that carries it (`equip-18` for a monitor, `room-1/whiteboard`). */
  owner: string
  desk: string | null
  name: string
  centre: [number, number, number]
  /** Width and height, metres. */
  size: [number, number]
  /** Outward unit normal on the floor plane. */
  normal: [number, number, number]
}

/** A floor tile of a shell, baked into the room's floor texture instead of drawn as a brick. */
export interface FloorTile {
  /** World metres: west, north, east, south edges. */
  x0: number
  z0: number
  x1: number
  z1: number
  colour: string
}

export interface RoomChunk {
  room: string
  instances: InstanceBatch[]
  /**
   * The shell's floor layer (`tile` parts at the floor): flat, studless and
   * seen from above, so it is painted into one textured plane per room
   * (`floor.ts`) rather than drawn as thousands of boxes.
   */
  floor: FloorTile[]
  /** World height of the floor layer's top (y = 0 with the shells lowered). */
  floorTop: number
  studs: StudBatch[]
  surfaces: SurfaceAnchor[]
  /** Instances (the floor's tiles included) and studs, for checks against the kit's own counts. */
  instanceCount: number
  studCount: number
  /** The lot sides this room's walls stand on (cut away like exterior walls). */
  exterior: Side[]
}

/** A compiled source: a shell chunk (offset from the room's corner) or a placement. */
export interface ChunkSource {
  build: KitBuildLike
  /** World position of the design's min corner on its base, before the turn (shells) … */
  origin?: [number, number, number]
  /** … or the placement (footprint centre, turn). */
  placement?: Placement
  /** `[w, d]` footprint in studs (placements, for the centre). */
  footprint?: [number, number]
  shell: boolean
  /** Merged like a shell at the low tier though placed (the town's houses). */
  merge?: boolean
  /** The design's surfaces (from `infoJson().surfaces`), design frame. */
  surfaces?: Array<{ name: string; centre: [number, number, number]; size: [number, number]; normal: [number, number, number] }>
}

/** Sides of the room that lie on the lot's boundary. */
export function exteriorSides(room: RoomLayout, layout: Pick<BuildingLayout, 'originX' | 'originZ' | 'width' | 'depth'>): Side[] {
  const eps = 1e-3
  const out: Side[] = []
  if (Math.abs(room.z - layout.originZ) < eps) out.push('north')
  if (Math.abs(room.z + room.d - (layout.originZ + layout.depth)) < eps) out.push('south')
  if (Math.abs(room.x - layout.originX) < eps) out.push('west')
  if (Math.abs(room.x + room.w - (layout.originX + layout.width)) < eps) out.push('east')
  return out
}

/**
 * The region of a shell instance at room-local `(x, y, z)` (metres from the
 * room's north-west corner, `y` above the floor top). Walls are the one-stud
 * band inside the room's rect; the nearest side wins at corners.
 */
export function regionOf(room: Pick<RoomLayout, 'w' | 'd'>, exterior: readonly Side[], x: number, y: number, z: number): Region {
  // Below the floor's top: baseplates and the floor layer.
  if (y < -0.005) return 'base'
  const band = STUD * 1.2
  const dist: Array<[Side, number]> = [
    ['north', z],
    ['south', room.d - z],
    ['west', x],
    ['east', room.w - x],
  ]
  let best: [Side, number] | null = null
  for (const d of dist) if (d[1] < band && (!best || d[1] < best[1])) best = d
  if (!best) return 'base'
  if (exterior.includes(best[0])) return `wall-${best[0]}`
  return y > PARTITION_TOP ? 'upper' : 'base'
}

/** Writes the row-vector world matrix of a box `(sx, sy, sz)` turned `t` quarter turns at `(tx, ty, tz)`. */
export function writeMatrix(out: Float32Array, o: number, sx: number, sy: number, sz: number, t: number, tx: number, ty: number, tz: number): void {
  const [ax, az] = turnXZ(1, 0, t)
  const [cx, cz] = turnXZ(0, 1, t)
  out[o] = ax * sx
  out[o + 1] = 0
  out[o + 2] = az * sx
  out[o + 3] = 0
  out[o + 4] = 0
  out[o + 5] = sy
  out[o + 6] = 0
  out[o + 7] = 0
  out[o + 8] = cx * sz
  out[o + 9] = 0
  out[o + 10] = cz * sz
  out[o + 11] = 0
  out[o + 12] = tx
  out[o + 13] = ty
  out[o + 14] = tz
  out[o + 15] = 1
}

class Growable {
  data = new Float32Array(16 * 64)
  count = 0
  push(): number {
    if ((this.count + 1) * 16 > this.data.length) {
      const next = new Float32Array(this.data.length * 2)
      next.set(this.data)
      this.data = next
    }
    return this.count++ * 16
  }
  done(): Float32Array {
    return this.data.slice(0, this.count * 16)
  }
}

/**
 * Gathers the sources of one room into batches. `room` is in world metres;
 * shells are lowered by `FLOOR_TOP` so the floor's top is at y = 0, where
 * the people walk and the placements stand.
 */
export function buildRoomChunk(room: RoomLayout, exterior: Side[], sources: readonly ChunkSource[], opts: { merge?: boolean } = {}): RoomChunk {
  const inst = new Map<string, { region: Region; colour: string; shape: Shape; buf: Growable }>()
  // Level of detail (ADR-0063 decision 5, the low tier): a shell's boxes per batch, merged before writing.
  const raw = new Map<string, RawBox[]>()
  const studs = new Map<string, { region: Region; colour: string; buf: Growable }>()
  const surfaces: SurfaceAnchor[] = []
  const floor: FloorTile[] = []
  let floorTop = 0
  let instanceCount = 0
  let studCount = 0

  for (const src of sources) {
    const b = src.build
    const p = src.placement
    // Design frame → world: shells translate; placements turn about their footprint centre.
    const fw = (src.footprint?.[0] ?? 0) * STUD
    const fd = (src.footprint?.[1] ?? 0) * STUD
    const turn = p?.turn ?? 0
    const world = (x: number, y: number, z: number): [number, number, number] => {
      if (src.origin) return [src.origin[0] + x, src.origin[1] + y, src.origin[2] + z]
      const [dx, dz] = turnXZ(x - fw / 2, z - fd / 2, turn)
      return [p!.x + dx, p!.y + y, p!.z + dz]
    }
    for (let g = 0; g < b.groupCount(); g++) {
      const template = b.groupTemplate(g)
      // The window module has no pane of its own: the renderer draws it as glass (see the spike report).
      const colour = template === 'window' ? WINDOW_COLOUR : b.groupColour(g)
      const shape = shapeOf(template)
      const t = b.groupTransforms(g)
      for (let i = 0; i + 7 <= t.length; i += 7) {
        const [wx, wy, wz] = world(t[i], t[i + 1], t[i + 2])
        // The floor layer: one plate thick, its bottom on the baseplates (the floor's top at y = 0).
        if (src.shell && template === 'tile' && Math.abs(wy - t[i + 4] / 2 + FLOOR_TOP - PLATE) < 0.004) {
          const odd = (t[i + 6] & 1) === 1
          const hx = (odd ? t[i + 5] : t[i + 3]) / 2
          const hz = (odd ? t[i + 3] : t[i + 5]) / 2
          floor.push({ x0: wx - hx, z0: wz - hz, x1: wx + hx, z1: wz + hz, colour })
          floorTop = wy + t[i + 4] / 2
          instanceCount++
          continue
        }
        const region = src.shell ? regionOf(room, exterior, wx - room.x, wy - t[i + 4] / 2, wz - room.z) : 'base'
        const key = `${region}|${colour}|${shape}`
        let e = inst.get(key)
        if (!e) inst.set(key, (e = { region, colour, shape, buf: new Growable() }))
        instanceCount++
        if (opts.merge && (src.shell || src.merge) && shape === 'box') {
          const odd = ((t[i + 6] + turn) & 1) === 1
          let list = raw.get(key)
          if (!list) raw.set(key, (list = []))
          list.push({ x: wx, y: wy, z: wz, sx: odd ? t[i + 5] : t[i + 3], sy: t[i + 4], sz: odd ? t[i + 3] : t[i + 5] })
          continue
        }
        const o = e.buf.push()
        writeMatrix(e.buf.data, o, t[i + 3] - GAP, t[i + 4] - GAP_Y, t[i + 5] - GAP, t[i + 6] + turn, wx, wy, wz)
      }
    }
    for (let g = 0; g < b.studGroupCount(); g++) {
      const colour = b.studColour(g)
      const s = b.studPositions(g)
      for (let i = 0; i + 3 <= s.length; i += 3) {
        const [wx, wy, wz] = world(s[i], s[i + 1], s[i + 2])
        const region = src.shell ? regionOf(room, exterior, wx - room.x, wy - 0.001, wz - room.z) : 'base'
        const key = `${region}|${colour}`
        let e = studs.get(key)
        if (!e) studs.set(key, (e = { region, colour, buf: new Growable() }))
        const o = e.buf.push()
        writeMatrix(e.buf.data, o, 1, 1, 1, 0, wx, wy + STUD_HEIGHT / 2, wz)
        studCount++
      }
    }
    for (const s of src.surfaces ?? []) {
      const c = world(s.centre[0], s.centre[1], s.centre[2])
      const [nx, nz] = turnXZ(s.normal[0], s.normal[2], turn)
      surfaces.push({ owner: p?.id ?? room.id, desk: p?.desk ?? null, name: s.name, centre: c, size: s.size, normal: [nx, s.normal[1], nz] })
    }
  }

  for (const [key, list] of raw) {
    const e = inst.get(key)!
    for (const b of mergeBoxes(list)) writeMatrix(e.buf.data, e.buf.push(), b.sx - GAP, b.sy - GAP_Y, b.sz - GAP, 0, b.x, b.y, b.z)
  }

  const sorted = <T>(m: Map<string, T>) => [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  return {
    room: room.id,
    instances: sorted(inst).map(([key, e]) => ({ key, region: e.region, colour: e.colour, shape: e.shape, matrices: e.buf.done(), count: e.buf.count })),
    floor,
    floorTop,
    studs: sorted(studs).map(([key, e]) => ({ key, region: e.region, colour: e.colour, matrices: e.buf.done(), count: e.buf.count })),
    surfaces,
    instanceCount,
    studCount,
    exterior,
  }
}

/** An axis-aligned box: centre and size, metres. */
export interface RawBox {
  x: number
  y: number
  z: number
  sx: number
  sy: number
  sz: number
}

const TOL = 1e-4
const q = (v: number) => Math.round(v / TOL)

/**
 * Merges touching boxes of one batch (one colour) into fewer, larger ones:
 * runs along x, then stacks along y, then runs along z, each where the other
 * two extents match. The bricks' look (seams, studs) is the cost; the outline
 * stays. Deterministic: the input order does not matter.
 */
export function mergeBoxes(boxes: readonly RawBox[]): RawBox[] {
  let out = boxes.map((b) => ({ ...b }))
  const axes: Array<['x' | 'y' | 'z', 'sx' | 'sy' | 'sz']> = [
    ['x', 'sx'],
    ['y', 'sy'],
    ['z', 'sz'],
  ]
  for (const [a, sa] of axes) {
    const others = axes.filter(([o]) => o !== a)
    const groups = new Map<string, RawBox[]>()
    for (const b of out) {
      const k = others.map(([o, so]) => `${q(b[o] - b[so] / 2)},${q(b[so])}`).join('|')
      let g = groups.get(k)
      if (!g) groups.set(k, (g = []))
      g.push(b)
    }
    const next: RawBox[] = []
    for (const k of [...groups.keys()].sort()) {
      const g = groups.get(k)!.sort((p, r) => p[a] - p[sa] / 2 - (r[a] - r[sa] / 2))
      let cur = g[0]
      for (let i = 1; i < g.length; i++) {
        const b = g[i]
        const end = cur[a] + cur[sa] / 2
        const start = b[a] - b[sa] / 2
        if (Math.abs(end - start) < TOL) {
          const lo = cur[a] - cur[sa] / 2
          const hi = b[a] + b[sa] / 2
          cur = { ...cur, [a]: (lo + hi) / 2, [sa]: hi - lo }
        } else {
          next.push(cur)
          cur = b
        }
      }
      next.push(cur)
    }
    out = next
  }
  return out
}

/** World origin of a shell chunk (`roomShells` gives `offset` in metres from the room's corner). */
export function shellOrigin(room: Pick<RoomLayout, 'x' | 'z'>, offset: [number, number]): [number, number, number] {
  return [room.x + offset[0], -FLOOR_TOP, room.z + offset[1]]
}
