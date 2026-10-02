/**
 * Room names painted on the floor (FEAT-020): each room's label from the
 * layout, in small capitals along the room's far side from the camera, so no
 * wall in front of it hides it. A decal is a floor quad in the main scene
 * (lit by the room, under people and furniture) that samples one text atlas.
 *
 * Where the name goes is pure (`roomNameSpot`, unit-tested): along the north
 * or the south side, whichever is further from the camera, centred on the
 * stretch of floor there that no desk, prop or table seat covers.
 */
import { Color3, Mesh, PBRMaterial, Vector3, VertexData, type Camera, type Scene, type TransformNode } from '@babylonjs/core'
import type { BuildingLayout, RoomLayout } from '../state/render-state'
import { createAtlas } from './characters/atlas'
import { LABEL_FONT } from './characters/label-layout'

/** Height of the letters' line on the floor, metres. */
export const ROOM_NAME_HEIGHT = 0.42
/** Distance of the line's centre from the wall, metres. */
export const ROOM_NAME_INSET = 0.36
const FONT_PX = 26
const CELL_W = 400
const CELL_H = 40

export interface Rect {
  x0: number
  z0: number
  x1: number
  z1: number
}

/** What covers floor in a room: desks with their chair, props, the table and its seats. */
export function roomObstacles(room: RoomLayout): Rect[] {
  const out: Rect[] = []
  const around = (x: number, z: number, hw: number, hd: number) => out.push({ x0: x - hw, z0: z - hd, x1: x + hw, z1: z + hd })
  for (const d of room.desks) {
    around(d.x, d.z, 0.75, 0.4)
    around(d.seat[0], d.seat[1], 0.35, 0.35)
  }
  for (const p of room.props) if (!p.attachedTo) around(p.x, p.z, p.kind === 'whiteboard' || p.kind === 'mood-board-wall' ? 0.9 : 0.45, 0.4)
  for (const s of tableSeats(room)) around(s[0], s[1], 0.3, 0.3)
  return out
}

/**
 * Seats around a room's table (sim-core `ROUND_TABLE_SEATS` and `table_seat`:
 * offsets from the room centre, clamped 0.4 m inside the walls), for the
 * rooms where the sim seats people at a table.
 */
export const ROUND_TABLE_SEATS: ReadonlyArray<readonly [number, number]> = [
  [-1.2, 0],
  [1.2, 0],
  [0, -1.0],
  [0, 1.0],
  [-0.9, -0.8],
  [0.9, -0.8],
  [-0.9, 0.8],
  [0.9, 0.8],
  [-2.1, 0],
  [2.1, 0],
  [0, -1.9],
  [0, 1.9],
]

/** Room kinds with a table: meetings (meeting and strategy rooms) and lunch (the kitchen). */
export const TABLE_ROOMS = new Set(['meeting-room', 'strategy-room', 'kitchen'])

export function tableSeats(room: RoomLayout): Array<[number, number]> {
  if (!TABLE_ROOMS.has(room.kind)) return []
  const n = Math.min(room.capacity, ROUND_TABLE_SEATS.length)
  const cx = room.x + room.w / 2
  const cz = room.z + room.d / 2
  const hx = Math.max(0, room.w / 2 - 0.4)
  const hz = Math.max(0, room.d / 2 - 0.4)
  return ROUND_TABLE_SEATS.slice(0, n).map(([dx, dz]) => [cx + Math.max(-hx, Math.min(hx, dx)), cz + Math.max(-hz, Math.min(hz, dz))])
}

export interface RoomNameSpot {
  /** The free stretch of the strip, x from `from` to `to`, at depth `z`. */
  from: number
  to: number
  z: number
  /** Widest the text may be, metres. */
  maxWidth: number
}

/**
 * Where a room's name goes on its `side` (north or south): the widest stretch
 * of that strip of floor no obstacle covers, the name centred in it.
 */
export function roomNameSpot(room: RoomLayout, side: 'north' | 'south'): RoomNameSpot {
  const z = side === 'north' ? room.z + ROOM_NAME_INSET : room.z + room.d - ROOM_NAME_INSET
  const z0 = z - ROOM_NAME_HEIGHT / 2
  const z1 = z + ROOM_NAME_HEIGHT / 2
  const pad = 0.25
  const blocked = roomObstacles(room)
    .filter((r) => r.z1 > z0 && r.z0 < z1)
    .map((r) => ({ from: Math.max(room.x + pad, r.x0), to: Math.min(room.x + room.w - pad, r.x1) }))
    .filter((s) => s.to > s.from)
    .sort((a, b) => a.from - b.from)
  let best = { from: room.x + pad, to: room.x + pad }
  let cursor = room.x + pad
  for (const b of [...blocked, { from: room.x + room.w - pad, to: room.x + room.w - pad }]) {
    if (b.from - cursor > best.to - best.from) best = { from: cursor, to: b.from }
    cursor = Math.max(cursor, b.to)
  }
  return { from: best.from, to: best.to, z, maxWidth: Math.max(0, best.to - best.from - 0.1) }
}

/**
 * The x of a name `width` metres wide in `spot`: at the end of the stretch
 * away from the camera (`towards` −1 for west, +1 for east), so the low
 * partition on the camera's side does not cover its end.
 */
export function nameX(spot: RoomNameSpot, width: number, towards: -1 | 1): number {
  const w = Math.min(width, spot.maxWidth)
  return towards < 0 ? spot.from + 0.05 + w / 2 : spot.to - 0.05 - w / 2
}

/**
 * The turn (`rotation.y`, 0 or π) that makes a name along the x axis read
 * left to right and upright for a camera whose right vector has x component
 * `rightX` and whose up vector has z component `upZ`. Unturned, the text
 * reads along +x with its top towards +z; turned by π, along −x with its top
 * towards −z. Of the two, the one that agrees more with the screen wins.
 */
export function nameTurn(rightX: number, upZ: number): 0 | number {
  return rightX + upZ >= 0 ? 0 : Math.PI
}

export interface RoomNameDecal {
  room: RoomLayout
  mesh: Mesh
  /** Text size on the floor at full size, metres. */
  width: number
  north: RoomNameSpot
  south: RoomNameSpot
}

export interface RoomNames {
  decals: RoomNameDecal[]
  material: PBRMaterial
  /** Place every name on the far side from the camera, reading left to right. Call when the camera turns. */
  face(camera: Camera): void
  dispose(): void
}

function floorQuad(scene: Scene, name: string): Mesh {
  const mesh = new Mesh(name, scene)
  const data = new VertexData()
  // Lying on the floor, +x the reading direction, the text's top towards +z
  // (seen from above in Babylon's left-handed frame, +x right and +z up is unmirrored).
  data.positions = [-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5]
  data.indices = [0, 2, 1, 0, 3, 2]
  data.normals = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]
  data.uvs = [0, 1, 1, 1, 1, 0, 0, 0]
  data.applyToMesh(mesh, true)
  mesh.isPickable = false
  return mesh
}

export function buildRoomNames(scene: Scene, layout: BuildingLayout, parent: TransformNode, maxLights: number): RoomNames {
  const cols = 5
  const rows = Math.max(1, Math.ceil(layout.rooms.length / cols))
  const atlas = createAtlas(scene, 'room-names', { cellW: CELL_W, cellH: CELL_H, cols, rows, margin: 4, scale: 1 })
  const material = new PBRMaterial('room-names', scene)
  material.albedoColor = atlas.texture ? new Color3(1, 1, 1) : new Color3(0.3, 0.24, 0.18)
  material.albedoTexture = atlas.texture
  material.useAlphaFromAlbedoTexture = true
  material.roughness = 0.9
  material.metallic = 0
  material.backFaceCulling = false
  material.zOffset = -2
  material.maxSimultaneousLights = maxLights

  const font = `600 ${FONT_PX}px ${LABEL_FONT}`
  const decals: RoomNameDecal[] = []
  layout.rooms.forEach((room, i) => {
    const text = room.label.toUpperCase()
    const w = Math.min(CELL_W - 8, atlas.measure(text, font, FONT_PX) + Math.ceil(text.length * 1.5) + 4)
    const h = CELL_H - 8
    const mesh = floorQuad(scene, `room-name-${room.id}`)
    mesh.material = material
    mesh.parent = parent
    mesh.receiveShadows = true
    atlas.map(mesh, i, w, h)
    if (atlas.begin(i)) {
      const ctx = atlas.ctx!
      ctx.font = font
      ctx.textBaseline = 'alphabetic'
      ctx.textAlign = 'left'
      // Spaced capitals, in the floor's darker tone (alpha carries the shape).
      ;(ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '1.5px'
      ctx.fillStyle = 'rgba(54, 40, 28, 0.62)'
      ctx.fillText(text, 2, h - 9)
      atlas.end()
    }
    const metres = ROOM_NAME_HEIGHT / h
    decals.push({ room, mesh, width: w * metres, north: roomNameSpot(room, 'north'), south: roomNameSpot(room, 'south') })
  })
  atlas.flush()

  const right = new Vector3()
  const up = new Vector3()
  const forward = new Vector3()
  return {
    decals,
    material,
    face(camera) {
      camera.getDirectionToRef(Vector3.RightReadOnly, right)
      camera.getDirectionToRef(Vector3.UpReadOnly, up)
      camera.getDirectionToRef(Vector3.LeftHandedForwardReadOnly, forward)
      // The far side is the one the camera looks towards.
      const far = forward.z < 0 ? 'north' : 'south'
      const turn = nameTurn(right.x, up.z)
      for (const d of decals) {
        const spot = d[far]
        const k = d.width > 0 ? Math.min(1, spot.maxWidth / d.width) : 1
        d.mesh.setEnabled(k > 0.45)
        d.mesh.scaling.set(d.width * k, 1, ROOM_NAME_HEIGHT * k)
        d.mesh.position.set(nameX(spot, d.width * k, forward.x < 0 ? -1 : 1), 0.006, spot.z)
        d.mesh.rotation.y = turn
      }
    },
    dispose() {
      for (const d of decals) d.mesh.dispose()
      material.dispose()
      atlas.dispose()
    },
  }
}
