/**
 * The brick office (FEAT-081, ADR-0063, ADR-0065, ADR-0085): every room, the
 * hallway and the street built from the construction kit. The box office
 * (`../office.ts`) stays the scene's skeleton (lights, labels, picking, the
 * people) and its geometry is switched off; its lights reach the brick
 * meshes the same way (ADR-0006 scopes), and the cutaway (ADR-0005) hides
 * brick walls by the same rule as box walls. `rooms` narrows it to some
 * kinds (the bench compares the spike's two rooms).
 *
 * One thin-instanced mesh per region, colour and template shape per room,
 * plus one stud mesh per region and colour (`chunk.ts`); one material per
 * palette colour (glowing colours emissive; the bulbs one per room, lit by
 * the room's light level). Surfaces (`surfaces.ts`) are planes in front of
 * the monitors' screens and the whiteboard.
 */
import {
  Color3,
  Constants,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  RawTexture,
  SceneInstrumentation,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
  VertexBuffer,
  VertexData,
  type Scene,
} from '@babylonjs/core'
import type { BuildingLayout, RenderState, RoomKind, RoomLayout, Side } from '../../state/render-state'
import { isCutAway } from '../cutaway'
import type { Lighting } from '../lighting'
import { lampsLightFloor, MAX_LIGHTS_PER_MATERIAL, type OfficeHandles } from '../office'
import { hallwayRects } from '../walls'
import { townOf, townPath, type TownLayout, type TownSpot } from './town'
import type { Arrival } from './arrivals'
import { buildRoomChunk, exteriorSides, shellOrigin, STUD_HEIGHT, STUD_RADIUS, type ChunkSource, type Region, type RoomChunk, type SurfaceAnchor } from './chunk'
import { baseplateMesh, floorMesh, paintFloor } from './floor'
import { envIntensityFor, plasticEnvironment } from './environment'
import { BrickSeamPlugin } from './seams'
import { mappingOf, paletteOf, type KitApi, type KitBuildLike, type PaletteColour } from './kit'
import { modelPlacement, modelRoom } from './model'
import { FLOOR_TOP, roomPlacements, STUD, turnXZ, type DesignInfo, type Turn } from './placements'
import {
  boardView,
  CLOSE_PX,
  estimate,
  monitorGlow,
  monitorView,
  paintBoard,
  paintMonitor,
  SurfaceScheduler,
  viewKey,
  type BoardCard,
  type MonitorFacts,
  type SurfaceLevel,
} from './surfaces'

/** The spike's rooms (docs/design/brick-office.md section 8). */
export const SPIKE_ROOMS: readonly RoomKind[] = ['newsroom', 'editor-office']

/** Every room kind: the office is bricks throughout. */
export const ALL_ROOMS: readonly RoomKind[] = [
  'newsroom',
  'editor-office',
  'meeting-room',
  'archive',
  'photo-studio',
  'seo-lab',
  'translation-desk',
  'design-studio',
  'ceo-office',
  'kitchen',
  'server-room',
  'finance-office',
  'strategy-room',
]

/** Text for the surfaces, from the browser store (rule 2); `main.ts` wires it. */
export interface SurfaceSources {
  person(staffId: string): { name: string } | undefined
  job(workItemId: string): { title: string; stage: string } | undefined
  board(): readonly BoardCard[]
}

export interface BrickRoomStats {
  room: string
  kind: RoomKind
  /** Bricks (parts) and studs for the room, and what the kit says it compiled. */
  instances: number
  /** Of the instances, the floor tiles painted into the floor plane instead of drawn. */
  floorTiles?: number
  studs: number
  kitInstances: number
  kitStuds: number
  meshes: number
  studMeshes: number
  placements: number
  surfaces: number
  /** Kit compile (the room's shell chunks, and its designs not compiled for an earlier room) and Babylon mesh build, ms. */
  compileMs: number
  meshMs: number
}

export interface BrickOfficeStats {
  rooms: BrickRoomStats[]
  instances: number
  studs: number
  meshes: number
  /** Brick meshes Babylon drew last frame (enabled, in the frustum). */
  activeBrickMeshes: number
  /** Draw calls of the last frame (the whole scene), from Babylon's instrumentation. */
  drawCalls: number
  kitLoadMs: number | null
  /** `roomShells(layout)`: the shell designs of every room of the layout (the kit makes them all at once). */
  shellsMs: number
  /** The hallway and the street, from the kit's ground shells. */
  grounds?: { count: number; instances: number; meshes: number }
  buildMs: number
  surfaces: { monitors: number; boards: number; close: number; redraws: number; maxRedrawsPerFrame: number }
  studsShown: boolean
  /** The model table's town, or null when there is none. */
  model?: { room: string; hash: string; instances: number; kitInstances: number; scale: number; shown: boolean } | null
}

interface SurfaceHandle {
  id: string
  kind: 'monitor' | 'whiteboard'
  anchor: SurfaceAnchor
  mesh: Mesh
  material: StandardMaterial
  texture: RawTexture | null
  canvas: { w: number; h: number; ctx: CanvasRenderingContext2D | null } | null
  level: SurfaceLevel
  glow: Color3
}

interface RoomBuild {
  chunk: RoomChunk
  meshes: Array<{ mesh: Mesh; region: Region }>
  studs: Array<{ mesh: Mesh; region: Region }>
  /** The floor layer, one textured plane (`floor.ts`), or null when the shell has none. */
  floor: Mesh | null
  stats: BrickRoomStats
}

export interface BrickOffice {
  rooms: Map<string, RoomBuild>
  /** The town's houses (ADR-0086): where each section stands. */
  town: TownSpot[]
  /**
   * The layout's town items as drawn (ADR-0087): id, design and the world
   * rect each covers, for picking and highlighting. Empty when the town is
   * the generic arrangement (the layout has no `town`).
   */
  townItems: TownItemRect[]
  surfaces: SurfaceHandle[]
  /** The fresh equipment's nodes (`BrickOfficeOptions.fresh`), in build order; empty without. */
  arrivals: Arrival[]
  /** Apply a render state (lights, monitors); call after the box office's own update. */
  update(state: RenderState): void
  /** Cutaway and surfaces for this frame (registered before every render). */
  frame(): void
  setSources(sources: SurfaceSources | null): void
  setStuds(on: boolean): void
  /**
   * The site's brick town on the model table (ADR-0072): a design JSON from
   * the central server, or null to clear. Rebuilt only when it changes.
   */
  setModel(designJson: string | null): void
  stats(): BrickOfficeStats
  dispose(): void
}

export interface TownItemRect {
  id: string
  design: string
  x: number
  z: number
  turn: Turn
  rect: { x: number; z: number; w: number; d: number }
}

export interface BrickOfficeOptions {
  rooms?: readonly RoomKind[]
  /**
   * Level of detail (ADR-0063 decision 5): `full` draws every brick of the
   * shells; `merged` (the low tier) merges each colour's touching shell
   * bricks into a few boxes, so walls lose their seams and the office costs
   * a fraction of the vertices, and the plastic loses its clear coat and
   * reflections.
   */
  detail?: 'full' | 'merged'
  kitLoadMs?: number | null
  now?: () => number
  /** Redraw budget per frame. */
  budget?: number
  /** The houses' signs by section id (the UI's labels); the town's own names otherwise. */
  signs?: Record<string, string>
  /**
   * Equipment that has just been placed (FEAT-084, in build order): each is built as its own
   * meshes under a node (`BrickOffice.arrivals`) for the construction animation (`arrivals.ts`),
   * a desk with its chair. Absent or empty: every placement goes into its room's batches.
   */
  fresh?: readonly string[]
}

const hex = (h: string) => Color3.FromHexString(h).toLinearSpace()

/** ABS plastic: glossy, never matte. */
export const PLASTIC_ROUGHNESS = 0.24

/** Materials per palette colour (PBR, the prototype's look); glowing colours emissive. */
function makeMaterial(scene: Scene, c: PaletteColour, name = `brick-${c.id}`, gloss = true): PBRMaterial {
  const m = new PBRMaterial(name, scene)
  m.albedoColor = hex(c.hex)
  m.metallic = (c.metal ?? 0) / 1000
  m.roughness = c.rough !== undefined ? c.rough / 1000 : 0.36
  m.maxSimultaneousLights = MAX_LIGHTS_PER_MATERIAL
  if (c.class === 'transparent') {
    m.alpha = (c.alpha ?? 220) / 1000
    m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND
  }
  if (c.emissive) {
    m.emissiveColor = hex(c.emissive)
    m.emissiveIntensity = (c.glow ?? 1000) / 1000
  }
  // Solid plastic: glossy ABS with a clear coat for the glints, and its seams; glass and light are not.
  if (c.class === 'solid' && !c.emissive) {
    m.roughness = c.rough !== undefined ? c.rough / 1000 : PLASTIC_ROUGHNESS
    m.clearCoat.isEnabled = gloss
    m.clearCoat.intensity = 0.55
    m.clearCoat.roughness = 0.12
  }
  if (c.class !== 'transparent' && !c.emissive) new BrickSeamPlugin(m)
  return m
}

const now0 = () => (typeof performance === 'undefined' ? Date.now() : performance.now())

/**
 * Builds the brick rooms into a scene that already has the box office and
 * switches the box office's meshes in those rooms off. Synchronous once the
 * kit is loaded (`loadKit`).
 */
export function buildBrickOffice(scene: Scene, kit: KitApi, layout: BuildingLayout, office: OfficeHandles, lighting: Lighting | null, opts: BrickOfficeOptions = {}): BrickOffice {
  const now = opts.now ?? now0
  const t0 = now()
  const kinds = new Set(opts.rooms ?? ALL_ROOMS)
  // The low tier (merged) skips the clear coat and the reflections: the cheaper plastic.
  const gloss = opts.detail !== 'merged'
  const mapping = mappingOf(kit)
  const palette = new Map(paletteOf(kit).map((c) => [c.id, c]))
  const rooms = layout.rooms.filter((r) => kinds.has(r.kind))

  // --- compile (designs once per id and params; shells per chunk) ---------
  const cache = new Map<string, { build: KitBuildLike; info: DesignInfo & { surfaces: NonNullable<ChunkSource['surfaces']> } }>()
  const compiled = (design: string, params: string) => {
    const key = `${design}|${params}`
    let c = cache.get(key)
    if (!c) {
      const build = kit.compileShipped(design, params)
      if (!build.ok()) throw new Error(`kit: ${design} did not compile: ${build.issuesJson()}`)
      const info = JSON.parse(build.infoJson())
      c = { build, info: { bounds: info.bounds, mount: info.mount, ports: info.ports, surfaces: info.surfaces } }
      cache.set(key, c)
    }
    return c
  }
  const shellsStart = now()
  const shells = JSON.parse(kit.roomShells(JSON.stringify(layout))) as Record<string, Array<{ offset: [number, number]; design: unknown }>>
  const shellsMs = now() - shellsStart
  const ownBuilds: KitBuildLike[] = []

  // --- materials ------------------------------------------------------------
  const materials = new Map<string, PBRMaterial>()
  const roomBulbs = new Map<string, PBRMaterial>()
  const materialFor = (colour: string, room: string) => {
    const c = palette.get(colour) ?? { id: colour, name: colour, hex: '#ff00ff', class: 'solid' }
    if (colour === 'bulb') {
      let m = roomBulbs.get(room)
      if (!m) roomBulbs.set(room, (m = makeMaterial(scene, c, `brick-bulb-${room}`, gloss)))
      return m
    }
    let m = materials.get(colour)
    if (!m) materials.set(colour, (m = makeMaterial(scene, c, undefined, gloss)))
    return m
  }

  // --- templates: one shape per template kind. Each mesh gets its own copy of the vertex data:
  // a geometry shared by thin-instanced meshes shares its cached vertex array object under
  // WebGL2, and every mesh would then draw the first one's instance buffer.
  const templates = {
    box: MeshBuilder.CreateBox('brick-template-box', { size: 1 }, scene),
    cylinder: MeshBuilder.CreateCylinder('brick-template-cylinder', { diameter: 1, height: 1, tessellation: 16 }, scene),
    stud: MeshBuilder.CreateCylinder('brick-template-stud', { diameter: 2 * STUD_RADIUS, height: STUD_HEIGHT, tessellation: 10 }, scene),
  }
  const shapes = {
    box: VertexData.ExtractFromMesh(templates.box),
    cylinder: VertexData.ExtractFromMesh(templates.cylinder),
    stud: VertexData.ExtractFromMesh(templates.stud),
  }
  for (const t of Object.values(templates)) t.dispose()
  const instanced = (name: string, shape: VertexData, matrices: Float32Array, material: PBRMaterial) => {
    const m = new Mesh(name, scene)
    shape.applyToMesh(m)
    m.material = material
    m.thinInstanceSetBuffer('matrix', matrices, 16, true)
    m.thinInstanceRefreshBoundingInfo(false)
    m.freezeWorldMatrix()
    m.isPickable = false
    return m
  }

  const hexOf = (colour: string) => palette.get(colour)?.hex ?? '#ff00ff'
  const floorOf = (name: string, chunk: RoomChunk) => {
    const image = paintFloor(chunk.floor, hexOf)
    if (!image) return null
    const m = floorMesh(scene, name, image, chunk.floorTop)
    ;(m.material as PBRMaterial).maxSimultaneousLights = MAX_LIGHTS_PER_MATERIAL
    return m
  }

  const roomBuilds = new Map<string, RoomBuild>()
  const surfaceAnchors: SurfaceAnchor[] = []
  // The construction animation's items: built apart, each under its own node (pivot on its footprint centre).
  const freshIds = new Set(opts.fresh ?? [])
  const arrivalsById = new Map<string, Arrival>()
  /** The surfaces of fresh items: their planes ride with the item's node. */
  const freshSurface = new Map<string, TransformNode>()
  for (const room of rooms) {
    const c0 = now()
    const sources: ChunkSource[] = []
    for (const s of shells[room.id] ?? []) {
      const b = kit.compile(JSON.stringify(s.design), '')
      if (!b.ok()) throw new Error(`kit: the shell of ${room.id} did not compile: ${b.issuesJson()}`)
      ownBuilds.push(b)
      sources.push({ build: b, origin: shellOrigin(room, s.offset), shell: true })
    }
    const { placements } = roomPlacements(room, mapping, (d, p) => compiled(d, p).info)
    /** Fresh items' sources by the equipment id they belong to (a chair goes with its desk). */
    const freshSources = new Map<string, { at: [number, number]; list: ChunkSource[] }>()
    for (const p of placements) {
      const c = compiled(p.design, p.params)
      const src: ChunkSource = {
        build: c.build,
        placement: p,
        footprint: [c.info.bounds[0], c.info.bounds[1]],
        shell: false,
        surfaces: p.surface ? c.info.surfaces.filter((s) => s.name === p.surface) : [],
      }
      const owner = freshIds.has(p.id) ? p.id : p.desk && freshIds.has(p.desk) ? p.desk : null
      if (!owner) {
        sources.push(src)
        continue
      }
      let f = freshSources.get(owner)
      if (!f) freshSources.set(owner, (f = { at: [p.x, p.z], list: [] }))
      if (p.id === owner) f.at = [p.x, p.z]
      f.list.push(src)
    }
    const compileMs = now() - c0
    const m0 = now()
    const exterior = exteriorSides(room, layout)
    const chunk = buildRoomChunk(room, exterior, sources, { merge: opts.detail === 'merged' })
    const meshes = chunk.instances.map((b) => ({
      mesh: instanced(`bricks-${room.id}-${b.key}`, shapes[b.shape], b.matrices, materialFor(b.colour, room.id)),
      region: b.region,
    }))
    const studs = chunk.studs.map((b) => ({ mesh: instanced(`studs-${room.id}-${b.key}`, shapes.stud, b.matrices, materialFor(b.colour, room.id)), region: b.region }))
    for (const [id, f] of freshSources) {
      // Built where it stands; the node's pivot is its footprint centre on the floor, so it drops and grows in place.
      const node = new TransformNode(`arrive-${id}`, scene)
      node.setPivotPoint(new Vector3(f.at[0], 0, f.at[1]))
      const part = buildRoomChunk(room, exterior, f.list)
      const own = (name: string, shape: VertexData, matrices: Float32Array, colour: string) => {
        const m = instanced(name, shape, matrices, materialFor(colour, room.id))
        // It moves with its node while it arrives: its world matrix is not frozen.
        m.unfreezeWorldMatrix()
        m.parent = node
        return { mesh: m, region: 'base' as Region }
      }
      for (const b of part.instances) meshes.push(own(`bricks-${room.id}-${id}-${b.key}`, shapes[b.shape], b.matrices, b.colour))
      for (const b of part.studs) studs.push(own(`studs-${room.id}-${id}-${b.key}`, shapes.stud, b.matrices, b.colour))
      for (const a of part.surfaces) freshSurface.set(a.owner, node)
      chunk.surfaces.push(...part.surfaces)
      chunk.instanceCount += part.instanceCount
      chunk.studCount += part.studCount
      arrivalsById.set(id, { id, room: room.id, node })
    }
    const floor = floorOf(`bricks-${room.id}-floor`, chunk)
    const meshMs = now() - m0
    surfaceAnchors.push(...chunk.surfaces)
    roomBuilds.set(room.id, {
      chunk,
      meshes,
      studs,
      floor,
      stats: {
        room: room.id,
        kind: room.kind,
        instances: chunk.instanceCount,
        floorTiles: chunk.floor.length,
        studs: chunk.studCount,
        kitInstances: sources.reduce((a, s) => a + s.build.instanceCount(), 0),
        kitStuds: sources.reduce((a, s) => a + s.build.studCount(), 0),
        meshes: meshes.length,
        studMeshes: studs.length,
        placements: placements.length,
        surfaces: chunk.surfaces.length,
        compileMs,
        meshMs,
      },
    })
  }

  // --- the grounds: the hallway between the rooms and the street outside ---
  const groundMeshes: Mesh[] = []
  let groundInstances = 0
  const groundList = groundRects(layout)
  for (const g of groundList) {
    const chunks = JSON.parse(kit.groundShell(JSON.stringify({ id: g.id, style: g.style, w: g.w, d: g.d }))) as Array<{ offset: [number, number]; design: unknown }>
    const at = { id: g.id, x: g.x, z: g.z, w: g.w, d: g.d } as RoomLayout
    const sources: ChunkSource[] = chunks.map((s) => {
      const b = kit.compile(JSON.stringify(s.design), '')
      if (!b.ok()) throw new Error(`kit: the ground ${g.id} did not compile: ${b.issuesJson()}`)
      ownBuilds.push(b)
      return { build: b, origin: shellOrigin(at, s.offset), shell: true }
    })
    const chunk = buildRoomChunk(at, [], sources, { merge: opts.detail === 'merged' })
    groundInstances += chunk.instanceCount
    for (const b of chunk.instances) groundMeshes.push(instanced(`bricks-${g.id}-${b.key}`, shapes[b.shape], b.matrices, materialFor(b.colour, g.id)))
    for (const b of chunk.studs) groundMeshes.push(instanced(`studs-${g.id}-${b.key}`, shapes.stud, b.matrices, materialFor(b.colour, g.id)))
    const floor = floorOf(`bricks-${g.id}-floor`, chunk)
    if (floor) groundMeshes.push(floor)
  }
  // --- the town (ADR-0086, ADR-0087): the sections' houses and the furniture, from the layout's
  // `town` when it has one, else the generic arrangement; their fronts to the office ---------
  const { spots: town, props: scenery } = townOf(layout as TownLayout)
  const townMeshes: Mesh[] = []
  const townItems: TownItemRect[] = []
  for (const spot of town) {
    const params = JSON.stringify(spot.params)
    const c = compiled('town-house', params)
    const at = { id: `town-${spot.id}`, ...spot.rect } as unknown as RoomLayout
    const placement = { id: `town-${spot.id}`, role: 'prop' as const, design: 'town-house', params, x: spot.x, y: -FLOOR_TOP, z: spot.z, turn: spot.turn, standIn: true }
    const chunk = buildRoomChunk(at, [], [{ build: c.build, placement, footprint: [c.info.bounds[0], c.info.bounds[1]], shell: false, merge: true }], { merge: opts.detail === 'merged' })
    for (const b of chunk.instances) townMeshes.push(instanced(`bricks-town-${spot.id}-${b.key}`, shapes[b.shape], b.matrices, materialFor(b.colour, `town-${spot.id}`)))
    for (const b of chunk.studs) townMeshes.push(instanced(`studs-town-${spot.id}-${b.key}`, shapes.stud, b.matrices, materialFor(b.colour, `town-${spot.id}`)))
    const sign = signMesh(scene, spot, opts.signs?.[spot.id] ?? spot.label)
    if (sign) townMeshes.push(sign)
    if (spot.item) townItems.push({ id: spot.item, design: 'town-house', x: spot.x, z: spot.z, turn: spot.turn, rect: spot.rect })
  }
  // The town's furniture: lamps, benches, trees; one chunk for all of it.
  {
    const sources: ChunkSource[] = scenery.map((p) => {
      const params = JSON.stringify(p.params)
      const c = compiled(p.design, params)
      const placement = { id: `town-${p.id}`, role: 'prop' as const, design: p.design, params, x: p.x, y: -FLOOR_TOP, z: p.z, turn: p.turn, standIn: true }
      if (p.item) townItems.push({ id: p.item, design: p.design, x: p.x, z: p.z, turn: p.turn, rect: footprintRect(p.x, p.z, c.info.bounds, p.turn) })
      return { build: c.build, placement, footprint: [c.info.bounds[0], c.info.bounds[1]] as [number, number], shell: false, merge: true }
    })
    const at = { id: 'town-scenery', x: layout.originX, z: layout.originZ, w: layout.width, d: layout.depth } as unknown as RoomLayout
    const chunk = buildRoomChunk(at, [], sources, { merge: opts.detail === 'merged' })
    for (const b of chunk.instances) townMeshes.push(instanced(`bricks-town-scenery-${b.key}`, shapes[b.shape], b.matrices, materialFor(b.colour, 'town')))
    for (const b of chunk.studs) townMeshes.push(instanced(`studs-town-scenery-${b.key}`, shapes.stud, b.matrices, materialFor(b.colour, 'town')))
  }
  for (const m of townMeshes) {
    m.receiveShadows = true
    if (lighting?.shadows && m.name.startsWith('bricks-')) lighting.shadows.addShadowCaster(m)
  }

  // The world the office stands on: a green baseplate, studs and all, well past the street.
  {
    const margin = 16
    const plate = baseplateMesh(scene, 'bricks-baseplate', layout.originX - margin, layout.originZ - margin, layout.width + 2 * margin, layout.depth + 2 * margin, -FLOOR_TOP - 0.002, hexOf('green'))
    ;(plate.material as PBRMaterial).maxSimultaneousLights = MAX_LIGHTS_PER_MATERIAL
    groundMeshes.push(plate)
  }
  for (const m of groundMeshes) m.receiveShadows = true
  if (groundMeshes.length) {
    office.hall?.setEnabled(false)
    office.street.setEnabled(false)
  }

  // --- the box office in those rooms: off --------------------------------
  const brickRooms = new Map(rooms.map((r) => [r.id, r]))
  for (const id of brickRooms.keys()) {
    const h = office.rooms.get(id)
    if (!h) continue
    h.floor.setEnabled(false)
    for (const p of h.panels) p.setEnabled(false)
  }
  for (const d of office.desks.values()) {
    if (!brickRooms.has(d.roomId)) continue
    for (const m of [...d.meshes, d.lampShade]) m.setEnabled(false)
  }
  for (const p of office.props.values()) if (brickRooms.has(p.roomId)) for (const m of p.meshes) m.setEnabled(false)
  // Wall pieces (exterior walls, panes, partitions) along a brick room's sides: its own walls replace them.
  for (const w of office.walls) {
    const b = w.mesh.getBoundingInfo().boundingBox
    const c = b.centerWorld
    const ext = b.extendSizeWorld
    const alongX = ext.x >= ext.z
    for (const r of brickRooms.values()) {
      const inside = alongX
        ? c.x > r.x + 0.01 && c.x < r.x + r.w - 0.01 && c.z > r.z - 0.2 && c.z < r.z + r.d + 0.2
        : c.z > r.z + 0.01 && c.z < r.z + r.d - 0.01 && c.x > r.x - 0.2 && c.x < r.x + r.w + 0.2
      if (inside) {
        w.mesh.setEnabled(false)
        break
      }
    }
  }

  // --- lights (ADR-0006 scopes) and shadows --------------------------------
  for (const [id, rb] of roomBuilds) {
    const all = [...rb.meshes, ...rb.studs].map((m) => m.mesh).concat(rb.floor ? [rb.floor] : [])
    const h = office.rooms.get(id)
    for (const l of h?.lights ?? []) l.includedOnlyMeshes.push(...all)
    const lampsReach = lampsLightFloor(brickRooms.get(id)!.desks.length)
    for (const d of office.desks.values()) if (d.roomId === id && lampsReach) d.lamp.includedOnlyMeshes.push(...rb.meshes.map((m) => m.mesh), ...(rb.floor ? [rb.floor] : []))
    if (rb.floor) rb.floor.receiveShadows = true
    if (lighting?.shadows) {
      for (const { mesh } of rb.meshes) {
        mesh.receiveShadows = true
        const mat = mesh.material as PBRMaterial
        if (mat.alpha >= 1) lighting.shadows.addShadowCaster(mesh)
      }
    }
  }
  // The room names stay paint on the floor: the shells are lowered so the brick floor's top is y = 0.

  // --- surfaces ------------------------------------------------------------
  const surfaces: SurfaceHandle[] = surfaceAnchors.map((a, i) => {
    const kind = a.name === 'whiteboard' ? 'whiteboard' : 'monitor'
    const id = `${a.owner}/${a.name}`
    const mesh = MeshBuilder.CreatePlane(`surface-${id}`, { width: a.size[0] * 0.94, height: a.size[1] * 0.92 }, scene)
    // Texture row 0 is the canvas' top (raw upload, not flipped): v = 0 at the top edge.
    mesh.setVerticesData(VertexBuffer.UVKind, new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]))
    mesh.position.set(a.centre[0] + a.normal[0] * 0.004, a.centre[1], a.centre[2] + a.normal[2] * 0.004)
    // A plane faces -z: turn it so its front looks along the surface's normal.
    mesh.rotation.y = Math.atan2(-a.normal[0], -a.normal[2])
    mesh.isPickable = false
    const rides = freshSurface.get(a.owner)
    if (rides) mesh.parent = rides
    const material = new StandardMaterial(`surface-${i}`, scene)
    material.disableLighting = true
    material.diffuseColor = Color3.Black()
    material.specularColor = Color3.Black()
    material.emissiveColor = kind === 'whiteboard' ? new Color3(0.85, 0.86, 0.84) : Color3.Black()
    mesh.material = material
    return { id, kind, anchor: a, mesh, material, texture: null, canvas: null, level: 'far', glow: material.emissiveColor.clone() }
  })

  const scheduler = new SurfaceScheduler(opts.budget)
  let sources: SurfaceSources | null = null
  let lastState: RenderState | null = null
  let redraws = 0
  let maxRedrawsPerFrame = 0
  const real = typeof document !== 'undefined' && scene.getEngine().name !== 'NullEngine'
  // What the plastic reflects (a generated studio; not under NullEngine).
  if (real && gloss) void plasticEnvironment(scene)

  const ensureCanvas = (s: SurfaceHandle) => {
    if (s.canvas) return s.canvas
    const w = s.kind === 'whiteboard' ? 1024 : 256
    const h = Math.max(32, Math.round((w * s.anchor.size[1]) / s.anchor.size[0]))
    let ctx: CanvasRenderingContext2D | null = null
    if (real) {
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      ctx = c.getContext('2d', { willReadFrequently: true })
    }
    if (ctx) {
      s.texture = new RawTexture(new Uint8Array(w * h * 4), w, h, Constants.TEXTUREFORMAT_RGBA, scene, false, false, Texture.BILINEAR_SAMPLINGMODE)
      s.texture.wrapU = s.texture.wrapV = Texture.CLAMP_ADDRESSMODE
    }
    s.canvas = { w, h, ctx }
    return s.canvas
  }

  const monitorFacts = (s: SurfaceHandle): MonitorFacts => {
    const desk = s.anchor.desk
    const st = lastState
    const person = st?.staff.find((p) => p.seatedAt === desk) ?? null
    return { on: !!(desk && st?.monitors[desk]), pose: person?.pose ?? null, workItem: person?.workItem ?? null, staff: person?.id ?? null }
  }

  const measure = (px: number) => {
    // The label atlas' estimate: canvas measuring per frame is not worth it at these sizes.
    return estimate(px)
  }

  /** What a surface would show at the close level, and how to draw it. */
  const closeView = (s: SurfaceHandle) => {
    const cv = ensureCanvas(s)
    if (s.kind === 'whiteboard') {
      const v = boardView(sources?.board() ?? [], cv.w, cv.h, measure)
      return { key: viewKey(v), paint: (ctx: CanvasRenderingContext2D) => paintBoard(ctx, v) }
    }
    const f = monitorFacts(s)
    const job = f.workItem ? sources?.job(f.workItem) : undefined
    const v = monitorView({ name: (f.staff && sources?.person(f.staff)?.name) || '', job: job?.title ?? '', stage: job?.stage ?? '' }, f, cv.w, cv.h, measure)
    return { key: viewKey(v), paint: (ctx: CanvasRenderingContext2D) => paintMonitor(ctx, v) }
  }

  const camDir = new Vector3()
  const regionHidden = (region: Region, alpha: number) => {
    if (region === 'upper') return true
    if (region === 'base') return false
    return isCutAway(region.slice(5) as Side, alpha)
  }
  let studsShown = true

  const frame = () => {
    const camera = scene.activeCamera
    if (!camera) return
    // The glints follow the sky (lighting is sim state, ADR-0006): faint at night.
    scene.environmentIntensity = envIntensityFor(lighting?.sky.intensity ?? 0.5)
    // Cutaway: the box office's rule on the brick walls.
    const alpha = (camera as unknown as { alpha?: number }).alpha ?? 0
    for (const rb of roomBuilds.values()) {
      for (const m of rb.meshes) m.mesh.setEnabled(!regionHidden(m.region, alpha))
      for (const m of rb.studs) m.mesh.setEnabled(studsShown && !regionHidden(m.region, alpha))
    }
    // Surfaces: level by on-screen size, redraws within the budget.
    const engine = scene.getEngine()
    const span = (camera.orthoTop ?? 1) - (camera.orthoBottom ?? -1)
    const pxPerMetre = engine.getRenderHeight() / Math.max(1e-3, span)
    camera.getDirectionToRef(Vector3.Forward(), camDir)
    const candidates = []
    const views = new Map<string, ReturnType<typeof closeView>>()
    for (const s of surfaces) {
      const facing = -(s.anchor.normal[0] * camDir.x + s.anchor.normal[1] * camDir.y + s.anchor.normal[2] * camDir.z) > 0.05
      const visible = facing && camera.isInFrustum(s.mesh)
      const level: SurfaceLevel = !visible ? 'off' : s.anchor.size[0] * pxPerMetre >= CLOSE_PX && sources ? 'close' : 'far'
      if (level !== s.level) {
        if (level !== 'close') {
          scheduler.forget(s.id)
          s.material.emissiveTexture = null
          s.material.emissiveColor = s.glow
        }
        s.level = level
      }
      let key = ''
      if (level === 'close') {
        const v = closeView(s)
        views.set(s.id, v)
        key = v.key
      }
      candidates.push({ id: s.id, visible, level, key })
    }
    const picked = scheduler.pick(candidates)
    for (const id of picked) {
      const s = surfaces.find((x) => x.id === id)!
      const v = views.get(id)!
      const cv = ensureCanvas(s)
      if (cv.ctx && s.texture) {
        v.paint(cv.ctx)
        const px = cv.ctx.getImageData(0, 0, cv.w, cv.h)
        s.texture.update(new Uint8Array(px.data.buffer, px.data.byteOffset, px.data.byteLength))
        // The emissive texture adds to the emissive colour: black, so the texture shows as drawn.
        s.material.emissiveTexture = s.texture
        s.material.emissiveColor = Color3.Black()
      }
      redraws++
    }
    maxRedrawsPerFrame = Math.max(maxRedrawsPerFrame, picked.length)
  }
  const observer = scene.onBeforeRenderObservable.add(frame)
  const instrumentation = new SceneInstrumentation(scene)

  const update = (state: RenderState) => {
    lastState = state
    // The model table stands while the sim knows a blueprint (rule 8: the render state decides).
    showModel(!!state.siteModel)
    const levels = new Map(state.rooms.map((r) => [r.id, r.light]))
    for (const [room, m] of roomBulbs) {
      const level = levels.get(room) ?? 'off'
      m.emissiveIntensity = level === 'on' ? 3 : level === 'dim' ? 1.2 : 0.05
    }
    for (const s of surfaces) {
      if (s.kind !== 'monitor') continue
      const [r, g, b] = monitorGlow(monitorFacts(s))
      s.glow.set(r, g, b)
      if (s.level !== 'close') s.material.emissiveColor = s.glow
    }
  }

  // --- the model table (ADR-0072): the site's town, scaled onto a table ------
  let model: {
    json: string
    node: TransformNode
    meshes: Mesh[]
    build: KitBuildLike
    stats: Omit<NonNullable<BrickOfficeStats['model']>, 'shown'>
  } | null = null
  /** Whether the render state says the model table stands; false until a state arrives. */
  let modelShown = false
  function showModel(on: boolean) {
    modelShown = on
    for (const m of model?.meshes ?? []) m.setEnabled(on)
  }
  const clearModel = () => {
    if (!model) return
    for (const m of model.meshes) m.dispose()
    model.node.dispose()
    model.build.free()
    model = null
  }
  const setModel = (json: string | null) => {
    if (model && json === model.json) return
    clearModel()
    const room = json ? modelRoom(rooms) : null
    if (!json || !room) return
    const town = kit.compile(json, '')
    if (!town.ok()) {
      console.warn(`[bricks] the site town did not compile: ${town.issuesJson()}`)
      town.free()
      return
    }
    const info = JSON.parse(town.infoJson()) as { hash: string; bounds: [number, number, number] }
    const table = compiled(modelPlacement(room, { bounds: [1, 1, 1] }, info).table.design, '{}')
    const mp = modelPlacement(room, table.info, info)
    const tableChunk = buildRoomChunk(room, [], [{ build: table.build, placement: mp.table, footprint: [table.info.bounds[0], table.info.bounds[1]], shell: false }])
    const townChunk = buildRoomChunk(room, [], [{ build: town, origin: [0, 0, 0], shell: false }])
    const node = new TransformNode('model-town', scene)
    node.position.set(mp.origin[0], mp.origin[1], mp.origin[2])
    node.scaling.setAll(mp.scale)
    const meshes: Mesh[] = []
    for (const [chunk, parent] of [[tableChunk, null], [townChunk, node]] as const) {
      for (const b of chunk.instances) meshes.push(instanced(`model-${chunk === townChunk ? 'town' : 'table'}-${b.key}`, shapes[b.shape], b.matrices, materialFor(b.colour, room.id)))
      for (const b of chunk.studs) meshes.push(instanced(`model-studs-${chunk === townChunk ? 'town' : 'table'}-${b.key}`, shapes.stud, b.matrices, materialFor(b.colour, room.id)))
      if (parent) {
        for (const m of meshes.slice(-chunk.instances.length - chunk.studs.length)) {
          m.unfreezeWorldMatrix()
          m.parent = parent
          m.computeWorldMatrix(true)
          m.freezeWorldMatrix()
        }
      }
    }
    for (const l of office.rooms.get(room.id)?.lights ?? []) l.includedOnlyMeshes.push(...meshes)
    for (const m of meshes) m.setEnabled(modelShown)
    model = {
      json,
      node,
      meshes,
      build: town,
      stats: {
        room: room.id,
        hash: info.hash,
        instances: townChunk.instanceCount,
        kitInstances: town.instanceCount(),
        scale: mp.scale,
      },
    }
  }

  const buildMs = now() - t0
  return {
    rooms: roomBuilds,
    town,
    townItems,
    surfaces,
    arrivals: (opts.fresh ?? []).flatMap((id) => arrivalsById.get(id) ?? []),
    update,
    frame,
    setSources: (s) => {
      sources = s
    },
    setStuds: (on) => {
      studsShown = on
    },
    setModel,
    stats: () => {
      const rs = [...roomBuilds.values()].map((r) => r.stats)
      let active = 0
      for (const rb of roomBuilds.values()) for (const m of [...rb.meshes, ...rb.studs]) if (m.mesh.isEnabled() && m.mesh.isVisible && scene.getActiveMeshes().data.includes(m.mesh)) active++
      return {
        rooms: rs,
        instances: rs.reduce((a, r) => a + r.instances, 0),
        studs: rs.reduce((a, r) => a + r.studs, 0),
        meshes: rs.reduce((a, r) => a + r.meshes + r.studMeshes, 0),
        activeBrickMeshes: active,
        drawCalls: instrumentation.drawCallsCounter.current,
        kitLoadMs: opts.kitLoadMs ?? null,
        shellsMs,
        grounds: { count: groundList.length, instances: groundInstances, meshes: groundMeshes.length },
        buildMs,
        surfaces: {
          monitors: surfaces.filter((s) => s.kind === 'monitor').length,
          boards: surfaces.filter((s) => s.kind === 'whiteboard').length,
          close: surfaces.filter((s) => s.level === 'close').length,
          redraws,
          maxRedrawsPerFrame,
        },
        studsShown,
        model: model ? { ...model.stats, shown: modelShown } : null,
      }
    },
    dispose: () => {
      clearModel()
      scene.onBeforeRenderObservable.remove(observer)
      instrumentation.dispose()
      for (const b of ownBuilds) b.free()
      for (const c of cache.values()) c.build.free()
    },
  }
}

/** The world rect of a design's footprint (`bounds` in studs) centred at `(x, z)`, turned. */
export function footprintRect(x: number, z: number, bounds: readonly number[], turn: number): { x: number; z: number; w: number; d: number } {
  const odd = turn % 2 === 1
  const w = (odd ? bounds[1] : bounds[0]) * STUD
  const d = (odd ? bounds[0] : bounds[1]) * STUD
  return { x: x - w / 2, z: z - d / 2, w, d }
}

/**
 * The floors outside the rooms as ground shells (`kit/rooms.json`
 * `grounds`): the hallway (lot minus rooms, whole metres) and the street
 * outside the entrance, as the box office lays them out, rounded out to
 * whole metres so every side is whole studs.
 */
export function groundRects(layout: BuildingLayout): Array<{ id: string; style: 'hallway' | 'street'; x: number; z: number; w: number; d: number }> {
  const halls = hallwayRects(layout).map((r, i) => ({ id: `hall-${i}`, style: 'hallway' as const, ...r }))
  const { originX: ox, originZ: oz, width: W, depth: D } = layout
  const e = layout.entrance
  const outside = Math.ceil(Math.max(2, Math.hypot(e.spawn[0] - e.x, e.spawn[1] - e.z) + 1))
  const alongX = e.side === 'north' || e.side === 'south'
  const w = alongX ? W + 4 : outside
  const d = alongX ? outside : D + 4
  const x = e.side === 'west' ? ox - outside : e.side === 'east' ? ox + W : ox - 2
  const z = e.side === 'north' ? oz - outside : e.side === 'south' ? oz + D : oz - 2
  return [...halls, { id: 'street', style: 'street', x, z, w, d }, { id: 'town-path', style: 'hallway', ...townPath(layout) }]
}

/**
 * The section's name on its house's plaque (the design's black plaque over
 * the door, 2.25 × 0.55 m): a plane just in front of it, unlit so it reads
 * at night too. Null without a canvas (NullEngine tests).
 */
function signMesh(scene: Scene, spot: TownSpot, label: string): Mesh | null {
  if (typeof document === 'undefined' || scene.getEngine().name === 'NullEngine') return null
  const W = 512
  const H = 128
  const texture = new DynamicTexture(`sign-${spot.id}`, { width: W, height: H }, scene, true)
  const ctx = texture.getContext() as unknown as CanvasRenderingContext2D
  ctx.fillStyle = '#26231f'
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = '#fffdf8'
  ctx.font = '600 72px Georgia, "Iowan Old Style", serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, W / 2, H / 2 + 4)
  texture.update()
  const mesh = MeshBuilder.CreatePlane(`sign-${spot.id}`, { width: 2.2, height: 0.52 }, scene)
  // The plaque's centre in the design's frame: on its front (+z) face, 1.875 m from the footprint's centre, 2.575 m up.
  const [dx, dz] = turnXZ(0, 1.875 + 0.006, spot.turn)
  mesh.position.set(spot.x + dx, -FLOOR_TOP + 2.575, spot.z + dz)
  const [nx, nz] = turnXZ(0, 1, spot.turn)
  mesh.rotation.y = Math.atan2(-nx, -nz)
  const material = new StandardMaterial(`sign-${spot.id}`, scene)
  material.disableLighting = true
  material.emissiveTexture = texture
  material.diffuseColor = Color3.Black()
  material.specularColor = Color3.Black()
  mesh.material = material
  mesh.isPickable = false
  return mesh
}
