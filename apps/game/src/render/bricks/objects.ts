/**
 * Placed objects (ADR-0065 §4, K-4; ADR-0087 decision 7): the player's own kit designs standing in
 * the office, as the sim lays them out (`Sim.layout_json().objects`). The sim knows each object by
 * its design's hash and the design's compiled summary (rule 2: no design text enters the sim); the
 * design itself is company text, resolved by its hash through the data source (`designOf`).
 *
 * The wire types are the render state's (`PlacedObjectLayout`, `ObjectSummary`), re-exported.
 */
import type { BuildingLayout } from '../../state/render-state'
import { STUD, turnOf, type Turn } from './placements'

export type { ObjectSummary, PlacedObjectLayout } from '../../state/render-state'
import type { ObjectSummary, PlacedObjectLayout } from '../../state/render-state'

/** A layout that may carry placed objects. */
export type LayoutWithObjects = BuildingLayout

/** The layout's placed objects (none before the sim lays any out). */
export function objectsOf(layout: BuildingLayout | null | undefined): PlacedObjectLayout[] {
  const list = (layout as LayoutWithObjects | null | undefined)?.objects
  return Array.isArray(list) ? list.filter((o) => o && typeof o.id === 'string' && typeof o.design === 'string') : []
}

/**
 * The world rect an object covers, turned: from its summary's footprint in studs (the design's
 * frame) when it has one, else the layout's footprint in metres taken in the design's frame too.
 */
export function objectRect(o: Pick<PlacedObjectLayout, 'x' | 'z' | 'rot' | 'footprint'> & { summary?: Pick<ObjectSummary, 'footprint'> }): { x: number; z: number; w: number; d: number } {
  const [w0, d0] = o.summary?.footprint ? [o.summary.footprint[0] * STUD, o.summary.footprint[1] * STUD] : o.footprint
  const odd = turnOf(o.rot) % 2 === 1
  const w = odd ? d0 : w0
  const d = odd ? w0 : d0
  return { x: o.x - w / 2, z: o.z - d / 2, w, d }
}

export const objectTurn = (o: Pick<PlacedObjectLayout, 'rot'>): Turn => turnOf(o.rot)

/**
 * How the renderer finds a design by its hash: the design JSON (text or object), `undefined` while
 * it is being read, `null` when the company has none.
 */
export type DesignResolver = (hash: string) => string | object | null | undefined

/** A resolved design as the kit's compiler takes it. */
export function designText(d: string | object | null | undefined): string | null {
  if (d == null) return null
  return typeof d === 'string' ? d : JSON.stringify(d)
}
