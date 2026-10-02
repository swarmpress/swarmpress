/**
 * A person in simple geometry (FEAT-024): a capsule and a head, with a cap of
 * hair so the facing shows, and three parts that appear with a pose: legs
 * bent over a seat, forearms on the keyboard, and the speaker's ring on the
 * floor. No glTF and no skeleton; a pose is a handful of transforms. Seats
 * are the office's (desk chairs, the stools around tables).
 *
 * Geometry is built once and shared by every person (clones share vertex
 * buffers). Skin, hair and ring materials are shared too; only the body
 * colour is per person. People are separate meshes, not instances: each is
 * lit by the room they are in, and instances would share one set of lights.
 */
import { Color3, Mesh, MeshBuilder, PBRMaterial, Scene, StandardMaterial, TransformNode } from '@babylonjs/core'
import type { Pose } from '../../state/render-state'
import { createWalk, emptyWalkSample, type Walk, type WalkSample } from './motion'
import { emptyMotion, emptyPoseView, phaseOf, type PoseMotion, type PoseView, type Stance } from './pose'

/** Top of the head above the floor, per stance: where the label goes. */
export const HEAD_TOP: Record<Stance, number> = { stand: 1.47, sit: 1.4 }

const STAND = { pivot: 0, body: 0.58, bodyScale: 1, head: 1.32 }
/** Seated: hips on a 0.45 m seat, the capsule shortened to a torso. */
const SIT = { pivot: 0.45, body: 0.78, bodyScale: 0.62, head: 1.26 }
const ARMS_Y = 0.87
const MAX_HEAD_TURN = 1.1

export interface StaffHandle {
  id: string
  /** At the person's feet; `rotation.y` is the facing. */
  root: TransformNode
  /** Body, head and forearms: leans and bobs. */
  torso: TransformNode
  body: Mesh
  head: Mesh
  hair: Mesh
  /** Bent legs, shown when seated. */
  lap: Mesh
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

export function createRigFactory(scene: Scene, maxLights: number): RigFactory {
  const templates = new TransformNode('staff-templates', scene)
  templates.setEnabled(false)
  const template = <T extends Mesh>(m: T): T => {
    m.parent = templates
    m.isPickable = false
    return m
  }
  const body = template(MeshBuilder.CreateCapsule('staff-t-body', { height: 1.15, radius: 0.22, tessellation: 16 }, scene))
  const head = template(MeshBuilder.CreateSphere('staff-t-head', { diameter: 0.28, segments: 12 }, scene))
  const hair = template(MeshBuilder.CreateSphere('staff-t-hair', { diameter: 0.315, segments: 12, slice: 0.52 }, scene))
  const thighs = MeshBuilder.CreateBox('staff-t-thighs', { width: 0.36, height: 0.15, depth: 0.44 }, scene)
  thighs.position.set(0, 0.47, 0.2)
  const shins = MeshBuilder.CreateBox('staff-t-shins', { width: 0.34, height: 0.42, depth: 0.14 }, scene)
  shins.position.set(0, 0.21, 0.37)
  const lap = template(Mesh.MergeMeshes([thighs, shins], true)!)
  lap.name = 'staff-t-lap'
  const left = MeshBuilder.CreateBox('staff-t-arm-l', { width: 0.09, height: 0.08, depth: 0.46 }, scene)
  left.position.set(-0.2, 0, 0.27)
  const right = MeshBuilder.CreateBox('staff-t-arm-r', { width: 0.09, height: 0.08, depth: 0.46 }, scene)
  right.position.set(0.2, 0, 0.27)
  const arms = template(Mesh.MergeMeshes([left, right], true)!)
  arms.name = 'staff-t-arms'
  const ring = template(MeshBuilder.CreateTorus('staff-t-ring', { diameter: 0.86, thickness: 0.05, tessellation: 32 }, scene))

  const skin = pbr(scene, 'staff-skin', new Color3(0.86, 0.68, 0.55), 0.6, maxLights)
  const hairMat = pbr(scene, 'staff-hair', new Color3(0.16, 0.11, 0.08), 0.8, maxLights)
  const ringMat = new StandardMaterial('staff-ring', scene)
  ringMat.disableLighting = true
  ringMat.emissiveColor = new Color3(1, 0.78, 0.36)
  const materials = [skin, hairMat]

  return {
    materials,
    create(id, color) {
      const root = new TransformNode(`staff-${id}`, scene)
      const torso = new TransformNode(`staff-${id}-torso`, scene)
      torso.parent = root
      const bodyMat = pbr(scene, `staff-${id}-body`, color, 0.65, maxLights)
      materials.push(bodyMat)
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
        lap: part(lap, 'lap', root, bodyMat),
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
      // The hair turns with the head: a cap over its top and back.
      h.hair.parent = h.head
      h.hair.position.set(0, 0.01, -0.012)
      h.hair.rotation.x = -0.55
      h.ring.position.y = 0.03
      h.ring.isPickable = false
      h.lit = [h.body, h.head, h.hair, h.lap, h.arms]
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
    h.body.scaling.y = g.bodyScale
    h.head.position.y = g.head - g.pivot
    h.arms.position.y = ARMS_Y - g.pivot
    h.lap.setEnabled(stance === 'sit')
    s.stance = stance
  }
  if (s.arms !== arms) {
    h.arms.setEnabled(arms)
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
