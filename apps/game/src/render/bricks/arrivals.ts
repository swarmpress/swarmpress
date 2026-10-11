/**
 * Construction (FEAT-084, ADR-0087 decision 6; docs/design/construction-kit.md §7.2): when the
 * sim places equipment (the office designer's builders, one `PlaceEquipment` after another), the
 * scene is rebuilt on the new `layoutRev` and the items that were not there before arrive: their
 * bricks drop from above into place with a short ease and a little scale, one after another in
 * build order. The sim decides what stands where (rule 8); this only animates what the new layout
 * already holds, and never on frozen pages or for a viewer who prefers reduced motion.
 *
 * The brick office builds each new item as its own meshes under one node (`BrickOfficeOptions.fresh`);
 * the node is what moves here. Once it lands it stays a separate small batch until the next rebuild
 * merges it into its room.
 */
import type { Observer, Scene, TransformNode } from '@babylonjs/core'
import type { BuildingLayout } from '../../state/render-state'

/** How long one item takes to land, how far it falls, how much it grows, and the gap between two items. */
export const ARRIVAL_MS = 600
export const ARRIVAL_DROP = 0.6
export const ARRIVAL_SCALE = 0.85
export const ARRIVAL_STAGGER_MS = 140
/**
 * The most animation time one frame may advance. The first frames after a rebuild can be slow
 * (new meshes, new shaders): the animation then plays slower rather than skipping to the end.
 */
export const ARRIVAL_MAX_STEP_MS = 50

/** An item arriving: its node (pivot on its footprint centre at the floor) and the room it stands in. */
export interface Arrival {
  id: string
  room: string
  node: TransformNode
}

/** The ids of every piece of equipment of a layout (desks, ceiling lights, props). */
function equipmentIds(layout: BuildingLayout): string[] {
  const out: string[] = []
  for (const r of layout.rooms) {
    for (const d of r.desks) out.push(d.id)
    for (const l of r.ceilingLights) out.push(l.id)
    for (const p of r.props) out.push(p.id)
  }
  return out
}

/** Build order: the sim numbers equipment as it places it (`equip-12` after `equip-9`). */
export function byBuildOrder(a: string, b: string): number {
  const na = Number(/(\d+)$/.exec(a)?.[1] ?? NaN)
  const nb = Number(/(\d+)$/.exec(b)?.[1] ?? NaN)
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb
  return a < b ? -1 : a > b ? 1 : 0
}

/** The equipment the next layout has and the previous one had not, in build order. None without a previous layout. */
export function freshEquipment(prev: BuildingLayout | null, next: BuildingLayout): string[] {
  if (!prev) return []
  const before = new Set(equipmentIds(prev))
  return equipmentIds(next)
    .filter((id) => !before.has(id))
    .sort(byBuildOrder)
}

/** Whether the viewer asked for less motion (no animation then). */
export function prefersReducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/** What to animate after a rebuild: nothing on a frozen page or under reduced motion, else the fresh ids. */
export function arrivalsFor(prev: BuildingLayout | null, next: BuildingLayout, opts: { frozen: boolean; reducedMotion: boolean }): string[] {
  if (opts.frozen || opts.reducedMotion) return []
  return freshEquipment(prev, next)
}

const easeOut = (t: number) => 1 - (1 - t) ** 3

/** An item's pose `ms` after the animation started: its height above its place, its scale, and whether it shows yet. */
export function arrivalPose(ms: number, index: number): { y: number; scale: number; visible: boolean; done: boolean } {
  const t = (ms - index * ARRIVAL_STAGGER_MS) / ARRIVAL_MS
  if (t <= 0) return { y: ARRIVAL_DROP, scale: ARRIVAL_SCALE, visible: false, done: false }
  if (t >= 1) return { y: 0, scale: 1, visible: true, done: true }
  const e = easeOut(t)
  return { y: ARRIVAL_DROP * (1 - e), scale: ARRIVAL_SCALE + (1 - ARRIVAL_SCALE) * e, visible: true, done: false }
}

/**
 * Plays the arrivals on the scene's frames: each node starts hidden, then drops into place in turn.
 * Animation time starts at the first frame drawn and advances by the frames' wall time, at most
 * `ARRIVAL_MAX_STEP_MS` a frame. Returns a stop function that puts every node in its place at once
 * (also called when the scene goes).
 */
export function animateArrivals(scene: Scene, arrivals: readonly Arrival[], now: () => number = () => performance.now()): () => void {
  if (arrivals.length === 0) return () => undefined
  let last: number | null = null
  let ms = 0
  const pose = (n: TransformNode, p: ReturnType<typeof arrivalPose>) => {
    n.position.y = p.y
    n.scaling.setAll(p.scale)
    n.setEnabled(p.visible)
  }
  arrivals.forEach((a, i) => pose(a.node, arrivalPose(0, i)))
  let observer: Observer<Scene> | null = null
  const stop = () => {
    if (!observer) return
    scene.onBeforeRenderObservable.remove(observer)
    observer = null
    for (const a of arrivals) if (!a.node.isDisposed()) pose(a.node, arrivalPose(Infinity, 0))
  }
  observer = scene.onBeforeRenderObservable.add(() => {
    const t = now()
    ms += last === null ? 0 : Math.min(ARRIVAL_MAX_STEP_MS, Math.max(0, t - last))
    last = t
    let all = true
    arrivals.forEach((a, i) => {
      const p = arrivalPose(ms, i)
      pose(a.node, p)
      all &&= p.done
    })
    if (all) stop()
  })
  scene.onDisposeObservable.addOnce(stop)
  return stop
}
