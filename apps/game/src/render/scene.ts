import { Scene, Vector3, type AbstractEngine } from '@babylonjs/core'
import type { BuildingLayout, RenderState } from '../state/render-state'
import { createIsoCamera, type IsoCamera } from './camera'
import { isCutAway } from './cutaway'
import { applyRenderState, createLighting, type Lighting } from './lighting'
import { buildOffice, type OfficeHandles } from './office'
import { createPostFx, type QualitySettings } from './postfx'
import { buildWallClocks } from './wallclock'

export interface GameScene {
  scene: Scene
  office: OfficeHandles
  lighting: Lighting
  iso: IsoCamera
  /** Push a new render state from the sim. */
  update(state: RenderState): void
  /** Re-evaluate which walls are cut away for the current camera angle. */
  updateCutaway(): void
  /** Set the wall clocks to a real instant in the HQ timezone (cosmetic, not sim state). */
  setClock(instant: Date, timeZone: string): void
  clockCount: number
}

export interface SceneOptions {
  quality: QualitySettings
  /** Post-processing needs a real GPU; tests with NullEngine turn it off. */
  postFx: boolean
}

export function createGameScene(
  engine: AbstractEngine,
  canvas: HTMLCanvasElement | null,
  layout: BuildingLayout,
  opts: SceneOptions,
): GameScene {
  const scene = new Scene(engine)
  const center = new Vector3(layout.width / 2, 0, layout.depth / 2)
  const iso = createIsoCamera(scene, canvas, center.clone())
  const office = buildOffice(scene, layout)
  const lighting = createLighting(scene, office, { shadows: opts.quality.shadows, shadowMapSize: opts.quality.shadowMapSize })
  const clocks = buildWallClocks(scene, layout)
  if (opts.postFx) createPostFx(scene, iso.camera, opts.quality)

  const updateCutaway = () => {
    for (const w of office.walls) {
      if (!w.side) continue
      w.mesh.isVisible = !isCutAway(w.side, iso.camera.alpha)
    }
  }
  scene.onBeforeRenderObservable.add(updateCutaway)
  updateCutaway()

  return {
    scene,
    office,
    lighting,
    iso,
    update: (state) => applyRenderState(scene, office, lighting, state, center),
    updateCutaway,
    setClock: (instant, timeZone) => clocks.set(instant, timeZone),
    clockCount: clocks.count,
  }
}
