/**
 * The visual comparison of a design's page and the page its theme renders (ADR-0093, FEAT-115):
 * a pure function of two RGBA rasters, scored in permille. The harness that screenshots both
 * pages (`apps/game/e2e/theme-visual.mts`) hands it the screenshots scaled to the same width;
 * nothing here knows about browsers, WordPress or the sim, and nothing enters the sim (rule 2).
 *
 * Both rasters are cut into a grid of cells as wide as the narrower one allows (`cols` across,
 * square cells), over the height both have. Per cell:
 * - **colour**: the mean colour's distance (RGB, 0–441) as permille of agreement;
 * - **structure**: the mean edge strength (the luminance gradient) compared, so a heading where
 *   the design has a heading counts even in another colour.
 * The page's score is the cells' mean (colour 60%, structure 40%), less a length term: a page
 * twice as long as its design keeps at most 80% (the rest is not compared, and it is a
 * difference). The worst cells are named in pixels of the first raster: where a repair turn
 * would look first.
 */

export interface Raster {
  width: number
  height: number
  /** RGBA, row-major, `width * height * 4` bytes. */
  data: Uint8Array | Uint8ClampedArray
}

export interface Region {
  x: number
  y: number
  width: number
  height: number
  /** The cell's score, permille. */
  score: number
}

export interface VisualScore {
  /** 0–1000: 1000 is the same picture. */
  similarity: number
  colour: number
  structure: number
  /** The compared height over the longer page's, permille. */
  coverage: number
  cells: number
  /** The worst cells, worst first. */
  worst: Region[]
}

export interface VisualOptions {
  /** Cells across (default 16). */
  cols?: number
  /** Worst cells reported (default 5). */
  worst?: number
}

const lum = (d: Raster['data'], i: number) => (299 * d[i] + 587 * d[i + 1] + 114 * d[i + 2]) / 1000

interface Cell {
  r: number
  g: number
  b: number
  edge: number
}

function cells(img: Raster, cell: number, cols: number, rows: number): Cell[] {
  const out: Cell[] = []
  const { width, data } = img
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      let r = 0
      let g = 0
      let b = 0
      let edge = 0
      let n = 0
      for (let y = cy * cell; y < (cy + 1) * cell; y++) {
        for (let x = cx * cell; x < (cx + 1) * cell; x++) {
          const i = (y * width + x) * 4
          r += data[i]
          g += data[i + 1]
          b += data[i + 2]
          const right = x + 1 < width ? Math.abs(lum(data, i) - lum(data, i + 4)) : 0
          const down = y + 1 < img.height ? Math.abs(lum(data, i) - lum(data, i + width * 4)) : 0
          edge += right + down
          n++
        }
      }
      out.push({ r: r / n, g: g / n, b: b / n, edge: edge / n })
    }
  }
  return out
}

/** How alike two rasters are (module docs). Rasters of different widths compare over the narrower. */
export function visualSimilarity(a: Raster, b: Raster, opts: VisualOptions = {}): VisualScore {
  const cols = Math.max(1, Math.floor(opts.cols ?? 16))
  const width = Math.min(a.width, b.width)
  const cell = Math.max(1, Math.floor(width / cols))
  const height = Math.min(a.height, b.height)
  const rows = Math.floor(height / cell)
  const longer = Math.max(a.height, b.height)
  const coverage = longer === 0 ? 0 : Math.round((1000 * rows * cell) / longer)
  if (rows === 0) return { similarity: 0, colour: 0, structure: 0, coverage, cells: 0, worst: [] }
  const ca = cells(a, cell, cols, rows)
  const cb = cells(b, cell, cols, rows)
  let colour = 0
  let structure = 0
  const scored: Region[] = []
  for (let i = 0; i < ca.length; i++) {
    const p = ca[i]
    const q = cb[i]
    const dist = Math.hypot(p.r - q.r, p.g - q.g, p.b - q.b) / 441.7
    const c = 1000 * (1 - Math.min(1, dist))
    const top = Math.max(p.edge, q.edge, 1)
    const s = 1000 * (1 - Math.abs(p.edge - q.edge) / top)
    colour += c
    structure += s
    scored.push({ x: (i % cols) * cell, y: Math.floor(i / cols) * cell, width: cell, height: cell, score: Math.round(0.6 * c + 0.4 * s) })
  }
  colour /= ca.length
  structure /= ca.length
  const compared = 0.6 * colour + 0.4 * structure
  // Length: what was not compared counts against the page, down to 80% for half the length.
  const lengthFactor = 0.8 + 0.2 * Math.min(1, coverage / 1000)
  const worst = scored
    .slice()
    .sort((x, y) => x.score - y.score || x.y - y.y || x.x - y.x)
    .slice(0, opts.worst ?? 5)
  return {
    similarity: Math.round(compared * (coverage >= 1000 ? 1 : lengthFactor)),
    colour: Math.round(colour),
    structure: Math.round(structure),
    coverage,
    cells: ca.length,
    worst,
  }
}
