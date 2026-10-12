// Staff use what the bricks provide (ADR-0088), as drawn, under NullEngine on the real kit
// (crates/kit-wasm/pkg; skipped without it): a desk-top object stands at its desk's slot port, where
// the office draws a monitor or a lamp, and moves with the desk; the build bridge's ghost stands at
// a desk's screen or lamp port and picks a desk-top object there; a workstation object gets a chair
// at the seat the layout gives it, and a person the render state seats there is drawn where the
// render state puts them, sitting and facing the object.
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Matrix, NullEngine, Vector3 } from '@babylonjs/core'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import layoutJson from '../../state/fixtures/demo-layout.json'
import workingJson from '../../state/fixtures/demo-working.json'
import type { BuildingLayout, ObjectSummary as WireSummary, RenderState, StaffRender } from '../../state/render-state'
import { createBuildBridge } from '../build-mode/bridge'
import { emptyPoseView, layoutContext, poseView } from '../characters/pose'
import { QUALITY } from '../postfx'
import { createGameScene, type GameScene } from '../scene'
import { mappingOf, type KitApi } from './kit'
import { objectSeat, objectSpot, type PlacedObjectLayout } from './objects'
import { buildBrickOffice, type BrickOfficeOptions } from './office'
import { deskSlotAt, roomPlacements, turnXZ, type DesignInfo } from './placements'

const base = layoutJson as unknown as BuildingLayout
const working = workingJson as unknown as RenderState
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

const player = { kind: 'player', player: 'local' }
/** A mug: a surface design without a screen (the lamp slot). */
const MUG = JSON.stringify({ format: 'swarmpress.design.v1', id: 'mug', name: 'Mug', mount: 'surface', footprint: [2, 2], height: 3, ops: [{ op: 'box', at: [0, 0, 0], size: [2, 2, 3], part: 'brick', colour: 'red' }], provenance: player })
/** A workstation of the player's: a desk-high top, a screen, a seat port 0.75 m south of its centre. */
const MY_DESK = JSON.stringify({
  format: 'swarmpress.design.v1',
  id: 'my-desk',
  name: 'My desk',
  footprint: [16, 12],
  height: 40,
  ops: [
    { op: 'box', at: [0, 0, 0], size: [16, 12, 29], part: 'brick', colour: 'sand' },
    { op: 'box', at: [0, 0, 29], size: [16, 12, 1], part: 'plate', colour: 'sand' },
    { op: 'part', part: 'screen-2x2', at: [7, 2, 30], colour: 'screen-blue', surface: 'monitor' },
  ],
  ports: [{ id: 'seat', at: [8, 18, 0], accepts: ['seat'] }],
  provenance: player,
})

const summary = (over: Partial<WireSummary>): WireSummary => ({ footprint: [2, 2], height: 3, mount: 'Surface', seats: 0, workstation: false, lights: 0, storage: 0, screens: 0, parts: 1, cost: 12, ...over })

/** The demo layout with equip-17's lamp (equip-19) taken off, so a mug can take the lamp slot; and `objects`. */
function layoutWith(objects: PlacedObjectLayout[], moveDesk = 0): BuildingLayout {
  const l = structuredClone(base) as BuildingLayout & { objects?: PlacedObjectLayout[] }
  const room = l.rooms.find((r) => r.id === 'room-1')!
  room.props = room.props.filter((p) => p.id !== 'equip-19')
  const desk = room.desks.find((d) => d.id === 'equip-17')!
  desk.x += moveDesk
  desk.seat = [desk.seat[0] + moveDesk, desk.seat[1]]
  l.objects = objects
  return l
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

const infoOf = () => {
  const cache = new Map<string, DesignInfo>()
  return (design: string, params: string): DesignInfo => {
    const key = `${design}|${params}`
    let i = cache.get(key)
    if (!i) {
      const b = kit.compileShipped(design, params)
      const j = JSON.parse(b.infoJson())
      b.free()
      cache.set(key, (i = { bounds: j.bounds, mount: j.mount, ports: j.ports }))
    }
    return i
  }
}

describe.skipIf(!built)('desk slots and desk-top objects (kit-wasm, NullEngine)', { timeout: 30_000 }, () => {
  it('finds a desk’s screen and lamp ports where the office draws its monitor and lamp', () => {
    const info = infoOf()
    const mapping = mappingOf(kit)
    const room = base.rooms.find((r) => r.id === 'room-1')!
    const desk = room.desks.find((d) => d.id === 'equip-17')!
    const { placements } = roomPlacements(room, mapping, info)
    const monitor = placements.find((p) => p.id === 'equip-18')!
    const lamp = placements.find((p) => p.id === 'equip-19')!
    const screen = deskSlotAt(desk, 'screen', mapping, info)!
    const lampSlot = deskSlotAt(desk, 'lamp', mapping, info)!
    expect(screen).toEqual({ x: monitor.x, y: monitor.y, z: monitor.z, turn: monitor.turn })
    expect(lampSlot).toEqual({ x: lamp.x, y: lamp.y, z: lamp.z, turn: lamp.turn })
    expect(screen.x).not.toBeCloseTo(lampSlot.x, 3)
    expect(screen.y).toBeGreaterThan(0.7)
    expect(deskSlotAt(desk, 'drawer', mapping, info)).toBeNull()
  })

  it('draws a desk-top object at its desk’s slot port and moves it with the desk', () => {
    const hash = kit.hashDesign(MUG)
    const mug: PlacedObjectLayout = { id: 'object-4', design: hash, room: 'room-1', x: 0, z: 0, rot: 0, footprint: [0.125, 0.125], summary: summary({}), onDesk: { desk: 'equip-17', slot: 'lamp' } }
    const info = infoOf()
    const mapping = mappingOf(kit)
    const desk = base.rooms[0].desks.find((d) => d.id === 'equip-17')!
    const lamp = deskSlotAt(desk, 'lamp', mapping, info)!
    const { bricks } = scene(layoutWith([mug]), { designOf: () => MUG })
    expect(bricks.objects).toHaveLength(1)
    expect(bricks.objects[0]).toMatchObject({ id: 'object-4', drawn: 'design', at: { ...lamp, desk: 'equip-17' }, seat: null })
    // Its x and z in the layout are not where it is drawn: its desk is.
    expect(bricks.objects[0].rect.x + bricks.objects[0].rect.w / 2).toBeCloseTo(lamp.x, 6)
    // The desk moves a metre east: the mug goes with it.
    const moved = scene(layoutWith([mug], 1), { designOf: () => MUG }).bricks
    expect(moved.objects[0].at.x).toBeCloseTo(lamp.x + 1, 6)
    expect(moved.objects[0].at.z).toBeCloseTo(lamp.z, 6)
    // The pure spot says the same; a desk the layout lacks has none (nothing is drawn).
    expect(objectSpot(mug, layoutWith([mug], 1), mapping, info)!.x).toBeCloseTo(lamp.x + 1, 6)
    const lost = { ...mug, onDesk: { desk: 'equip-999', slot: 'lamp' as const } }
    expect(objectSpot(lost, layoutWith([lost]), mapping, info)).toBeNull()
    expect(scene(layoutWith([lost]), { designOf: () => MUG }).bricks.objects).toEqual([])
    // Still being read: a placeholder box at the port's height.
    const pending = scene(layoutWith([mug]), { designOf: () => undefined })
    const box = pending.game.scene.getMeshByName('object-placeholder-object-4')!
    expect(box.position.x).toBeCloseTo(lamp.x, 6)
    expect(box.position.y).toBeGreaterThan(lamp.y)
  })

  it('arrives with a fresh desk', () => {
    const hash = kit.hashDesign(MUG)
    const mug: PlacedObjectLayout = { id: 'object-4', design: hash, room: 'room-1', x: 0, z: 0, rot: 0, footprint: [0.125, 0.125], summary: summary({}), onDesk: { desk: 'equip-17', slot: 'lamp' } }
    const { bricks } = scene(layoutWith([mug]), { designOf: () => MUG, fresh: ['equip-17'] })
    expect(bricks.arrivals.map((a) => a.id)).toEqual(['equip-17'])
  })

  it('stands the ghost at a desk’s screen or lamp port, and picks a desk-top object on its desk', () => {
    const hash = kit.hashDesign(MUG)
    const mug: PlacedObjectLayout = { id: 'object-4', design: hash, room: 'room-1', x: 0, z: 0, rot: 0, footprint: [0.125, 0.125], summary: summary({}), onDesk: { desk: 'equip-17', slot: 'lamp' } }
    const l = layoutWith([mug])
    const { game, bricks } = scene(l, { designOf: () => MUG })
    const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, right: 512, bottom: 256, width: 512, height: 256 }) } as unknown as HTMLCanvasElement
    const bridge = createBuildBridge({ game, bricks, kit, layout: l, canvas: () => canvas })
    const info = infoOf()
    const mapping = mappingOf(kit)
    const desk = l.rooms[0].desks.find((d) => d.id === 'equip-20')!
    const screen = deskSlotAt(desk, 'screen', mapping, info)!
    const lamp = deskSlotAt(desk, 'lamp', mapping, info)!
    // A design of the player's on the screen slot: at the port, raised to its height.
    bridge.ghost({ kind: 'design:mug', family: 'equipment', x: 0, z: 0, rot: 0, ok: true, design: MUG, onDesk: { desk: 'equip-20', slot: 'screen' } })
    let g = bridge.debug().ghost!.node
    expect([g.position.x, g.position.y, g.position.z]).toEqual([screen.x, screen.y, screen.z])
    bridge.ghost({ kind: 'design:mug', family: 'equipment', x: 0, z: 0, rot: 0, ok: true, design: MUG, onDesk: { desk: 'equip-20', slot: 'lamp' } })
    g = bridge.debug().ghost!.node
    expect([g.position.x, g.position.y, g.position.z]).toEqual([lamp.x, lamp.y, lamp.z])
    // A kit lamp: at the lamp port (its design is built at the port's height already).
    bridge.ghost({ kind: 'DeskLamp', family: 'equipment', x: desk.x, z: desk.z, rot: 0, ok: true, onDesk: { desk: 'equip-20', slot: 'lamp' } })
    g = bridge.debug().ghost!.node
    expect([g.position.x, g.position.y, g.position.z]).toEqual([lamp.x, 0, lamp.z])
    // An unknown desk: the ghost stays at its own x, z.
    bridge.ghost({ kind: 'DeskLamp', family: 'equipment', x: 2, z: 2, rot: 0, ok: false, onDesk: { desk: 'equip-999', slot: 'lamp' } })
    g = bridge.debug().ghost!.node
    expect([g.position.x, g.position.z]).toEqual([2, 2])
    // The mug on equip-17 is picked at its port (it is on top of the desk).
    const at = bricks.objects[0].at
    const s = screenOf(game, new Vector3(at.x, at.y + 0.05, at.z))
    expect(bridge.pick(s.x, s.y)!.target).toEqual({ kind: 'object', id: 'object-4' })
    bridge.highlight({ kind: 'object', id: 'object-4' })
    expect(bridge.debug().highlight).toHaveLength(4)
    bridge.dispose()
  })
})

describe.skipIf(!built)('workstation objects (kit-wasm, NullEngine)', { timeout: 30_000 }, () => {
  const room6 = base.rooms.find((r) => r.id === 'room-6')!
  const spot = { x: room6.x + 2, z: room6.z + 3 }

  /** My desk in room-6, turned a quarter, called home by the typist of the working fixture. */
  function deskObject(seatAt: [number, number] | null, assignedTo: string | null): PlacedObjectLayout {
    return {
      id: 'object-1',
      design: kit.hashDesign(MY_DESK),
      room: 'room-6',
      x: spot.x,
      z: spot.z,
      rot: Math.PI / 2,
      footprint: [1, 0.75],
      summary: summary({ footprint: [16, 12], height: 35, mount: 'Floor', workstation: true, screens: 1, seat_at: seatAt ? [seatAt[0] * 1000, seatAt[1] * 1000] : null } as Partial<WireSummary>),
      seatAt,
      assignedTo,
    }
  }

  it('draws its chair at the seat the layout gives, turned with the object', () => {
    const o = deskObject([0, 0.75], 'staff-x')
    const [dx, dz] = turnXZ(0, 0.75, 1)
    expect(objectSeat(o)).toEqual([spot.x + dx, spot.z + dz])
    const withSeat = scene({ ...base, objects: [o] } as unknown as BuildingLayout, { designOf: () => MY_DESK }).bricks
    const without = scene({ ...base, objects: [{ ...o, seatAt: null }] } as unknown as BuildingLayout, { designOf: () => MY_DESK }).bricks
    expect(withSeat.objects[0].seat).toEqual([spot.x + dx, spot.z + dz])
    expect(without.objects[0].seat).toBeNull()
    // The chair's bricks are in the room's batches.
    expect(withSeat.rooms.get('room-6')!.stats.instances).toBeGreaterThan(without.rooms.get('room-6')!.stats.instances)
  })

  it('draws a person the render state seats there where it puts them, sitting and facing the object', () => {
    const typist = working.staff.find((s) => s.pose === 'type')!
    const o = deskObject([0, 0.75], typist.id)
    const seat = objectSeat(o)!
    const l = { ...base, objects: [o] } as unknown as BuildingLayout
    // The sim seats the typist at the object: their position is the seat, `seatedAt` the object.
    const state = structuredClone(working)
    const p = state.staff.find((s) => s.id === typist.id)!
    Object.assign(p, { x: seat[0], z: seat[1], seatedAt: 'object-1', path: null } satisfies Partial<StaffRender>)
    const ctx = { ...layoutContext(l), meeting: () => undefined, person: () => undefined }
    expect(poseView(p, ctx, emptyPoseView())).toMatchObject({ stance: 'sit', seat: 'desk', faceX: spot.x, faceZ: spot.z, arms: true })
    // Without `seatedAt`, the layout's `assignedTo` and the seat position say the same.
    const q = { ...p, seatedAt: null }
    expect(poseView(q, ctx, emptyPoseView())).toMatchObject({ stance: 'sit', seat: 'desk', faceX: spot.x, faceZ: spot.z })
    // Away from the seat they are not drawn at it.
    expect(poseView({ ...q, x: seat[0] + 2 }, ctx, emptyPoseView()).faceX).not.toBe(spot.x)

    const engine = new NullEngine()
    engines.push(engine)
    const game = createGameScene(engine, null, l, { quality: QUALITY.low, postFx: false })
    game.update(state, 0)
    game.frame(16)
    const h = game.staff.handles.get(typist.id)!
    expect([h.root.position.x, h.root.position.z]).toEqual([seat[0], seat[1]])
    expect(h.shown.stance).toBe('sit')
    // Facing the object: the object's centre is straight ahead.
    const ahead = Math.atan2(spot.x - seat[0], spot.z - seat[1])
    expect(Math.abs(Math.sin(h.root.rotation.y - ahead))).toBeLessThan(1e-6)
    expect(Math.cos(h.root.rotation.y - ahead)).toBeGreaterThan(0)
  })
})
