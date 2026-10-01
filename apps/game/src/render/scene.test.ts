import { NullEngine } from '@babylonjs/core'
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

  it('keeps every room within the per-material light budget', () => {
    for (const room of game.office.rooms.values()) {
      const lamps = room.layout.desks.length
      // ceiling + desk lamps + sun + sky
      expect(room.lights.length + lamps + 2).toBeLessThanOrEqual(MAX_LIGHTS_PER_MATERIAL)
    }
    for (const m of game.office.materials) expect(m.maxSimultaneousLights).toBe(MAX_LIGHTS_PER_MATERIAL)
  })

  it('scopes room lights to the room instead of the whole building', () => {
    const news = game.office.rooms.get('newsroom')!
    const editorDesk = game.scene.getMeshByName('desk-desk-ed')!
    for (const l of news.lights) expect(l.includedOnlyMeshes).not.toContain(editorDesk)
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

  it('creates shadows on medium quality and none on low', () => {
    expect(game.lighting.shadows).not.toBeNull()
    const low = createGameScene(engine, null, DEMO_BUILDING, { quality: QUALITY.low, postFx: false })
    expect(low.lighting.shadows).toBeNull()
  })
})
