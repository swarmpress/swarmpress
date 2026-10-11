/**
 * A person built from bricks (FEAT-024 rig, ADR-0085): block legs, a torso
 * brick with shoulder studs, a square head with a 2 × 2 hair plate on top
 * and eyes on its front so the facing shows, and arms at the sides. Our own
 * figure, not a copy of any toy's (docs/design/brick-office.md, brand). A
 * seated pose swaps the legs for bent ones over the seat, typing swaps the
 * side arms for forearms on the keyboard, and the speaker gets a ring on the
 * floor. No glTF and no skeleton; a pose is a handful of transforms. Seats
 * are the office's (desk chairs, the stools around tables).
 *
 * Geometry is built once and shared by every person (clones share vertex
 * buffers). Skin, hair, trouser, eye and ring materials are shared; only the
 * shirt colour is per person, and skin and hair tones are picked from the id.
 * People are separate meshes, not instances: each is lit by the room they
 * are in, and instances would share one set of lights.
 */
import { Color3, Mesh, MeshBuilder, PBRMaterial, Scene, StandardMaterial, TransformNode } from '@babylonjs/core'
import type { Pose } from '../../state/render-state'
import { createWalk, emptyWalkSample, type Walk, type WalkSample } from './motion'
import { emptyMotion, emptyPoseView, phaseOf, type PoseMotion, type PoseView, type Stance } from './pose'

/** Top of the head above the floor, per stance: where the label goes. */
export const HEAD_TOP: Record<Stance, number> = { stand: 1.52, sit: 1.43 }

/** Standing: the legs reach the hips at 0.56 m, the torso brick sits on them. */
const STAND = { pivot: 0, body: 0.87, head: 1.32 }
/** Seated: hips on a 0.45 m seat, the same torso brick on them. */
const SIT = { pivot: 0.45, body: 0.78, head: 1.23 }
/** The torso brick: shoulders 0.38 m wide, 0.6 m tall. */
const TORSO_H = 0.6
const ARMS_Y = 0.87
const MAX_HEAD_TURN = 1.1

export interface StaffHandle {
  id: string
  /** At the person's feet; `rotation.y` is the facing. */
  root: TransformNode
  /** Body, head and forearms: leans and bobs. */
  torso: TransformNode
  /** The torso brick (shoulder studs, neck). */
  body: Mesh
  head: Mesh
  /** The hair plate on the head, with its studs. */
  hair: Mesh
  /** Straight legs, shown when standing. */
  legs: Mesh
  /** Bent legs, shown when seated. */
  lap: Mesh
  /** Arms at the sides, shown when the forearms are not. */
  sideArms: Mesh
  /** Forearms, shown when typing or talking. */
  arms: Mesh
  /** On the floor under the meeting's speaker. */
  ring: Mesh
  /** The meshes room lights and the desk lamp light. */
  lit: Mesh[]
  walk: Walk
  sample: WalkSample
  /** How the sim has the person (from the last render state). */
  view: PoseView
  motion: PoseMotion
  phase: number
  heading: number
  /** What is applied to the meshes, to skip work when nothing changed (null: not yet applied). */
  shown: { pose: Pose | null; stance: Stance | null; arms: boolean | null; ring: boolean | null }
  /** The room and desk whose lights include this person. */
  litRoom: string | undefined
  litDesk: string | undefined
  /** The work item the sim has them on. */
  workItem: string | null
}

export interface RigFactory {
  create(id: string, color: Color3): StaffHandle
  /** Shared materials (for the light-budget test). */
  materials: PBRMaterial[]
}

function pbr(scene: Scene, name: string, albedo: Color3, roughness: number, maxLights: number): PBRMaterial {
  const m = new PBRMaterial(name, scene)
  m.albedoColor = albedo
  m.roughness = roughness
  m.metallic = 0
  m.maxSimultaneousLights = maxLights
  return m
}

/** Skin and hair tones, picked from the person's id (deterministic, rule 1's spirit). */
const SKINS = [new Color3(0.96, 0.8, 0.66), new Color3(0.87, 0.67, 0.5), new Color3(0.7, 0.5, 0.36), new Color3(0.45, 0.3, 0.2)]
const HAIRS = [new Color3(0.1, 0.08, 0.07), new Color3(0.32, 0.19, 0.1), new Color3(0.62, 0.42, 0.2), new Color3(0.8, 0.66, 0.38), new Color3(0.55, 0.55, 0.55)]

function hashOf(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  return h >>> 0
}

export function createRigFactory(scene: Scene, maxLights: number): RigFactory {
  const templates = new TransformNode('staff-templates', scene)
  templates.setEnabled(false)
  const template = <T extends Mesh>(m: T): T => {
    m.parent = templates
    m.isPickable = false
    return m
  }
  const box = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const b = MeshBuilder.CreateBox('staff-t-part', { width: w, height: h, depth: d }, scene)
    b.position.set(x, y, z)
    return b
  }
  /** A stud: the brick look's signature, 0.08 m across. */
  const stud = (x: number, y: number, z: number, d = 0.08, h = 0.035) => {
    const c = MeshBuilder.CreateCylinder('staff-t-stud', { diameter: d, height: h, tessellation: 12 }, scene)
    c.position.set(x, y + h / 2, z)
    return c
  }
  const merge = (name: string, parts: Mesh[]) => {
    const m = template(Mesh.MergeMeshes(parts, true)!)
    m.name = name
    return m
  }
  // Torso brick (centred on its pivot), shoulder studs, the neck.
  const body = merge('staff-t-body', [
    box(0.38, TORSO_H, 0.22, 0, 0, 0),
    stud(-0.12, TORSO_H / 2, 0),
    stud(0.12, TORSO_H / 2, 0),
    stud(0, TORSO_H / 2 - 0.03, 0, 0.1, 0.12),
  ])
  // Square head; the hair is a 2 × 2 plate with four studs over its top and back.
  const head = template(MeshBuilder.CreateBox('staff-t-head', { width: 0.24, height: 0.24, depth: 0.24 }, scene))
  const hair = merge('staff-t-hair', [
    box(0.27, 0.05, 0.27, 0, 0.145, -0.005),
    box(0.27, 0.12, 0.05, 0, 0.07, -0.12),
    stud(-0.065, 0.17, -0.07),
    stud(0.065, 0.17, -0.07),
    stud(-0.065, 0.17, 0.06),
    stud(0.065, 0.17, 0.06),
  ])
  const eyes = merge('staff-t-eyes', [box(0.035, 0.05, 0.01, -0.055, 0.015, 0.121), box(0.035, 0.05, 0.01, 0.055, 0.015, 0.121)])
  // Legs: two 1 × 1 columns to the hips, with a hip plate.
  const legs = merge('staff-t-legs', [box(0.16, 0.5, 0.18, -0.095, 0.25, 0), box(0.16, 0.5, 0.18, 0.095, 0.25, 0), box(0.38, 0.06, 0.2, 0, 0.53, 0)])
  // Seated: thighs over the seat, shins down to the floor.
  const lap = merge('staff-t-lap', [
    box(0.38, 0.06, 0.22, 0, 0.48, 0),
    box(0.16, 0.14, 0.44, -0.095, 0.46, 0.2),
    box(0.16, 0.14, 0.44, 0.095, 0.46, 0.2),
    box(0.16, 0.42, 0.16, -0.095, 0.21, 0.36),
    box(0.16, 0.42, 0.16, 0.095, 0.21, 0.36),
  ])
  // Arms at the sides (shirt colour) …
  const sideArms = merge('staff-t-side-arms', [box(0.09, 0.46, 0.12, -0.24, -0.06, 0), box(0.09, 0.46, 0.12, 0.24, -0.06, 0)])
  // … or forearms on the keyboard.
  const arms = merge('staff-t-arms', [box(0.09, 0.08, 0.46, -0.2, 0, 0.27), box(0.09, 0.08, 0.46, 0.2, 0, 0.27)])
  const ring = template(MeshBuilder.CreateTorus('staff-t-ring', { diameter: 0.86, thickness: 0.05, tessellation: 32 }, scene))

  const skins = SKINS.map((c, i) => pbr(scene, `staff-skin-${i}`, c, 0.45, maxLights))
  const hairs = HAIRS.map((c, i) => pbr(scene, `staff-hair-${i}`, c, 0.45, maxLights))
  const trousers = pbr(scene, 'staff-trousers', new Color3(0.13, 0.16, 0.24), 0.5, maxLights)
  const eyeMat = pbr(scene, 'staff-eyes', new Color3(0.04, 0.04, 0.05), 0.3, maxLights)
  const ringMat = new StandardMaterial('staff-ring', scene)
  ringMat.disableLighting = true
  ringMat.emissiveColor = new Color3(1, 0.78, 0.36)
  const materials = [...skins, ...hairs, trousers, eyeMat]

  return {
    materials,
    create(id, color) {
      const root = new TransformNode(`staff-${id}`, scene)
      const torso = new TransformNode(`staff-${id}-torso`, scene)
      torso.parent = root
      // Shirts are plastic: a little glossier than cloth.
      const bodyMat = pbr(scene, `staff-${id}-body`, color, 0.45, maxLights)
      materials.push(bodyMat)
      const pick = hashOf(id)
      const skin = skins[pick % skins.length]
      const hairMat = hairs[(pick >>> 8) % hairs.length]
      const part = (source: Mesh, name: string, parent: TransformNode, material: PBRMaterial | StandardMaterial) => {
        const m = source.clone(`staff-${id}-${name}`, parent)
        m.material = material
        m.isPickable = true
        m.metadata = { staff: id }
        return m
      }
      const h: StaffHandle = {
        id,
        root,
        torso,
        body: part(body, 'body', torso, bodyMat),
        head: part(head, 'head', torso, skin),
        hair: part(hair, 'hair', torso, hairMat),
        legs: part(legs, 'legs', root, trousers),
        lap: part(lap, 'lap', root, trousers),
        sideArms: part(sideArms, 'side-arms', torso, bodyMat),
        arms: part(arms, 'arms', torso, bodyMat),
        ring: part(ring, 'ring', root, ringMat),
        lit: [],
        walk: createWalk(),
        sample: emptyWalkSample(),
        view: emptyPoseView(),
        motion: emptyMotion(),
        phase: phaseOf(id),
        heading: 0,
        shown: { pose: null, stance: null, arms: null, ring: null },
        litRoom: undefined,
        litDesk: undefined,
        workItem: null,
      }
      // Hair and eyes turn with the head.
      h.hair.parent = h.head
      const e = part(eyes, 'eyes', torso, eyeMat)
      e.parent = h.head
      // The side arms hang from the shoulders.
      h.sideArms.parent = h.body
      h.ring.position.y = 0.03
      h.ring.isPickable = false
      h.lit = [h.body, h.head, h.hair, e, h.legs, h.lap, h.sideArms, h.arms]
      applyStance(h, 'stand', false, false)
      return h
    },
  }
}

/** Stand or sit, and which parts show. Only touches the meshes when something changed. */
export function applyStance(h: StaffHandle, stance: Stance, arms: boolean, ring: boolean): void {
  const s = h.shown
  if (s.stance !== stance) {
    const g = stance === 'sit' ? SIT : STAND
    h.torso.position.y = g.pivot
    h.body.position.y = g.body - g.pivot
    h.head.position.y = g.head - g.pivot
    h.arms.position.y = ARMS_Y - g.pivot
    h.lap.setEnabled(stance === 'sit')
    h.legs.setEnabled(stance !== 'sit')
    s.stance = stance
  }
  if (s.arms !== arms) {
    h.arms.setEnabled(arms)
    h.sideArms.setEnabled(!arms)
    s.arms = arms
  }
  if (s.ring !== ring) {
    h.ring.setEnabled(ring)
    s.ring = ring
  }
}

/** Turn of the head towards (x, z) relative to the body's facing, limited to what a neck does. */
export function headTurn(heading: number, fromX: number, fromZ: number, x: number, z: number): number {
  let d = (Math.atan2(x - fromX, z - fromZ) - heading) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return Math.max(-MAX_HEAD_TURN, Math.min(MAX_HEAD_TURN, d))
}

/** Per frame: the transforms of a pose's motion. `pivot` follows the stance applied before. */
export function applyMotion(h: StaffHandle, lean: number, motion: PoseMotion, look: number): void {
  const pivot = h.shown.stance === 'sit' ? SIT.pivot : STAND.pivot
  h.torso.position.y = pivot + motion.bob
  h.torso.rotation.x = lean
  if (h.shown.arms) {
    h.arms.position.y = ARMS_Y - pivot + motion.lift
    h.arms.position.z = motion.reach
  }
  if (h.shown.ring) h.ring.scaling.set(motion.ring, 1, motion.ring)
  h.head.rotation.y = look
}
