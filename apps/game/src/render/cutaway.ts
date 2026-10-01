/**
 * Dollhouse cutaway (ADR-0005): walls whose outside faces the camera are
 * hidden so the player looks into the rooms. Pure functions, unit-tested.
 */

export type Side = 'north' | 'south' | 'east' | 'west'

/** Outward normal on the floor plane. x grows east, z grows south. */
export const SIDE_NORMAL: Record<Side, { x: number; z: number }> = {
  north: { x: 0, z: -1 },
  south: { x: 0, z: 1 },
  east: { x: 1, z: 0 },
  west: { x: -1, z: 0 },
}

/**
 * Babylon ArcRotateCamera sits at target + (cos α · sin β, cos β, sin α · sin β) · r.
 * A wall is cut away when its outward normal points towards the camera.
 */
export function isCutAway(side: Side, cameraAlpha: number): boolean {
  const n = SIDE_NORMAL[side]
  const dot = n.x * Math.cos(cameraAlpha) + n.z * Math.sin(cameraAlpha)
  return dot > 1e-6
}
