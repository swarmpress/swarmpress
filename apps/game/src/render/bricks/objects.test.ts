// Placed objects in the scene (K-4, ADR-0065 §4; ADR-0087 decision 7) under NullEngine on the real
// kit (crates/kit-wasm/pkg; skipped without it): the brick office draws the layout's objects from
// their designs (resolved by hash), placed and lit like a room's equipment; one whose design is not
// at hand is a translucent footprint box until it is; new objects arrive like equipment. The build
// bridge draws a design of the player's own as the ghost and picks and highlights placed objects.
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Matrix, NullEngine, Vector3, type StandardMaterial } from '@babylonjs/core'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import layoutJson from '../../state/fixtures/demo-layout.json'
import type { BuildingLayout } from '../../state/render-state'
import { QUALITY } from '../postfx'
import { createGameScene, type GameScene } from '../scene'
import { createBuildBridge } from '../build-mode/bridge'
import { arrivalsFor } from './arrivals'
import type { KitApi } from './kit'
import { objectRect, objectsOf, type PlacedObjectLayout } from './objects'
import { buildBrickOffice, type BrickOfficeOptions } from './office'
import { STUD } from './placements'
import type { ObjectSummary } from '../../state/render-state'
/** A floor design's summary for a footprint in metres (16 studs a metre). */
const summaryOf = (w: number, d: number): ObjectSummary => ({ footprint: [w * 16, d * 16], height: 3, mount: 'Floor', seats: 0, workstation: false, lights: 0, storage: 0, screens: 0, parts: 1, cost: 100 })

const base = layoutJson as unknown as BuildingLayout
const PKG = resolve(process.cwd(), '../../crates/kit-wasm/pkg') + '/'
const built = existsSync(`${PKG}kit_wasm.js`)

let kit: KitApi & { hashDesign(json: string): string }
beforeAll(async () => {
  if (!built) return
  const mod = (await import(/* @vite-ignore */ pathToFileURL(`${PKG}kit_wasm.js`).href)) as typeof kit & { initSync(m: { module: BufferSource }): unknown }
  mod.initSync({ module: readFileSync(`${PKG}kit_wasm_bg.wasm`) })
  kit = mod
})

const engines: NullEngine[] = []
afterEach(() => {
  for (const e of engines.splice(0)) e.dispose()
})

/** A red cube of the player's, 8 × 8 studs (0.5 m), 6 plates high. */
const CUBE = JSON.stringify({
  format: 'swarmpress.design.v1',
  id: 'cube-1',
  name: 'Red cube',
  footprint: [8, 8],
  height: 6,
  ops: [{ op: 'box', at: [0, 0, 0], size: [8, 8, 6], part: 'brick', colour: 'red' }],
  provenance: { kind: 'player', player: 'local' },
})
/** A long bench, 16 × 4 studs, to see the turn. */
const BENCH = JSON.stringify({
  format: 'swarmpress.design.v1',
  id: 'bench-1',
  name: 'Long bench',
  footprint: [16, 4],
  height: 3,
  ops: [{ op: 'box', at: [0, 0, 0], size: [16, 4, 3], part: 'brick', colour: 'blue' }],
  provenance: { kind: 'player', player: 'local' },
})

const room6 = base.rooms.find((r) => r.id === 'room-6')!
const spot = { x: room6.x + 1.25, z: room6.z + room6.d - 1.25 }

function withObjects(objects: PlacedObjectLayout[]): BuildingLayout {
  return { ...base, objects } as unknown as BuildingLayout
}

function scene(l: BuildingLayout, opts: BrickOfficeOptions = {}) {
  const engine = new NullEngine()
  engines.push(engine)
  const game = createGameScene(engine, null, l, { quality: QUALITY.low, postFx: false })
  const bricks = buildBrickOffice(game.scene, kit, l, game.office, game.lighting, opts)
  return { game, bricks }
}

function screenOf(game: GameScene, p: Vector3): { x: number; y: number } {
  const engine = game.scene.getEngine()
  const cam = game.iso.camera
  const vp = cam.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight())
  const s = Vector3.Project(p, Matrix.Identity(), cam.getViewMatrix(true).multiply(cam.getProjectionMatrix(true)), vp)
  return { x: s.x, y: s.y }
}

describe('placed objects (pure)', () => {
  it('reads the layout’s objects and their footprint rect, turned', () => {
    const o: PlacedObjectLayout = { id: 'object-1', design: 'a'.repeat(64), room: 'room-6', x: 2, z: 3, rot: Math.PI / 2, footprint: [1, 0.25], summary: { footprint: [16, 4], height: 3, mount: 'Floor', seats: 0, workstation: false, lights: 0, storage: 0, screens: 0, parts: 2, cost: 10 } }
    expect(objectsOf(withObjects([o]))).toHaveLength(1)
    expect(objectsOf(base)).toEqual([])
    // A quarter turn: the 1 m by 0.25 m bench lies north to south.
    expect(objectRect(o)).toEqual({ x: 2 - 0.125, z: 3 - 0.5, w: 0.25, d: 1 })
    // Without a summary the layout's metres are used.
    expect(objectRect({ ...o, rot: 0, summary: undefined })).toEqual({ x: 1.5, z: 2.875, w: 1, d: 0.25 })
    expect(objectRect({ ...o, rot: 0 }).w).toBeCloseTo(16 * STUD, 9)
  })
})

// Each test builds whole brick offices: generous under a loaded full run.
describe.skipIf(!built)('placed objects in the brick office (kit-wasm, NullEngine)', { timeout: 30_000 }, () => {
  it('draws an object from its design, resolved by hash, in its room and lit by it', () => {
    const hash = kit.hashDesign(CUBE)
    const asked: string[] = []
    const plain = scene(base).bricks
    const l = withObjects([{ id: 'object-1', design: hash, room: 'room-6', x: spot.x, z: spot.z, rot: 0, footprint: [0.5, 0.5], summary: summaryOf(0.5, 0.5) }])
    const { game, bricks } = scene(l, { designOf: (h) => (asked.push(h), h === hash ? CUBE : null) })
    expect(asked).toEqual([hash])
    expect(bricks.objects).toEqual([{ id: 'object-1', room: 'room-6', design: hash, drawn: 'design', rect: { x: spot.x - 0.25, z: spot.z - 0.25, w: 0.5, d: 0.5 }, at: { x: spot.x, y: 0, z: spot.z, turn: 0, desk: null }, seat: null }])
    expect(bricks.pendingDesigns()).toEqual([])
    // Its bricks are part of the room's batches: the room has the cube's instances more.
    const cube = kit.compile(CUBE, '')
    const more = bricks.rooms.get('room-6')!.stats.instances - plain.rooms.get('room-6')!.stats.instances
    expect(more).toBe(cube.instanceCount())
    cube.free()
    expect(bricks.stats().objects).toEqual({ drawn: 1, placeholders: 0 })
    // Lit by the room: its meshes are in the room's lights' scope.
    const roomMeshes = bricks.rooms.get('room-6')!.meshes.map((m) => m.mesh)
    const light = game.office.rooms.get('room-6')!.lights[0]
    if (light) expect(roomMeshes.every((m) => light.includedOnlyMeshes.includes(m))).toBe(true)
    expect(game.scene.getMeshByName('object-placeholder-object-1')).toBeNull()
  })

  it('draws a translucent footprint box while the design is not at hand, then the design once it is', () => {
    const hash = kit.hashDesign(BENCH)
    const l = withObjects([{ id: 'object-1', design: hash, room: 'room-6', x: spot.x, z: spot.z, rot: Math.PI / 2, footprint: [1, 0.25], summary: summaryOf(1, 0.25) }])
    const loading = scene(l, { designOf: () => undefined })
    expect(loading.bricks.objects[0].drawn).toBe('placeholder')
    expect(loading.bricks.pendingDesigns()).toEqual([hash])
    const box = loading.game.scene.getMeshByName('object-placeholder-object-1')!
    expect(box).toBeTruthy()
    expect((box.material as StandardMaterial).alpha).toBeLessThan(1)
    expect(box.isPickable).toBe(false)
    const ext = box.getBoundingInfo().boundingBox.extendSizeWorld
    // Turned a quarter: 0.25 m east to west, 1 m north to south, centred on the object.
    expect(ext.x * 2).toBeCloseTo(0.25, 3)
    expect(ext.z * 2).toBeCloseTo(1, 3)
    expect(box.position.x).toBeCloseTo(spot.x, 6)
    expect(loading.bricks.stats().objects).toEqual({ drawn: 0, placeholders: 1 })
    // Without any resolver, too.
    expect(scene(l).bricks.pendingDesigns()).toEqual([hash])
    // A design the kit refuses stays a box.
    const refused = scene(l, { designOf: () => '{"format":"swarmpress.design.v1","id":"x","name":"x","footprint":[1,1],"height":1,"ops":[{"op":"box","at":[0,0,0],"size":[1,1,1],"part":"nope","colour":"red"}]}' })
    expect(refused.bricks.objects[0].drawn).toBe('placeholder')
    // The design arrives: the next build draws it.
    const ready = scene(l, { designOf: () => BENCH })
    expect(ready.bricks.objects[0].drawn).toBe('design')
    expect(ready.bricks.objects[0].rect.w).toBeCloseTo(0.25, 6)
  })

  it('lets a new object arrive like equipment', () => {
    const hash = kit.hashDesign(CUBE)
    const next = withObjects([{ id: 'object-3', design: hash, room: 'room-6', x: spot.x, z: spot.z, rot: 0, footprint: [0.5, 0.5], summary: summaryOf(0.5, 0.5) }])
    const fresh = arrivalsFor(base, next, { frozen: false, reducedMotion: false })
    expect(fresh).toEqual(['object-3'])
    expect(arrivalsFor(base, next, { frozen: true, reducedMotion: false })).toEqual([])
    const { bricks } = scene(next, { designOf: () => CUBE, fresh })
    expect(bricks.arrivals.map((a) => [a.id, a.room])).toEqual([['object-3', 'room-6']])
    expect(bricks.arrivals[0].node.getChildMeshes().length).toBeGreaterThan(0)
  })
})

describe.skipIf(!built)('the build bridge with designs of the player’s own (kit-wasm, NullEngine)', { timeout: 30_000 }, () => {
  const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, right: 512, bottom: 256, width: 512, height: 256 }) } as unknown as HTMLCanvasElement

  it('shows the player’s design as the ghost, turned and tinted, and reuses it', () => {
    const { game, bricks } = scene(base)
    const bridge = createBuildBridge({ game, bricks, kit, layout: base, canvas: () => canvas })
    bridge.ghost({ kind: 'design:cube', family: 'equipment', x: spot.x, z: spot.z, rot: 1, ok: false, design: CUBE })
    const g = bridge.debug().ghost!
    expect(g.ok).toBe(false)
    expect(g.meshes.length).toBeGreaterThan(0)
    for (const m of g.meshes) expect(m.material?.name).toBe('ghost-bad')
    expect(g.node.position.x).toBeCloseTo(spot.x, 6)
    expect(g.node.rotation.y).toBeCloseTo(-Math.PI / 2, 6)
    const node = g.node
    bridge.ghost({ kind: 'design:cube', family: 'equipment', x: spot.x + 1, z: spot.z, rot: 0, ok: true, design: CUBE })
    expect(bridge.debug().ghost!.node).toBe(node)
    expect(bridge.state().ghost?.design).toBe(CUBE)
    // A design the kit refuses has no ghost, and nothing breaks.
    bridge.ghost({ kind: 'design:bad', family: 'equipment', x: 0, z: 0, rot: 0, ok: true, design: '{"nope":1}' })
    expect(bridge.debug().ghost).toBeNull()
    bridge.ghost(null)
    expect(node.isEnabled()).toBe(false)
    bridge.dispose()
  })

  it('picks a placed object by its footprint and highlights it', () => {
    const hash = kit.hashDesign(CUBE)
    const l = withObjects([{ id: 'object-1', design: hash, room: 'room-6', x: spot.x, z: spot.z, rot: 0, footprint: [0.5, 0.5], summary: summaryOf(0.5, 0.5) }])
    const { game, bricks } = scene(l, { designOf: () => CUBE })
    const bridge = createBuildBridge({ game, bricks, kit, layout: l, canvas: () => canvas })
    const s = screenOf(game, new Vector3(spot.x, 0, spot.z))
    expect(bridge.pick(s.x, s.y)!.target).toEqual({ kind: 'object', id: 'object-1' })
    // Beside it: the room.
    const off = screenOf(game, new Vector3(spot.x + 0.6, 0, spot.z))
    expect(bridge.pick(off.x, off.y)!.target).toEqual({ kind: 'room', id: 'room-6' })
    bridge.highlight({ kind: 'object', id: 'object-1' })
    const bars = bridge.debug().highlight
    expect(bars).toHaveLength(4)
    const xs = bars.map((b) => b.position.x)
    expect(Math.min(...xs)).toBeLessThan(spot.x - 0.25)
    expect(Math.max(...xs)).toBeGreaterThan(spot.x + 0.25)
    bridge.highlight({ kind: 'object', id: 'object-9' })
    expect(bridge.debug().highlight).toHaveLength(0)
    bridge.dispose()
  })
})
