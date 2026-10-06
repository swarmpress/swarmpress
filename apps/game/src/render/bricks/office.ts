/**
 * The brick office spike (FEAT-081, ADR-0063, ADR-0065 increment K-3):
 * chosen rooms built from the construction kit instead of boxes, behind
 * `?office=bricks`. The rest of the office, the people, the lights and the
 * labels stay the box office's (`../office.ts`); its meshes in the brick
 * rooms are switched off, its lights reach the brick meshes the same way
 * (ADR-0006 scopes), and the cutaway (ADR-0005) hides brick walls by the
 * same rule as box walls.
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
import type { BuildingLayout, RenderState, RoomKind, Side } from '../../state/render-state'
import { isCutAway } from '../cutaway'
import type { Lighting } from '../lighting'
import { lampsLightFloor, MAX_LIGHTS_PER_MATERIAL, type OfficeHandles } from '../office'
import { buildRoomChunk, exteriorSides, shellOrigin, STUD_HEIGHT, STUD_RADIUS, type ChunkSource, type Region, type RoomChunk, type SurfaceAnchor } from './chunk'
import { mappingOf, paletteOf, type KitApi, type KitBuildLike, type PaletteColour } from './kit'
import { modelPlacement, modelRoom } from './model'
import { roomPlacements, type DesignInfo } from './placements'
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

/** Text for the surfaces, from the browser store (rule 2); `main.ts` wires it. */
export interface SurfaceSources {
  person(staffId: string): { name: string } | undefined
  job(workItemId: string): { title: string; stage: string } | undefined
  board(): readonly BoardCard[]
}

export interface BrickRoomStats {
  room: string
  kind: RoomKind
  /** Bricks (parts) and studs drawn for the room, and what the kit says it compiled. */
  instances: number
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
  stats: BrickRoomStats
}

export interface BrickOffice {
  rooms: Map<string, RoomBuild>
  surfaces: SurfaceHandle[]
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

export interface BrickOfficeOptions {
  rooms?: readonly RoomKind[]
  kitLoadMs?: number | null
  now?: () => number
  /** Redraw budget per frame. */
  budget?: number
}

const hex = (h: string) => Color3.FromHexString(h).toLinearSpace()

/** Materials per palette colour (PBR, the prototype's look); glowing colours emissive. */
function makeMaterial(scene: Scene, c: PaletteColour, name = `brick-${c.id}`): PBRMaterial {
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
  const kinds = new Set(opts.rooms ?? SPIKE_ROOMS)
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
      if (!m) roomBulbs.set(room, (m = makeMaterial(scene, c, `brick-bulb-${room}`)))
      return m
    }
    let m = materials.get(colour)
    if (!m) materials.set(colour, (m = makeMaterial(scene, c)))
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

  const roomBuilds = new Map<string, RoomBuild>()
  const surfaceAnchors: SurfaceAnchor[] = []
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
    for (const p of placements) {
      const c = compiled(p.design, p.params)
      sources.push({
        build: c.build,
        placement: p,
        footprint: [c.info.bounds[0], c.info.bounds[1]],
        shell: false,
        surfaces: p.surface ? c.info.surfaces.filter((s) => s.name === p.surface) : [],
      })
    }
    const compileMs = now() - c0
    const m0 = now()
    const exterior = exteriorSides(room, layout)
    const chunk = buildRoomChunk(room, exterior, sources)
    const meshes = chunk.instances.map((b) => ({
      mesh: instanced(`bricks-${room.id}-${b.key}`, shapes[b.shape], b.matrices, materialFor(b.colour, room.id)),
      region: b.region,
    }))
    const studs = chunk.studs.map((b) => ({ mesh: instanced(`studs-${room.id}-${b.key}`, shapes.stud, b.matrices, materialFor(b.colour, room.id)), region: b.region }))
    const meshMs = now() - m0
    surfaceAnchors.push(...chunk.surfaces)
    roomBuilds.set(room.id, {
      chunk,
      meshes,
      studs,
      stats: {
        room: room.id,
        kind: room.kind,
        instances: chunk.instanceCount,
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
    const all = [...rb.meshes, ...rb.studs].map((m) => m.mesh)
    const h = office.rooms.get(id)
    for (const l of h?.lights ?? []) l.includedOnlyMeshes.push(...all)
    const lampsReach = lampsLightFloor(brickRooms.get(id)!.desks.length)
    for (const d of office.desks.values()) if (d.roomId === id && lampsReach) d.lamp.includedOnlyMeshes.push(...rb.meshes.map((m) => m.mesh))
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
    surfaces,
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
