// The floor layer as one painted plane (FEAT-081, ADR-0085): tiles land on
// their texels with a darker seam on their east and south edges; the image
// covers the tiles' rect at PX_PER_STUD texels per stud.
import { describe, expect, it } from 'vitest'
import { mergeBoxes } from './chunk'
import { paintFloor, paintStud, PX_PER_STUD } from './floor'
import { STUD } from './placements'

const hex = (c: string) => ({ red: '#ff0000', blue: '#0000ff' })[c] ?? '#000000'

describe('paintFloor', () => {
  it('paints each tile on its texels, seams darker, row 0 at the north edge', () => {
    // Two tiles side by side: red 2 × 1 studs at x 0..2, blue 1 × 1 at x 2..3, both z 0..1.
    const img = paintFloor(
      [
        { x0: 10, z0: 5, x1: 10 + 2 * STUD, z1: 5 + STUD, colour: 'red' },
        { x0: 10 + 2 * STUD, z0: 5, x1: 10 + 3 * STUD, z1: 5 + STUD, colour: 'blue' },
      ],
      hex,
    )!
    expect([img.width, img.height]).toEqual([3 * PX_PER_STUD, PX_PER_STUD])
    expect([img.x0, img.z0]).toEqual([10, 5])
    const at = (x: number, y: number) => [...img.pixels.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)]
    expect(at(0, 0)).toEqual([255, 0, 0, 255])
    // The red tile's east seam, then the blue tile.
    expect(at(2 * PX_PER_STUD - 1, 0)[0]).toBeLessThan(255)
    expect(at(2 * PX_PER_STUD, 0)).toEqual([0, 0, 255, 255])
    // The south seam.
    expect(at(0, PX_PER_STUD - 1)[0]).toBeLessThan(255)
  })

  it('has nothing to paint without tiles', () => {
    expect(paintFloor([], hex)).toBeNull()
  })
})

describe('mergeBoxes (the low tier’s level of detail)', () => {
  it('merges a wall course into one box and stacks equal courses', () => {
    // Two courses of three 4-stud bricks, the second staggered but covering the same span.
    const brick = (x: number, y: number, w = 0.25) => ({ x, y, z: 0, sx: w, sy: 0.075, sz: 0.0625 })
    const wall = [brick(0.125, 0), brick(0.375, 0), brick(0.625, 0), brick(0.0625, 0.075, 0.125), brick(0.25, 0.075), brick(0.5, 0.075), brick(0.6875, 0.075, 0.125)]
    const out = mergeBoxes(wall)
    expect(out).toHaveLength(1)
    expect(out[0].sx).toBeCloseTo(0.75, 6)
    expect(out[0].sy).toBeCloseTo(0.15, 6)
    expect(out[0].x).toBeCloseTo(0.375, 6)
    // Order does not matter.
    expect(mergeBoxes([...wall].reverse())).toEqual(out)
  })

  it('keeps apart what does not touch or differs in depth', () => {
    const a = { x: 0, y: 0, z: 0, sx: 1, sy: 1, sz: 1 }
    expect(mergeBoxes([a, { ...a, x: 1.5 }])).toHaveLength(2)
    expect(mergeBoxes([a, { ...a, x: 1, sz: 0.5 }])).toHaveLength(2)
  })
})

describe('paintStud (the baseplate under the office)', () => {
  it('draws a stud brighter than its plate, with a shadow to the south-east', () => {
    const size = 32
    const px = paintStud('#2a7a46', size)
    const g = (x: number, y: number) => px[(y * size + x) * 4 + 1]
    const plate = g(1, 1)
    expect(plate).toBe(0x7a)
    expect(g(16, 16)).toBeGreaterThan(plate)
    // Just past the stud's rim to the south-east: the shadow.
    expect(g(16 + 11, 16 + 3)).toBeLessThan(plate)
  })
})
