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
import type { BuildingLayout, PropKind, PropLayout, RoomLayout } from '../state/render-state'
import type { StaffHandle } from './characters/rig'
import type { Side } from './cutaway'
import { TABLE_ROOMS, tableSeats } from './room-names'
import { exteriorOpenings, facingIntoRoom, hallwayRects, interiorWalls, roomEdgesAlong, splitSpan } from './walls'

export type { StaffHandle } from './characters/rig'

/**
 * Lights that may affect one mesh at once (ADR-0006 light budget). Babylon's
 * WebGPU engine gives every light its own uniform buffer and supports at most
 * 8 per material, so lights are scoped per room and per desk.
 */
export const MAX_LIGHTS_PER_MATERIAL = 8

const WALL_T = 0.15
const SILL = 0.9
const HEAD = 2.2
/** Seat height of chairs and stools; the seated pose sits on it. */
export const SEAT_HEIGHT = 0.45
/** Table top height (desks and tables). */
export const TABLE_HEIGHT = 0.74
const TABLE_RADIUS = 0.75
/** Dollhouse: interior partitions are cut low so rooms stay readable. */
export const PARTITION_HEIGHT = 1.1

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

/** A prop the render state switches (`devices[].state`): the coffee machine's lamp, a whiteboard in use. */
export interface PropHandle {
  id: string
  kind: PropKind
  roomId: string
  /** The part that lights up, and its colour when on. */
  glow: PBRMaterial | null
  glowColor: Color3
  meshes: AbstractMesh[]
}

export interface OfficeHandles {
  root: TransformNode
  walls: WallPiece[]
  rooms: Map<string, RoomHandle>
  desks: Map<string, DeskHandle>
  props: Map<string, PropHandle>
  staff: Map<string, StaffHandle>
  /** The hallway floor (lot minus rooms) and the pavement outside the entrance. */
  hall: Mesh | null
  street: Mesh
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

/** Sun + sky + one lamp per desk + at least one ceiling light fit on the floor. */
export function lampsLightFloor(deskCount: number): boolean {
  return 2 + deskCount + 1 <= MAX_LIGHTS_PER_MATERIAL
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

/** Floor tint per room kind (wood unless the room's use says otherwise). */
const FLOORS: Partial<Record<RoomLayout['kind'], [number, number, number, number]>> = {
  kitchen: [0.74, 0.72, 0.66, 0.5],
  'server-room': [0.42, 0.44, 0.47, 0.6],
  'photo-studio': [0.3, 0.3, 0.32, 0.75],
}

/**
 * Builds the procedural placeholder office from the sim's layout: floors (the
 * rooms, the hallway between them, the pavement at the entrance), exterior
 * walls with the layout's windows and doors, interior partitions on the room
 * sides with the layout's doors, desks with chairs, the tables the sim seats
 * people at, and the layout's props. In M9 the room shells are replaced by
 * baked glTF modules; the handles stay the same so render-state application
 * does not change.
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
  const hallMat = mat('hall-floor', new Color3(0.6, 0.58, 0.54), 0.85)
  const streetMat = mat('street', new Color3(0.36, 0.37, 0.38), 0.95)
  const wallMat = mat('wall', new Color3(0.86, 0.84, 0.8), 0.9)
  const partitionMat = mat('partition', new Color3(0.78, 0.76, 0.72), 0.9)
  const deskMat = mat('desk', new Color3(0.42, 0.3, 0.2), 0.55)
  const metalMat = mat('metal', new Color3(0.2, 0.2, 0.22), 0.4, 0.8)
  const chairMat = mat('chair', new Color3(0.16, 0.17, 0.19), 0.6)
  const glassMat = mat('glass', new Color3(0.7, 0.8, 0.9), 0.05)
  glassMat.alpha = 0.18
  const floorMats = new Map<string, PBRMaterial>()
  const floorFor = (kind: RoomLayout['kind']) => {
    const f = FLOORS[kind]
    if (!f) return floorMat
    let m = floorMats.get(kind)
    if (!m) floorMats.set(kind, (m = mat(`floor-${kind}`, new Color3(f[0], f[1], f[2]), f[3])))
    return m
  }

  const shadowCasters: AbstractMesh[] = []
  const shadowReceivers: AbstractMesh[] = []
  const walls: WallPiece[] = []
  const rooms = new Map<string, RoomHandle>()
  const desks = new Map<string, DeskHandle>()
  const props = new Map<string, PropHandle>()

  const box = (name: string, w: number, h: number, d: number, x: number, y: number, z: number, m: PBRMaterial, parent: TransformNode = root) => {
    const b = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene)
    b.position.set(x, y, z)
    b.material = m
    b.parent = parent
    return b
  }
  const cylinder = (name: string, diameter: number, h: number, x: number, y: number, z: number, m: PBRMaterial, parent: TransformNode = root, top = diameter) => {
    const c = MeshBuilder.CreateCylinder(name, { diameterTop: top, diameterBottom: diameter, height: h, tessellation: 20 }, scene)
    c.position.set(x, y, z)
    c.material = m
    c.parent = parent
    return c
  }
  /**
   * One mesh from several parts with the same material (fewer draw calls).
   * The result is baked in world space and hangs from the office root, so
   * the parts' parents' matrices must be current when it is called.
   */
  const merged = (name: string, parts: Mesh[]) => {
    if (parts.length === 1) {
      parts[0].name = name
      return parts[0]
    }
    const m = Mesh.MergeMeshes(parts, true, true)!
    m.name = name
    m.parent = root
    return m
  }

  const ox = layout.originX
  const oz = layout.originZ
  const W = layout.width
  const D = layout.depth
  const H = layout.wallHeight

  // --- Floors: rooms (below), the hallway between them, the street ---------
  const hallParts = hallwayRects(layout).map((r, i) => {
    const g = MeshBuilder.CreateGround(`hall-${i}`, { width: r.w, height: r.d }, scene)
    g.position.set(r.x + r.w / 2, 0, r.z + r.d / 2)
    return g
  })
  const hall = hallParts.length ? merged('hall-floor', hallParts) : null
  if (hall) {
    hall.material = hallMat
    hall.parent = root
    shadowReceivers.push(hall)
  }
  const e = layout.entrance
  const outside = Math.max(2, Math.hypot(e.spawn[0] - e.x, e.spawn[1] - e.z) + 1)
  const alongX = e.side === 'north' || e.side === 'south'
  const street = MeshBuilder.CreateGround('street', { width: alongX ? W + 4 : outside, height: alongX ? outside : D + 4 }, scene)
  const sx = e.side === 'west' ? ox - outside / 2 : e.side === 'east' ? ox + W + outside / 2 : ox + W / 2
  const sz = e.side === 'north' ? oz - outside / 2 : e.side === 'south' ? oz + D + outside / 2 : oz + D / 2
  street.position.set(sx, -0.02, sz)
  street.material = streetMat
  street.parent = root
  shadowReceivers.push(street)

  // --- Exterior walls with the layout's windows and doors ------------------
  const sideLength: Record<Side, number> = { north: W, south: W, west: D, east: D }
  const sideCuts: Record<Side, number[]> = {
    north: roomEdgesAlong(layout, 'x').map((x) => x - ox),
    south: roomEdgesAlong(layout, 'x').map((x) => x - ox),
    west: roomEdgesAlong(layout, 'z').map((z) => z - oz),
    east: roomEdgesAlong(layout, 'z').map((z) => z - oz),
  }
  const fixedOf = (side: Side) =>
    side === 'north' ? oz - WALL_T / 2 : side === 'south' ? oz + D + WALL_T / 2 : side === 'west' ? ox - WALL_T / 2 : ox + W + WALL_T / 2
  const placeWall = (side: Side, name: string, from: number, to: number, y0: number, y1: number) => {
    const h = y1 - y0
    if (to - from <= 0.01 || h <= 0.01) return
    // Cut at room edges: each piece is lit by the rooms of one span only.
    for (const [i, [a, b]] of splitSpan(from, to, sideCuts[side]).entries()) {
      const mid = (a + b) / 2
      const fixed = fixedOf(side)
      const mesh =
        side === 'north' || side === 'south'
          ? box(`${name}-${i}`, b - a, h, WALL_T, ox + mid, y0 + h / 2, fixed, wallMat)
          : box(`${name}-${i}`, WALL_T, h, b - a, fixed, y0 + h / 2, oz + mid, wallMat)
      walls.push({ mesh, side })
      shadowCasters.push(mesh)
      shadowReceivers.push(mesh)
    }
  }

  const openings = exteriorOpenings(layout)
  for (const side of ['north', 'south', 'west', 'east'] as Side[]) {
    let cursor = 0
    openings[side].forEach((o, i) => {
      placeWall(side, `wall-${side}-${i}-solid`, cursor, o.from, 0, H)
      placeWall(side, `wall-${side}-${i}-head`, o.from, o.to, HEAD, H)
      if (o.kind === 'window') {
        placeWall(side, `wall-${side}-${i}-sill`, o.from, o.to, 0, SILL)
        const mid = (o.from + o.to) / 2
        const fixed = fixedOf(side)
        const pane =
          side === 'north' || side === 'south'
            ? box(`glass-${side}-${i}`, o.to - o.from, HEAD - SILL, 0.02, ox + mid, (SILL + HEAD) / 2, fixed, glassMat)
            : box(`glass-${side}-${i}`, 0.02, HEAD - SILL, o.to - o.from, fixed, (SILL + HEAD) / 2, oz + mid, glassMat)
        walls.push({ mesh: pane, side })
      }
      cursor = o.to
    })
    placeWall(side, `wall-${side}-end`, cursor, sideLength[side], 0, H)
  }

  // --- Interior partitions on the room sides, open at the layout's doors ---
  const cutsX = roomEdgesAlong(layout, 'x')
  const cutsZ = roomEdgesAlong(layout, 'z')
  interiorWalls(layout).forEach((run, i) => {
    for (const [j, [a, b]] of splitSpan(run.from, run.to, run.axis === 'x' ? cutsX : cutsZ).entries()) {
      const mid = (a + b) / 2
      const mesh =
        run.axis === 'x'
          ? box(`part-${i}-${j}`, b - a, PARTITION_HEIGHT, WALL_T, mid, PARTITION_HEIGHT / 2, run.at, partitionMat)
          : box(`part-${i}-${j}`, WALL_T, PARTITION_HEIGHT, b - a, run.at, PARTITION_HEIGHT / 2, mid, partitionMat)
      walls.push({ mesh })
      shadowCasters.push(mesh)
    }
  })

  // --- Rooms: ceiling light panels + point lights, furniture --------------
  const overlaps = (m: AbstractMesh, room: RoomLayout) => {
    const b = m.getBoundingInfo().boundingBox
    const min = b.minimumWorld
    const max = b.maximumWorld
    const pad = 0.3
    return max.x >= room.x - pad && min.x <= room.x + room.w + pad && max.z >= room.z - pad && min.z <= room.z + room.d + pad
  }

  const propMats = {
    board: mat('whiteboard', new Color3(0.93, 0.94, 0.95), 0.35),
    frame: mat('prop-frame', new Color3(0.62, 0.63, 0.66), 0.4, 0.6),
    shelf: mat('shelf', new Color3(0.36, 0.26, 0.18), 0.7),
    binder: mat('binders', new Color3(0.28, 0.36, 0.5), 0.6),
    pot: mat('pot', new Color3(0.62, 0.36, 0.24), 0.8),
    leaves: mat('leaves', new Color3(0.2, 0.42, 0.2), 0.8),
    counter: mat('counter', new Color3(0.82, 0.8, 0.76), 0.5),
    machine: mat('machine', new Color3(0.12, 0.12, 0.13), 0.35, 0.5),
    cork: mat('cork', new Color3(0.66, 0.52, 0.36), 0.9),
    swatchA: mat('swatch-a', new Color3(0.85, 0.42, 0.3), 0.7),
    swatchB: mat('swatch-b', new Color3(0.3, 0.55, 0.7), 0.7),
    swatchC: mat('swatch-c', new Color3(0.9, 0.78, 0.35), 0.7),
    softbox: mat('softbox', new Color3(0.92, 0.92, 0.9), 0.6),
  }

  for (const room of layout.rooms) {
    const panelMaterial = mat(`panel-${room.id}`, new Color3(0.95, 0.95, 0.92), 0.3)
    const floor = MeshBuilder.CreateGround(`floor-${room.id}`, { width: room.w, height: room.d }, scene)
    floor.position.set(room.x + room.w / 2, 0, room.z + room.d / 2)
    floor.material = floorFor(room.kind)
    floor.parent = root
    shadowReceivers.push(floor)
    const handle: RoomHandle = { layout: room, floor, lights: [], panels: [], panelMaterial, scope: [floor] }
    for (const l of room.ceilingLights) {
      handle.panels.push(box(`panel-${l.id}`, 1.2, 0.04, 0.6, l.x, H - 0.05, l.z, panelMaterial))
    }
    // The sim decides where fixtures are; how many point lights represent
    // them is a rendering budget decision (ADR-0006): sun + sky + one lamp per
    // desk + ceiling lights must stay within MAX_LIGHTS_PER_MATERIAL. In a room
    // with too many desks for that, desk lamps stop lighting the shared floor
    // (only their desk and sitter), so the floor keeps sun, sky and ceiling.
    const ceilingBudget = lampsLightFloor(room.desks.length)
      ? MAX_LIGHTS_PER_MATERIAL - 2 - room.desks.length
      : MAX_LIGHTS_PER_MATERIAL - 2
    for (const [i, group] of groupFixtures(room.ceilingLights, ceilingBudget).entries()) {
      const light = new PointLight(`ceiling-${room.id}-${i}`, new Vector3(group.x, H - 0.3, group.z), scene)
      light.diffuse = new Color3(1.0, 0.95, 0.86)
      light.range = Math.max(room.w, room.d)
      light.intensity = 0
      handle.lights.push(light)
    }

    for (const d of room.desks) {
      // The desk's local +z points at its chair (the sim's seat).
      const node = new TransformNode(`desk-node-${d.id}`, scene)
      node.parent = root
      node.position.set(d.x, 0, d.z)
      node.rotation.y = Math.atan2(d.seat[0] - d.x, d.seat[1] - d.z)
      // Merged parts are baked in world space: the node's matrix must be current first.
      node.computeWorldMatrix(true)
      const seatDist = Math.hypot(d.seat[0] - d.x, d.seat[1] - d.z)
      const wide = room.props.some((p) => p.attachedTo === d.id && p.kind === 'color-monitor')
      const desk = box(`desk-${d.id}`, 1.4, 0.05, 0.7, 0, TABLE_HEIGHT, 0, deskMat, node)
      const legs = box(`desk-${d.id}-legs`, 1.3, 0.72, 0.6, 0, 0.36, 0, metalMat, node)
      legs.scaling.set(1, 1, 0.15)
      const screenMaterial = mat(`screen-${d.id}`, new Color3(0.05, 0.05, 0.06), 0.2)
      const screen = box(`screen-${d.id}`, wide ? 0.8 : 0.6, wide ? 0.42 : 0.36, 0.03, 0, 1.0, -0.2, screenMaterial, node)
      const stand = box(`stand-${d.id}`, 0.06, 0.2, 0.06, 0, 0.84, -0.22, metalMat, node)
      const shadeMat = mat(`shade-${d.id}`, new Color3(0.9, 0.75, 0.45), 0.6)
      const lampShade = box(`lamp-${d.id}`, 0.16, 0.14, 0.16, 0.55, 1.05, -0.15, shadeMat, node)
      const lamp = new PointLight(`lamp-${d.id}`, new Vector3(0.55, 1.0, -0.1), scene)
      lamp.parent = node
      lamp.diffuse = new Color3(1.0, 0.72, 0.42)
      lamp.range = 2.5
      lamp.intensity = 0
      const chair = merged(`chair-${d.id}`, [
        box(`chair-${d.id}-seat`, 0.46, 0.06, 0.44, 0, SEAT_HEIGHT - 0.03, seatDist, chairMat, node),
        box(`chair-${d.id}-back`, 0.44, 0.42, 0.05, 0, SEAT_HEIGHT + 0.26, seatDist + 0.24, chairMat, node),
        box(`chair-${d.id}-post`, 0.06, SEAT_HEIGHT - 0.06, 0.06, 0, (SEAT_HEIGHT - 0.06) / 2, seatDist, chairMat, node),
      ])
      for (const m of [desk, legs, screen, stand, lampShade, chair]) m.computeWorldMatrix(true)
      desks.set(d.id, { id: d.id, roomId: room.id, meshes: [desk, legs, screen, stand, chair], screen, screenMaterial, lamp, lampShade })
      handle.scope.push(desk, legs, screen, stand, lampShade, chair)
      shadowCasters.push(desk, legs, screen, chair)
      shadowReceivers.push(desk)
    }

    if (TABLE_ROOMS.has(room.kind)) {
      // The sim seats meetings and lunch around the room's centre (sim-core `table_seat`).
      const cx = room.x + room.w / 2
      const cz = room.z + room.d / 2
      const table = cylinder(`table-${room.id}`, TABLE_RADIUS * 2, 0.05, cx, TABLE_HEIGHT, cz, deskMat)
      const base = merged(`table-${room.id}-base`, [
        cylinder(`table-${room.id}-post`, 0.12, TABLE_HEIGHT - 0.02, cx, (TABLE_HEIGHT - 0.02) / 2, cz, metalMat),
        cylinder(`table-${room.id}-foot`, 0.6, 0.03, cx, 0.015, cz, metalMat),
      ])
      const seats = tableSeats(room)
      const stools = seats.length
        ? merged(
            `stools-${room.id}`,
            seats.flatMap(([x, z], i) => [
              cylinder(`stool-${room.id}-${i}`, 0.38, 0.05, x, SEAT_HEIGHT - 0.025, z, chairMat),
              cylinder(`stool-${room.id}-${i}-post`, 0.06, SEAT_HEIGHT - 0.05, x, (SEAT_HEIGHT - 0.05) / 2, z, chairMat),
            ]),
          )
        : null
      for (const m of [table, base, ...(stools ? [stools] : [])]) {
        handle.scope.push(m)
        shadowCasters.push(m)
      }
      shadowReceivers.push(table)
    }

    for (const p of room.props) {
      const made = buildProp(p, room)
      if (!made) continue
      props.set(p.id, made)
      for (const m of made.meshes) {
        handle.scope.push(m)
        shadowCasters.push(m)
      }
    }
    rooms.set(room.id, handle)
  }

  /** A prop from the layout, in simple shapes facing into its room. Desk-top items are part of the desk. */
  function buildProp(p: PropLayout, room: RoomLayout): PropHandle | null {
    if (p.attachedTo && (p.kind === 'monitor' || p.kind === 'color-monitor' || p.kind === 'desk-lamp')) return null
    const node = new TransformNode(`prop-${p.id}`, scene)
    node.parent = root
    node.position.set(p.x, 0, p.z)
    node.rotation.y = facingIntoRoom(room, p.x, p.z)
    node.computeWorldMatrix(true)
    const parts: Mesh[] = []
    let glow: PBRMaterial | null = null
    let glowColor = Color3.Black()
    const part = (m: Mesh) => (parts.push(m), m)
    const k = `${p.id}`
    switch (p.kind) {
      case 'whiteboard': {
        glow = mat(`board-${k}`, propMats.board.albedoColor.clone(), 0.35)
        glowColor = new Color3(0.25, 0.25, 0.24)
        part(box(`${k}-board`, 1.5, 0.95, 0.04, 0, 1.3, 0, glow, node))
        part(merged(`${k}-frame`, [
          box(`${k}-leg-l`, 0.04, 1.8, 0.04, -0.72, 0.9, 0.03, propMats.frame, node),
          box(`${k}-leg-r`, 0.04, 1.8, 0.04, 0.72, 0.9, 0.03, propMats.frame, node),
          box(`${k}-foot-l`, 0.05, 0.03, 0.5, -0.72, 0.015, 0.03, propMats.frame, node),
          box(`${k}-foot-r`, 0.05, 0.03, 0.5, 0.72, 0.015, 0.03, propMats.frame, node),
          box(`${k}-tray`, 1.2, 0.03, 0.08, 0, 0.82, 0.05, propMats.frame, node),
        ]))
        break
      }
      case 'archive-shelf':
        part(box(`${k}-case`, 1.2, 1.8, 0.4, 0, 0.9, 0, propMats.shelf, node))
        part(merged(`${k}-binders`, [0.35, 0.8, 1.25].map((y, i) => box(`${k}-row-${i}`, 1.05, 0.32, 0.3, 0, y, 0.06, propMats.binder, node))))
        break
      case 'coffee-machine': {
        glow = mat(`lamp-${k}`, new Color3(0.2, 0.05, 0.03), 0.4)
        glowColor = new Color3(1, 0.3, 0.12)
        part(box(`${k}-counter`, 1.4, 0.9, 0.6, 0, 0.45, 0, propMats.counter, node))
        part(box(`${k}-body`, 0.34, 0.44, 0.36, 0, 1.12, -0.04, propMats.machine, node))
        part(box(`${k}-light`, 0.06, 0.03, 0.01, 0.1, 1.24, 0.145, glow, node))
        break
      }
      case 'plant':
        part(cylinder(`${k}-pot`, 0.3, 0.36, 0, 0.18, 0, propMats.pot, node, 0.38))
        part(MeshBuilder.CreateSphere(`${k}-leaves`, { diameter: 0.62, segments: 10 }, scene))
        parts[1].position.set(0, 0.72, 0)
        parts[1].scaling.y = 1.2
        parts[1].material = propMats.leaves
        parts[1].parent = node
        break
      case 'camera-rig':
        part(merged(`${k}-tripod`, [
          cylinder(`${k}-mast`, 0.05, 1.35, 0, 0.68, 0, propMats.frame, node),
          ...[0, 1, 2].map((i) => {
            const leg = box(`${k}-leg-${i}`, 0.03, 0.8, 0.03, Math.sin((i * 2 * Math.PI) / 3) * 0.2, 0.36, Math.cos((i * 2 * Math.PI) / 3) * 0.2, propMats.frame, node)
            leg.rotation.set(Math.cos((i * 2 * Math.PI) / 3) * 0.45, 0, -Math.sin((i * 2 * Math.PI) / 3) * 0.45)
            return leg
          }),
        ]))
        part(box(`${k}-camera`, 0.2, 0.14, 0.26, 0, 1.42, 0, propMats.machine, node))
        part(box(`${k}-softbox`, 0.7, 0.7, 0.08, 0.7, 1.6, -0.3, propMats.softbox, node))
        parts[parts.length - 1].rotation.y = -0.6
        break
      case 'mood-board-wall':
        part(box(`${k}-board`, 2.0, 1.2, 0.05, 0, 1.25, 0, propMats.cork, node))
        part(merged(`${k}-legs`, [
          box(`${k}-leg-l`, 0.05, 1.85, 0.05, -0.95, 0.925, -0.02, propMats.frame, node),
          box(`${k}-leg-r`, 0.05, 1.85, 0.05, 0.95, 0.925, -0.02, propMats.frame, node),
        ]))
        part(box(`${k}-swatch-a`, 0.5, 0.35, 0.01, -0.55, 1.45, 0.03, propMats.swatchA, node))
        part(box(`${k}-swatch-b`, 0.42, 0.5, 0.01, 0.1, 1.2, 0.03, propMats.swatchB, node))
        part(box(`${k}-swatch-c`, 0.38, 0.3, 0.01, 0.62, 1.5, 0.03, propMats.swatchC, node))
        break
      case 'monitor':
      case 'color-monitor':
        part(box(`${k}-screen`, p.kind === 'color-monitor' ? 0.8 : 0.6, 0.38, 0.03, 0, 1.0, 0, propMats.machine, node))
        break
      case 'desk-lamp':
        part(box(`${k}-shade`, 0.16, 0.14, 0.16, 0, 1.05, 0, propMats.counter, node))
        break
    }
    for (const m of parts) m.computeWorldMatrix(true)
    return { id: p.id, kind: p.kind, roomId: room.id, glow, glowColor, meshes: parts }
  }

  // Scope lights (ADR-0006): ceiling lights reach their room's floor,
  // furniture and adjacent walls; desk lamps reach only their desk, the room
  // floor and whoever sits there (added per frame by the staff layer).
  for (const h of rooms.values()) {
    for (const w of walls) {
      w.mesh.computeWorldMatrix(true)
      if (overlaps(w.mesh, h.layout)) h.scope.push(w.mesh)
    }
    for (const l of h.lights) l.includedOnlyMeshes = [...h.scope]
  }
  for (const d of desks.values()) {
    const room = rooms.get(d.roomId)!
    d.lamp.includedOnlyMeshes = lampsLightFloor(room.layout.desks.length) ? [...d.meshes, room.floor] : [...d.meshes]
  }

  return {
    root,
    walls,
    rooms,
    desks,
    props,
    staff: new Map(),
    hall,
    street,
    shadowCasters,
    shadowReceivers,
    materials,
  }
}
