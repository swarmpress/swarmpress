import {
  Color3,
  Color4,
  DirectionalLight,
  HemisphericLight,
  Scene,
  ShadowGenerator,
  Vector3,
} from '@babylonjs/core'
import type { LightLevel, RenderState } from '../state/render-state'
import { daylight, keyLightDirection, type Rgb } from './daylight'
import type { OfficeHandles } from './office'

const setColor = (out: Color3, c: Rgb) => out.set(c.r, c.g, c.b)

/** Interior light levels (PBR physical units, tuned against the reference shots). */
export const CEILING_INTENSITY = 14
/** A room people only pass through is dimmed (`RoomRender.light` = `dim`). */
export const DIM_FACTOR = 0.4
export const LAMP_INTENSITY = 3
const SCREEN_ON = new Color3(0.55, 0.75, 1.0)
const SCREEN_OFF = new Color3(0, 0, 0)
const PANEL_ON = new Color3(1, 0.97, 0.9)
const PANEL_DIM = new Color3(0.5, 0.48, 0.44)
const SHADE_ON = new Color3(1, 0.7, 0.35)
const BLACK = new Color3(0, 0, 0)

export interface Lighting {
  sun: DirectionalLight
  sky: HemisphericLight
  shadows: ShadowGenerator | null
}

export function createLighting(scene: Scene, office: OfficeHandles, opts: { shadows: boolean; shadowMapSize: number }): Lighting {
  const sun = new DirectionalLight('sun', new Vector3(-0.5, -1, 0.3), scene)
  const sky = new HemisphericLight('sky', new Vector3(0, 1, 0), scene)
  let shadows: ShadowGenerator | null = null
  if (opts.shadows) {
    shadows = new ShadowGenerator(opts.shadowMapSize, sun)
    shadows.usePercentageCloserFiltering = true
    shadows.filteringQuality = ShadowGenerator.QUALITY_HIGH
    shadows.bias = 0.002
    shadows.normalBias = 0.02
    for (const m of office.shadowCasters) shadows.addShadowCaster(m)
    for (const m of office.shadowReceivers) m.receiveShadows = true
  }
  return { sun, sky, shadows }
}

const scratch = new Vector3()

/**
 * Applies the sim's render state to the building (ADR-0007): sun and sky from
 * the minute, ceiling lights from each room's light level, monitors and desk
 * lamps from the devices, and the props the sim switches (the coffee
 * machine's lamp, a whiteboard in use). The renderer makes no gameplay
 * decisions; the people are the staff layer's (`characters/staff.ts`).
 */
export function applyRenderState(scene: Scene, office: OfficeHandles, lighting: Lighting, state: RenderState, center: Vector3) {
  const d = daylight(state.minute)
  const dir = keyLightDirection(d)
  lighting.sun.direction.set(dir.x, dir.y, dir.z)
  scratch.set(dir.x, dir.y, dir.z)
  lighting.sun.position = center.subtract(scratch.scaleInPlace(30))
  setColor(lighting.sun.diffuse, d.keyColor)
  lighting.sun.intensity = d.keyIntensity
  setColor(lighting.sky.diffuse, d.skyColor)
  setColor(lighting.sky.groundColor, d.groundColor)
  lighting.sky.intensity = d.ambientIntensity
  scene.clearColor = new Color4(d.clearColor.r, d.clearColor.g, d.clearColor.b, 1)

  const levels = new Map<string, LightLevel>()
  for (const r of state.rooms ?? []) levels.set(r.id, r.light)
  for (const [id, room] of office.rooms) {
    const level: LightLevel = levels.get(id) ?? (state.roomLights[id] === true ? 'on' : 'off')
    const k = level === 'on' ? 1 : level === 'dim' ? DIM_FACTOR : 0
    for (const l of room.lights) l.intensity = CEILING_INTENSITY * k
    room.panelMaterial.emissiveColor = level === 'on' ? PANEL_ON : level === 'dim' ? PANEL_DIM : BLACK
  }

  for (const [id, desk] of office.desks) {
    desk.screenMaterial.emissiveColor = state.monitors[id] === true ? SCREEN_ON : SCREEN_OFF
    const lampOn = state.deskLamps[id] === true
    desk.lamp.intensity = lampOn ? LAMP_INTENSITY : 0
    ;(desk.lampShade.material as { emissiveColor?: Color3 }).emissiveColor = lampOn ? SHADE_ON : BLACK
  }

  if (office.props.size) {
    const states = new Map<string, string>()
    for (const dev of state.devices ?? []) states.set(dev.id, dev.state)
    for (const [id, p] of office.props) if (p.glow) p.glow.emissiveColor = (states.get(id) ?? 'off') === 'off' ? BLACK : p.glowColor
  }
}
