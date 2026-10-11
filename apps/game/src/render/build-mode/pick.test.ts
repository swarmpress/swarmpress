// Build mode's picking math (ADR-0087), pure: the ray onto a plane, the stud grid, which item
// wins under the pointer, the highlight's bars and the sim's kind names.
import { describe, expect, it } from 'vitest'
import { STUD } from '../bricks/placements'
import { frameBars, inRect, itemUnder, kebabKind, rayToPlane, snapStud, type PickItem } from './pick'

describe('build picking', () => {
  it('meets the floor where the ray crosses it, and nowhere for a level or receding ray', () => {
    // An iso-like ray: down and forward.
    expect(rayToPlane([2, 10, 3], [1, -2, 0.5], 0)).toEqual({ x: 7, z: 5.5 })
    expect(rayToPlane([2, 10, 3], [1, -2, 0.5], 2)).toEqual({ x: 6, z: 5 })
    expect(rayToPlane([0, 10, 0], [1, 0, 0], 0)).toBeNull()
    expect(rayToPlane([0, 10, 0], [0, 1, 0], 0)).toBeNull()
  })

  it('snaps to whole studs (1/16 m)', () => {
    expect(STUD).toBe(1 / 16)
    expect(snapStud(1.03)).toBe(1.0)
    expect(snapStud(1.04)).toBe(1.0625)
    expect(snapStud(-0.01)).toBe(0)
    expect(Object.is(snapStud(-0.01), 0)).toBe(true)
    for (const v of [0.3, 7.77, -2.49]) expect(Number.isInteger(snapStud(v) * 16)).toBe(true)
  })

  it('takes an item on a desk over the desk, a floor item over a ceiling light, the smaller of two', () => {
    const down = [0, -1, 0] as const
    const items: PickItem[] = [
      { id: 'desk', rect: { x: 0, z: 0, w: 2, d: 1 }, y: 0, rank: 1 },
      { id: 'monitor', rect: { x: 0.5, z: 0.2, w: 0.5, d: 0.2 }, y: 0.75, rank: 0 },
      { id: 'light', rect: { x: 0, z: 0, w: 3, d: 3 }, y: 2.9, rank: 2 },
      { id: 'plant', rect: { x: 1.5, z: 0.5, w: 0.5, d: 0.5 }, y: 0, rank: 1 },
    ]
    expect(itemUnder(items, [0.6, 5, 0.3], down)?.id).toBe('monitor')
    expect(itemUnder(items, [0.2, 5, 0.8], down)?.id).toBe('desk')
    expect(itemUnder(items, [1.7, 5, 0.7], down)?.id).toBe('plant')
    expect(itemUnder(items, [2.5, 5, 2.5], down)?.id).toBe('light')
    expect(itemUnder(items, [9, 5, 9], down)).toBeNull()
    // A slanted ray is tested at each item's own height.
    const slant = [1, -1, 0] as const
    expect(itemUnder([{ id: 'up', rect: { x: 4, z: 0, w: 1, d: 1 }, y: 1, rank: 0 }], [0, 5, 0.5], slant)?.id).toBe('up')
  })

  it('frames a rect with four bars just outside it', () => {
    const r = { x: 1, z: 2, w: 3, d: 4 }
    const bars = frameBars(r, 0.1)
    expect(bars).toHaveLength(4)
    for (const b of bars) {
      // None covers the rect's inside.
      expect(inRect(b, r.x + r.w / 2, r.z + r.d / 2)).toBe(false)
    }
    const xs = bars.flatMap((b) => [b.x, b.x + b.w])
    expect(Math.min(...xs)).toBeCloseTo(0.9)
    expect(Math.max(...xs)).toBeCloseTo(4.1)
  })

  it('names the sim kinds as the layout does', () => {
    expect(kebabKind('Desk')).toBe('desk')
    expect(kebabKind('DeskLamp')).toBe('desk-lamp')
    expect(kebabKind('MoodBoardWall')).toBe('mood-board-wall')
    expect(kebabKind('color-monitor')).toBe('color-monitor')
  })
})
