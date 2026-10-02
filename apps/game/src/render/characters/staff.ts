/**
 * The people in the office (FEAT-024): one rig per person on site, moved,
 * posed and labelled from the render state, and redrawn every frame between
 * the sim's 10 Hz steps.
 *
 * `sync` takes a new render state (once per sim step); `frame` runs once per
 * rendered frame and only interpolates what the last state says (`motion.ts`):
 * the renderer never moves anyone the sim has not moved, never ahead of the
 * sim, and never decides a pose. Nothing is allocated per frame.
 */
import { Color3, Matrix, Vector3, type ArcRotateCamera, type Scene } from '@babylonjs/core'
import type { MeetingRender, RenderState, StaffRender } from '../../state/render-state'
import type { Lighting } from '../lighting'
import type { OfficeHandles } from '../office'
import type { SceneLookups } from './label-layout'
import { createLabels, type LabelHit, type Labels, type ScreenRect } from './labels'
import { createDisplayClock, displayStep, headingOf, lerpAngle, retarget, sampleWalk, updateWalk } from './motion'
import { layoutContext, poseMotion, poseView, type PoseContext } from './pose'
import { applyMotion, applyStance, createRigFactory, HEAD_TOP, headTurn, type StaffHandle } from './rig'
import type { BuildingLayout } from '../../state/render-state'

/** Wall time of one game-clock slice (ADR-0060 `STEP_MS`): steps arrive at most this often. */
export const SLICE_MS = 100
/** A person standing still turns to face their desk or table over about this long. */
const TURN_MS = 160
/** Label texts are re-read from the lookups at most this often while the sim is held. */
const RELABEL_MS = 500

export interface PersonOnScreen {
  id: string
  /** Where the person is drawn (metres). */
  x: number
  z: number
  /** The middle of their body on the canvas, CSS pixels from its top-left. */
  screenX: number
  screenY: number
  /** Their label's rectangle on the canvas, if it is shown. */
  label: ScreenRect | null
  /** Walking on screen right now. */
  walking: boolean
  pose: StaffRender['pose']
  workItem: string | null
}

export interface StaffLayer {
  handles: Map<string, StaffHandle>
  labels: Labels
  /** A new render state from the sim (`nowMs`: `performance.now()` when it arrived). */
  sync(state: RenderState, nowMs: number): void
  /** Draw the people at wall time `nowMs`. */
  frame(nowMs: number): void
  /** The fractional sim step drawn now. */
  displayStep(nowMs: number): number
  setLookups(lookups: SceneLookups): void
  setOccluders(occluders: (() => readonly ScreenRect[]) | null): void
  /** The person (or their label) under a point of the canvas, CSS pixels from its top-left. */
  pick(x: number, y: number): LabelHit | null
  onScreen(): PersonOnScreen[]
}

export interface StaffLayerOptions {
  /** Unknown poses throw (dev builds and tests) instead of drawing idle. */
  dev: boolean
  maxLights: number
}

export function createStaffLayer(
  scene: Scene,
  camera: ArcRotateCamera,
  office: OfficeHandles,
  lighting: Lighting,
  layout: BuildingLayout,
  opts: StaffLayerOptions,
): StaffLayer {
  const handles = office.staff
  const rigs = createRigFactory(scene, opts.maxLights)
  const labels = createLabels(scene)
  const clock = createDisplayClock()
  const places = layoutContext(layout)
  const people = new Map<string, StaffRender>()
  const meetings = new Map<string, MeetingRender>()
  const ctx: PoseContext = {
    ...places,
    meeting: (id) => meetings.get(id),
    person: (id) => {
      const h = handles.get(id)
      return h && h.root.isEnabled() ? h.root.position : undefined
    },
  }
  const present = new Set<string>()
  let last: RenderState | null = null
  let lastFrame = 0
  let lastRelabel = 0
  let lookups: SceneLookups = {}
  let occluders: (() => readonly ScreenRect[]) | null = null
  let occluded: readonly ScreenRect[] = []
  let lastOccluders = -Infinity
  const roomIds = [...office.rooms.keys()]

  const roomAt = (x: number, z: number): string | undefined => {
    for (const id of roomIds) {
      const l = office.rooms.get(id)!.layout
      if (x >= l.x && x < l.x + l.w && z >= l.z && z < l.z + l.d) return id
    }
    return undefined
  }

  /** A person is lit by the room they are drawn in and by their own desk lamp only (ADR-0006). */
  const scope = (h: StaffHandle, room: string | undefined, desk: string | undefined) => {
    if (h.litRoom === room && h.litDesk === desk && h.lit.length) return
    const set = (list: unknown[], include: boolean) => {
      for (const m of h.lit) {
        const i = list.indexOf(m)
        if (include && i < 0) list.push(m)
        if (!include && i >= 0) list.splice(i, 1)
      }
    }
    for (const id of new Set([h.litRoom, room])) {
      if (!id) continue
      for (const l of office.rooms.get(id)?.lights ?? []) set(l.includedOnlyMeshes, id === room)
    }
    for (const id of new Set([h.litDesk, desk])) {
      if (!id) continue
      const lamp = office.desks.get(id)?.lamp
      if (lamp) set(lamp.includedOnlyMeshes, id === desk)
    }
    h.litRoom = room
    h.litDesk = desk
  }

  const create = (s: StaffRender): StaffHandle => {
    const h = rigs.create(s.id, Color3.FromHexString(s.color))
    h.root.parent = office.root
    for (const m of h.lit) lighting.shadows?.addShadowCaster(m)
    // Lights start scoped to nothing: `scope` then adds the person where they are.
    h.litRoom = undefined
    h.litDesk = undefined
    handles.set(s.id, h)
    return h
  }

  /** Draw `h` at display step `step`; `dtMs` since the last frame (Infinity snaps turns). */
  const draw = (h: StaffHandle, step: number, dtMs: number) => {
    const sample = h.sample
    sampleWalk(h.walk, step, sample)
    const walking = sample.moving && (h.walk.hasPrevious || step >= h.walk.current.startStep)
    const x = sample.x
    const z = sample.z
    h.root.position.set(x, 0, z)
    const view = h.view
    let target = h.heading
    if (walking) target = sample.heading
    else if (view.faceX !== null && view.faceZ !== null && (Math.abs(view.faceX - x) > 1e-3 || Math.abs(view.faceZ - z) > 1e-3))
      target = headingOf(view.faceX - x, view.faceZ - z)
    h.heading = walking || !(dtMs < TURN_MS * 10) ? target : lerpAngle(h.heading, target, dtMs / TURN_MS)
    h.root.rotation.y = h.heading
    const pose = walking ? 'walk' : view.pose
    if (walking) applyStance(h, 'stand', false, false)
    else applyStance(h, view.stance, view.arms, view.ring)
    h.shown.pose = pose
    poseMotion(pose, step, sample.distance, h.phase, h.motion)
    const look = !walking && view.lookX !== null && view.lookZ !== null ? headTurn(h.heading, x, z, view.lookX, view.lookZ) : 0
    applyMotion(h, walking ? 0.08 : view.lean, h.motion, look)
    scope(h, roomAt(x, z), !walking && view.seat === 'desk' ? (people.get(h.id)?.seatedAt ?? undefined) : undefined)
  }

  const anchor = (id: string) => handles.get(id)?.root
  const headHeight = (id: string) => {
    const h = handles.get(id)
    return h ? HEAD_TOP[h.shown.stance ?? 'stand'] + h.motion.bob : 1.5
  }

  const project = new Vector3()
  const screen = new Vector3()

  const layer: StaffLayer = {
    handles,
    labels,
    sync(state, nowMs) {
      if (!clock.started || state.step !== clock.to) retarget(clock, state.step, nowMs, SLICE_MS)
      const shown = displayStep(clock, nowMs)
      meetings.clear()
      for (const m of state.meetings ?? []) meetings.set(m.id, m)
      people.clear()
      present.clear()
      for (const s of state.staff) {
        people.set(s.id, s)
        present.add(s.id)
      }
      for (const [id, h] of handles) if (!present.has(id) && h.root.isEnabled()) h.root.setEnabled(false)
      for (const s of state.staff) {
        let h = handles.get(s.id)
        const fresh = !h || !h.root.isEnabled()
        if (!h) h = create(s)
        if (fresh) h.root.setEnabled(true)
        // Someone who just appeared starts where the sim has them, not at the end of an old walk.
        updateWalk(h.walk, s.x, s.z, s.path, state.step, fresh ? state.step : shown)
        if (fresh) h.walk.hasPrevious = false
        h.workItem = s.workItem
      }
      // Poses after everyone is placed (a listener looks at where the speaker is).
      for (const s of state.staff) {
        const h = handles.get(s.id)!
        poseView(s, ctx, h.view, opts.dev)
      }
      for (const s of state.staff) {
        const h = handles.get(s.id)!
        draw(h, shown, h.shown.pose === null ? Infinity : 0)
      }
      labels.sync(state.staff)
      last = state
    },
    frame(nowMs) {
      const step = displayStep(clock, nowMs)
      const dt = lastFrame ? Math.max(0, nowMs - lastFrame) : 0
      lastFrame = nowMs
      for (const id of present) draw(handles.get(id)!, step, dt)
      if (last && nowMs - lastRelabel > RELABEL_MS && (lookups.staff || lookups.workItem)) {
        lastRelabel = nowMs
        labels.sync(last.staff)
      }
      if (occluders && nowMs - lastOccluders > 250) {
        lastOccluders = nowMs
        occluded = occluders()
      }
      labels.place(camera, anchor, headHeight, occluded)
    },
    displayStep: (nowMs) => displayStep(clock, nowMs),
    setLookups(next) {
      lookups = next
      labels.setLookups(next)
      if (last) labels.sync(last.staff)
    },
    setOccluders(fn) {
      occluders = fn
      occluded = fn ? fn() : []
      lastOccluders = -Infinity
    },
    pick(x, y) {
      const onLabel = labels.hit(x, y)
      if (onLabel) return onLabel
      const hit = scene.pick(x, y, (m) => {
        const id = (m.metadata as { staff?: string } | null)?.staff
        return !!id && present.has(id) && m.isEnabled() && m.isVisible
      })
      const id = hit?.pickedMesh ? (hit.pickedMesh.metadata as { staff: string }).staff : null
      if (!id) return null
      return { staff: id, workItem: handles.get(id)?.workItem ?? null }
    },
    onScreen() {
      const engine = scene.getEngine()
      const w = engine.getRenderWidth()
      const h = engine.getRenderHeight()
      const px = 1 / engine.getHardwareScalingLevel()
      const viewport = camera.viewport.toGlobal(w, h)
      const transform = scene.getTransformMatrix()
      const out: PersonOnScreen[] = []
      for (const id of present) {
        const p = handles.get(id)!
        project.set(p.root.position.x, (p.shown.stance === 'sit' ? 0.85 : 0.8) + p.motion.bob, p.root.position.z)
        Vector3.ProjectToRef(project, Matrix.IdentityReadOnly, transform, viewport, screen)
        out.push({
          id,
          x: p.root.position.x,
          z: p.root.position.z,
          screenX: screen.x / px,
          screenY: screen.y / px,
          label: labels.rectOf(id),
          walking: p.shown.pose === 'walk',
          pose: p.shown.pose ?? 'idle',
          workItem: p.workItem,
        })
      }
      return out
    },
  }
  return layer
}
