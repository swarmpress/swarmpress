import { Color3, Mesh, MeshBuilder, PBRMaterial, Scene, TransformNode } from '@babylonjs/core'
import type { BuildingLayout, RoomLayout } from '../state/render-state'
import { clockHands } from './clock-math'

const RADIUS = 0.32
const HEIGHT = 2.35
const ROOM_KINDS_WITH_CLOCK = new Set(['newsroom', 'kitchen', 'meeting-room', 'ceo-office'])

export interface WallClock {
  root: TransformNode
  hour: Mesh
  minute: Mesh
  second: Mesh
}

/** Where a clock can hang: on an exterior wall segment of the room that has no window. */
export function clockSpot(room: RoomLayout): { x: number; z: number; facing: 'south' | 'east' } | null {
  const free = (side: 'north' | 'west', from: number, to: number, at: number) =>
    room.windows.filter((w) => w.side === side).every((w) => at < from + w.at - RADIUS || at > from + w.at + w.width + RADIUS)
  if (room.z === 0) {
    for (const f of [0.5, 0.25, 0.75, 0.1, 0.9]) {
      const x = room.x + room.w * f
      if (free('north', room.x, room.x + room.w, x)) return { x, z: 0.04, facing: 'south' }
    }
  }
  if (room.x === 0) {
    for (const f of [0.5, 0.25, 0.75]) {
      const z = room.z + room.d * f
      if (free('west', room.z, room.z + room.d, z)) return { x: 0.04, z, facing: 'east' }
    }
  }
  return null
}

function hand(scene: Scene, name: string, length: number, width: number, depth: number, mat: PBRMaterial, parent: TransformNode) {
  const pivot = new TransformNode(`${name}-pivot`, scene)
  pivot.parent = parent
  const m = MeshBuilder.CreateBox(name, { width, height: length, depth: 0.01 }, scene)
  m.position.set(0, length / 2 - 0.03, -depth)
  m.material = mat
  m.parent = pivot
  return { pivot, mesh: m }
}

/** Builds analog wall clocks in rooms that get one; returns an updater. */
export function buildWallClocks(scene: Scene, layout: BuildingLayout) {
  const faceMat = new PBRMaterial('clock-face', scene)
  faceMat.albedoColor = new Color3(0.95, 0.94, 0.9)
  faceMat.roughness = 0.6
  faceMat.metallic = 0
  const darkMat = new PBRMaterial('clock-hands', scene)
  darkMat.albedoColor = new Color3(0.08, 0.08, 0.09)
  darkMat.roughness = 0.5
  darkMat.metallic = 0.2
  const redMat = new PBRMaterial('clock-second', scene)
  redMat.albedoColor = new Color3(0.75, 0.1, 0.08)
  redMat.roughness = 0.5
  redMat.metallic = 0

  const pivots: Array<{ hour: TransformNode; minute: TransformNode; second: TransformNode }> = []
  for (const room of layout.rooms) {
    if (!ROOM_KINDS_WITH_CLOCK.has(room.kind)) continue
    const spot = clockSpot(room)
    if (!spot) continue
    const root = new TransformNode(`clock-${room.id}`, scene)
    root.position.set(spot.x, HEIGHT, spot.z)
    // Face the room: local -Z points out of the wall into the room.
    root.rotation.y = spot.facing === 'south' ? Math.PI : -Math.PI / 2
    const face = MeshBuilder.CreateCylinder(`clock-${room.id}-face`, { diameter: RADIUS * 2, height: 0.04, tessellation: 48 }, scene)
    face.rotation.x = Math.PI / 2
    face.material = faceMat
    face.parent = root
    for (let i = 0; i < 12; i++) {
      const tick = MeshBuilder.CreateBox(`clock-${room.id}-tick-${i}`, { width: 0.015, height: i % 3 === 0 ? 0.07 : 0.04, depth: 0.01 }, scene)
      const a = (i / 12) * Math.PI * 2
      tick.position.set(Math.sin(a) * (RADIUS - 0.05), Math.cos(a) * (RADIUS - 0.05), -0.03)
      tick.rotation.z = -a
      tick.material = darkMat
      tick.parent = root
    }
    const h = hand(scene, `clock-${room.id}-hour`, RADIUS * 0.5, 0.025, 0.035, darkMat, root)
    const m = hand(scene, `clock-${room.id}-minute`, RADIUS * 0.78, 0.016, 0.04, darkMat, root)
    const s = hand(scene, `clock-${room.id}-second`, RADIUS * 0.85, 0.006, 0.045, redMat, root)
    pivots.push({ hour: h.pivot, minute: m.pivot, second: s.pivot })
  }

  return {
    count: pivots.length,
    /** Set all clocks to `instant` in `timeZone` (rotation is clockwise seen from the room). */
    set(instant: Date, timeZone: string) {
      const a = clockHands(instant, timeZone)
      for (const p of pivots) {
        p.hour.rotation.z = -a.hour
        p.minute.rotation.z = -a.minute
        p.second.rotation.z = -a.second
      }
    },
    pivots,
  }
}

