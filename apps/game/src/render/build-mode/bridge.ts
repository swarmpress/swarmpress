/**
 * The renderer's side of build mode (ADR-0087): `BuildBridge` on a game
 * scene and its brick office. Picking casts the camera's ray onto the floor
 * (y = 0) and snaps it to the stud grid; what stands there is resolved from
 * the layout (each placement's footprint, from its kit design) and the
 * town's item rects and the placed objects' footprints (K-4), never from
 * meshes. The ghost is the kit design the player is about to place (or a
 * design of the player's own, by its JSON), compiled once per kind and drawn translucent,
 * green or red as the UI says the sim would answer; the highlight is a
 * yellow frame around a footprint or a room. The renderer decides nothing
 * here (rule 8): the UI asks, the sim judges.
 */
import { Color3, Matrix, Mesh, MeshBuilder, StandardMaterial, TransformNode, VertexData, type Scene } from '@babylonjs/core'
import type { BuildBridge, BuildTarget, GhostSpec, PlanGhost } from '../../build-bridge'
import type { BuildingLayout } from '../../state/render-state'
import type { GameScene } from '../scene'
import { buildRoomChunk, STUD_HEIGHT, STUD_RADIUS, type ChunkSource } from '../bricks/chunk'
import { mappingOf, type KitApi, type KitBuildLike, type KitMapping } from '../bricks/kit'
import { footprintRect, type BrickOffice } from '../bricks/office'
import { objectRect, objectsOf } from '../bricks/objects'
import { FLOOR_TOP, PLATE, roomPlacements, turnOf, WALL_TOP, type DesignInfo, type Turn } from '../bricks/placements'
import { TOWN_DESIGN, TOWN_HOUSES, HOUSE_SECTION, townFrame, treeParams, type TownItemKind } from '../bricks/town'
import { frameBars, inRect, itemUnder, kebabKind, rayToPlane, snapStud, type PickItem, type Rect } from './pick'

export interface BuildBridgeDeps {
  game: Pick<GameScene, 'scene' | 'iso'>
  bricks: Pick<BrickOffice, 'town' | 'townItems'>
  kit: KitApi
  layout: BuildingLayout
  /** The canvas the scene draws on (client pixels are taken relative to it). */
  canvas: () => HTMLCanvasElement
  /** The share of the view a panel covers on the right, for `focus` (0 without one). */
  covered?: () => number
}

/** What a bridge carries over to the next scene's (a rebuild keeps the gesture going). */
export interface BuildBridgeState {
  capture: boolean
  ghost: GhostSpec | null
  highlight: BuildTarget | null
  rect?: { x: number; z: number; w: number; d: number; ok: boolean } | null
  plan?: PlanGhost[] | null
}

export interface BuildBridgeImpl extends BuildBridge {
  state(): BuildBridgeState
  /** Frees the compiled designs and the ghost's and highlight's meshes. */
  dispose(): void
  /** Tests: the ghost's root node and meshes when one is shown, the highlight's bars, the room rect's meshes. */
  debug(): {
    ghost: { node: TransformNode; meshes: Mesh[]; ok: boolean } | null
    highlight: Mesh[]
    rect: Mesh[]
    /** The plan's ghosts, one node per item drawn (an item without a design is left out). */
    plan: Array<{ node: TransformNode; meshes: Mesh[] }>
  }
}

const GHOST_ALPHA = 0.5
const GHOST_OK = new Color3(0.25, 0.85, 0.35)
const GHOST_BAD = new Color3(0.95, 0.25, 0.2)
const HIGHLIGHT = new Color3(1, 0.82, 0.1)
/** The highlight frame's height above the floor and its bars' thickness. */
const HIGHLIGHT_Y = 0.02
const HIGHLIGHT_H = 0.05
/** How far inside a room's rect its frame lies: past the wall's stud band. */
const ROOM_INSET = 0.2
/** The room rect ghost's outline width and its wall stubs' height. */
const RECT_LINE = 0.08
const RECT_WALL = 0.35

/** Items on desks are picked at their own height first, then floor items, then ceiling lights. */
const RANK = { attached: 0, floor: 1, ceiling: 2 } as const

/** The design, params and base height a ghost of `kind` is drawn with; null for kinds without a design. */
export function ghostDesign(
  g: Pick<GhostSpec, 'kind' | 'family'>,
  mapping: KitMapping,
  infoOf: (design: string, params: string) => DesignInfo,
): { design: string; params: string; y: number } | null {
  if (g.family === 'town') {
    const section = HOUSE_SECTION[g.kind as TownItemKind]
    if (section) {
      const h = TOWN_HOUSES.find((x) => x.id === section)!
      return { design: 'town-house', params: JSON.stringify({ wall: h.wall, roof: h.roof, door: h.door, trim: h.trim }), y: -FLOOR_TOP }
    }
    const design = TOWN_DESIGN[g.kind as keyof typeof TOWN_DESIGN]
    if (!design) return null
    return { design, params: JSON.stringify(design === 'town-tree' ? treeParams(0) : {}), y: -FLOOR_TOP }
  }
  const kind = kebabKind(g.kind)
  const design = mapping.equipment[kind]
  if (!design) return null
  // On a desk: at its port's height; a ceiling light: under the ceiling; the rest on the floor.
  const port = mapping.desk_ports[kind]
  if (port) {
    const at = infoOf(mapping.equipment.desk, '{}').ports.find((p) => p.id === port)
    return { design, params: '{}', y: (at?.at[2] ?? 0) * PLATE }
  }
  if (kind === 'ceiling-light') return { design, params: '{}', y: WALL_TOP - FLOOR_TOP - infoOf(design, '{}').bounds[2] * PLATE }
  return { design, params: '{}', y: 0 }
}

/** Marks an object's pick item among the equipment's (ids of both are the sim's, in different spaces). */
const OBJECT_MARK = '\u0000object:'

/** A short, stable digest of a text (FNV-1a), to key ghosts by their design text. */
function hashText(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  return (h >>> 0).toString(16)
}

/** Babylon's `rotation.y` for a quarter turn as the kit counts it (clockwise seen from above). */
export const ghostRotation = (turn: number) => (-turn * Math.PI) / 2

export function createBuildBridge(deps: BuildBridgeDeps, carry?: BuildBridgeState): BuildBridgeImpl {
  const { game, bricks, kit, layout } = deps
  const scene: Scene = game.scene
  const mapping = mappingOf(kit)

  // --- the kit's designs, compiled once per id and params ------------------
  const builds = new Map<string, { build: KitBuildLike; info: DesignInfo }>()
  const compiled = (design: string, params: string) => {
    const key = `${design}|${params}`
    let c = builds.get(key)
    if (!c) {
      const build = kit.compileShipped(design, params)
      if (!build.ok()) {
        const issues = build.issuesJson()
        build.free()
        throw new Error(`kit: ${design} did not compile: ${issues}`)
      }
      const i = JSON.parse(build.infoJson())
      c = { build, info: { bounds: i.bounds, mount: i.mount, ports: i.ports } }
      builds.set(key, c)
    }
    return c
  }
  const infoOf = (design: string, params: string) => compiled(design, params).info
  /** A design of the player's own (K-4), by its JSON; compiled once per text. Throws when the kit refuses it. */
  const ownBuilds = new Map<string, { build: KitBuildLike; info: DesignInfo }>()
  const compiledOwn = (json: string) => {
    let c = ownBuilds.get(json)
    if (!c) {
      const build = kit.compile(json, '')
      if (!build.ok()) {
        const issues = build.issuesJson()
        build.free()
        throw new Error(`kit: the design did not compile: ${issues}`)
      }
      const i = JSON.parse(build.infoJson())
      c = { build, info: { bounds: i.bounds, mount: i.mount, ports: i.ports ?? [] } }
      ownBuilds.set(json, c)
    }
    return c
  }

  // --- what can be picked: every placement of the layout, by its footprint ---
  let equipment: PickItem[] | null = null
  const equipmentItems = () => {
    if (equipment) return equipment
    equipment = []
    for (const room of layout.rooms) {
      for (const p of roomPlacements(room, mapping, infoOf).placements) {
        // Chairs and the renderer's stand-in board are not the sim's equipment.
        if (p.standIn || p.role === 'seat') continue
        const rect = footprintRect(p.x, p.z, infoOf(p.design, p.params).bounds, p.turn)
        const attached = p.role === 'monitor' || p.role === 'desk-lamp'
        const rank = attached ? RANK.attached : p.role === 'ceiling-light' ? RANK.ceiling : RANK.floor
        equipment.push({ id: p.id, rect, y: attached || rank === RANK.ceiling ? p.y : 0, rank })
      }
    }
    return equipment
  }
  const townItems = (): PickItem[] => bricks.townItems.map((t) => ({ id: t.id, rect: t.rect, y: 0, rank: RANK.floor }))
  /** The placed objects (K-4) by the footprint the sim keeps for them: no design needs to be at hand. */
  const objectItems = (): PickItem[] => objectsOf(layout).map((o) => ({ id: o.id, rect: objectRect(o), y: 0, rank: RANK.floor }))

  const rectOf = (t: BuildTarget): Rect | null => {
    if (t.kind === 'room') return layout.rooms.find((r) => r.id === t.id) ?? null
    if (t.kind === 'town') return bricks.townItems.find((x) => x.id === t.id)?.rect ?? null
    if (t.kind === 'object') return objectItems().find((x) => x.id === t.id)?.rect ?? null
    return equipmentItems().find((x) => x.id === t.id)?.rect ?? null
  }

  // --- ghosts: one node per kind, moved and tinted --------------------------
  // The template shapes, made when the first ghost is (a page that never builds makes none).
  let shapeCache: Record<'box' | 'cylinder' | 'stud', VertexData> | null = null
  const shapes = () => (shapeCache ??= (() => {
    const box = MeshBuilder.CreateBox('ghost-template-box', { size: 1 }, scene)
    const cylinder = MeshBuilder.CreateCylinder('ghost-template-cylinder', { diameter: 1, height: 1, tessellation: 12 }, scene)
    const stud = MeshBuilder.CreateCylinder('ghost-template-stud', { diameter: 2 * STUD_RADIUS, height: STUD_HEIGHT, tessellation: 8 }, scene)
    const out = { box: VertexData.ExtractFromMesh(box), cylinder: VertexData.ExtractFromMesh(cylinder), stud: VertexData.ExtractFromMesh(stud) }
    for (const m of [box, cylinder, stud]) m.dispose()
    return out
  })())
  const material = (name: string, colour: Color3, alpha: number) => {
    const m = new StandardMaterial(name, scene)
    m.disableLighting = true
    m.emissiveColor = colour
    m.diffuseColor = Color3.Black()
    m.specularColor = Color3.Black()
    m.alpha = alpha
    return m
  }
  let okMaterial: StandardMaterial | null = null
  let badMaterial: StandardMaterial | null = null
  const ghostMaterial = (ok: boolean) =>
    ok ? (okMaterial ??= material('ghost-ok', GHOST_OK, GHOST_ALPHA)) : (badMaterial ??= material('ghost-bad', GHOST_BAD, GHOST_ALPHA))

  /** A design's bricks under one node, built at the origin unturned; the node moves and turns it. */
  const makeGhost = (name: string, d: { design: string; params: string; y: number; json?: string }) => {
    const c = d.json !== undefined ? compiledOwn(d.json) : compiled(d.design, d.params)
    const placement = { id: name, role: 'prop' as const, design: d.design, params: d.params, x: 0, y: d.y, z: 0, turn: 0 as Turn, standIn: true }
    const at = { id: name, x: -50, z: -50, w: 100, d: 100 } as unknown as BuildingLayout['rooms'][number]
    const src: ChunkSource = { build: c.build, placement, footprint: [c.info.bounds[0], c.info.bounds[1]], shell: false }
    const chunk = buildRoomChunk(at, [], [src])
    const node = new TransformNode(name, scene)
    const meshes: Mesh[] = []
    const add = (mesh: string, shape: VertexData, matrices: Float32Array) => {
      const m = new Mesh(mesh, scene)
      shape.applyToMesh(m)
      m.thinInstanceSetBuffer('matrix', matrices, 16, true)
      m.thinInstanceRefreshBoundingInfo(false)
      m.isPickable = false
      m.parent = node
      meshes.push(m)
    }
    for (const b of chunk.instances) add(`${name}-${b.key}`, shapes()[b.shape], b.matrices)
    for (const b of chunk.studs) add(`${name}-studs-${b.key}`, shapes().stud, b.matrices)
    return { node, meshes }
  }

  const ghosts = new Map<string, { node: TransformNode; meshes: Mesh[] } | null>()
  const ghostOf = (g: GhostSpec) => {
    // A design of the player's own is keyed by its text (a kind names it, the text is what is drawn).
    const key = g.design !== undefined ? `own|${g.kind}|${g.design.length}|${hashText(g.design)}` : `${g.family}|${g.kind}`
    if (ghosts.has(key)) return ghosts.get(key)!
    if (g.design !== undefined) {
      let gh: { node: TransformNode; meshes: Mesh[] } | null = null
      try {
        gh = makeGhost(`ghost-own-${ghosts.size}`, { design: g.kind, params: '', y: 0, json: g.design })
        gh.node.setEnabled(false)
      } catch (err) {
        console.warn(`[build] the ghost of ${g.kind} could not be drawn`, err)
      }
      ghosts.set(key, gh)
      return gh
    }
    const d = ghostDesign(g, mapping, infoOf)
    if (!d) {
      console.warn(`[build] no kit design for ${g.family} ${g.kind}`)
      ghosts.set(key, null)
      return null
    }
    const gh = makeGhost(`ghost-${key}`, d)
    gh.node.setEnabled(false)
    ghosts.set(key, gh)
    return gh
  }
  let shownGhost: { node: TransformNode; meshes: Mesh[]; ok: boolean } | null = null
  let ghostSpec: GhostSpec | null = null

  // --- a whole plan's ghosts (the office designer's preview): one node per item, all green ---
  let planSpec: PlanGhost[] | null = null
  let planGhosts: Array<{ node: TransformNode; meshes: Mesh[] }> = []
  const clearPlan = () => {
    for (const g of planGhosts) {
      for (const m of g.meshes) m.dispose()
      g.node.dispose()
    }
    planGhosts = []
  }
  /** Where a plan item stands: its own spot, or the desk it goes on (a planned desk by index, a placed one by id). */
  const planSpot = (items: PlanGhost[], i: PlanGhost): { x: number; z: number; turn: Turn } | null => {
    if (i.onDesk === undefined) return { x: i.x, z: i.z, turn: i.rot }
    if (typeof i.onDesk === 'number') {
      const desk = items[i.onDesk]
      return desk && desk.onDesk === undefined ? { x: desk.x, z: desk.z, turn: desk.rot } : null
    }
    for (const r of layout.rooms) {
      const d = r.desks.find((x) => x.id === i.onDesk)
      if (d) return { x: d.x, z: d.z, turn: turnOf(d.rot) }
    }
    return null
  }
  /** The design of a plan item: an equipment kind by the kit mapping, else a kit design by its own id (a table, a stool). */
  const planDesign = (kind: string) => ghostDesign({ kind, family: 'equipment' }, mapping, infoOf) ?? { design: kebabKind(kind), params: '{}', y: 0 }

  // --- the highlight: a yellow frame around a footprint ---------------------
  let highlightMaterial: StandardMaterial | null = null
  let bars: Mesh[] = []
  let highlighted: BuildTarget | null = null

  // --- the room rect's ghost: a slab, its outline and low wall stubs -------
  let rectMeshes: Mesh[] = []
  let rectSpec: { x: number; z: number; w: number; d: number; ok: boolean } | null = null
  let outlineOk: StandardMaterial | null = null
  let outlineBad: StandardMaterial | null = null

  let capture = false

  const bridge: BuildBridgeImpl = {
    pick(clientX, clientY) {
      const c = deps.canvas().getBoundingClientRect()
      const ray = scene.createPickingRay(clientX - c.left, clientY - c.top, Matrix.Identity(), game.iso.camera, false)
      const o = [ray.origin.x, ray.origin.y, ray.origin.z] as const
      const dir = [ray.direction.x, ray.direction.y, ray.direction.z] as const
      const floor = rayToPlane(o, dir, 0)
      if (!floor) return null
      const x = snapStud(floor.x)
      const z = snapStud(floor.z)
      const room = layout.rooms.find((r) => inRect(r, floor.x, floor.z))?.id ?? null
      // Equipment and placed objects are picked together (the item on top wins), then the town.
      const eq = itemUnder([...equipmentItems(), ...objectItems().map((x) => ({ ...x, id: `${OBJECT_MARK}${x.id}` }))], o, dir)
      const town = eq ? null : itemUnder(townItems(), o, dir)
      const target: BuildTarget | null = eq
        ? eq.id.startsWith(OBJECT_MARK)
          ? { kind: 'object', id: eq.id.slice(OBJECT_MARK.length) }
          : { kind: 'equipment', id: eq.id }
        : town
          ? { kind: 'town', id: town.id }
          : room
            ? { kind: 'room', id: room }
            : null
      return { x, z, room, target }
    },
    ghost(g) {
      ghostSpec = g
      const next = g ? ghostOf(g) : null
      if (shownGhost && shownGhost.node !== next?.node) shownGhost.node.setEnabled(false)
      shownGhost = null
      if (!g || !next) return
      next.node.position.set(g.x, 0, g.z)
      next.node.rotation.y = ghostRotation(g.rot)
      const m = ghostMaterial(g.ok)
      for (const mesh of next.meshes) mesh.material = m
      next.node.setEnabled(true)
      shownGhost = { ...next, ok: g.ok }
    },
    ghostPlan(items) {
      planSpec = items
      clearPlan()
      if (!items) return
      const m = ghostMaterial(true)
      items.forEach((i, n) => {
        const at = planSpot(items, i)
        if (!at) return
        let g: { node: TransformNode; meshes: Mesh[] }
        try {
          g = makeGhost(`ghost-plan-${n}`, planDesign(i.kind))
        } catch (err) {
          console.warn(`[build] no kit design for the plan's ${i.kind}`, err)
          return
        }
        g.node.position.set(at.x, 0, at.z)
        g.node.rotation.y = ghostRotation(at.turn)
        for (const mesh of g.meshes) mesh.material = m
        planGhosts.push(g)
      })
    },
    ghostRect(r) {
      rectSpec = r
      for (const m of rectMeshes) m.dispose()
      rectMeshes = []
      if (!r || !(r.w > 0) || !(r.d > 0)) return
      const fill = ghostMaterial(r.ok)
      const line = r.ok ? (outlineOk ??= material('ghost-rect-ok', GHOST_OK, 0.9)) : (outlineBad ??= material('ghost-rect-bad', GHOST_BAD, 0.9))
      const box = (name: string, b: Rect, y: number, h: number, m: StandardMaterial) => {
        const mesh = MeshBuilder.CreateBox(name, { width: b.w, depth: b.d, height: h }, scene)
        mesh.position.set(b.x + b.w / 2, y + h / 2, b.z + b.d / 2)
        mesh.material = m
        mesh.isPickable = false
        rectMeshes.push(mesh)
      }
      box('ghost-rect-slab', r, HIGHLIGHT_Y - 0.01, 0.01, fill)
      // The outline on the slab's edge, then low wall stubs along it (the walls a room will get).
      const inner = { x: r.x + RECT_LINE, z: r.z + RECT_LINE, w: Math.max(0, r.w - 2 * RECT_LINE), d: Math.max(0, r.d - 2 * RECT_LINE) }
      frameBars(inner, RECT_LINE).forEach((b, i) => box(`ghost-rect-line-${i}`, b, HIGHLIGHT_Y, HIGHLIGHT_H, line))
      frameBars(inner, RECT_LINE).forEach((b, i) => box(`ghost-rect-wall-${i}`, b, HIGHLIGHT_Y + HIGHLIGHT_H, RECT_WALL, fill))
    },
    highlight(t) {
      highlighted = t
      for (const b of bars) b.dispose()
      bars = []
      const found = t ? rectOf(t) : null
      if (!found) return
      // A room's frame lies on its floor, inside its walls (outside them it would sit under the neighbours').
      const r = t!.kind === 'room' ? { x: found.x + ROOM_INSET, z: found.z + ROOM_INSET, w: found.w - 2 * ROOM_INSET, d: found.d - 2 * ROOM_INSET } : found
      highlightMaterial ??= material('build-highlight', HIGHLIGHT, 1)
      bars = frameBars(r).map((b, i) => {
        const m = MeshBuilder.CreateBox(`build-highlight-${i}`, { width: b.w, depth: b.d, height: HIGHLIGHT_H }, scene)
        m.position.set(b.x + b.w / 2, HIGHLIGHT_Y, b.z + b.d / 2)
        m.material = highlightMaterial
        m.isPickable = false
        return m
      })
    },
    setCapture(on) {
      capture = on
      game.iso.setPan(!on)
    },
    focus(t) {
      const covered = deps.covered?.() ?? 0
      if ('town' in t) {
        game.iso.frame(townFrame(layout, bricks.town, 'town'), covered)
        return
      }
      const r = layout.rooms.find((x) => x.id === t.room)
      if (r) game.iso.frame({ x: r.x, z: r.z, w: r.w, d: r.d, h: layout.wallHeight }, covered)
    },
    canvas: () => deps.canvas(),
    state: () => ({ capture, ghost: ghostSpec, highlight: highlighted, rect: rectSpec, plan: planSpec }),
    dispose() {
      clearPlan()
      for (const m of rectMeshes) m.dispose()
      rectMeshes = []
      outlineOk?.dispose()
      outlineBad?.dispose()
      for (const b of bars) b.dispose()
      bars = []
      for (const g of ghosts.values()) {
        if (!g) continue
        for (const m of g.meshes) m.dispose()
        g.node.dispose()
      }
      ghosts.clear()
      shownGhost = null
      okMaterial?.dispose()
      badMaterial?.dispose()
      highlightMaterial?.dispose()
      for (const c of builds.values()) c.build.free()
      builds.clear()
      for (const c of ownBuilds.values()) c.build.free()
      ownBuilds.clear()
    },
    debug: () => ({ ghost: shownGhost, highlight: bars, rect: rectMeshes, plan: planGhosts }),
  }
  if (carry) {
    if (carry.capture) bridge.setCapture(true)
    // A ghost or a highlight whose kind or item is gone is simply not drawn.
    try {
      bridge.ghost(carry.ghost)
    } catch (err) {
      console.warn('[build] the ghost did not carry over', err)
    }
    bridge.highlight(carry.highlight)
    bridge.ghostRect(carry.rect ?? null)
    bridge.ghostPlan(carry.plan ?? null)
  }
  return bridge
}
