// The generic town of sections (ADR-0086): houses in a row opposite the entrance, their fronts to
// the office, clear of the lot and of each other; the path between in whole metres; and the frames
// the shell's sections move the camera to.
import { describe, expect, it } from 'vitest'
import layoutJson from '../../state/fixtures/demo-layout.json'
import type { BuildingLayout, Side } from '../../state/render-state'
import { TOWN_HOUSES, townFrame, townPath, townSpots } from './town'

const layout = layoutJson as unknown as BuildingLayout
const overlaps = (a: { x: number; z: number; w: number; d: number }, b: { x: number; z: number; w: number; d: number }) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.z < b.z + b.d && b.z < a.z + a.d

describe('the town', () => {
  it('stands one house per section opposite the entrance, facing the office', () => {
    const spots = townSpots(layout)
    expect(spots.map((s) => s.id)).toEqual(TOWN_HOUSES.map((h) => h.id))
    // The demo's entrance is south: the row is north of the lot, fronts south (turn 0).
    for (const s of spots) {
      expect(s.turn).toBe(0)
      expect(s.rect.z + s.rect.d).toBeLessThanOrEqual(layout.originZ - 2)
    }
    const lot = { x: layout.originX, z: layout.originZ, w: layout.width, d: layout.depth }
    for (const [i, a] of spots.entries()) {
      expect(overlaps(a.rect, lot)).toBe(false)
      for (const b of spots.slice(i + 1)) expect(overlaps(a.rect, b.rect)).toBe(false)
    }
  })

  it('turns the row with the entrance', () => {
    const turns: Record<Side, number> = { south: 0, north: 2, east: 3, west: 1 }
    for (const side of ['south', 'north', 'east', 'west'] as Side[]) {
      const spots = townSpots({ ...layout, entrance: { ...layout.entrance, side } })
      expect(spots[0].turn, side).toBe(turns[side])
      const lot = { x: layout.originX, z: layout.originZ, w: layout.width, d: layout.depth }
      for (const s of spots) expect(overlaps(s.rect, lot), side).toBe(false)
    }
  })

  it('lays the path in whole metres between the row and the lot', () => {
    const p = townPath(layout)
    for (const v of [p.x, p.z, p.w, p.d]) expect(Number.isInteger(v)).toBe(true)
    expect(p.z + p.d).toBe(layout.originZ)
  })

  it('frames a house with its street, the office for Staff, and everything for the town', () => {
    const spots = townSpots(layout)
    const plan = townFrame(layout, spots, 'plan')
    expect(plan.w).toBe(spots[0].rect.w + 6)
    expect(townFrame(layout, spots, 'staff')).toMatchObject({ x: layout.originX, w: layout.width })
    const town = townFrame(layout, spots, 'town')
    expect(town.z).toBeLessThan(layout.originZ)
    expect(town.x + town.w).toBeGreaterThanOrEqual(layout.originX + layout.width)
  })
})
