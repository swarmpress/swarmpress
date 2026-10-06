// The brick office spike (FEAT-081) under NullEngine, on the real kit
// (crates/kit-wasm/pkg from `cargo xtask wasm`; skipped without it, like
// the sim's wasm drift test): deterministic instance buffers, counts per
// room equal to the kit's, placement at the layout's positions and turns,
// separable studs, the cutaway, and the box office switched off in the
// brick rooms only.
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { NullEngine, type Mesh } from '@babylonjs/core'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import layoutJson from '../../state/fixtures/demo-layout.json'
import workingJson from '../../state/fixtures/demo-working.json'
import { seatOf, type BuildingLayout, type RenderState, type RoomLayout } from '../../state/render-state'
import { ISO_ALPHAS } from '../camera-math'
import { isCutAway } from '../cutaway'
import { QUALITY } from '../postfx'
import { createGameScene, type GameScene } from '../scene'
import { buildRoomChunk, exteriorSides, regionOf, shellOrigin, type ChunkSource } from './chunk'
import { mappingOf, type KitApi } from './kit'
import { buildBrickOffice, SPIKE_ROOMS, type BrickOffice } from './office'
import { PLATE, roomPlacements, STUD, turnOf, type DesignInfo } from './placements'
import townJson from '../../../../../crates/blueprint/tests/fixtures/cinqueterre-mini.town.json'

const layout = layoutJson as unknown as BuildingLayout
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

function scene(l: BuildingLayout = layout): { game: GameScene; bricks: BrickOffice } {
  const engine = new NullEngine()
  engines.push(engine)
  const game = createGameScene(engine, null, l, { quality: QUALITY.low, postFx: false })
  const bricks = buildBrickOffice(game.scene, kit, l, game.office, game.lighting)
  return { game, bricks }
}

const infoOf = (design: string, params: string): DesignInfo => {
  const b = kit.compileShipped(design, params)
  const i = JSON.parse(b.infoJson())
  b.free()
  return { bounds: i.bounds, mount: i.mount, ports: i.ports }
}

const room = (kind: string) => layout.rooms.find((r) => r.kind === kind)!

describe.skipIf(!built)('brick office spike (kit-wasm, NullEngine)', () => {
  it('builds the newsroom and the editor’s office, and only those', () => {
    const { bricks } = scene()
    const kinds = [...bricks.rooms.values()].map((r) => r.stats.kind)
    expect(kinds.sort()).toEqual([...SPIKE_ROOMS].sort())
    for (const r of bricks.rooms.values()) {
      expect(r.stats.instances).toBeGreaterThan(2000)
      expect(r.meshes.length).toBeGreaterThan(5)
    }
  })

  it('draws exactly the instances and studs the kit compiled, per room', () => {
    const { bricks } = scene()
    for (const r of bricks.rooms.values()) {
      expect(r.stats.instances).toBe(r.stats.kitInstances)
      expect(r.stats.studs).toBe(r.stats.kitStuds)
      const drawn = r.meshes.reduce((a, m) => a + m.mesh.thinInstanceCount, 0)
      const studs = r.studs.reduce((a, m) => a + m.mesh.thinInstanceCount, 0)
      expect(drawn).toBe(r.stats.instances)
      expect(studs).toBe(r.stats.studs)
    }
  })

  it('gives byte-identical instance buffers for the same layout', () => {
    const a = scene().bricks
    const b = scene().bricks
    for (const [id, ra] of a.rooms) {
      const rb = b.rooms.get(id)!
      expect(rb.chunk.instances.map((x) => x.key)).toEqual(ra.chunk.instances.map((x) => x.key))
      ra.chunk.instances.forEach((x, i) => expect(Buffer.from(rb.chunk.instances[i].matrices.buffer).equals(Buffer.from(x.matrices.buffer))).toBe(true))
      ra.chunk.studs.forEach((x, i) => expect(Buffer.from(rb.chunk.studs[i].matrices.buffer).equals(Buffer.from(x.matrices.buffer))).toBe(true))
    }
  })

  it('places a desk, its monitor and its chair at the layout’s position, seat and turn', () => {
    const news = room('newsroom')
    const { placements } = roomPlacements(news, mappingOf(kit), infoOf)
    const d = news.desks[0]
    const desk = placements.find((p) => p.id === d.id)!
    expect([desk.design, desk.x, desk.z, desk.turn]).toEqual(['desk', d.x, d.z, turnOf(d.rot)])
    const chair = placements.find((p) => p.id === `${d.id}/seat`)!
    expect(chair.design).toBe('chair')
    expect(chair.x).toBeCloseTo(d.seat[0], 6)
    expect(chair.z).toBeCloseTo(d.seat[1], 6)
    const monitor = placements.find((p) => p.desk === d.id && p.role === 'monitor')!
    expect(monitor.y).toBeCloseTo(30 * PLATE, 6) // the desk top (75 cm)
    expect(monitor.turn).toBe(desk.turn)
  })

  it('turns a desk by the sim’s rot: its chair lands on the sim’s seat at every quarter turn', () => {
    const news = room('newsroom')
    for (const t of [0, 1, 2, 3]) {
      const rot = (t * Math.PI) / 2
      const r: RoomLayout = { ...news, props: [], desks: [{ id: 'd', x: 4, z: 3, rot, seat: seatOf(4, 3, rot) }] }
      const { placements } = roomPlacements(r, mappingOf(kit), infoOf)
      const chair = placements.find((p) => p.id === 'd/seat')!
      expect([chair.x, chair.z, chair.turn]).toEqual([expect.closeTo(r.desks[0].seat[0], 6), expect.closeTo(r.desks[0].seat[1], 6), t])
    }
  })

  it('turns the bricks with the placement: a desk at rot π/2 spans 0.75 m east–west and 1.5 m north–south', () => {
    const news = room('newsroom')
    const r: RoomLayout = { ...news, props: [], ceilingLights: [], desks: [{ id: 'd', x: 4, z: 3, rot: Math.PI / 2, seat: seatOf(4, 3, Math.PI / 2) }] }
    const { placements } = roomPlacements(r, mappingOf(kit), infoOf)
    const p = placements.find((x) => x.id === 'd')!
    const b = kit.compileShipped('desk', '{}')
    const i = infoOf('desk', '{}')
    const chunk = buildRoomChunk(r, [], [{ build: b, placement: p, footprint: [i.bounds[0], i.bounds[1]], shell: false }])
    let [x0, x1, z0, z1] = [Infinity, -Infinity, Infinity, -Infinity]
    for (const batch of chunk.instances)
      for (let k = 0; k < batch.count; k++) {
        const o = k * 16
        // Half extents of a turned box from its matrix rows.
        const hx = (Math.abs(batch.matrices[o]) + Math.abs(batch.matrices[o + 8])) / 2
        const hz = (Math.abs(batch.matrices[o + 2]) + Math.abs(batch.matrices[o + 10])) / 2
        x0 = Math.min(x0, batch.matrices[o + 12] - hx)
        x1 = Math.max(x1, batch.matrices[o + 12] + hx)
        z0 = Math.min(z0, batch.matrices[o + 14] - hz)
        z1 = Math.max(z1, batch.matrices[o + 14] + hz)
      }
    b.free()
    expect(x1 - x0).toBeCloseTo(12 * STUD, 2)
    expect(z1 - z0).toBeCloseTo(24 * STUD, 2)
    expect((x0 + x1) / 2).toBeCloseTo(4, 2)
    expect((z0 + z1) / 2).toBeCloseTo(3, 2)
  })

  it('gives every thin-instanced mesh its own geometry (WebGL2 caches a vertex array object per geometry)', () => {
    const { bricks } = scene()
    const meshes = [...bricks.rooms.values()].flatMap((r) => [...r.meshes, ...r.studs].map((m) => m.mesh))
    expect(new Set(meshes.map((m) => m.geometry)).size).toBe(meshes.length)
    // Window modules are drawn as glass.
    expect([...bricks.rooms.values()].some((r) => r.chunk.instances.some((b) => b.colour === 'glass' && b.region !== 'base'))).toBe(true)
  })

  it('keeps the studs in their own meshes, so they can be dropped wholesale', () => {
    const { bricks } = scene()
    const studMeshes = [...bricks.rooms.values()].flatMap((r) => r.studs.map((s) => s.mesh))
    expect(studMeshes.length).toBeGreaterThan(0)
    bricks.setStuds(false)
    bricks.frame()
    expect(studMeshes.every((m) => !m.isEnabled())).toBe(true)
    expect([...bricks.rooms.values()].some((r) => r.meshes.some((m) => m.mesh.isEnabled()))).toBe(true)
    bricks.setStuds(true)
    bricks.frame()
    expect(studMeshes.some((m) => m.isEnabled())).toBe(true)
  })

  it('cuts brick walls away by the box office’s rule, and keeps interior walls at partition height', () => {
    const { game, bricks } = scene()
    const news = [...bricks.rooms.values()].find((r) => r.stats.kind === 'newsroom')!
    expect(news.chunk.exterior.sort()).toEqual(['north', 'west'])
    for (const alpha of ISO_ALPHAS) {
      game.iso.camera.alpha = alpha
      bricks.frame()
      for (const { mesh, region } of news.meshes) {
        if (region === 'upper') expect(mesh.isEnabled(), mesh.name).toBe(false)
        else if (region === 'base') expect(mesh.isEnabled(), mesh.name).toBe(true)
        else expect(mesh.isEnabled(), `${mesh.name} @${alpha}`).toBe(!isCutAway(region.slice(5) as 'north', alpha))
      }
    }
    expect(news.meshes.some((m) => m.region === 'wall-north')).toBe(true)
    expect(news.meshes.some((m) => m.region === 'upper')).toBe(true)
  })

  it('classifies wall bands by the nearest side, and floors as base', () => {
    const r = { w: 8, d: 6 }
    expect(regionOf(r, ['north'], 4, 1.5, 0.03)).toBe('wall-north')
    expect(regionOf(r, ['north'], 4, 1.5, 5.97)).toBe('upper')
    expect(regionOf(r, ['north'], 4, 0.5, 5.97)).toBe('base')
    expect(regionOf(r, ['north'], 4, -0.03, 0.03)).toBe('base')
    expect(regionOf(r, ['north'], 4, 1.5, 3)).toBe('base')
    expect(exteriorSides(room('editor-office'), layout)).toEqual(['north'])
    expect(shellOrigin({ x: 8, z: 0 }, [0, 0])[1]).toBeCloseTo(-2 * PLATE, 6)
  })

  it('switches the box office off in the brick rooms only', () => {
    const { game } = scene()
    const brickIds = new Set(layout.rooms.filter((r) => SPIKE_ROOMS.includes(r.kind)).map((r) => r.id))
    for (const [id, h] of game.office.rooms) expect(h.floor.isEnabled(), id).toBe(!brickIds.has(id))
    for (const d of game.office.desks.values()) for (const m of d.meshes) expect(m.isEnabled(), m.name).toBe(!brickIds.has(d.roomId))
    // The kitchen keeps its walls; the newsroom's north wall is bricks now.
    const enabledNorth = game.office.walls.filter((w) => w.side === 'north' && w.mesh.isEnabled()).map((w) => w.mesh.getBoundingInfo().boundingBox.centerWorld.x)
    expect(enabledNorth.every((x) => x > 12)).toBe(true)
  })

  it('reaches the brick meshes with the room’s ceiling lights, within the light budget', () => {
    const { game, bricks } = scene()
    for (const [id, r] of bricks.rooms) {
      for (const l of game.office.rooms.get(id)!.lights) for (const { mesh } of r.meshes) expect(l.includedOnlyMeshes).toContain(mesh)
      const lightsOn = (m: Mesh) => game.scene.lights.filter((l) => l.includedOnlyMeshes.length === 0 || l.includedOnlyMeshes.includes(m)).length
      for (const { mesh } of r.meshes) expect(lightsOn(mesh)).toBeLessThanOrEqual(8)
    }
  })

  it('has a monitor surface per desk and the newsroom whiteboard, and glows from the render state', () => {
    const { game, bricks } = scene()
    const desks = layout.rooms.filter((r) => SPIKE_ROOMS.includes(r.kind)).flatMap((r) => r.desks.map((d) => d.id))
    const monitors = bricks.surfaces.filter((s) => s.kind === 'monitor')
    expect(monitors.map((s) => s.anchor.desk).sort()).toEqual([...desks].sort())
    expect(bricks.surfaces.filter((s) => s.kind === 'whiteboard')).toHaveLength(1)
    const state = workingJson as unknown as RenderState
    game.update(state)
    bricks.update(state)
    for (const s of monitors) {
      const on = state.monitors[s.anchor.desk!] === true
      expect(s.material.emissiveColor.b > 0, s.id).toBe(on)
    }
    // Surfaces face into the room, in front of their screen.
    for (const s of monitors) expect(s.anchor.normal).toEqual([0, 0, 1])
  })

  it('puts the site’s brick town on a model table, scaled, and rebuilds only on change (ADR-0072)', () => {
    const { bricks } = scene()
    expect(bricks.stats().model).toBeNull()
    const json = JSON.stringify(townJson)
    bricks.setModel(json)
    const m = bricks.stats().model!
    expect(m).not.toBeNull()
    // Hidden until the render state says the sim knows a blueprint (rule 8).
    expect(m.shown).toBe(false)
    const state = workingJson as unknown as RenderState
    bricks.update({ ...state, siteModel: { pageTypes: 6, slots: 18, issues: 0, tools: 0, failingTools: 0 } })
    expect(bricks.stats().model!.shown).toBe(true)
    bricks.update({ ...state, siteModel: null })
    expect(bricks.stats().model!.shown).toBe(false)
    expect(m.room).toBe(room('editor-office').id)
    expect(m.instances).toBe(m.kitInstances)
    expect(m.instances).toBeGreaterThan(20)
    expect(m.scale).toBeGreaterThan(0)
    expect(m.scale).toBeLessThanOrEqual(1 / 8)
    // The same town again: nothing is rebuilt.
    const before = bricks.stats().model
    bricks.setModel(json)
    expect(bricks.stats().model).toEqual(before)
    // A design the kit refuses leaves no model, and null clears it.
    bricks.setModel(JSON.stringify({ ...townJson, ops: [{ op: 'box', at: [0, 0, 0], size: [1, 1, 1], part: 'nope' }] }))
    expect(bricks.stats().model).toBeNull()
    bricks.setModel(json)
    bricks.setModel(null)
    expect(bricks.stats().model).toBeNull()
  })
})
