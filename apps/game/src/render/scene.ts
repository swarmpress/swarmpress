import { PointerEventTypes, Scene, Vector3, type AbstractEngine } from '@babylonjs/core'
import type { BuildingLayout, RenderState } from '../state/render-state'
import { createIsoCamera, type IsoCamera } from './camera'
import type { SceneLookups } from './characters/label-layout'
import type { ScreenRect } from './characters/labels'
import { createStaffLayer, type PersonOnScreen, type StaffLayer } from './characters/staff'
import { isCutAway } from './cutaway'
import { applyRenderState, createLighting, type Lighting } from './lighting'
import { buildOffice, MAX_LIGHTS_PER_MATERIAL, type OfficeHandles } from './office'
import { createPostFx, type QualitySettings } from './postfx'
import { buildRoomNames, type RoomNames } from './room-names'
import { buildWallClocks } from './wallclock'

export type { SceneLookups, PersonInfo } from './characters/label-layout'
export type { ScreenRect } from './characters/labels'
export type { PersonOnScreen } from './characters/staff'

/**
 * What the scene reports when the player clicks a person (the overlay
 * decides what to open; `render/` imports nothing from the UI).
 */
export interface ScenePicks {
  /** A person, or their name: their profile. */
  person?(staffId: string): void
  /** A person busy with a work item, or their work line: that item. */
  workItem?(workItemId: string, staffId: string): void
}

export interface GameScene {
  scene: Scene
  office: OfficeHandles
  lighting: Lighting
  iso: IsoCamera
  staff: StaffLayer
  roomNames: RoomNames
  /** Push a new render state from the sim. `nowMs` is when it arrived (default `performance.now()`). */
  update(state: RenderState, nowMs?: number): void
  /** Draw the people at `nowMs`; runs before every render on its own, tests call it directly. */
  frame(nowMs: number): void
  /** Re-evaluate which walls are cut away for the current camera angle. */
  updateCutaway(): void
  /** Set the wall clocks to a real instant in the HQ timezone (cosmetic, not sim state). */
  setClock(instant: Date, timeZone: string): void
  clockCount: number
  /** Who a person is and what a work item is called, for the labels. */
  setLookups(lookups: SceneLookups): void
  /** Screen rectangles labels must not cover (the HUD and panels), CSS pixels from the canvas' top-left. */
  setOccluders(occluders: (() => readonly ScreenRect[]) | null): void
  onPick(picks: ScenePicks): void
  /** Everyone on site and where they are drawn (tests and dev tools). */
  people(): PersonOnScreen[]
  /** The building and the labels drawn over it are ready (shaders compiled, textures uploaded). */
  isReady(): boolean
  /**
   * Change the quality while the page runs (the GPU scheduler's renderer
   * hooks, render/quality.ts): shadows on or off, bloom, MSAA and SSAO.
   * The shadow map's size stays what the page started with.
   */
  setQuality(q: QualitySettings): void
}

export interface SceneOptions {
  quality: QualitySettings
  /** Post-processing needs a real GPU; tests with NullEngine turn it off. */
  postFx: boolean
  /** Unknown sim poses throw instead of drawing idle (default: true). */
  dev?: boolean
}

const now = () => (typeof performance === 'undefined' ? Date.now() : performance.now())

export function createGameScene(
  engine: AbstractEngine,
  canvas: HTMLCanvasElement | null,
  layout: BuildingLayout,
  opts: SceneOptions,
): GameScene {
  const scene = new Scene(engine)
  // Aim at half wall height: walls rise above the footprint only at the back,
  // so a ground-level target would push the far wall tops off screen.
  const center = new Vector3(layout.originX + layout.width / 2, layout.wallHeight / 2, layout.originZ + layout.depth / 2)
  const iso = createIsoCamera(scene, canvas, center.clone(), {
    width: layout.width,
    depth: layout.depth,
    height: layout.wallHeight,
  })
  scene.cameraToUseForPointers = iso.camera
  const office = buildOffice(scene, layout)
  const lighting = createLighting(scene, office, { shadows: opts.quality.shadows, shadowMapSize: opts.quality.shadowMapSize })
  const roomNames = buildRoomNames(scene, layout, office.root, MAX_LIGHTS_PER_MATERIAL)
  for (const d of roomNames.decals) {
    // A name is paint on its room's floor: lit by that room only.
    for (const l of office.rooms.get(d.room.id)?.lights ?? []) l.includedOnlyMeshes.push(d.mesh)
    if (lighting.shadows) d.mesh.receiveShadows = true
  }
  const clocks = buildWallClocks(scene, layout)
  const staff = createStaffLayer(scene, iso.camera, office, lighting, layout, { dev: opts.dev ?? true, maxLights: MAX_LIGHTS_PER_MATERIAL })
  const postFx = opts.postFx ? createPostFx(scene, iso.camera, opts.quality) : null

  let facedAlpha = Number.NaN
  const updateCutaway = () => {
    for (const w of office.walls) {
      if (!w.side) continue
      w.mesh.isVisible = !isCutAway(w.side, iso.camera.alpha)
    }
    // Room names move to the far side when the camera has turned to a new angle.
    const snapped = Math.round(iso.camera.alpha / (Math.PI / 2) - 0.5)
    if (snapped !== facedAlpha) {
      facedAlpha = snapped
      roomNames.face(iso.camera)
    }
  }
  scene.onBeforeRenderObservable.add(updateCutaway)
  updateCutaway()
  scene.onBeforeRenderObservable.add(() => staff.frame(now()))

  let picks: ScenePicks = {}
  scene.onPointerObservable.add((info) => {
    if (info.type !== PointerEventTypes.POINTERTAP) return
    const hit = staff.pick(scene.pointerX, scene.pointerY)
    if (!hit) return
    if (hit.workItem && picks.workItem) picks.workItem(hit.workItem, hit.staff)
    else picks.person?.(hit.staff)
  })
  canvas?.addEventListener('pointermove', (e) => {
    if (e.buttons) return
    const rect = canvas.getBoundingClientRect()
    canvas.style.cursor = staff.pick(e.clientX - rect.left, e.clientY - rect.top) ? 'pointer' : ''
  })

  return {
    scene,
    office,
    lighting,
    iso,
    staff,
    roomNames,
    update: (state, at = now()) => {
      applyRenderState(scene, office, lighting, state, center)
      staff.sync(state, at)
    },
    frame: (at) => staff.frame(at),
    updateCutaway,
    setClock: (instant, timeZone) => clocks.set(instant, timeZone),
    clockCount: clocks.count,
    setLookups: (l) => staff.setLookups(l),
    setOccluders: (o) => staff.setOccluders(o),
    onPick: (p) => {
      picks = p
    },
    people: () => staff.onScreen(),
    isReady: () => scene.isReady() && staff.labels.scene.isReady(),
    setQuality: (q) => {
      // Shadows can only come back if the page started with them (the generator exists).
      scene.shadowsEnabled = q.shadows
      postFx?.apply(q)
    },
  }
}
