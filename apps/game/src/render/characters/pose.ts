/**
 * From a person's render state to how they are drawn (FEAT-024). Pure: the
 * sim decides the pose, the seat and the meeting; this only maps those facts
 * to a stance, what the person faces, and the small motion that makes each
 * pose readable. Every motion is a function of the display step, so two
 * clients draw the same thing and a held clock holds the people.
 */
import type { BuildingLayout, DeskLayout, MeetingRender, Pose, RoomLayout, StaffRender } from '../../state/render-state'
import { POSES } from '../../state/render-state-shape'

export type Stance = 'stand' | 'sit'
/** What the person sits on: the chair at a desk (part of the office) or a stool at a table (part of the person). */
export type Seat = 'desk' | 'table' | null

export interface PoseView {
  pose: Pose
  stance: Stance
  seat: Seat
  /** Forearms out (on the keyboard, or gesturing). */
  arms: boolean
  /** The speaker's ring on the floor. */
  ring: boolean
  /** Torso lean in radians, forward positive. */
  lean: number
  /** What the body faces when not walking, or null to keep the last heading. */
  faceX: number | null
  faceZ: number | null
  /** What the head turns to (the speaker), or null to look ahead. */
  lookX: number | null
  lookZ: number | null
}

/** Where things are, from the layout and the current state. */
export interface PoseContext {
  desk(id: string): DeskLayout | undefined
  room(id: string): RoomLayout | undefined
  roomAt(x: number, z: number): RoomLayout | undefined
  meeting(id: string): MeetingRender | undefined
  /** A person on site, for where the speaker sits. */
  person(id: string): { x: number; z: number } | undefined
}

export function layoutContext(layout: BuildingLayout): Pick<PoseContext, 'desk' | 'room' | 'roomAt'> {
  const desks = new Map<string, DeskLayout>()
  const rooms = new Map<string, RoomLayout>()
  for (const r of layout.rooms) {
    rooms.set(r.id, r)
    for (const d of r.desks) desks.set(d.id, d)
  }
  return {
    desk: (id) => desks.get(id),
    room: (id) => rooms.get(id),
    roomAt: (x, z) => layout.rooms.find((r) => x >= r.x && x < r.x + r.w && z >= r.z && z < r.z + r.d),
  }
}

const LEAN: Record<Pose, number> = { walk: 0.1, sit: 0, type: 0.14, talk: 0.05, listen: 0.1, idle: 0 }

/** Reported once per unknown slug outside dev builds, where it throws instead. */
const reported = new Set<string>()

/** An unknown pose is a contract change the renderer was not told about: loud in dev, idle in production. */
export function knownPose(pose: string, dev: boolean): Pose {
  if (POSES.includes(pose)) return pose as Pose
  if (dev) throw new Error(`unknown pose "${pose}": add it to render-state.ts and characters/pose.ts`)
  if (!reported.has(pose)) {
    reported.add(pose)
    console.error(`unknown pose "${pose}", drawn as idle`)
  }
  return 'idle'
}

const centre = (r: RoomLayout) => ({ x: r.x + r.w / 2, z: r.z + r.d / 2 })

/**
 * How to draw `s`. `out` is reused. The table of a meeting, the kitchen and
 * the strategy room stands in the middle of its room (sim-core `table_seat`),
 * so "face the table" is "face the room's centre".
 */
export function poseView(s: StaffRender, ctx: PoseContext, out: PoseView, dev = true): PoseView {
  const pose = knownPose(s.pose, dev)
  out.pose = pose
  out.lean = LEAN[pose]
  out.arms = pose === 'type' || pose === 'talk'
  out.ring = pose === 'talk'
  out.faceX = out.faceZ = out.lookX = out.lookZ = null
  out.stance = 'stand'
  out.seat = null
  if (pose === 'walk') return out

  const desk = s.seatedAt ? ctx.desk(s.seatedAt) : undefined
  if (desk) {
    out.stance = 'sit'
    out.seat = 'desk'
    out.faceX = desk.x
    out.faceZ = desk.z
    // Idle at the desk (lunch without a kitchen): leaning back.
    if (pose === 'idle') out.lean = -0.1
    return out
  }

  const meeting = s.meeting ? ctx.meeting(s.meeting) : undefined
  const table = pose === 'talk' || pose === 'listen' ? (meeting ? ctx.room(meeting.room) : ctx.roomAt(s.x, s.z)) : pose === 'sit' ? ctx.roomAt(s.x, s.z) : undefined
  if (table) {
    const c = centre(table)
    out.stance = 'sit'
    out.seat = 'table'
    out.faceX = c.x
    out.faceZ = c.z
    if (pose === 'listen' && meeting?.speaker && meeting.speaker !== s.id) {
      const speaker = ctx.person(meeting.speaker)
      if (speaker) {
        out.lookX = speaker.x
        out.lookZ = speaker.z
      }
    }
  } else if (pose !== 'idle') {
    // Seated in the sim, but nowhere the layout knows: still drawn seated.
    out.stance = pose === 'sit' || pose === 'type' ? 'sit' : 'stand'
    out.seat = out.stance === 'sit' ? 'table' : null
  }
  return out
}

export function emptyPoseView(): PoseView {
  return { pose: 'idle', stance: 'stand', seat: null, arms: false, ring: false, lean: 0, faceX: null, faceZ: null, lookX: null, lookZ: null }
}

// ----------------------------------------------------------------------------
// Motion within a pose
// ----------------------------------------------------------------------------

/** A stable number in [0, 1) per person, so people do not move in unison. */
export function phaseOf(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 1024) / 1024
}

const TAU = Math.PI * 2
/** Metres per walk cycle (two steps). */
export const STRIDE = 1.3

export interface PoseMotion {
  /** Vertical offset of the whole person, metres. */
  bob: number
  /** Extra forward travel of the forearms, metres. */
  reach: number
  /** Extra height of the forearms, metres. */
  lift: number
  /** Scale of the speaker's ring. */
  ring: number
}

export function emptyMotion(): PoseMotion {
  return { bob: 0, reach: 0, lift: 0, ring: 1 }
}

/**
 * The motion of a pose at display step `step` (10 steps per real second at
 * speed 1). Walking bobs with the distance walked, not with time: a walker
 * who is held mid-stride stays mid-stride.
 */
export function poseMotion(pose: Pose, step: number, distance: number, phase: number, out: PoseMotion): PoseMotion {
  out.bob = 0
  out.reach = 0
  out.lift = 0
  out.ring = 1
  if (pose === 'walk') out.bob = 0.035 * Math.abs(Math.sin((distance / STRIDE) * TAU))
  else if (pose === 'type') {
    // Fingers: about four strokes a second, the two hands' sum never quite repeating.
    out.reach = 0.012 * Math.sin((step * 0.42 + phase) * TAU)
    out.lift = 0.008 * Math.sin((step * 0.27 + phase * 3) * TAU)
  } else if (pose === 'talk') {
    const t = (step * 0.12 + phase) * TAU
    out.bob = 0.018 * Math.sin(t)
    out.lift = 0.1 + 0.05 * Math.sin(t * 0.5)
    out.ring = 1 + 0.08 * Math.sin(t)
  }
  return out
}
