import { describe, expect, it } from 'vitest'
import type { BuildingLayout } from '../state/render-state'
import { DEMO_BUILDING } from '../state/render-state'
import layoutJson from '../state/fixtures/demo-layout.json'
import { nameTurn, nameX, roomNameSpot, roomObstacles, tableSeats } from './room-names'
import { doorGaps, exteriorOpenings, facingIntoRoom, hallwayRects, interiorWalls, roomEdgesAlong, splitSpan } from './walls'

const layout = layoutJson as unknown as BuildingLayout

/** Does any interior wall run cover the point (x, z)? */
const walled = (x: number, z: number) =>
  interiorWalls(layout).some((w) => (w.axis === 'x' ? Math.abs(w.at - z) < 1e-6 && x > w.from && x < w.to : Math.abs(w.at - x) < 1e-6 && z > w.from && z < w.to))

describe('doors from the layout', () => {
  it("puts a gap at every door the sim declares and at the street entrance, and nowhere else", () => {
    const gaps = doorGaps(layout)
    const declared = layout.rooms.reduce((n, r) => n + r.doors.length, 0)
    expect(gaps).toHaveLength(declared + 1)
    for (const room of layout.rooms) {
      for (const d of room.doors) {
        const along = (d.side === 'north' || d.side === 'south' ? room.x : room.z) + d.at + d.width / 2
        const x = d.side === 'west' ? room.x : d.side === 'east' ? room.x + room.w : along
        const z = d.side === 'north' ? room.z : d.side === 'south' ? room.z + room.d : along
        expect(gaps.some((g) => g.room === room.id && Math.abs(g.x - x) < 1e-6 && Math.abs(g.z - z) < 1e-6), `${room.id} ${d.side}@${d.at}`).toBe(true)
        // the partition is open there…
        expect(walled(x, z), `${room.id} door at ${x},${z}`).toBe(false)
      }
    }
    const street = gaps.find((g) => g.room === null)!
    expect([street.x, street.z, street.exterior]).toEqual([layout.entrance.x, layout.entrance.z, true])
  })

  it('keeps the walls closed beside each door (no invented mid-edge gaps)', () => {
    const newsroom = layout.rooms.find((r) => r.kind === 'newsroom')!
    // the newsroom's only door is in its south side at 3..4 m
    expect(newsroom.doors).toEqual([{ side: 'south', at: 3, width: 1 }])
    expect(walled(newsroom.x + 3.5, newsroom.z + newsroom.d)).toBe(false)
    expect(walled(newsroom.x + 1, newsroom.z + newsroom.d)).toBe(true)
    expect(walled(newsroom.x + 6, newsroom.z + newsroom.d)).toBe(true)
    // its east side is shared with the editor's office, which has no door there: closed along its length
    expect(walled(newsroom.x + newsroom.w, newsroom.z + newsroom.d / 2)).toBe(true)
  })

  it('opens the exterior wall at the entrance, and keeps windows out of doorways', () => {
    const south = exteriorOpenings(layout).south
    const door = south.find((o) => o.kind === 'door')!
    expect((door.from + door.to) / 2).toBeCloseTo(layout.entrance.x - layout.originX)
    for (const o of south) if (o.kind === 'window') expect(o.to <= door.from || o.from >= door.to).toBe(true)
  })

  it('walls no side twice and none on the lot boundary', () => {
    const runs = interiorWalls(layout)
    for (const r of runs) {
      expect(r.at).toBeGreaterThan(r.axis === 'x' ? layout.originZ : layout.originX)
      expect(r.at).toBeLessThan(r.axis === 'x' ? layout.originZ + layout.depth : layout.originX + layout.width)
    }
    for (let i = 0; i < runs.length; i++)
      for (let j = i + 1; j < runs.length; j++) {
        const a = runs[i]
        const b = runs[j]
        if (a.axis === b.axis && Math.abs(a.at - b.at) < 1e-6) expect(a.to <= b.from || b.to <= a.from).toBe(true)
      }
  })

  it('reads the fixture layout of the hand-written demo too (doors in shared sides)', () => {
    const gaps = doorGaps(DEMO_BUILDING)
    expect(gaps.filter((g) => g.room === 'newsroom').map((g) => [g.x, g.z])).toEqual([
      [10, 2.5],
      [10, 7.5],
    ])
  })
})

describe('floors', () => {
  it('covers exactly the lot minus the rooms with hallway', () => {
    const hall = hallwayRects(layout)
    const area = hall.reduce((a, r) => a + r.w * r.d, 0)
    const rooms = layout.rooms.reduce((a, r) => a + r.w * r.d, 0)
    expect(area).toBeCloseTo(layout.width * layout.depth - rooms)
    for (const h of hall)
      for (const r of layout.rooms) expect(h.x >= r.x + r.w || h.x + h.w <= r.x || h.z >= r.z + r.d || h.z + h.d <= r.z, `${JSON.stringify(h)} vs ${r.id}`).toBe(true)
    // the corridor the staff walk along (z 6..8) is floored
    expect(hall.some((h) => h.z <= 6 && h.z + h.d >= 8 - 1 && h.w >= 10)).toBe(true)
    expect(hall.length).toBeLessThan(10)
  })
})

describe('wall pieces and props', () => {
  it('cuts runs at room edges', () => {
    expect(splitSpan(0, 10, [0, 4, 8, 12])).toEqual([
      [0, 4],
      [4, 8],
      [8, 10],
    ])
    expect(roomEdgesAlong(layout, 'x')).toContain(8)
  })

  it('turns props into the room, away from the nearest wall', () => {
    const meeting = layout.rooms.find((r) => r.kind === 'meeting-room')!
    const board = meeting.props.find((p) => p.kind === 'whiteboard')!
    expect(facingIntoRoom(meeting, board.x, board.z)).toBe(0) // on the north side: faces south
    const strategy = layout.rooms.find((r) => r.kind === 'strategy-room')!
    const board2 = strategy.props.find((p) => p.kind === 'whiteboard')!
    expect(facingIntoRoom(strategy, board2.x, board2.z)).toBe(Math.PI)
  })

  it('seats tables like the sim: around the centre, 0.4 m off the walls', () => {
    const kitchen = layout.rooms.find((r) => r.kind === 'kitchen')!
    const seats = tableSeats(kitchen)
    expect(seats).toHaveLength(Math.min(kitchen.capacity, 12))
    expect(seats[0]).toEqual([kitchen.x + kitchen.w / 2 - 1.2, kitchen.z + kitchen.d / 2])
    for (const [x, z] of tableSeats(layout.rooms.find((r) => r.kind === 'strategy-room')!)) expect(x).toBeGreaterThanOrEqual(12.4)
    expect(tableSeats(layout.rooms.find((r) => r.kind === 'newsroom')!)).toEqual([])
  })
})

describe('room names', () => {
  it('go on a free stretch of the far strip', () => {
    for (const room of layout.rooms) {
      for (const side of ['north', 'south'] as const) {
        const spot = roomNameSpot(room, side)
        expect(spot.from).toBeGreaterThanOrEqual(room.x)
        expect(spot.to).toBeLessThanOrEqual(room.x + room.w)
        for (const o of roomObstacles(room)) {
          if (o.z1 <= spot.z - 0.21 || o.z0 >= spot.z + 0.21) continue
          expect(o.x1 <= spot.from + 1e-9 || o.x0 >= spot.to - 1e-9, `${room.id} ${side}`).toBe(true)
        }
      }
    }
    const spot = roomNameSpot(layout.rooms[0], 'north')
    expect(nameX(spot, 1, -1)).toBeCloseTo(spot.from + 0.55)
    expect(nameX(spot, 1, 1)).toBeCloseTo(spot.to - 0.55)
  })

  it('read left to right for the camera', () => {
    expect(nameTurn(0.7, 0.4)).toBe(0)
    expect(nameTurn(-0.7, -0.4)).toBe(Math.PI)
  })
})
