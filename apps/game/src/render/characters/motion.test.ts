import { describe, expect, it } from 'vitest'
import type { PathRender, RenderState } from '../../state/render-state'
import lunch from '../../state/fixtures/demo-lunch.json'
import standup from '../../state/fixtures/demo-standup.json'
import working from '../../state/fixtures/demo-working.json'
import {
  arrivalStep,
  CATCH_UP,
  createDisplayClock,
  createWalk,
  displayStep,
  distanceAtStep,
  emptyRoute,
  emptySample,
  emptyWalkSample,
  headingOf,
  lerpAngle,
  locateOnRoute,
  MAX_ANIMATED_STEPS,
  retarget,
  sampleRoute,
  sampleWalk,
  setRoute,
  TURN_DISTANCE,
  updateWalk,
} from './motion'

const path: PathRender = {
  waypoints: [
    [0, 0],
    [2, 0],
    [2, 1],
  ],
  startStep: 10,
  speed: 0.25,
}
const route = () => {
  const r = emptyRoute()
  setRoute(r, path)
  return r
}

/** sim-core `Path::sample` at an integer step, in millimetres (integer maths, like the sim). */
function simSample(p: PathRender, step: number): [number, number] {
  const mm = p.waypoints.map(([x, z]) => [Math.round(x * 1000), Math.round(z * 1000)])
  let left = Math.max(0, step - p.startStep) * Math.round(p.speed * 1000)
  for (let i = 0; i + 1 < mm.length; i++) {
    const seg = Math.abs(mm[i + 1][0] - mm[i][0]) + Math.abs(mm[i + 1][1] - mm[i][1])
    if (left < seg) return [(mm[i][0] + left * Math.sign(mm[i + 1][0] - mm[i][0])) / 1000, (mm[i][1] + left * Math.sign(mm[i + 1][1] - mm[i][1])) / 1000]
    left -= seg
  }
  const last = mm[mm.length - 1]
  return [last[0] / 1000, last[1] / 1000]
}

describe('position along a path at a fractional step', () => {
  it('is (step − startStep) × speed metres along the waypoints', () => {
    const r = route()
    const s = emptySample()
    expect(r.length).toBe(3)
    sampleRoute(r, distanceAtStep(r, 14), s)
    expect([s.x, s.z]).toEqual([1, 0])
    sampleRoute(r, distanceAtStep(r, 18.5), s)
    expect(s.x).toBeCloseTo(2)
    expect(s.z).toBeCloseTo(0.125)
    expect(s.segment).toBe(1)
  })

  it('clamps before the start and after the end of the walk', () => {
    const r = route()
    const s = emptySample()
    expect(distanceAtStep(r, 3)).toBe(0)
    sampleRoute(r, distanceAtStep(r, 3), s)
    expect([s.x, s.z]).toEqual([0, 0])
    expect(distanceAtStep(r, 1e9)).toBe(3)
    sampleRoute(r, distanceAtStep(r, 1e9), s)
    expect([s.x, s.z]).toEqual([2, 1])
    expect(arrivalStep(r)).toBe(22)
  })

  it('agrees with the sim at every step of the real walks in the fixtures', () => {
    const states = [standup, working, lunch] as unknown as RenderState[]
    const r = emptyRoute()
    const s = emptySample()
    let walkers = 0
    for (const state of states) {
      for (const p of state.staff) {
        if (!p.path) continue
        walkers++
        setRoute(r, p.path)
        // where the sim has the person now
        sampleRoute(r, distanceAtStep(r, state.step), s)
        expect(s.x).toBeCloseTo(p.x, 6)
        expect(s.z).toBeCloseTo(p.z, 6)
        // and at every integer step of the walk, like sim-core's Path::sample
        for (let step = p.path.startStep; step <= arrivalStep(r); step++) {
          sampleRoute(r, distanceAtStep(r, step), s)
          const [x, z] = simSample(p.path, step)
          expect(s.x).toBeCloseTo(x, 6)
          expect(s.z).toBeCloseTo(z, 6)
        }
      }
    }
    expect(walkers).toBeGreaterThan(5)
  })

  it('locates the sim position on the route, choosing the pass nearest the formula', () => {
    const r = emptyRoute()
    setRoute(r, { waypoints: [[0, 0], [2, 0], [2, 1], [1, 1], [1, 0]], startStep: 0, speed: 0.5 })
    expect(locateOnRoute(r, 1.5, 0, 1.5)).toBeCloseTo(1.5)
    // (1, 0) is passed at 1 m and again at the end (5 m)
    expect(locateOnRoute(r, 1, 0, 4.9)).toBeCloseTo(5)
    expect(locateOnRoute(r, 1, 0, 1.1)).toBeCloseTo(1)
    expect(locateOnRoute(r, 5, 5, 0)).toBe(-1)
  })
})

describe('facing', () => {
  it('follows the direction of travel', () => {
    expect(headingOf(0, 1)).toBeCloseTo(0)
    expect(headingOf(1, 0)).toBeCloseTo(Math.PI / 2)
    expect(headingOf(-1, 0)).toBeCloseTo(-Math.PI / 2)
    const r = route()
    const s = emptySample()
    sampleRoute(r, 1, s)
    expect(s.heading).toBeCloseTo(Math.PI / 2)
    sampleRoute(r, 2.9, s)
    expect(s.heading).toBeCloseTo(0)
  })

  it('turns over a short distance after a corner instead of snapping', () => {
    const r = route()
    const s = emptySample()
    sampleRoute(r, 2 + TURN_DISTANCE / 2, s)
    expect(s.heading).toBeCloseTo(Math.PI / 4)
  })

  it('turns the short way round', () => {
    expect(lerpAngle(Math.PI - 0.1, -Math.PI + 0.1, 0.5)).toBeCloseTo(Math.PI)
    expect(lerpAngle(0, 1, 2)).toBe(1)
    expect(lerpAngle(0, 1, -1)).toBe(0)
  })
})

describe('the display step', () => {
  it('shows the first step at once, then runs to each new step and stops there', () => {
    const c = createDisplayClock()
    retarget(c, 100, 0, 100)
    expect(displayStep(c, 0)).toBe(100)
    retarget(c, 101, 1000, 100)
    expect(displayStep(c, 1000)).toBe(100)
    const mid = displayStep(c, 1050)
    expect(mid).toBeGreaterThan(100)
    expect(mid).toBeLessThan(101)
    expect(displayStep(c, 1000 + 100 * CATCH_UP)).toBe(101)
    // the clock is held: no new step, nobody moves
    expect(displayStep(c, 60_000)).toBe(101)
  })

  it('is never ahead of the sim and never goes back', () => {
    const c = createDisplayClock()
    let sim = 0
    let shown = 0
    retarget(c, sim, 0, 100)
    // 10 Hz steps, a frame every 16.7 ms, uneven arrival
    for (let t = 0; t < 5000; t += 16.7) {
      if (Math.floor(t / 100) > sim) {
        sim = Math.floor(t / 100)
        retarget(c, sim, t, 100)
      }
      const d = displayStep(c, t)
      expect(d).toBeLessThanOrEqual(sim)
      expect(d).toBeGreaterThanOrEqual(shown)
      shown = d
    }
    // it keeps up: within two steps of the sim
    expect(sim - shown).toBeLessThan(2)
  })

  it('jumps instead of animating a long skip or a step back', () => {
    const c = createDisplayClock()
    retarget(c, 10, 0, 100)
    retarget(c, 10 + MAX_ANIMATED_STEPS + 1, 200, 100)
    expect(displayStep(c, 200)).toBe(10 + MAX_ANIMATED_STEPS + 1)
    retarget(c, 5, 400, 100)
    expect(displayStep(c, 400)).toBe(5)
  })
})

describe('a walk on screen', () => {
  it('moves on every frame between steps, never past the sim position', () => {
    const walk = createWalk()
    const c = createDisplayClock()
    const out = emptyWalkSample()
    const r = route()
    const s = emptySample()
    const seen = new Set<string>()
    let steps = 0
    let lastDistance = -1
    for (let t = 0, step = 10; ; t += 16.7) {
      const due = Math.min(22, 10 + Math.floor(t / 100))
      if (due > step || t === 0) {
        step = due
        steps++
        sampleRoute(r, distanceAtStep(r, step), s)
        retarget(c, step, t, 100)
        updateWalk(walk, s.x, s.z, step < arrivalStep(r) ? path : null, step, displayStep(c, t))
      }
      const shown = displayStep(c, t)
      sampleWalk(walk, shown, out)
      seen.add(`${out.x.toFixed(4)},${out.z.toFixed(4)}`)
      if (out.moving) {
        expect(out.distance).toBeGreaterThanOrEqual(lastDistance)
        expect(out.distance).toBeLessThanOrEqual(distanceAtStep(r, step) + 1e-9)
        lastDistance = out.distance
      }
      if (step >= 22 && shown >= 22) break
    }
    expect(seen.size).toBeGreaterThan(steps * 2)
    // the walk ends where the sim's ends
    expect([out.x, out.z]).toEqual([2, 1])
    expect(out.moving).toBe(false)
  })

  it('finishes the previous walk on screen before the next one starts', () => {
    const walk = createWalk()
    const out = emptyWalkSample()
    updateWalk(walk, 0, 0, path, 10, 10)
    // sim at step 22: the walk is over and a new one starts from its end
    const next: PathRender = { waypoints: [[2, 1], [2, 3]], startStep: 22, speed: 0.25 }
    updateWalk(walk, 2, 1, next, 22, 20.5)
    sampleWalk(walk, 20.5, out)
    expect(out.moving).toBe(true)
    expect(out.x).toBeCloseTo(2)
    expect(out.z).toBeCloseTo(0.625)
    // never ahead of the sim: it reported step 22, the start of the new walk
    sampleWalk(walk, 22, out)
    expect(out.z).toBeCloseTo(1)
    updateWalk(walk, 2, 1.5, next, 24, 22)
    sampleWalk(walk, 23, out)
    expect(out.z).toBeCloseTo(1.25)
  })

  it('holds a seated person exactly where the sim has them', () => {
    const walk = createWalk()
    const out = emptyWalkSample()
    updateWalk(walk, 4, 2.25, null, 500, 500)
    sampleWalk(walk, 499.3, out)
    expect([out.x, out.z, out.moving]).toEqual([4, 2.25, false])
  })
})
