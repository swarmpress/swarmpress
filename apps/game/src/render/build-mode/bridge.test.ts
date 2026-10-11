// Build mode's renderer side (ADR-0087) under NullEngine on the real kit (crates/kit-wasm/pkg,
// skipped without it like bricks.test.ts): the town drawn from the layout's `town` (positions,
// turns, ids) or the generic arrangement without it; the bridge's pick, ghost and highlight; and a
// layout rebuild that leaves nothing of the old scene behind.
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Matrix, NullEngine, PointerEventTypes, Vector3, type Mesh } from '@babylonjs/core'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import layoutJson from '../../state/fixtures/demo-layout.json'
import type { BuildingLayout } from '../../state/render-state'
import { QUALITY } from '../postfx'
import { createGameScene, type GameScene } from '../scene'
import { buildRoomChunk } from '../bricks/chunk'
import { mappingOf, type KitApi } from '../bricks/kit'
import { buildBrickOffice, type BrickOffice } from '../bricks/office'
import { FLOOR_TOP } from '../bricks/placements'
import { HOUSE_D, HOUSE_W, townOf, townScenery, townSpots, type TownItemLayout } from '../bricks/town'
import { createBuildBridge, ghostDesign, type BuildBridgeImpl } from './bridge'

// The demo layout as a layout without a town (the sim writes one now): the tests that want one add it.
const { town: _town, buildMode: _mode, ...bare } = layoutJson as unknown as BuildingLayout & { town?: unknown; buildMode?: unknown }
const layout = bare as BuildingLayout
const PKG = resolve(process.cwd(), '../../crates/kit-wasm/pkg') + '/'
const built = existsSync(`${PKG}kit_wasm.js`)

let kit: KitApi
beforeAll(async () => {
  if (!built) return
  const mod = (await import(/* @vite-ignore */ pathToFileURL(`${PKG}kit_wasm.js`).href)) as KitApi & { initSync(m: { module: BufferSource }): unknown }
  mod.initSync({ module: readFileSync(`${PKG}kit_wasm_bg.wasm`) })
  kit = mod
})

const engines: NullEngine[] = []
afterEach(() => {
  for (const e of engines.splice(0)) e.dispose()
})

/** A town as the sim seeds it: the four houses moved and turned, and some furniture. */
const TOWN: TownItemLayout[] = [
  { id: 'town-1', kind: 'PlanHouse', x: 3, z: -6, rot: 0 },
  { id: 'town-2', kind: 'BuildingHouse', x: 10, z: -6, rot: 0 },
  { id: 'town-3', kind: 'FactoryHouse', x: -6, z: 4, rot: -Math.PI / 2 },
  { id: 'town-4', kind: 'ProjectsHouse', x: 30, z: 4, rot: Math.PI / 2 },
  { id: 'town-5', kind: 'Tree', x: -4, z: -4, rot: 0 },
  { id: 'town-6', kind: 'Tree', x: 28, z: -4, rot: Math.PI },
  { id: 'town-7', kind: 'StreetLamp', x: 6.5, z: -3, rot: 0 },
  { id: 'town-8', kind: 'Bench', x: 14, z: -3, rot: Math.PI / 2 },
]
const withTown = { ...layout, town: TOWN } as BuildingLayout

function setup(l: BuildingLayout = layout, engine = new NullEngine()): { engine: NullEngine; game: GameScene; bricks: BrickOffice; bridge: BuildBridgeImpl } {
  if (!engines.includes(engine)) engines.push(engine)
  const game = createGameScene(engine, null, l, { quality: QUALITY.low, postFx: false })
  const bricks = buildBrickOffice(game.scene, kit, l, game.office, game.lighting)
  const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, right: 512, bottom: 256, width: 512, height: 256 }) } as unknown as HTMLCanvasElement
  const bridge = createBuildBridge({ game, bricks, kit, layout: l, canvas: () => canvas })
  return { engine, game, bricks, bridge }
}

/** Where a world point is drawn, CSS pixels from the canvas' corner (hardware scaling 1 under NullEngine). */
function screenOf(game: GameScene, p: Vector3): { x: number; y: number } {
  const engine = game.scene.getEngine()
  const cam = game.iso.camera
  const vp = cam.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight())
  const s = Vector3.Project(p, Matrix.Identity(), cam.getViewMatrix(true).multiply(cam.getProjectionMatrix(true)), vp)
  return { x: s.x, y: s.y }
}

/** Every thin instance's centre in the world (a design's placement, whatever the meshes). */
function centres(meshes: Mesh[]): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = []
  for (const m of meshes) {
    const world = m.computeWorldMatrix(true)
    for (const local of m.thinInstanceGetWorldMatrices()) {
      const c = Vector3.TransformCoordinates(local.getTranslation(), world)
      out.push([c.x, c.y, c.z])
    }
  }
  return out
}

/** The same points, each within 2 mm of one of the others (float32 buffers round differently). */
function samePoints(a: ReadonlyArray<ArrayLike<number>>, b: ReadonlyArray<ArrayLike<number>>): boolean {
  if (a.length !== b.length) return false
  const used = new Set<number>()
  return a.every((p) => {
    const i = b.findIndex((q, j) => !used.has(j) && Math.abs(p[0] - q[0]) < 0.002 && Math.abs(p[1] - q[1]) < 0.002 && Math.abs(p[2] - q[2]) < 0.002)
    if (i < 0) return false
    used.add(i)
    return true
  })
}

describe('the town from the layout (pure)', () => {
  it('places the houses and the furniture where the layout says, turned, with their ids', () => {
    const { spots, props } = townOf(withTown)
    expect(spots.map((s) => [s.id, s.item, s.x, s.z, s.turn])).toEqual([
      ['plan', 'town-1', 3, -6, 0],
      ['building', 'town-2', 10, -6, 0],
      ['factory', 'town-3', -6, 4, 3],
      ['projects', 'town-4', 30, 4, 1],
    ])
    // A turned house covers its depth along x.
    expect(spots[2].rect).toEqual({ x: -6 - HOUSE_D / 2, z: 4 - HOUSE_W / 2, w: HOUSE_D, d: HOUSE_W })
    expect(props.map((p) => [p.item, p.design, p.turn])).toEqual([
      ['town-5', 'town-tree', 0],
      ['town-6', 'town-tree', 2],
      ['town-7', 'street-lamp', 0],
      ['town-8', 'town-bench', 1],
    ])
    // A tree's look follows its id: the same everywhere, different between neighbours.
    expect(townOf(withTown).props[0].params).toEqual(props[0].params)
    expect(props[0].params).not.toEqual(props[1].params)
  })

  it('falls back to the generic arrangement without a town in the layout', () => {
    const { spots, props } = townOf(layout)
    expect(spots).toEqual(townSpots(layout))
    expect(props).toEqual(townScenery(layout, spots))
    expect(spots.every((s) => s.item === undefined)).toBe(true)
  })
})

describe.skipIf(!built)('build mode in the scene (kit-wasm, NullEngine)', () => {
  it('builds the town from the layout and lists every item with its rect', () => {
    const { bricks, game } = setup(withTown)
    expect(bricks.town.map((s) => s.item)).toEqual(['town-1', 'town-2', 'town-3', 'town-4'])
    expect(bricks.townItems.map((t) => t.id)).toEqual(TOWN.map((t) => t.id))
    const bench = bricks.townItems.find((t) => t.id === 'town-8')!
    expect(bench).toMatchObject({ design: 'town-bench', x: 14, z: -3, turn: 1 })
    expect(bench.rect.x + bench.rect.w / 2).toBeCloseTo(14)
    expect(bench.rect.z + bench.rect.d / 2).toBeCloseTo(-3)
    // The houses' bricks stand where the layout puts them (the Factory house at x = -6, z = 4).
    const walls = game.scene.meshes.filter((m) => m.name.startsWith('bricks-town-factory-'))
    expect(walls.length).toBeGreaterThan(0)
    const c = walls[0].getBoundingInfo().boundingBox.centerWorld
    expect(Math.abs(c.x + 6)).toBeLessThan(HOUSE_W / 2)
    expect(Math.abs(c.z - 4)).toBeLessThan(HOUSE_W / 2)
  })

  it('draws the generic town without a layout town, with no items to pick', () => {
    const { bricks, game } = setup()
    expect(bricks.town.map((s) => s.id)).toEqual(['plan', 'building', 'factory', 'projects'])
    expect(bricks.townItems).toEqual([])
    expect(game.scene.meshes.some((m) => m.name.startsWith('bricks-town-plan-'))).toBe(true)
  })

  it('picks the floor point on the stud grid, its room and what stands there', () => {
    const { game, bridge, bricks } = setup(withTown)
    // An empty spot of the meeting room's floor.
    const room6 = layout.rooms.find((r) => r.id === 'room-6')!
    const p = new Vector3(room6.x + 1.03, 0, room6.z + room6.d - 1.0)
    const s = screenOf(game, p)
    const hit = bridge.pick(s.x, s.y)!
    expect(hit.x).toBeCloseTo(room6.x + 1.0, 6)
    expect(hit.z).toBeCloseTo(p.z, 6)
    expect(Number.isInteger(hit.x * 16) && Number.isInteger(hit.z * 16)).toBe(true)
    expect(hit.room).toBe('room-6')
    expect(hit.target).toEqual({ kind: 'room', id: 'room-6' })
    // A plant in the CEO's office.
    const plant = layout.rooms.flatMap((r) => r.props).find((x) => x.id === 'equip-66')!
    const ps = screenOf(game, new Vector3(plant.x, 0, plant.z))
    expect(bridge.pick(ps.x, ps.y)!.target).toEqual({ kind: 'equipment', id: 'equip-66' })
    // A desk, picked beside its monitor.
    const desk = layout.rooms[0].desks[0]
    const target = bridge.pick(...(Object.values(screenOf(game, new Vector3(desk.x + 0.5, 0, desk.z))) as [number, number]))!.target
    expect(target?.kind).toBe('equipment')
    // A bench of the town, outside every room.
    const bench = bricks.townItems.find((t) => t.id === 'town-8')!
    const bs = screenOf(game, new Vector3(bench.x, 0, bench.z))
    const b = bridge.pick(bs.x, bs.y)!
    expect(b.room).toBeNull()
    expect(b.target).toEqual({ kind: 'town', id: 'town-8' })
  })

  it('shows a ghost of the kit design at the spot, turned, tinted, and hides it again', () => {
    const { bridge, game } = setup()
    const before = game.scene.meshes.length
    bridge.ghost({ kind: 'Desk', family: 'equipment', x: 2, z: 3, rot: 1, ok: true })
    const g = bridge.debug().ghost!
    expect(g.ok).toBe(true)
    expect(g.node.isEnabled()).toBe(true)
    expect(g.meshes.length).toBeGreaterThan(0)
    for (const m of g.meshes) {
      expect(m.material?.name).toBe('ghost-ok')
      expect(m.material!.alpha).toBeLessThan(1)
      expect(m.isPickable).toBe(false)
    }
    // The same bricks, at the same places, as the desk placed there with that turn.
    const mapping = mappingOf(kit)
    const b = kit.compileShipped(mapping.equipment.desk, '{}')
    const info = JSON.parse(b.infoJson())
    const ref = buildRoomChunk({ id: 'ref', x: -50, z: -50, w: 100, d: 100 } as never, [], [
      { build: b, placement: { id: 'ref', role: 'prop', design: 'desk', params: '{}', x: 2, y: 0, z: 3, turn: 1 }, footprint: [info.bounds[0], info.bounds[1]], shell: false },
    ])
    const refCentres = ref.instances.flatMap((x) => Array.from({ length: x.count }, (_, i) => x.matrices.subarray(i * 16 + 12, i * 16 + 15)))
    const expected = [...refCentres, ...ref.studs.flatMap((x) => Array.from({ length: x.count }, (_, i) => x.matrices.subarray(i * 16 + 12, i * 16 + 15)))]
    b.free()
    expect(samePoints(centres(g.meshes), expected)).toBe(true)
    // A quarter turn the other way is not the same desk.
    bridge.ghost({ kind: 'Desk', family: 'equipment', x: 2, z: 3, rot: 3, ok: true })
    expect(samePoints(centres(g.meshes), expected)).toBe(false)
    // Red when the sim would refuse; the same meshes, moved.
    bridge.ghost({ kind: 'Desk', family: 'equipment', x: 4, z: 3, rot: 0, ok: false })
    const red = bridge.debug().ghost!
    expect(red.node).toBe(g.node)
    for (const m of red.meshes) expect(m.material?.name).toBe('ghost-bad')
    expect(red.node.position.x).toBe(4)
    const shown = game.scene.meshes.length
    // A town kind: its own ghost; the desk's is hidden.
    bridge.ghost({ kind: 'Tree', family: 'town', x: -3, z: -3, rot: 0, ok: true })
    expect(g.node.isEnabled()).toBe(false)
    expect(bridge.debug().ghost!.node.name).toBe('ghost-town|Tree')
    bridge.ghost(null)
    expect(bridge.debug().ghost).toBeNull()
    expect(game.scene.meshes.filter((m) => m.name.startsWith('ghost-') && m.isEnabled()).length).toBe(0)
    expect(shown).toBeGreaterThan(before)
    bridge.dispose()
    expect(game.scene.meshes.length).toBe(before)
  })

  it('shows a room rect as a green or red slab with an outline and wall stubs, and hides it', () => {
    const { bridge, game } = setup()
    const before = game.scene.meshes.length
    bridge.ghostRect({ x: 2, z: 3, w: 4, d: 5, ok: true })
    const ms = bridge.debug().rect
    expect(ms).toHaveLength(9)
    const slab = ms.find((m) => m.name === 'ghost-rect-slab')!
    expect(slab.position.x).toBeCloseTo(4)
    expect(slab.position.z).toBeCloseTo(5.5)
    expect(slab.position.y).toBeGreaterThan(0)
    expect(slab.position.y).toBeLessThan(0.05)
    const bb = slab.getBoundingInfo().boundingBox.extendSize
    expect([bb.x * 2, bb.z * 2]).toEqual([4, 5])
    expect(slab.material?.name).toBe('ghost-ok')
    expect(slab.material!.alpha).toBeLessThan(1)
    // Every outline bar inside the rect.
    for (const m of ms.filter((x) => x.name.startsWith('ghost-rect-line'))) {
      m.computeWorldMatrix(true)
      const b = m.getBoundingInfo().boundingBox
      expect(b.minimumWorld.x).toBeGreaterThanOrEqual(2 - 1e-6)
      expect(b.maximumWorld.z).toBeLessThanOrEqual(8 + 1e-6)
    }
    bridge.ghostRect({ x: 2, z: 3, w: 4, d: 5, ok: false })
    expect(bridge.debug().rect.find((m) => m.name === 'ghost-rect-slab')!.material?.name).toBe('ghost-bad')
    expect(ms.every((m) => m.isDisposed())).toBe(true)
    expect(bridge.state().rect).toMatchObject({ ok: false })
    bridge.ghostRect(null)
    expect(bridge.debug().rect).toHaveLength(0)
    bridge.ghostRect({ x: 0, z: 0, w: 0, d: 3, ok: true })
    expect(bridge.debug().rect).toHaveLength(0)
    bridge.dispose()
    expect(game.scene.meshes.length).toBe(before)
  })

  it('gives each kind its design and height', () => {
    const mapping = mappingOf(kit)
    const infoOf = (d: string, p: string) => {
      const b = kit.compileShipped(d, p)
      const i = JSON.parse(b.infoJson())
      b.free()
      return i
    }
    expect(ghostDesign({ kind: 'Plant', family: 'equipment' }, mapping, infoOf)).toEqual({ design: 'plant', params: '{}', y: 0 })
    expect(ghostDesign({ kind: 'Monitor', family: 'equipment' }, mapping, infoOf)!.y).toBeGreaterThan(0.5)
    expect(ghostDesign({ kind: 'CeilingLight', family: 'equipment' }, mapping, infoOf)!.y).toBeGreaterThan(2)
    expect(ghostDesign({ kind: 'PlanHouse', family: 'town' }, mapping, infoOf)).toMatchObject({ design: 'town-house', y: -FLOOR_TOP })
    expect(ghostDesign({ kind: 'Bench', family: 'town' }, mapping, infoOf)!.design).toBe('town-bench')
    expect(ghostDesign({ kind: 'Spaceship', family: 'town' }, mapping, infoOf)).toBeNull()
  })

  it('highlights a footprint, a town item or a room with a frame, and clears it', () => {
    const { bridge, bricks } = setup(withTown)
    bridge.highlight({ kind: 'equipment', id: 'equip-66' })
    const bars = bridge.debug().highlight
    expect(bars).toHaveLength(4)
    const plant = layout.rooms.flatMap((r) => r.props).find((x) => x.id === 'equip-66')!
    const xs = bars.map((m) => m.position.x)
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(plant.x, 3)
    bridge.highlight({ kind: 'town', id: 'town-3' })
    const house = bricks.townItems.find((t) => t.id === 'town-3')!
    const zs = bridge.debug().highlight.map((m) => m.position.z)
    expect((Math.min(...zs) + Math.max(...zs)) / 2).toBeCloseTo(house.z, 3)
    expect(bars.every((m) => m.isDisposed())).toBe(true)
    bridge.highlight({ kind: 'room', id: 'room-1' })
    expect(bridge.debug().highlight).toHaveLength(4)
    bridge.highlight({ kind: 'equipment', id: 'nope' })
    expect(bridge.debug().highlight).toHaveLength(0)
    bridge.highlight(null)
    expect(bridge.debug().highlight).toHaveLength(0)
  })

  it('stops the left-drag pan while capturing, and frames a room or the town', () => {
    const { bridge, game } = setup(withTown)
    // A left drag: down, move, up; returns how far the camera's target slid.
    const drag = (button: number) => {
      const t0 = game.iso.camera.target.clone()
      const send = (type: number, event: object) => game.scene.onPointerObservable.notifyObservers({ type, event } as never, type)
      send(PointerEventTypes.POINTERDOWN, { button })
      send(PointerEventTypes.POINTERMOVE, { button, movementX: 40, movementY: 10 })
      send(PointerEventTypes.POINTERUP, { button })
      return Vector3.Distance(t0, game.iso.camera.target)
    }
    expect(drag(0)).toBeGreaterThan(0)
    bridge.setCapture(true)
    expect(bridge.state().capture).toBe(true)
    expect(drag(0)).toBe(0)
    // The right button still pans while build gestures own the left.
    expect(drag(2)).toBeGreaterThan(0)
    bridge.setCapture(false)
    expect(drag(0)).toBeGreaterThan(0)
    const frames: Array<{ x: number; z: number; w: number; d: number }> = []
    game.iso.frame = (r) => void frames.push(r)
    bridge.focus({ room: 'room-6' })
    bridge.focus({ town: true })
    bridge.focus({ room: 'nope' })
    expect(frames[0]).toMatchObject({ x: 0, z: 8, w: 6, d: 8 })
    // The town's frame reaches past the lot to the houses the layout placed.
    expect(frames[1].x).toBeLessThanOrEqual(-6 - HOUSE_D / 2)
    expect(frames[1].x + frames[1].w).toBeGreaterThanOrEqual(30 + HOUSE_D / 2)
    expect(frames).toHaveLength(2)
  })

  it('rebuilds on a layout change without leaving the old scene behind', () => {
    const engine = new NullEngine()
    const a = setup(layout, engine)
    a.bridge.ghost({ kind: 'Plant', family: 'equipment', x: 1, z: 1, rot: 0, ok: true })
    const count = { meshes: a.game.scene.meshes.length, materials: a.game.scene.materials.length, textures: a.game.scene.textures.length }
    a.game.iso.setView({ target: [3, 1, 4], zoom: 7 })
    const carry = a.bridge.state()
    const view = a.game.iso.view()
    // As main.ts does: a new scene on the same engine, the camera and the gesture carried over; the old one disposed.
    const b = setup(withTown, engine)
    b.game.iso.setView(view)
    const bridge = createBuildBridge({ game: b.game, bricks: b.bricks, kit, layout: withTown, canvas: () => b.bridge.canvas() }, carry)
    b.bridge.dispose()
    a.bridge.dispose()
    a.bricks.dispose()
    a.game.dispose()
    expect(a.game.scene.isDisposed).toBe(true)
    expect(a.game.scene.meshes).toHaveLength(0)
    expect(a.game.scene.materials).toHaveLength(0)
    expect(engine.scenes).toEqual([b.game.scene])
    expect(b.game.iso.view()).toEqual({ target: [3, 1, 4], zoom: 7 })
    expect(bridge.debug().ghost?.node.position.x).toBe(1)
    // Rebuilding the same layout again gives the same counts: nothing piles up.
    const c = setup(layout, engine)
    c.bridge.ghost({ kind: 'Plant', family: 'equipment', x: 1, z: 1, rot: 0, ok: true })
    bridge.dispose()
    b.bricks.dispose()
    b.game.dispose()
    expect(engine.scenes).toEqual([c.game.scene])
    expect({ meshes: c.game.scene.meshes.length, materials: c.game.scene.materials.length, textures: c.game.scene.textures.length }).toEqual(count)
  })
})

describe.skipIf(!built)('a whole plan as ghosts (FEAT-084, kit-wasm, NullEngine)', () => {
  // The meeting room (room-6: x 0..6, z 8..16) and the newsroom's first desk (equip-17).
  const PLAN = [
    { kind: 'Desk', x: 2, z: 11, rot: 1 as const },
    { kind: 'Monitor', x: 0, z: 0, rot: 0 as const, onDesk: 0 },
    { kind: 'DeskLamp', x: 0, z: 0, rot: 0 as const, onDesk: 'equip-17' },
    { kind: 'MeetingTable', x: 4, z: 13, rot: 0 as const },
    { kind: 'Plant', x: 5.5, z: 8.5, rot: 0 as const },
    // No kit design of that name: left out, the rest still drawn.
    { kind: 'Spaceship', x: 1, z: 9, rot: 0 as const },
    // On a desk that does not exist: left out.
    { kind: 'Monitor', x: 0, z: 0, rot: 0 as const, onDesk: 'equip-999' },
  ]

  it('draws every item at once, green, where it stands (an item on a desk where its desk does), and clears', () => {
    const { bridge, game } = setup()
    bridge.ghostPlan(PLAN)
    const plan = bridge.debug().plan
    expect(plan).toHaveLength(5)
    const at = plan.map((g) => [g.node.position.x, g.node.position.z])
    const desk = layout.rooms.flatMap((r) => r.desks).find((d) => d.id === 'equip-17')!
    expect(at).toEqual([
      [2, 11],
      [2, 11],
      [desk.x, desk.z],
      [4, 13],
      [5.5, 8.5],
    ])
    // The monitor turns with its planned desk, and stands on it (its bricks above the desk top).
    expect(plan[1].node.rotation.y).toBeCloseTo(plan[0].node.rotation.y)
    const top = (ms: Mesh[]) => Math.min(...centres(ms).map((c) => c[1]))
    expect(top(plan[1].meshes)).toBeGreaterThan(0.5)
    expect(top(plan[3].meshes)).toBeLessThan(0.3)
    for (const g of plan) {
      expect(g.meshes.length).toBeGreaterThan(0)
      for (const m of g.meshes) {
        expect(m.material?.name).toBe('ghost-ok')
        expect(m.isPickable).toBe(false)
      }
    }
    // The single ghost is its own thing: placing one does not touch the plan.
    bridge.ghost({ kind: 'Plant', family: 'equipment', x: 1, z: 1, rot: 0, ok: false })
    expect(bridge.debug().plan).toHaveLength(5)
    const meshes = plan.flatMap((g) => g.meshes)
    bridge.ghostPlan(null)
    expect(bridge.debug().plan).toEqual([])
    expect(meshes.every((m) => m.isDisposed())).toBe(true)
    expect(game.scene.meshes.some((m) => m.name.startsWith('ghost-plan-'))).toBe(false)
  })

  it('carries the plan over to the next scene, and frees it on dispose', () => {
    const first = setup()
    first.bridge.ghostPlan(PLAN.slice(0, 2))
    const carry = first.bridge.state()
    expect(carry.plan).toEqual(PLAN.slice(0, 2))
    const second = setup()
    const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, right: 512, bottom: 256, width: 512, height: 256 }) } as unknown as HTMLCanvasElement
    const bridge = createBuildBridge({ game: second.game, bricks: second.bricks, kit, layout, canvas: () => canvas }, carry)
    expect(bridge.debug().plan).toHaveLength(2)
    const meshes = bridge.debug().plan.flatMap((g) => g.meshes)
    bridge.dispose()
    expect(meshes.every((m) => m.isDisposed())).toBe(true)
  })
})
