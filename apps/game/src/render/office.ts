import {
  Color3,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  PointLight,
  Scene,
  TransformNode,
  Vector3,
  type AbstractMesh,
} from '@babylonjs/core'
import type { BuildingLayout, RoomLayout } from '../state/render-state'
import type { Side } from './cutaway'

/**
 * Lights that may affect one mesh at once (ADR-0006 light budget). Babylon's
 * WebGPU engine gives every light its own uniform buffer and supports at most
 * 8 per material, so lights are scoped per room and per desk.
 */
export const MAX_LIGHTS_PER_MATERIAL = 8

const WALL_T = 0.15
const SILL = 0.9
const HEAD = 2.2
const DOOR_W = 1.1

export interface WallPiece {
  mesh: Mesh
  /** Exterior side, or undefined for interior partitions (always low). */
  side?: Side
}

export interface DeskHandle {
  id: string
  roomId: string
  /** Desk furniture lit by this desk's lamp. */
  meshes: AbstractMesh[]
  screen: Mesh
  screenMaterial: PBRMaterial
  lamp: PointLight
  lampShade: Mesh
}

export interface RoomHandle {
  layout: RoomLayout
  floor: Mesh
  lights: PointLight[]
  panels: Mesh[]
  panelMaterial: PBRMaterial
  /** Meshes lit by this room's ceiling lights (floor, furniture, adjacent walls). */
  scope: AbstractMesh[]
}

export interface StaffHandle {
  id: string
  root: TransformNode
  body: Mesh
  head: Mesh
}

export interface OfficeHandles {
  root: TransformNode
  walls: WallPiece[]
  rooms: Map<string, RoomHandle>
  desks: Map<string, DeskHandle>
  staff: Map<string, StaffHandle>
  /** Everything that should cast sun/moon shadows. */
  shadowCasters: AbstractMesh[]
  /** Everything that should receive shadows. */
  shadowReceivers: AbstractMesh[]
  materials: PBRMaterial[]
}

function pbr(scene: Scene, name: string, albedo: Color3, roughness: number, metallic = 0): PBRMaterial {
  const m = new PBRMaterial(name, scene)
  m.albedoColor = albedo
  m.roughness = roughness
  m.metallic = metallic
  m.maxSimultaneousLights = MAX_LIGHTS_PER_MATERIAL
  return m
}

/** Merge fixtures into at most `n` light positions (row-major chunks, centroid each). */
export function groupFixtures(fixtures: Array<{ x: number; z: number }>, n: number): Array<{ x: number; z: number }> {
  if (fixtures.length <= n) return fixtures.map((f) => ({ x: f.x, z: f.z }))
  const sorted = [...fixtures].sort((a, b) => a.z - b.z || a.x - b.x)
  const per = Math.ceil(sorted.length / n)
  const groups: Array<{ x: number; z: number }> = []
  for (let i = 0; i < sorted.length; i += per) {
    const chunk = sorted.slice(i, i + per)
    groups.push({
      x: chunk.reduce((a, f) => a + f.x, 0) / chunk.length,
      z: chunk.reduce((a, f) => a + f.z, 0) / chunk.length,
    })
  }
  return groups
}

function roomAt(layout: BuildingLayout, x: number, z: number): RoomLayout | undefined {
  return layout.rooms.find((r) => x >= r.x && x < r.x + r.w && z >= r.z && z < r.z + r.d)
}

/**
 * Builds the procedural placeholder office from a layout. In M9 the room
 * shells are replaced by baked glTF modules; the handles stay the same so
 * render-state application does not change.
 */
export function buildOffice(scene: Scene, layout: BuildingLayout): OfficeHandles {
  const root = new TransformNode('office', scene)
  const materials: PBRMaterial[] = []
  const mat = (name: string, c: Color3, r: number, m = 0) => {
    const x = pbr(scene, name, c, r, m)
    materials.push(x)
    return x
  }

  const floorMat = mat('floor', new Color3(0.55, 0.42, 0.3), 0.7)
  const wallMat = mat('wall', new Color3(0.86, 0.84, 0.8), 0.9)
  const partitionMat = mat('partition', new Color3(0.78, 0.76, 0.72), 0.9)
  const deskMat = mat('desk', new Color3(0.42, 0.3, 0.2), 0.55)
  const metalMat = mat('metal', new Color3(0.2, 0.2, 0.22), 0.4, 0.8)
  const glassMat = mat('glass', new Color3(0.7, 0.8, 0.9), 0.05)
  glassMat.alpha = 0.18

  const shadowCasters: AbstractMesh[] = []
  const shadowReceivers: AbstractMesh[] = []
  const walls: WallPiece[] = []
  const rooms = new Map<string, RoomHandle>()
  const desks = new Map<string, DeskHandle>()

  const box = (name: string, w: number, h: number, d: number, x: number, y: number, z: number, m: PBRMaterial) => {
    const b = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene)
    b.position.set(x, y, z)
    b.material = m
    b.parent = root
    return b
  }

  // --- Exterior walls with window openings --------------------------------
  const H = layout.wallHeight
  const sideLength: Record<Side, number> = {
    north: layout.width,
    south: layout.width,
    west: layout.depth,
    east: layout.depth,
  }
  const openings: Record<Side, Array<{ from: number; to: number }>> = { north: [], south: [], west: [], east: [] }
  for (const room of layout.rooms) {
    for (const w of room.windows) {
      const offset = w.side === 'north' || w.side === 'south' ? room.x : room.z
      openings[w.side].push({ from: offset + w.at, to: offset + w.at + w.width })
    }
  }

  const placeWall = (side: Side, name: string, from: number, to: number, y0: number, y1: number) => {
    const len = to - from
    const h = y1 - y0
    if (len <= 0.01 || h <= 0.01) return
    const mid = (from + to) / 2
    const horizontal = side === 'north' || side === 'south'
    const fixed =
      side === 'north' ? -WALL_T / 2 : side === 'south' ? layout.depth + WALL_T / 2 : side === 'west' ? -WALL_T / 2 : layout.width + WALL_T / 2
    const mesh = horizontal
      ? box(name, len, h, WALL_T, mid, y0 + h / 2, fixed, wallMat)
      : box(name, WALL_T, h, len, fixed, y0 + h / 2, mid, wallMat)
    walls.push({ mesh, side })
    shadowCasters.push(mesh)
    shadowReceivers.push(mesh)
  }

  for (const side of ['north', 'south', 'west', 'east'] as Side[]) {
    const ops = openings[side].sort((a, b) => a.from - b.from)
    let cursor = 0
    ops.forEach((o, i) => {
      placeWall(side, `wall-${side}-${i}-solid`, cursor, o.from, 0, H)
      placeWall(side, `wall-${side}-${i}-sill`, o.from, o.to, 0, SILL)
      placeWall(side, `wall-${side}-${i}-head`, o.from, o.to, HEAD, H)
      const horizontal = side === 'north' || side === 'south'
      const mid = (o.from + o.to) / 2
      const fixed = side === 'north' ? -WALL_T / 2 : side === 'south' ? layout.depth + WALL_T / 2 : side === 'west' ? -WALL_T / 2 : layout.width + WALL_T / 2
      const pane = horizontal
        ? box(`glass-${side}-${i}`, o.to - o.from, HEAD - SILL, 0.02, mid, (SILL + HEAD) / 2, fixed, glassMat)
        : box(`glass-${side}-${i}`, 0.02, HEAD - SILL, o.to - o.from, fixed, (SILL + HEAD) / 2, mid, glassMat)
      walls.push({ mesh: pane, side })
      cursor = o.to
    })
    placeWall(side, `wall-${side}-end`, cursor, sideLength[side], 0, H)
  }

  // --- Interior partitions (east and south edges of rooms), with doors -----
  const PART_H = 1.1 // dollhouse: partitions are cut low so rooms stay readable
  for (const room of layout.rooms) {
    const eastX = room.x + room.w
    if (eastX < layout.width - 0.01) {
      const doorMid = room.z + room.d / 2
      const a = box(`part-${room.id}-e1`, WALL_T, PART_H, doorMid - DOOR_W / 2 - room.z, eastX, PART_H / 2, (room.z + doorMid - DOOR_W / 2) / 2, partitionMat)
      const bLen = room.z + room.d - (doorMid + DOOR_W / 2)
      const b = box(`part-${room.id}-e2`, WALL_T, PART_H, bLen, eastX, PART_H / 2, doorMid + DOOR_W / 2 + bLen / 2, partitionMat)
      walls.push({ mesh: a }, { mesh: b })
      shadowCasters.push(a, b)
    }
    const southZ = room.z + room.d
    const neighbourBelow = roomAt(layout, room.x + 0.01, southZ + 0.01)
    if (southZ < layout.depth - 0.01 && neighbourBelow) {
      const doorMid = room.x + room.w / 2
      const aLen = doorMid - DOOR_W / 2 - room.x
      const a = box(`part-${room.id}-s1`, aLen, PART_H, WALL_T, room.x + aLen / 2, PART_H / 2, southZ, partitionMat)
      const bLen = room.x + room.w - (doorMid + DOOR_W / 2)
      const b = box(`part-${room.id}-s2`, bLen, PART_H, WALL_T, doorMid + DOOR_W / 2 + bLen / 2, PART_H / 2, southZ, partitionMat)
      walls.push({ mesh: a }, { mesh: b })
      shadowCasters.push(a, b)
    }
  }

  // --- Rooms: ceiling light panels + point lights, furniture --------------
  const overlaps = (m: AbstractMesh, room: RoomLayout) => {
    const b = m.getBoundingInfo().boundingBox
    const min = b.minimumWorld
    const max = b.maximumWorld
    const pad = 0.3
    return max.x >= room.x - pad && min.x <= room.x + room.w + pad && max.z >= room.z - pad && min.z <= room.z + room.d + pad
  }

  for (const room of layout.rooms) {
    const panelMaterial = mat(`panel-${room.id}`, new Color3(0.95, 0.95, 0.92), 0.3)
    const floor = MeshBuilder.CreateGround(`floor-${room.id}`, { width: room.w, height: room.d }, scene)
    floor.position.set(room.x + room.w / 2, 0, room.z + room.d / 2)
    floor.material = floorMat
    floor.parent = root
    shadowReceivers.push(floor)
    const handle: RoomHandle = { layout: room, floor, lights: [], panels: [], panelMaterial, scope: [floor] }
    for (const l of room.ceilingLights) {
      handle.panels.push(box(`panel-${l.id}`, 1.2, 0.04, 0.6, l.x, H - 0.05, l.z, panelMaterial))
    }
    // The sim decides where fixtures are; how many point lights represent
    // them is a rendering budget decision (ADR-0006): sun + sky + one lamp per
    // desk + ceiling lights must stay within MAX_LIGHTS_PER_MATERIAL.
    const ceilingBudget = Math.max(1, MAX_LIGHTS_PER_MATERIAL - 2 - room.desks.length)
    for (const [i, group] of groupFixtures(room.ceilingLights, ceilingBudget).entries()) {
      const light = new PointLight(`ceiling-${room.id}-${i}`, new Vector3(group.x, H - 0.3, group.z), scene)
      light.diffuse = new Color3(1.0, 0.95, 0.86)
      light.range = Math.max(room.w, room.d)
      light.intensity = 0
      handle.lights.push(light)
    }

    for (const d of room.desks) {
      const desk = box(`desk-${d.id}`, 1.4, 0.05, 0.7, d.x, 0.74, d.z, deskMat)
      const legs = box(`desk-${d.id}-legs`, 1.3, 0.72, 0.6, d.x, 0.36, d.z, metalMat)
      legs.scaling.set(1, 1, 0.15)
      const dir = Math.cos(d.rot) >= 0 ? -1 : 1 // screen faces the seat
      const screenMaterial = mat(`screen-${d.id}`, new Color3(0.05, 0.05, 0.06), 0.2)
      const screen = box(`screen-${d.id}`, 0.6, 0.36, 0.03, d.x, 1.0, d.z + dir * 0.2, screenMaterial)
      const stand = box(`stand-${d.id}`, 0.06, 0.2, 0.06, d.x, 0.84, d.z + dir * 0.2, metalMat)
      const shadeMat = mat(`shade-${d.id}`, new Color3(0.9, 0.75, 0.45), 0.6)
      const lampShade = box(`lamp-${d.id}`, 0.16, 0.14, 0.16, d.x + 0.55, 1.05, d.z + dir * 0.15, shadeMat)
      const lamp = new PointLight(`lamp-${d.id}`, new Vector3(d.x + 0.55, 1.0, d.z + dir * 0.1), scene)
      lamp.diffuse = new Color3(1.0, 0.72, 0.42)
      lamp.range = 2.5
      lamp.intensity = 0
      desks.set(d.id, { id: d.id, roomId: room.id, meshes: [desk, legs, screen, stand], screen, screenMaterial, lamp, lampShade })
      handle.scope.push(desk, legs, screen, stand, lampShade)
      shadowCasters.push(desk, legs, screen)
      shadowReceivers.push(desk)
    }

    if (room.kind === 'meeting-room') {
      const cx = room.x + room.w / 2
      const cz = room.z + room.d / 2
      const table = box(`table-${room.id}`, 3, 0.06, 1.4, cx, 0.74, cz, deskMat)
      const base = box(`table-${room.id}-base`, 0.4, 0.72, 0.4, cx, 0.36, cz, metalMat)
      handle.scope.push(table, base)
      shadowCasters.push(table, base)
      shadowReceivers.push(table)
    }
    rooms.set(room.id, handle)
  }

  // Scope lights (ADR-0006): ceiling lights reach their room's floor,
  // furniture and adjacent walls; desk lamps reach only their desk, the room
  // floor and whoever sits there (added per frame in applyRenderState).
  for (const h of rooms.values()) {
    for (const w of walls) if (overlaps(w.mesh, h.layout)) h.scope.push(w.mesh)
    for (const l of h.lights) l.includedOnlyMeshes = [...h.scope]
  }
  for (const d of desks.values()) d.lamp.includedOnlyMeshes = [...d.meshes, rooms.get(d.roomId)!.floor]

  return {
    root,
    walls,
    rooms,
    desks,
    staff: new Map(),
    shadowCasters,
    shadowReceivers,
    materials,
  }
}

/** Placeholder person: capsule body + sphere head (replaced by rigged glTF in M1/M9). */
export function createStaffMesh(scene: Scene, id: string, color: Color3): StaffHandle {
  const root = new TransformNode(`staff-${id}`, scene)
  const bodyMat = pbr(scene, `staff-${id}-body`, color, 0.65)
  const skinMat = pbr(scene, `staff-${id}-skin`, new Color3(0.86, 0.68, 0.55), 0.6)
  const body = MeshBuilder.CreateCapsule(`staff-${id}-body`, { height: 1.15, radius: 0.22 }, scene)
  body.position.y = 0.58
  body.material = bodyMat
  body.parent = root
  const head = MeshBuilder.CreateSphere(`staff-${id}-head`, { diameter: 0.28, segments: 16 }, scene)
  head.position.y = 1.32
  head.material = skinMat
  head.parent = root
  return { id, root, body, head }
}
