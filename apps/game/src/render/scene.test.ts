import { NullEngine, type AbstractMesh } from '@babylonjs/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEMO_BUILDING, demoRenderState } from '../state/render-state'
import { ISO_ALPHAS } from './camera-math'
import { CEILING_INTENSITY, LAMP_INTENSITY } from './lighting'
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
