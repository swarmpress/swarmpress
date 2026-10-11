/**
 * The design editor's model (ADR-0065 §6, ADR-0087 decision 7): a design as
 * cells of brick material on its stud grid, plus the catalogue's special
 * parts kept whole. The player edits cells; the kit's compiler merges them
 * into bricks (its splitter), so the editor never picks brick sizes itself.
 *
 * Coordinates are the kit's `[x, z, y]`: x east and z south in studs, y up in
 * plates. Every edit is a pure function returning a new model, so undo and
 * redo keep plain values (`studio/history`).
 */

/** The brick materials of `box` ops (`kit/schema/design.schema.json`). */
export type Material = 'brick' | 'plate' | 'tile'

export interface Cell {
  /** Material: bricks and plates (`brick`), plates only (`plate`), smooth (`tile`). */
  m: Material
  /** A palette id. */
  c: string
}

/** A catalogue part that is not brick material (a screen, a seat, a round brick), kept whole. */
export interface PartPlacement {
  part: string
  /** Min corner. */
  at: [number, number, number]
  turn: number
  colour: string
  /** `[w, d, h]` of the part at turn 0 (from the catalogue). */
  size: [number, number, number]
  surface?: string
}

export interface Port {
  id: string
  at: [number, number, number]
  accepts: string[]
  turn?: number
}

export type Mount = 'floor' | 'surface' | 'ceiling'

export interface EditorDesign {
  id: string
  name: string
  /** `[w, d]` studs. */
  footprint: [number, number]
  /** Plates. */
  height: number
  mount: Mount
  cells: ReadonlyMap<string, Cell>
  parts: readonly PartPlacement[]
  ports: readonly Port[]
  tags: readonly string[]
}

/** An axis-aligned region of cells: min corner and size, `[x, z, y]`. */
export interface Region {
  at: [number, number, number]
  size: [number, number, number]
}

export const key = (x: number, z: number, y: number) => `${x},${z},${y}`

export function unkey(k: string): [number, number, number] {
  const [x, z, y] = k.split(',').map(Number)
  return [x, z, y]
}

// ------------------------------------------------------------ brushes

/** A part the player places: a standard brick, plate or tile. */
export interface Brush {
  id: string
  material: Material
  /** Studs along x at turn 0. */
  w: number
  /** Studs along z at turn 0. */
  d: number
  /** Plates. */
  h: number
}

const SIZES: Array<[number, number]> = [[1, 1], [1, 2], [1, 3], [1, 4], [2, 2], [2, 3], [2, 4]]

/** The palette of parts: bricks, plates and tiles from 1 × 1 to 2 × 4 (all in the catalogue). */
export const BRUSHES: readonly Brush[] = (['brick', 'plate', 'tile'] as const).flatMap((m) =>
  SIZES.map(([w, d]) => ({ id: `${m}-${w}x${d}`, material: m, w, d, h: m === 'brick' ? 3 : 1 })),
)

export const brushById = (id: string) => BRUSHES.find((b) => b.id === id) ?? BRUSHES[0]

/** The brush's footprint `[fx, fz]` at a quarter turn (odd turns swap). */
export const brushFootprint = (b: Brush, turn: number): [number, number] => (turn % 2 ? [b.d, b.w] : [b.w, b.d])

/** The region a brush covers with its min corner at `[x, z, y]`. */
export function brushRegion(b: Brush, turn: number, x: number, z: number, y: number): Region {
  const [fx, fz] = brushFootprint(b, turn)
  return { at: [x, z, y], size: [fx, fz, b.h] }
}

// ------------------------------------------------------------ construction

export function emptyDesign(opts: { id: string; name: string; footprint: [number, number]; height: number; mount?: Mount }): EditorDesign {
  return { id: opts.id, name: opts.name, footprint: opts.footprint, height: opts.height, mount: opts.mount ?? 'floor', cells: new Map(), parts: [], ports: [], tags: [] }
}

/** A fresh id for a player's design (`[a-z0-9-]`, at most 64 characters). */
export function freshId(base: string, rand: () => number = Math.random): string {
  const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'design'
  const tag = Math.floor(rand() * 0x10000).toString(16).padStart(4, '0')
  return `my-${slug}-${tag}`
}

// ------------------------------------------------------------ queries

export function inBounds(d: EditorDesign, r: Region): boolean {
  const [x, z, y] = r.at
  const [w, dd, h] = r.size
  return x >= 0 && z >= 0 && y >= 0 && x + w <= d.footprint[0] && z + dd <= d.footprint[1] && y + h <= d.height
}

/** Clip a region to the design's bounds (null when nothing is left). */
export function clip(d: EditorDesign, r: Region): Region | null {
  const lo = r.at.map((v) => Math.max(0, v)) as [number, number, number]
  const max = [d.footprint[0], d.footprint[1], d.height]
  const hi = r.at.map((v, i) => Math.min(max[i], v + r.size[i]))
  if (hi.some((v, i) => v <= lo[i])) return null
  return { at: lo, size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]] }
}

/** The region a special part occupies (its footprint swaps at odd turns). */
export function partRegion(p: PartPlacement): Region {
  const [w, d, h] = p.size
  return { at: p.at, size: p.turn % 2 ? [d, w, h] : [w, d, h] }
}

const contains = (r: Region, x: number, z: number, y: number) =>
  x >= r.at[0] && x < r.at[0] + r.size[0] && z >= r.at[1] && z < r.at[1] + r.size[1] && y >= r.at[2] && y < r.at[2] + r.size[2]

const intersects = (a: Region, b: Region) => a.at.every((v, i) => v < b.at[i] + b.size[i] && b.at[i] < v + a.size[i])

/** The index of the special part occupying a cell, or -1. */
export const partAt = (d: EditorDesign, x: number, z: number, y: number) => d.parts.findIndex((p) => contains(partRegion(p), x, z, y))

function* cellsOf(r: Region): Generator<[number, number, number]> {
  for (let y = r.at[2]; y < r.at[2] + r.size[2]; y++) for (let z = r.at[1]; z < r.at[1] + r.size[1]; z++) for (let x = r.at[0]; x < r.at[0] + r.size[0]; x++) yield [x, z, y]
}

/** The regions an edit touches with mirror symmetry on (the kit's `mirror`: across the footprint's centre). */
export function mirrored(d: EditorDesign, r: Region, mirror: { x: boolean; z: boolean }): Region[] {
  const out: Region[] = [r]
  const flipX = (q: Region): Region => ({ at: [d.footprint[0] - q.at[0] - q.size[0], q.at[1], q.at[2]], size: q.size })
  const flipZ = (q: Region): Region => ({ at: [q.at[0], d.footprint[1] - q.at[1] - q.size[1], q.at[2]], size: q.size })
  if (mirror.x) out.push(flipX(r))
  if (mirror.z) for (const q of [...out]) out.push(flipZ(q))
  const seen = new Set<string>()
  return out.filter((q) => {
    const k = JSON.stringify(q)
    return seen.has(k) ? false : (seen.add(k), true)
  })
}

// ------------------------------------------------------------ edits

/** Write `cell` (or clear with null) in every region, clipped to the bounds; special parts are left alone. */
export function writeRegions(d: EditorDesign, regions: Region[], cell: Cell | null): EditorDesign {
  const cells = new Map(d.cells)
  let changed = false
  const partRegions = d.parts.map(partRegion)
  for (const raw of regions) {
    const r = clip(d, raw)
    if (!r) continue
    for (const [x, z, y] of cellsOf(r)) {
      if (partRegions.some((p) => contains(p, x, z, y))) continue
      const k = key(x, z, y)
      const old = cells.get(k)
      if (cell) {
        if (old?.m === cell.m && old.c === cell.c) continue
        cells.set(k, cell)
        changed = true
      } else if (old) {
        cells.delete(k)
        changed = true
      }
    }
  }
  return changed ? { ...d, cells } : d
}

/** Place a brush's part (overwrites brick material, as the kit's `box`). */
export function place(d: EditorDesign, brush: Brush, turn: number, at: [number, number, number], colour: string, mirror = { x: false, z: false }): EditorDesign {
  const r = brushRegion(brush, turn, ...at)
  if (!inBounds(d, r)) return d
  return writeRegions(d, mirrored(d, r, mirror), { m: brush.material, c: colour })
}

/** Box fill: the rectangle between two corner cells on layer `y`, the brush's height tall. */
export function boxFill(d: EditorDesign, a: [number, number], b: [number, number], y: number, brush: Brush, colour: string, mirror = { x: false, z: false }): EditorDesign {
  const r: Region = { at: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), y], size: [Math.abs(a[0] - b[0]) + 1, Math.abs(a[1] - b[1]) + 1, brush.h] }
  const c = clip(d, r)
  if (!c) return d
  return writeRegions(d, mirrored(d, c, mirror), { m: brush.material, c: colour })
}

/** Remove the cells of a region and any special part that touches it. */
export function remove(d: EditorDesign, r: Region, mirror = { x: false, z: false }): EditorDesign {
  const regions = mirrored(d, r, mirror)
  const parts = d.parts.filter((p) => !regions.some((q) => intersects(partRegion(p), q)))
  const next = writeRegions(parts.length === d.parts.length ? d : { ...d, parts }, regions, null)
  return next
}

/** Paint the existing cells and special parts in a region. */
export function paint(d: EditorDesign, r: Region, colour: string, mirror = { x: false, z: false }): EditorDesign {
  const regions = mirrored(d, r, mirror).map((q) => clip(d, q)).filter((q): q is Region => !!q)
  const cells = new Map(d.cells)
  let changed = false
  for (const q of regions) {
    for (const [x, z, y] of cellsOf(q)) {
      const k = key(x, z, y)
      const old = cells.get(k)
      if (old && old.c !== colour) {
        cells.set(k, { m: old.m, c: colour })
        changed = true
      }
    }
  }
  let parts = d.parts
  if (d.parts.some((p) => p.colour !== colour && regions.some((q) => intersects(partRegion(p), q)))) {
    parts = d.parts.map((p) => (p.colour !== colour && regions.some((q) => intersects(partRegion(p), q)) ? { ...p, colour } : p))
    changed = true
  }
  return changed ? { ...d, cells, parts } : d
}

/** Flip the whole design across its footprint's centre along x or z. */
export function flip(d: EditorDesign, axis: 'x' | 'z'): EditorDesign {
  const [W, D] = d.footprint
  const fx = (x: number, w: number) => (axis === 'x' ? W - x - w : x)
  const fz = (z: number, dd: number) => (axis === 'z' ? D - z - dd : z)
  const cells = new Map<string, Cell>()
  for (const [k, c] of d.cells) {
    const [x, z, y] = unkey(k)
    cells.set(key(fx(x, 1), fz(z, 1), y), c)
  }
  const parts = d.parts.map((p) => {
    const r = partRegion(p)
    // A mirror turns a part's front: across x, east ↔ west (turns 1 ↔ 3); across z, south ↔ north (0 ↔ 2).
    const turn = axis === 'x' ? (p.turn % 2 ? (p.turn + 2) % 4 : p.turn) : p.turn % 2 ? p.turn : (p.turn + 2) % 4
    return { ...p, at: [fx(r.at[0], r.size[0]), fz(r.at[1], r.size[1]), p.at[2]] as [number, number, number], turn }
  })
  const ports = d.ports.map((p) => ({ ...p, at: [axis === 'x' ? W - p.at[0] : p.at[0], axis === 'z' ? D - p.at[1] : p.at[1], p.at[2]] as [number, number, number] }))
  return { ...d, cells, parts, ports }
}

/** Turn the whole design a quarter turn clockwise seen from above (east goes south); the footprint swaps. */
export function turnDesign(d: EditorDesign): EditorDesign {
  const [, D] = d.footprint
  const cells = new Map<string, Cell>()
  for (const [k, c] of d.cells) {
    const [x, z, y] = unkey(k)
    cells.set(key(D - 1 - z, x, y), c)
  }
  const parts = d.parts.map((p) => {
    const r = partRegion(p)
    return { ...p, at: [D - r.at[1] - r.size[1], r.at[0], p.at[2]] as [number, number, number], turn: (p.turn + 1) % 4 }
  })
  const ports = d.ports.map((p) => ({ ...p, at: [D - p.at[1], p.at[0], p.at[2]] as [number, number, number], turn: ((p.turn ?? 0) + 1) % 4 }))
  return { ...d, footprint: [d.footprint[1], d.footprint[0]], cells, parts, ports }
}

/** Change the bounds; cells and parts that no longer fit are dropped. */
export function resize(d: EditorDesign, footprint: [number, number], height: number): EditorDesign {
  const bounds = { ...d, footprint, height }
  const cells = new Map([...d.cells].filter(([k]) => {
    const [x, z, y] = unkey(k)
    return x < footprint[0] && z < footprint[1] && y < height
  }))
  const parts = d.parts.filter((p) => inBounds(bounds, partRegion(p)))
  return { ...bounds, cells, parts }
}

export const rename = (d: EditorDesign, name: string): EditorDesign => (name === d.name ? d : { ...d, name })

// ------------------------------------------------------------ copy and stamp

/** A copied block of cells, relative to its min corner. */
export interface Clip {
  size: [number, number, number]
  cells: Array<[number, number, number, Cell]>
}

/** Copy the columns of a rectangle from layer `y` up. */
export function copyRegion(d: EditorDesign, a: [number, number], b: [number, number], y: number): Clip {
  const x0 = Math.min(a[0], b[0])
  const z0 = Math.min(a[1], b[1])
  const r: Region = { at: [x0, z0, y], size: [Math.abs(a[0] - b[0]) + 1, Math.abs(a[1] - b[1]) + 1, d.height - y] }
  const cells: Clip['cells'] = []
  let top = 0
  for (const [x, z, yy] of cellsOf(clip(d, r) ?? { at: [0, 0, 0], size: [0, 0, 0] })) {
    const c = d.cells.get(key(x, z, yy))
    if (c) {
      cells.push([x - x0, z - z0, yy - y, c])
      top = Math.max(top, yy - y + 1)
    }
  }
  return { size: [r.size[0], r.size[1], top], cells }
}

/** Stamp a clip with its min corner at `[x, z, y]` (cells outside the bounds are dropped). */
export function stamp(d: EditorDesign, c: Clip, at: [number, number, number]): EditorDesign {
  let next = d
  const groups = new Map<string, Region[]>()
  for (const [x, z, y, cell] of c.cells) {
    const k = `${cell.m}|${cell.c}`
    const list = groups.get(k) ?? []
    list.push({ at: [at[0] + x, at[1] + z, at[2] + y], size: [1, 1, 1] })
    groups.set(k, list)
  }
  for (const [k, regions] of groups) {
    const [m, col] = k.split('|')
    next = writeRegions(next, regions, { m: m as Material, c: col })
  }
  return next
}

// ------------------------------------------------------------ the design JSON

export type Num = number
export interface BoxOp {
  op: 'box'
  at: [Num, Num, Num]
  size: [Num, Num, Num]
  part: Material
  colour: string
}
export interface PartOp {
  op: 'part'
  part: string
  at: [Num, Num, Num]
  turn?: number
  colour: string
  surface?: string
}

export interface DesignJson {
  format: 'swarmpress.design.v1'
  id: string
  name: string
  mount?: Mount
  footprint: [number, number]
  height: number
  ops: Array<BoxOp | PartOp>
  ports?: Port[]
  tags?: string[]
  provenance: { kind: 'player'; player: string }
}

/**
 * Merge cells into boxes: greedy, deterministic (layers bottom up, rows north
 * to south, west to east), each box one material and colour. The kit's
 * splitter then cuts boxes into catalogue bricks.
 */
export function mergeBoxes(cells: ReadonlyMap<string, Cell>): BoxOp[] {
  const done = new Set<string>()
  const keys = [...cells.keys()].map(unkey).sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0])
  const same = (x: number, z: number, y: number, c: Cell) => {
    const k = key(x, z, y)
    const o = cells.get(k)
    return !done.has(k) && !!o && o.m === c.m && o.c === c.c
  }
  const out: BoxOp[] = []
  for (const [x, z, y] of keys) {
    if (done.has(key(x, z, y))) continue
    const c = cells.get(key(x, z, y))!
    let w = 1
    while (same(x + w, z, y, c)) w++
    let d = 1
    const row = (zz: number, yy: number) => {
      for (let i = 0; i < w; i++) if (!same(x + i, zz, yy, c)) return false
      return true
    }
    while (row(z + d, y)) d++
    let h = 1
    const plane = (yy: number) => {
      for (let j = 0; j < d; j++) if (!row(z + j, yy)) return false
      return true
    }
    while (plane(y + h)) h++
    for (let yy = y; yy < y + h; yy++) for (let zz = z; zz < z + d; zz++) for (let xx = x; xx < x + w; xx++) done.add(key(xx, zz, yy))
    out.push({ op: 'box', at: [x, z, y], size: [w, d, h], part: c.m, colour: c.c })
  }
  return out
}

/** The design as the kit's format (`swarmpress.design.v1`), a player's design. */
export function toDesignJson(d: EditorDesign, player: string): DesignJson {
  const ops: Array<BoxOp | PartOp> = mergeBoxes(d.cells)
  for (const p of d.parts) {
    const op: PartOp = { op: 'part', part: p.part, at: [...p.at], colour: p.colour }
    if (p.turn) op.turn = p.turn
    if (p.surface) op.surface = p.surface
    ops.push(op)
  }
  const out: DesignJson = { format: 'swarmpress.design.v1', id: d.id, name: d.name, footprint: [...d.footprint], height: d.height, ops, provenance: { kind: 'player', player } }
  if (d.mount !== 'floor') out.mount = d.mount
  if (d.ports.length) out.ports = d.ports.map((p) => ({ ...p, at: [...p.at] }))
  if (d.tags.length) out.tags = [...d.tags]
  return out
}

/**
 * Read a design the editor wrote back (constant `box`/`part` ops only). Returns
 * null for anything richer (parameters, `use`, `mirror`, expressions, discs):
 * those are read through the compiler instead (`design-kit.importCompiled`).
 */
export function fromDesignJson(j: unknown, sizeOf: (part: string) => [number, number, number] | null): EditorDesign | null {
  const o = j as Partial<DesignJson> & { params?: unknown }
  if (!o || o.format !== 'swarmpress.design.v1' || o.params || !Array.isArray(o.ops)) return null
  const ints = (a: unknown, n: number) => Array.isArray(a) && a.length === n && a.every((v) => Number.isInteger(v))
  if (!ints(o.footprint, 2) || !Number.isInteger(o.height) || typeof o.id !== 'string' || typeof o.name !== 'string') return null
  let d = emptyDesign({ id: o.id, name: o.name, footprint: o.footprint as [number, number], height: o.height as number, mount: o.mount })
  const parts: PartPlacement[] = []
  for (const op of o.ops as unknown as Array<Record<string, unknown>>) {
    if (op.op === 'box' && ints(op.at, 3) && ints(op.size, 3) && ['brick', 'plate', 'tile', 'empty'].includes(op.part as string) && !op.shape) {
      const colour = op.colour as string | undefined
      if (op.part !== 'empty' && (!colour || colour.startsWith('$'))) return null
      d = writeRegions(d, [{ at: op.at as Region['at'], size: op.size as Region['size'] }], op.part === 'empty' ? null : { m: op.part as Material, c: colour! })
    } else if (op.op === 'part' && ints(op.at, 3) && typeof op.colour === 'string' && !op.colour.startsWith('$') && (op.turn === undefined || Number.isInteger(op.turn))) {
      const size = sizeOf(op.part as string)
      if (!size) return null
      parts.push({ part: op.part as string, at: op.at as PartPlacement['at'], turn: (op.turn as number | undefined) ?? 0, colour: op.colour, size, ...(op.surface ? { surface: op.surface as string } : {}) })
    } else return null
  }
  const ports = (o.ports ?? []).filter((p) => ints(p.at, 3)).map((p) => ({ ...p }))
  return { ...d, parts, ports, tags: [...(o.tags ?? [])] }
}

/** The colour of most cells (the library's icon colour). */
export function dominantColour(d: EditorDesign): string | null {
  const n = new Map<string, number>()
  for (const c of d.cells.values()) n.set(c.c, (n.get(c.c) ?? 0) + 1)
  for (const p of d.parts) n.set(p.colour, (n.get(p.colour) ?? 0) + p.size[0] * p.size[1] * p.size[2])
  let best: string | null = null
  let most = 0
  for (const [c, k] of [...n].sort((a, b) => a[0].localeCompare(b[0]))) if (k > most) (best = c), (most = k)
  return best
}
