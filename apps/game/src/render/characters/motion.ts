/**
 * Walking between sim steps (FEAT-024, ADR-0007).
 *
 * The sim steps at 10 Hz; the renderer draws at the display's rate. Between
 * two steps a walker is drawn on the sim's own path: the position at a
 * fractional step is `Path::sample` of sim-core evaluated for that step,
 * `(step − startStep) × speed` metres along the axis-aligned waypoints. The
 * renderer never pathfinds and never extrapolates:
 *
 *   - the step it draws (`displayStep`) trails the sim's step and stops at it,
 *     so a person is never ahead of where the sim has them;
 *   - the distance drawn is also capped at the sim's reported position on the
 *     path (`locateOnRoute`), so the two can not disagree about the segment;
 *   - when no step arrives (the clock is held or paused) the display step
 *     reaches the sim step and stays: people hold still.
 *
 * Everything here is pure and allocation-free per frame: routes and samples
 * are reused objects.
 */
import type { PathRender } from '../../state/render-state'

/** A walk prepared for sampling. Reused: `setRoute` refills it in place. */
export interface Route {
  /** x0, z0, x1, z1, … in metres. */
  pts: number[]
  /** Distance from the start to each waypoint (Manhattan, like the sim). */
  cum: number[]
  count: number
  length: number
  startStep: number
  /** Metres per sim step. */
  speed: number
}

export function emptyRoute(): Route {
  return { pts: [], cum: [], count: 0, length: 0, startStep: 0, speed: 1 }
}

export function clearRoute(route: Route): void {
  route.count = 0
  route.length = 0
}

export function setRoute(route: Route, path: PathRender): void {
  const n = path.waypoints.length
  route.pts.length = n * 2
  route.cum.length = n
  let total = 0
  for (let i = 0; i < n; i++) {
    const p = path.waypoints[i]
    route.pts[i * 2] = p[0]
    route.pts[i * 2 + 1] = p[1]
    if (i > 0) total += Math.abs(p[0] - route.pts[i * 2 - 2]) + Math.abs(p[1] - route.pts[i * 2 - 1])
    route.cum[i] = total
  }
  route.count = n
  route.length = total
  route.startStep = path.startStep
  route.speed = Math.max(path.speed, 1e-6)
}

export function copyRoute(to: Route, from: Route): void {
  to.pts.length = from.count * 2
  to.cum.length = from.count
  for (let i = 0; i < from.count * 2; i++) to.pts[i] = from.pts[i]
  for (let i = 0; i < from.count; i++) to.cum[i] = from.cum[i]
  to.count = from.count
  to.length = from.length
  to.startStep = from.startStep
  to.speed = from.speed
}

/** Whether `path` is the walk `route` was built from (the sim sends the whole path every step). */
export function sameWalk(route: Route, path: PathRender): boolean {
  const n = path.waypoints.length
  if (route.count !== n || route.startStep !== path.startStep || n === 0) return false
  const last = path.waypoints[n - 1]
  return route.pts[0] === path.waypoints[0][0] && route.pts[1] === path.waypoints[0][1] && route.pts[n * 2 - 2] === last[0] && route.pts[n * 2 - 1] === last[1]
}

/** Metres walked along the route at a (fractional) sim step, within `[0, length]`. */
export function distanceAtStep(route: Route, step: number): number {
  const d = (step - route.startStep) * route.speed
  return d <= 0 ? 0 : d >= route.length ? route.length : d
}

/** The first step at which the walk is over (`Path::arrival_step`). */
export function arrivalStep(route: Route): number {
  return route.startStep + Math.ceil(route.length / route.speed - 1e-9)
}

/** Yaw (Babylon `rotation.y`) of someone whose front (local +z) points along (dx, dz). */
export function headingOf(dx: number, dz: number): number {
  return Math.atan2(dx, dz)
}

/** The shortest turn from `a` to `b`, taken `t` of the way (0..1). */
export function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return a + d * (t <= 0 ? 0 : t >= 1 ? 1 : t)
}

/** A walker turns over this many metres after a corner instead of snapping. */
export const TURN_DISTANCE = 0.3

export interface RouteSample {
  x: number
  z: number
  /** Index of the segment the point is on (from waypoint `segment` to `segment + 1`). */
  segment: number
  /** Direction of travel as a yaw, eased over `TURN_DISTANCE` after a corner. */
  heading: number
}

export function emptySample(): RouteSample {
  return { x: 0, z: 0, segment: 0, heading: 0 }
}

function segmentHeading(route: Route, i: number): number {
  return headingOf(route.pts[i * 2 + 2] - route.pts[i * 2], route.pts[i * 2 + 3] - route.pts[i * 2 + 1])
}

/** The point `dist` metres along the route (clamped to it), written into `out`. */
export function sampleRoute(route: Route, dist: number, out: RouteSample): void {
  const n = route.count
  if (n === 0) return
  if (n === 1) {
    out.x = route.pts[0]
    out.z = route.pts[1]
    out.segment = 0
    return
  }
  const d = dist <= 0 ? 0 : dist >= route.length ? route.length : dist
  // The segment containing d: the last one that starts at or before it and has length.
  let seg = -1
  let prev = -1
  for (let i = 0; i < n - 1; i++) {
    if (route.cum[i + 1] - route.cum[i] <= 0) continue
    if (route.cum[i] <= d || seg < 0) {
      if (seg >= 0) prev = seg
      seg = i
    }
    if (route.cum[i + 1] >= d) break
  }
  if (seg < 0) {
    out.x = route.pts[0]
    out.z = route.pts[1]
    out.segment = 0
    return
  }
  const along = d - route.cum[seg]
  const len = route.cum[seg + 1] - route.cum[seg]
  const k = along / len
  out.x = route.pts[seg * 2] + (route.pts[seg * 2 + 2] - route.pts[seg * 2]) * k
  out.z = route.pts[seg * 2 + 1] + (route.pts[seg * 2 + 3] - route.pts[seg * 2 + 1]) * k
  out.segment = seg
  const h = segmentHeading(route, seg)
  out.heading = prev >= 0 && along < TURN_DISTANCE ? lerpAngle(segmentHeading(route, prev), h, along / TURN_DISTANCE) : h
}

/**
 * Where on the route the sim says the person is: the distance of the point
 * (x, z) along it, or -1 when the point is not on the route. A route may pass
 * a point twice; `near` (the distance the formula gives) picks the pass.
 */
export function locateOnRoute(route: Route, x: number, z: number, near: number, tolerance = 0.002): number {
  let best = -1
  let bestGap = Infinity
  for (let i = 0; i < route.count - 1; i++) {
    const ax = route.pts[i * 2]
    const az = route.pts[i * 2 + 1]
    const bx = route.pts[i * 2 + 2]
    const bz = route.pts[i * 2 + 3]
    const minX = Math.min(ax, bx) - tolerance
    const maxX = Math.max(ax, bx) + tolerance
    const minZ = Math.min(az, bz) - tolerance
    const maxZ = Math.max(az, bz) + tolerance
    if (x < minX || x > maxX || z < minZ || z > maxZ) continue
    const d = Math.min(route.cum[i + 1], route.cum[i] + Math.abs(x - ax) + Math.abs(z - az))
    const gap = Math.abs(d - near)
    if (gap < bestGap) {
      bestGap = gap
      best = d
    }
  }
  return best
}

// ----------------------------------------------------------------------------
// The step the renderer draws
// ----------------------------------------------------------------------------

/**
 * The display step: the fractional sim step drawn right now. It runs from
 * where it was when the sim's last step arrived (`from`) to that step (`to`)
 * and then waits.
 */
export interface DisplayClock {
  from: number
  to: number
  /** Wall time (ms) of the arrival. */
  t0: number
  /** Wall time (ms) the run from `from` to `to` takes. */
  duration: number
  started: boolean
}

/**
 * The run takes a little longer than the 100 ms between two slices of the
 * game clock, so the display is still moving when the next step arrives and
 * walkers keep a constant speed instead of stopping for a frame at every step.
 * The display then trails the sim by about this many slices.
 */
export const CATCH_UP = 1.25
/** A jump of more steps than this is not a walk to animate (night skip, restored game, frozen time). */
export const MAX_ANIMATED_STEPS = 60

export function createDisplayClock(): DisplayClock {
  return { from: 0, to: 0, t0: 0, duration: 1, started: false }
}

export function displayStep(clock: DisplayClock, nowMs: number): number {
  if (!clock.started) return clock.to
  const t = (nowMs - clock.t0) / clock.duration
  if (!(t > 0)) return clock.from
  return t >= 1 ? clock.to : clock.from + (clock.to - clock.from) * t
}

/**
 * The sim reached `simStep` at wall time `nowMs`; `sliceMs` is the wall time
 * between two slices of the game clock (100 ms). The first step, a step back
 * and a long jump are shown at once.
 */
export function retarget(clock: DisplayClock, simStep: number, nowMs: number, sliceMs: number): void {
  const shown = displayStep(clock, nowMs)
  const jump = !clock.started || simStep < shown || simStep - shown > MAX_ANIMATED_STEPS
  clock.from = jump ? simStep : shown
  clock.to = simStep
  clock.t0 = nowMs
  clock.duration = Math.max(1, sliceMs * CATCH_UP)
  clock.started = true
}

// ----------------------------------------------------------------------------
// One person's walk
// ----------------------------------------------------------------------------

/**
 * What the renderer keeps per person to draw their walk: the route the sim
 * has them on, and the one before it while the display step has not reached
 * the end of it (the display trails the sim, so a walk that is over in the
 * sim is still finishing on screen).
 */
export interface Walk {
  current: Route
  /** The sim has the person on `current`. */
  walking: boolean
  /** The sim's own position on `current`, in metres along it: the display never passes it. */
  simDistance: number
  previous: Route
  hasPrevious: boolean
  /** `previous` is drawn while the display step is below this. */
  previousUntilStep: number
  /** … and up to this distance along it. */
  previousLimit: number
  /** The sim's position, shown when no route applies. */
  x: number
  z: number
}

export function createWalk(): Walk {
  return {
    current: emptyRoute(),
    walking: false,
    simDistance: 0,
    previous: emptyRoute(),
    hasPrevious: false,
    previousUntilStep: 0,
    previousLimit: 0,
    x: 0,
    z: 0,
  }
}

const JOIN_TOLERANCE = 0.02
const scratch = emptySample()

/**
 * Take the sim's state of one person at `simStep`. `shownStep` is the display
 * step at this moment: a route the display has already finished is dropped.
 */
export function updateWalk(walk: Walk, x: number, z: number, path: PathRender | null, simStep: number, shownStep: number): void {
  walk.x = x
  walk.z = z
  const wasWalking = walk.walking
  if (path && path.waypoints.length > 0) {
    if (!(wasWalking && sameWalk(walk.current, path))) {
      // A new walk. The one before it is still drawn until the display reaches this one's start.
      if (wasWalking && path.startStep > shownStep) retire(walk, path.startStep, distanceAtStep(walk.current, path.startStep), path.waypoints[0][0], path.waypoints[0][1])
      else if (!(walk.hasPrevious && path.startStep > shownStep && joins(walk, path.waypoints[0][0], path.waypoints[0][1]))) walk.hasPrevious = false
      setRoute(walk.current, path)
    }
    walk.walking = true
    const formula = distanceAtStep(walk.current, simStep)
    const located = locateOnRoute(walk.current, x, z, formula)
    walk.simDistance = located >= 0 ? located : formula
    return
  }
  // Not walking in the sim. If a walk just ended where the person now is, the display finishes it.
  if (wasWalking) {
    const end = arrivalStep(walk.current)
    if (end > shownStep) retire(walk, end, walk.current.length, x, z)
    else walk.hasPrevious = false
  } else if (walk.hasPrevious && !joins(walk, x, z)) walk.hasPrevious = false
  walk.walking = false
  clearRoute(walk.current)
}

/** The previous route ends (at its limit) where the person continues from. */
function joins(walk: Walk, x: number, z: number): boolean {
  sampleRoute(walk.previous, walk.previousLimit, scratch)
  return Math.abs(scratch.x - x) + Math.abs(scratch.z - z) <= JOIN_TOLERANCE
}

function retire(walk: Walk, untilStep: number, limit: number, nextX: number, nextZ: number): void {
  copyRoute(walk.previous, walk.current)
  walk.previousUntilStep = untilStep
  walk.previousLimit = limit
  walk.hasPrevious = joins(walk, nextX, nextZ)
}

export interface WalkSample extends RouteSample {
  /** The display has the person on a route (walking on screen). */
  moving: boolean
  /** Metres walked on that route (drives the walk cycle). */
  distance: number
}

export function emptyWalkSample(): WalkSample {
  return { x: 0, z: 0, segment: 0, heading: 0, moving: false, distance: 0 }
}

/** Where to draw the person at display step `step`. Keeps `out.heading` when they stand. */
export function sampleWalk(walk: Walk, step: number, out: WalkSample): void {
  if (walk.hasPrevious && step < walk.previousUntilStep) {
    const d = Math.min(distanceAtStep(walk.previous, step), walk.previousLimit)
    sampleRoute(walk.previous, d, out)
    out.moving = true
    out.distance = d
    return
  }
  walk.hasPrevious = false
  if (walk.walking) {
    const d = Math.min(distanceAtStep(walk.current, step), walk.simDistance)
    sampleRoute(walk.current, d, out)
    out.moving = true
    out.distance = d
    return
  }
  out.x = walk.x
  out.z = walk.z
  out.moving = false
  out.distance = 0
}
