// Construction (FEAT-084, ADR-0087 decision 6): after a rebuild on a new `layoutRev`, the equipment
// the old layout did not have is found in build order, built apart under its own node (a desk with
// its chair, a monitor with its screen), and drops into place; nothing moves on frozen pages or
// under reduced motion. The scene parts run under NullEngine on the real kit (crates/kit-wasm/pkg,
// skipped without it like bricks.test.ts).
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { NullEngine, Vector3, type Mesh } from '@babylonjs/core'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import layoutJson from '../../state/fixtures/demo-layout.json'
import type { BuildingLayout } from '../../state/render-state'
import { QUALITY } from '../postfx'
import { createGameScene } from '../scene'
import type { KitApi } from './kit'
import { buildBrickOffice } from './office'
import { animateArrivals, ARRIVAL_DROP, ARRIVAL_MAX_STEP_MS, ARRIVAL_MS, ARRIVAL_STAGGER_MS, arrivalPose, arrivalsFor, byBuildOrder, freshEquipment } from './arrivals'

const base = layoutJson as unknown as BuildingLayout

/** The demo layout with a new desk, its monitor and a plant in the meeting room (room-6). */
function withNewThings(): BuildingLayout {
  const next = structuredClone(base)
  const room = next.rooms.find((r) => r.id === 'room-6')!
  room.desks.push({ id: 'equip-101', x: 2, z: 11, rot: 0, seat: [2, 11.75] } as (typeof room.desks)[number])
  room.props.push({ id: 'equip-102', kind: 'monitor', x: 2, z: 11, rot: 0, attachedTo: 'equip-101' } as (typeof room.props)[number])
  room.props.push({ id: 'equip-99', kind: 'plant', x: 5.5, z: 8.5, rot: 0, attachedTo: null } as (typeof room.props)[number])
  return next
}

describe('what arrives (pure)', () => {
  it('finds the equipment the new layout has and the old had not, in build order', () => {
    expect(freshEquipment(base, withNewThings())).toEqual(['equip-99', 'equip-101', 'equip-102'])
    expect(freshEquipment(base, base)).toEqual([])
    // The first scene of a page: nothing arrives.
    expect(freshEquipment(null, withNewThings())).toEqual([])
    expect(['equip-12', 'equip-9', 'b', 'a'].sort(byBuildOrder)).toEqual(['a', 'b', 'equip-9', 'equip-12'])
  })

  it('animates nothing on frozen pages or under reduced motion', () => {
    const next = withNewThings()
    expect(arrivalsFor(base, next, { frozen: false, reducedMotion: false })).toHaveLength(3)
    expect(arrivalsFor(base, next, { frozen: true, reducedMotion: false })).toEqual([])
    expect(arrivalsFor(base, next, { frozen: false, reducedMotion: true })).toEqual([])
  })

  it('drops each item from above with a little scale, one after another', () => {
    expect(arrivalPose(0, 0)).toEqual({ y: ARRIVAL_DROP, scale: 0.85, visible: false, done: false })
    const mid = arrivalPose(ARRIVAL_MS / 2, 0)
    expect(mid.visible).toBe(true)
    expect(mid.y).toBeGreaterThan(0)
    expect(mid.y).toBeLessThan(ARRIVAL_DROP / 2)
    expect(mid.scale).toBeGreaterThan(0.85)
    expect(mid.scale).toBeLessThan(1)
    expect(arrivalPose(ARRIVAL_MS, 0)).toEqual({ y: 0, scale: 1, visible: true, done: true })
    // The second waits its turn.
    expect(arrivalPose(ARRIVAL_STAGGER_MS / 2, 1).visible).toBe(false)
    expect(arrivalPose(ARRIVAL_MS + ARRIVAL_STAGGER_MS, 1).done).toBe(true)
  })
})

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

function office(layout: BuildingLayout, fresh?: readonly string[]) {
  const engine = new NullEngine()
  engines.push(engine)
  const game = createGameScene(engine, null, layout, { quality: QUALITY.low, postFx: false })
  const bricks = buildBrickOffice(game.scene, kit, layout, game.office, game.lighting, { fresh })
  return { game, bricks }
}

/** Every thin instance's centre in the world. */
function centres(meshes: readonly Mesh[]) {
  const out: Vector3[] = []
  for (const m of meshes) {
    const world = m.computeWorldMatrix(true)
    for (const local of m.thinInstanceGetWorldMatrices()) out.push(Vector3.TransformCoordinates(local.getTranslation(), world))
  }
  return out
}

describe.skipIf(!built)('arrivals in the scene (kit-wasm, NullEngine)', () => {
  it('builds the fresh items apart, each under its node, with the same bricks as without', () => {
    const next = withNewThings()
    const fresh = freshEquipment(base, next)
    const plain = office(next)
    const apart = office(next, fresh)
    expect(plain.bricks.arrivals).toEqual([])
    expect(apart.bricks.arrivals.map((a) => [a.id, a.room])).toEqual([
      ['equip-99', 'room-6'],
      ['equip-101', 'room-6'],
      ['equip-102', 'room-6'],
    ])
    // The room draws the same number of bricks either way: the fresh ones just sit in their own batches.
    const count = (b: typeof plain.bricks) => b.rooms.get('room-6')!.stats.instances
    expect(count(apart.bricks)).toBe(count(plain.bricks))
    // The desk's node carries its chair too; each node's pivot is its footprint centre on the floor.
    const desk = apart.bricks.arrivals[1]
    const deskMeshes = apart.game.scene.meshes.filter((m) => m.parent === desk.node)
    expect(deskMeshes.length).toBeGreaterThan(0)
    expect(deskMeshes.some((m) => m.name.includes('equip-101'))).toBe(true)
    expect(desk.node.getPivotPoint().asArray()).toEqual([2, 0, 11])
    // The monitor's screen rides with the monitor.
    const screen = apart.bricks.surfaces.find((s) => s.anchor.owner === 'equip-102')
    expect(screen?.mesh.parent).toBe(apart.bricks.arrivals[2].node)
  })

  it('starts each item hidden and above its place, then lands it where it stands', async () => {
    const next = withNewThings()
    const { game, bricks } = office(next, freshEquipment(base, next))
    const plant = bricks.arrivals[0]
    const meshes = game.scene.meshes.filter((m) => m.parent === plant.node) as Mesh[]
    const landed = centres(meshes).map((c) => c.asArray())
    let t = 0
    const observers = game.scene.onBeforeRenderObservable.observers.length
    const stop = animateArrivals(game.scene, bricks.arrivals, () => t)
    expect(bricks.arrivals.every((a) => !a.node.isEnabled(false))).toBe(true)
    // Time starts at the first frame drawn (a slow first frame after a rebuild skips nothing).
    t = 5000
    game.scene.render()
    expect(plant.node.isEnabled(false)).toBe(false)
    // A frame advances at most ARRIVAL_MAX_STEP_MS, however long it took.
    t += 1000
    game.scene.render()
    expect(plant.node.isEnabled(false)).toBe(true)
    expect(plant.node.position.y).toBeCloseTo(arrivalPose(ARRIVAL_MAX_STEP_MS, 0).y, 6)
    for (let i = 0; i < 6; i++) {
      t += 16
      game.scene.render()
    }
    expect(plant.node.position.y).toBeGreaterThan(0)
    // The last waits for its turn.
    expect(bricks.arrivals[2].node.isEnabled(false)).toBe(false)
    for (let i = 0; i < 80; i++) {
      t += 16
      game.scene.render()
    }
    for (const a of bricks.arrivals) {
      expect(a.node.isEnabled(false)).toBe(true)
      expect(a.node.position.y).toBe(0)
      expect(a.node.scaling.x).toBe(1)
    }
    const now = centres(meshes).map((c) => c.asArray())
    now.forEach((p, i) => p.forEach((v, k) => expect(v).toBeCloseTo(landed[i][k], 4)))
    // Done: the animation has let go of the frames (Babylon removes an observer after the notification that ran it).
    await new Promise((r) => setTimeout(r, 0))
    expect(game.scene.onBeforeRenderObservable.observers.length).toBe(observers)
    stop()
  })

  it('stopping puts every item in its place at once', () => {
    const next = withNewThings()
    const { game, bricks } = office(next, freshEquipment(base, next))
    const stop = animateArrivals(game.scene, bricks.arrivals, () => 0)
    stop()
    for (const a of bricks.arrivals) {
      expect(a.node.isEnabled(false)).toBe(true)
      expect(a.node.position.y).toBe(0)
    }
  })
})
