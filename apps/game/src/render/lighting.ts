import {
  Color3,
  Color4,
  DirectionalLight,
  HemisphericLight,
  Scene,
  ShadowGenerator,
  Vector3,
} from '@babylonjs/core'
import type { RenderState } from '../state/render-state'
import { daylight, keyLightDirection, type Rgb } from './daylight'
import { createStaffMesh, type OfficeHandles } from './office'

const c3 = (c: Rgb) => new Color3(c.r, c.g, c.b)

/** Interior light levels (PBR physical units, tuned against the reference shots). */
export const CEILING_INTENSITY = 14
export const LAMP_INTENSITY = 3
const SCREEN_ON = new Color3(0.55, 0.75, 1.0)
const SCREEN_OFF = new Color3(0, 0, 0)

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

/**
 * Applies the sim's render state to the scene (ADR-0007). The renderer makes
 * no gameplay decisions: every light, screen and person comes from `state`.
 */
export function applyRenderState(scene: Scene, office: OfficeHandles, lighting: Lighting, state: RenderState, center: Vector3) {
  const d = daylight(state.minute)
  const dir = keyLightDirection(d)
  lighting.sun.direction.set(dir.x, dir.y, dir.z)
  lighting.sun.position = center.subtract(new Vector3(dir.x, dir.y, dir.z).scale(30))
  lighting.sun.diffuse = c3(d.keyColor)
  lighting.sun.intensity = d.keyIntensity
  lighting.sky.diffuse = c3(d.skyColor)
  lighting.sky.groundColor = c3(d.groundColor)
  lighting.sky.intensity = d.ambientIntensity
  scene.clearColor = new Color4(d.clearColor.r, d.clearColor.g, d.clearColor.b, 1)

  for (const [id, room] of office.rooms) {
    const on = state.roomLights[id] === true
    for (const l of room.lights) l.intensity = on ? CEILING_INTENSITY : 0
    room.panelMaterial.emissiveColor = on ? new Color3(1, 0.97, 0.9) : Color3.Black()
  }

  for (const [id, desk] of office.desks) {
    const screenOn = state.monitors[id] === true
    desk.screenMaterial.emissiveColor = screenOn ? SCREEN_ON : SCREEN_OFF
    const lampOn = state.deskLamps[id] === true
    desk.lamp.intensity = lampOn ? LAMP_INTENSITY : 0
    ;(desk.lampShade.material as { emissiveColor?: Color3 }).emissiveColor = lampOn ? new Color3(1, 0.7, 0.35) : Color3.Black()
  }

  const present = new Set(state.staff.map((s) => s.id))
  for (const [id, handle] of office.staff) {
    if (!present.has(id)) {
      handle.root.setEnabled(false)
    }
  }
  for (const s of state.staff) {
    let handle = office.staff.get(s.id)
    if (!handle) {
      handle = createStaffMesh(scene, s.id, Color3.FromHexString(s.color))
      handle.root.parent = office.root
      lighting.shadows?.addShadowCaster(handle.body)
      lighting.shadows?.addShadowCaster(handle.head)
      // Staff are lit by whichever room they are in; include them in every room light.
      for (const room of office.rooms.values()) for (const l of room.lights) l.includedOnlyMeshes.push(handle.body, handle.head)
      for (const desk of office.desks.values()) desk.lamp.includedOnlyMeshes.push(handle.body, handle.head)
      office.staff.set(s.id, handle)
    }
    handle.root.setEnabled(true)
    handle.root.position.set(s.x, 0, s.z)
    // Seated people sit lower.
    handle.root.scaling.y = s.seatedAt ? 0.82 : 1
  }
}
