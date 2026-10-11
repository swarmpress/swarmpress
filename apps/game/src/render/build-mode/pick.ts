/**
 * Build mode's picking (ADR-0087), pure: a pointer ray onto a horizontal
 * plane, the stud grid, and what stands under a floor point. No Babylon
 * here, so it is tested without a GPU; `bridge.ts` hands in the camera's ray.
 */
import { STUD } from '../bricks/placements'

export interface Rect {
  x: number
  z: number
  w: number
  d: number
}

/** Where a ray (`origin`, `direction`) meets the plane y = `y`; null when it runs parallel or away. */
export function rayToPlane(origin: readonly [number, number, number], direction: readonly [number, number, number], y = 0): { x: number; z: number } | null {
  const dy = direction[1]
  if (Math.abs(dy) < 1e-9) return null
  const t = (y - origin[1]) / dy
  if (t < 0) return null
  return { x: origin[0] + direction[0] * t, z: origin[2] + direction[2] * t }
}

/** A coordinate on the stud grid (1/16 m). */
export function snapStud(v: number): number {
  // Round to whole studs; `+ 0` turns -0 into 0.
  return Math.round(v / STUD) * STUD + 0
}

export function inRect(r: Rect, x: number, z: number): boolean {
  return x >= r.x && x < r.x + r.w && z >= r.z && z < r.z + r.d
}

/** A placed item the pointer can land on. */
export interface PickItem {
  id: string
  rect: Rect
  /** Height of the plane it is picked at (an item on a desk at the desk top; the floor otherwise). */
  y: number
  /** Lower ranks win (items on desks, then floor items, then ceiling lights). */
  rank: number
}

/**
 * The item under the ray: each item is tested at its own height; among
 * hits the lowest rank wins, then the smallest footprint (a plant beside a
 * desk over the desk), then the id (deterministic).
 */
export function itemUnder(items: readonly PickItem[], origin: readonly [number, number, number], direction: readonly [number, number, number]): PickItem | null {
  let best: PickItem | null = null
  for (const it of items) {
    const p = rayToPlane(origin, direction, it.y)
    if (!p || !inRect(it.rect, p.x, p.z)) continue
    if (
      !best ||
      it.rank < best.rank ||
      (it.rank === best.rank && (it.rect.w * it.rect.d < best.rect.w * best.rect.d || (it.rect.w * it.rect.d === best.rect.w * best.rect.d && it.id < best.id)))
    )
      best = it
  }
  return best
}

/** The rect of a highlight frame around `r`, as four bars `t` wide just outside it. */
export function frameBars(r: Rect, t = 0.06): Rect[] {
  return [
    { x: r.x - t, z: r.z - t, w: r.w + 2 * t, d: t },
    { x: r.x - t, z: r.z + r.d, w: r.w + 2 * t, d: t },
    { x: r.x - t, z: r.z, w: t, d: r.d },
    { x: r.x + r.w, z: r.z, w: t, d: r.d },
  ]
}

/** A sim `EquipmentKind` name as the layout's kind (`DeskLamp` → `desk-lamp`); kebab-case passes through. */
export function kebabKind(kind: string): string {
  return kind.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
}
