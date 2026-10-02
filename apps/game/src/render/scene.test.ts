import { NullEngine, type AbstractMesh } from '@babylonjs/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEMO_BUILDING, demoRenderState, type BuildingLayout, type RenderState } from '../state/render-state'
import layoutJson from '../state/fixtures/demo-layout.json'
import lunchJson from '../state/fixtures/demo-lunch.json'
import standupJson from '../state/fixtures/demo-standup.json'
import workingJson from '../state/fixtures/demo-working.json'
import { ISO_ALPHAS } from './camera-math'
import { CEILING_INTENSITY, LAMP_INTENSITY } from './lighting'
import { distanceAtStep, emptyRoute, emptySample, sampleRoute, setRoute } from './characters/motion'
import { MAX_LIGHTS_PER_MATERIAL } from './office'
import { QUALITY } from './postfx'
import { createGameScene, type GameScene } from './scene'

let engine: NullEngine
let game: GameScene

beforeEach(() => {
  engine = new NullEngine()
  game = createGameScene(engine, null, DEMO_BUILDING, { quality: QUALITY.medium, postFx: false })
})
afterEach(() => engine.dispose())

describe('game scene (NullEngine)', () => {
  it('builds every room, desk and exterior wall from the layout', () => {
    expect([...game.office.rooms.keys()].sort()).toEqual(['editor', 'meeting', 'newsroom'])
    expect(game.office.desks.size).toBe(5)
    const sides = new Set(game.office.walls.filter((w) => w.side).map((w) => w.side))
    expect(sides).toEqual(new Set(['north', 'south', 'east', 'west']))
  })

  const lightsOn = (mesh: AbstractMesh) =>
    game.scene.lights.filter((l) => l.includedOnlyMeshes.length === 0 || l.includedOnlyMeshes.includes(mesh)).length

  it('keeps every mesh within the WebGPU light budget at every time of day', () => {
    for (let minute = 0; minute < 1440; minute += 60) {
      game.update(demoRenderState(minute, 0))
      for (const mesh of game.scene.meshes) expect(lightsOn(mesh), `${mesh.name} @${minute}`).toBeLessThanOrEqual(MAX_LIGHTS_PER_MATERIAL)
    }
    for (const m of game.office.materials) expect(m.maxSimultaneousLights).toBe(MAX_LIGHTS_PER_MATERIAL)
  })

  it('merges ceiling fixtures into the room light budget but draws every panel', () => {
    const crowded = { ...DEMO_BUILDING, rooms: DEMO_BUILDING.rooms.map((r) => r.id !== 'newsroom' ? r : {
      ...r,
      ceilingLights: [
        { id: 'a', x: 2.5, z: 2.5 }, { id: 'b', x: 7.5, z: 2.5 }, { id: 'c', x: 2.5, z: 7.5 }, { id: 'd', x: 7.5, z: 7.5 },
      ],
    }) }
    const g = createGameScene(engine, null, crowded, { quality: QUALITY.low, postFx: false })
    const news = g.office.rooms.get('newsroom')!
    expect(news.panels).toHaveLength(4)
    expect(news.lights.length + news.layout.desks.length + 2).toBeLessThanOrEqual(MAX_LIGHTS_PER_MATERIAL)
  })

  it('keeps a crowded room (more desks than the light budget) within budget at night', () => {
    const news = DEMO_BUILDING.rooms.find((r) => r.id === 'newsroom')!
    const desks = Array.from({ length: 7 }, (_, i) => ({ ...news.desks[0], id: `crowd-${i}`, x: news.x + 1 + i, z: news.z + 1 }))
    const crowded = { ...DEMO_BUILDING, rooms: DEMO_BUILDING.rooms.map((r) => (r.id === 'newsroom' ? { ...r, desks } : r)) }
    const g = createGameScene(engine, null, crowded, { quality: QUALITY.low, postFx: false })
    const floor = g.office.rooms.get('newsroom')!.floor
    const on = g.scene.lights.filter((l) => l.includedOnlyMeshes.length === 0 || l.includedOnlyMeshes.includes(floor))
    expect(on.length).toBeLessThanOrEqual(MAX_LIGHTS_PER_MATERIAL)
    // the floor still gets the sun and the sky
    expect(on.filter((l) => l.includedOnlyMeshes.length === 0).length).toBeGreaterThanOrEqual(2)
  })

  it('scopes room lights to the room instead of the whole building', () => {
    const news = game.office.rooms.get('newsroom')!
    const editorDesk = game.scene.getMeshByName('desk-desk-ed')!
    for (const l of news.lights) expect(l.includedOnlyMeshes).not.toContain(editorDesk)
  })

  it('lights a person only by their own room and desk lamp', () => {
    game.update(demoRenderState(23 * 60, 0))
    const marco = game.office.staff.get('marco')!
    const lights = game.scene.lights.filter((l) => l.includedOnlyMeshes.includes(marco.body)).map((l) => l.name)
    expect(lights.sort()).toEqual(['ceiling-editor-0', 'lamp-desk-ed'])
  })

  it('cuts away the walls facing the camera', () => {
    game.iso.setFacing(1)
    game.iso.snap()
    game.updateCutaway()
    const visibleSides = new Set(game.office.walls.filter((w) => w.side && w.mesh.isVisible).map((w) => w.side))
    expect(visibleSides).toEqual(new Set(['north', 'west']))
    expect(game.iso.camera.alpha).toBeCloseTo(ISO_ALPHAS[1])
  })

  it('morning: busy newsroom, daylight, ceiling lights off near the windows', () => {
    game.update(demoRenderState(11 * 60, 0))
    expect(game.office.staff.size).toBe(5)
    expect(game.lighting.sun.intensity).toBeGreaterThan(1)
    for (const l of game.office.rooms.get('newsroom')!.lights) expect(l.intensity).toBe(0)
    // the window-less meeting room is lit when occupied... nobody is there in the demo
    expect(game.office.desks.get('desk-1')!.screenMaterial.emissiveColor.b).toBeGreaterThan(0.5)
  })

  it('23:00 deadline: only editorial stays lit', () => {
    game.update(demoRenderState(11 * 60, 0))
    game.update(demoRenderState(23 * 60, 0))
    expect(game.lighting.sun.intensity).toBeLessThan(0.5)
    for (const l of game.office.rooms.get('editor')!.lights) expect(l.intensity).toBe(CEILING_INTENSITY)
    for (const l of game.office.rooms.get('newsroom')!.lights) expect(l.intensity).toBe(0)
    expect(game.office.desks.get('desk-ed')!.lamp.intensity).toBe(LAMP_INTENSITY)
    expect(game.office.desks.get('desk-1')!.lamp.intensity).toBe(0)
    const enabled = [...game.office.staff.values()].filter((s) => s.root.isEnabled()).map((s) => s.id)
    expect(enabled).toEqual(['marco'])
  })

  it('hangs a real-time wall clock on a window-free exterior wall and sets its hands', () => {
    expect(game.clockCount).toBe(1) // the newsroom; the meeting room has no exterior wall
    game.setClock(new Date(Date.UTC(2026, 0, 1, 14, 0, 0)), 'Europe/Rome') // 15:00 in Rome
    const hour = game.scene.getTransformNodeByName('clock-newsroom-hour-pivot')!
    const minute = game.scene.getTransformNodeByName('clock-newsroom-minute-pivot')!
    expect(hour.rotation.z).toBeCloseTo(-Math.PI / 2)
    expect(minute.rotation.z).toBeCloseTo(0)
  })

  it('creates shadows on medium quality and none on low', () => {
    expect(game.lighting.shadows).not.toBeNull()
    const low = createGameScene(engine, null, DEMO_BUILDING, { quality: QUALITY.low, postFx: false })
    expect(low.lighting.shadows).toBeNull()
  })
})

const layout = layoutJson as unknown as BuildingLayout
const standup = standupJson as unknown as RenderState
const working = workingJson as unknown as RenderState
const lunch = lunchJson as unknown as RenderState

describe('the real office (NullEngine, layout and states from the wasm sim)', () => {
  let office: GameScene
  beforeEach(() => {
    office = createGameScene(engine, null, layout, { quality: QUALITY.medium, postFx: false })
  })
  const lights = (mesh: AbstractMesh) =>
    office.scene.lights.filter((l) => l.includedOnlyMeshes.length === 0 || l.includedOnlyMeshes.includes(mesh)).length

  it('builds every room kind, the hallway floor, the street and the props the layout lists', () => {
    expect(office.office.rooms.size).toBe(layout.rooms.length)
    expect(office.office.hall).not.toBeNull()
    const kinds = new Set([...office.office.props.values()].map((p) => p.kind))
    for (const k of ['coffee-machine', 'whiteboard', 'plant', 'camera-rig', 'archive-shelf', 'mood-board-wall']) expect(kinds, k).toContain(k)
    for (const kind of ['kitchen', 'meeting-room', 'strategy-room']) {
      const room = layout.rooms.find((r) => r.kind === kind)!
      expect(office.scene.getMeshByName(`table-${room.id}`), kind).not.toBeNull()
      expect(office.scene.getMeshByName(`stools-${room.id}`), kind).not.toBeNull()
    }
    expect(office.roomNames.decals.map((d) => d.room.label)).toContain('Finance office')
  })

  it('keeps every mesh within the light budget with everyone in, at noon and at night', () => {
    for (const state of [standup, working, lunch, { ...lunch, minute: 23 * 60 }]) {
      office.update(state, 0)
      office.frame(50)
      for (const mesh of office.scene.meshes) expect(lights(mesh), mesh.name).toBeLessThanOrEqual(MAX_LIGHTS_PER_MATERIAL)
    }
  })

  it('poses people from the render state: seated typing, a speaker with a ring, seated listeners', () => {
    office.update(standup, 0)
    const speaker = standup.staff.find((s) => s.pose === 'talk')!
    const h = office.staff.handles.get(speaker.id)!
    expect(h.shown.stance).toBe('sit')
    expect(h.ring.isEnabled()).toBe(true)
    const listener = office.staff.handles.get(standup.staff.find((s) => s.pose === 'listen')!.id)!
    expect([listener.shown.stance, listener.ring.isEnabled()]).toEqual(['sit', false])
    office.update(working, 1000)
    const typist = office.staff.handles.get(working.staff.find((s) => s.pose === 'type')!.id)!
    expect([typist.shown.stance, typist.arms.isEnabled(), typist.workItem]).toEqual(['sit', true, 'work-item-1'])
    // the ring went with the turn
    expect(h.ring.isEnabled()).toBe(false)
  })

  it('draws a walker between steps on the sim path, and holds everyone while no step comes', () => {
    office.update(lunch, 0)
    const walker = lunch.staff.find((s) => s.pose === 'walk')!
    const h = office.staff.handles.get(walker.id)!
    expect([h.root.position.x, h.root.position.z]).toEqual([walker.x, walker.z])
    // the sim's next step: the walker is (step − startStep) × speed along the path
    const route = emptyRoute()
    setRoute(route, walker.path!)
    const at = emptySample()
    sampleRoute(route, distanceAtStep(route, lunch.step + 1), at)
    const next = structuredClone(lunch)
    next.step += 1
    Object.assign(next.staff.find((s) => s.id === walker.id)!, { x: at.x, z: at.z })
    office.update(next, 100)
    const seen = new Set<string>()
    const from = distanceAtStep(route, lunch.step)
    const to = distanceAtStep(route, next.step)
    for (let t = 100; t <= 260; t += 16) {
      office.frame(t)
      seen.add(`${h.root.position.x.toFixed(5)},${h.root.position.z.toFixed(5)}`)
      // on the path, between where the sim had the walker and where it has them now
      expect(h.sample.distance).toBeGreaterThanOrEqual(from - 1e-9)
      expect(h.sample.distance).toBeLessThanOrEqual(to + 1e-9)
    }
    expect(seen.size).toBeGreaterThan(4)
    expect([h.root.position.x, h.root.position.z]).toEqual([at.x, at.z])
    expect(h.root.rotation.y).toBeCloseTo(h.sample.heading)
    // the clock is held: nothing moves
    office.frame(60_000)
    expect([h.root.position.x, h.root.position.z]).toEqual([at.x, at.z])
  })

  it('labels people from the lookups it is given, with what they work on', () => {
    office.setLookups({ staff: (id) => ({ name: `Person ${id}`, role: 'writer' }), workItem: (id) => (id === 'work-item-1' ? 'Harvest week in Manarola' : undefined) })
    office.update(working, 0)
    const typist = working.staff.find((s) => s.pose === 'type')!
    expect(office.staff.labels.textOf(typist.id)).toMatchObject({ name: `Person ${typist.id}`, work: 'Harvest week in Manarola' })
    const other = working.staff.find((s) => !s.workItem)!
    expect(office.staff.labels.textOf(other.id)?.work).toBeNull()
  })

  it('picks a person or their label under the pointer, and the work line for the work item', () => {
    engine.setSize(1280, 800)
    office.update(working, 0)
    office.scene.render()
    const people = office.people()
    const typist = people.find((p) => p.pose === 'type')!
    const label = typist.label!
    const mid = (label.left + label.right) / 2
    expect(office.staff.pick(mid, label.bottom - 3)).toEqual({ staff: typist.id, workItem: 'work-item-1' })
    expect(office.staff.pick(mid, label.top + 3)).toEqual({ staff: typist.id, workItem: null })
    // a body no label covers
    const body = people.find((p) => !p.walking && !office.staff.labels.hit(p.screenX, p.screenY))!
    expect(office.staff.pick(body.screenX, body.screenY)).toEqual({ staff: body.id, workItem: body.workItem })
    expect(office.staff.pick(2, 2)).toBeNull()
  })

  it('hides people who left and brings them back where the sim has them', () => {
    office.update(lunch, 0)
    const gone = lunch.staff[0].id
    office.update({ ...lunch, step: lunch.step + 1, staff: lunch.staff.slice(1) }, 100)
    expect(office.staff.handles.get(gone)!.root.isEnabled()).toBe(false)
    office.update({ ...lunch, step: lunch.step + 2 }, 200)
    const h = office.staff.handles.get(gone)!
    expect(h.root.isEnabled()).toBe(true)
    expect([h.root.position.x, h.root.position.z]).toEqual([lunch.staff[0].x, lunch.staff[0].z])
  })
})
