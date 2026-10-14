import { describe, expect, it } from 'vitest'
import { pageScore, visualSimilarity, type Raster } from './visual'

/** A raster filled by `f(x, y) → [r, g, b]`. */
function raster(width: number, height: number, f: (x: number, y: number) => [number, number, number]): Raster {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = f(x, y)
      const i = (y * width + x) * 4
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = 255
    }
  }
  return { width, height, data }
}

const PAPER: [number, number, number] = [243, 239, 231]
const INK: [number, number, number] = [15, 30, 46]
/** A page: paper with a dark band (a heading) at `top`. */
const page = (h: number, top: number, band: [number, number, number] = INK) =>
  raster(64, h, (_x, y) => (y >= top && y < top + 8 ? band : PAPER))

describe('visualSimilarity (FEAT-115)', () => {
  it('scores the same page 1000', () => {
    const s = visualSimilarity(page(128, 20), page(128, 20))
    expect(s.similarity).toBe(1000)
    expect(s.coverage).toBe(1000)
    expect(s.cells).toBe(16 * 32)
  })

  it('scores a moved heading lower, and names where', () => {
    const s = visualSimilarity(page(128, 20), page(128, 60))
    expect(s.similarity).toBeLessThan(1000)
    expect(s.similarity).toBeGreaterThan(800)
    // the worst cell is on one of the two headings
    const y = s.worst[0].y
    expect((y >= 16 && y < 28) || (y >= 56 && y < 68)).toBe(true)
  })

  it('scores another colour lower than the same structure', () => {
    const recoloured = visualSimilarity(page(128, 20), page(128, 20, [181, 72, 47]))
    const blank = visualSimilarity(page(128, 20), raster(64, 128, () => PAPER))
    expect(recoloured.structure).toBeGreaterThan(blank.structure)
    expect(recoloured.colour).toBeLessThan(1000)
  })

  it('counts length that was not compared against the page', () => {
    const short = visualSimilarity(page(128, 20), page(256, 20))
    expect(short.coverage).toBe(500)
    expect(short.similarity).toBeLessThanOrEqual(900)
  })

  it('is deterministic and handles empty rasters', () => {
    const a = visualSimilarity(page(100, 10), page(100, 30), { cols: 8, worst: 3 })
    expect(visualSimilarity(page(100, 10), page(100, 30), { cols: 8, worst: 3 })).toEqual(a)
    expect(a.worst).toHaveLength(3)
    expect(visualSimilarity(raster(64, 0, () => PAPER), page(64, 0)).similarity).toBe(0)
  })
})

describe('pageScore (FEAT-115)', () => {
  it('weights regions by the design height and counts a missing region as 0', () => {
    expect(pageScore([])).toBe(0)
    expect(pageScore([{ name: 'a', weight: 100, similarity: 900, found: true }])).toBe(900)
    expect(
      pageScore([
        { name: 'hero', weight: 300, similarity: 800, found: true },
        { name: 'list', weight: 100, similarity: 400, found: true },
      ]),
    ).toBe(700)
    expect(
      pageScore([
        { name: 'hero', weight: 100, similarity: 1000, found: true },
        { name: 'gone', weight: 100, similarity: 950, found: false },
      ]),
    ).toBe(500)
  })
})
