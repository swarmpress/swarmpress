/**
 * The design editor's use of the construction kit (`crates/kit-wasm`,
 * ADR-0065): the shipped designs to start from, a live compile of the edited
 * design (issues, summary, hash, the merged bricks), and the import of any
 * design into editable cells by compiling it and reading its bricks back.
 *
 * The kit is the page's lazily loaded module (`render/bricks/kit.loadKit`);
 * tests hand in the real module with `setDesignKit`.
 */
import type { KitApi } from '../../render/bricks/kit'
import { emptyDesign, writeRegions, type EditorDesign, type Material, type PartPlacement, type Port } from './design-model'

/** The kit's facade as the editor uses it: the renderer's subset plus the shipped designs and the hash. */
export type EditorKit = KitApi & {
  designsJson(): string
  hashDesign(designJson: string): string
}

let injected: EditorKit | null = null

/** Use this kit instead of loading the page's module (tests, tools). */
export function setDesignKit(kit: EditorKit | null) {
  injected = kit
}

export async function getDesignKit(): Promise<EditorKit> {
  if (injected) return injected
  // Imported on use, so the editor's module never pulls the wasm alias in by itself (tests, other pages).
  const { loadKit } = await import('../../render/bricks/kit')
  return (await loadKit()) as EditorKit
}

/** A part of the kit's catalogue as `catalogueJson()` lists it. */
export interface CataloguePart {
  id: string
  kind: 'brick' | 'plate' | 'tile' | 'special' | string
  size: [number, number, number]
  colours: string[]
  cost: number
}

export interface KitCatalogue {
  parts: CataloguePart[]
  palette: Array<{ id: string; name: string; hex: string; class: string }>
}

const catalogues = new WeakMap<object, KitCatalogue>()

export function catalogueOf(kit: EditorKit): KitCatalogue {
  let c = catalogues.get(kit)
  if (!c) {
    c = JSON.parse(kit.catalogueJson()) as KitCatalogue
    catalogues.set(kit, c)
  }
  return c
}

export function partSize(kit: EditorKit, id: string): [number, number, number] | null {
  return catalogueOf(kit).parts.find((p) => p.id === id)?.size ?? null
}

/** A shipped design as the picker lists it. */
export interface ShippedDesign {
  id: string
  name: string
  tags: string[]
}

export function shippedDesigns(kit: EditorKit): ShippedDesign[] {
  const list = JSON.parse(kit.designsJson()) as Array<{ id: string; name: string; tags?: string[] }>
  return list.map((d) => ({ id: d.id, name: d.name, tags: d.tags ?? [] }))
}

/** One compiled brick, back in grid units: min corner `[x, z, y]`, its footprint after its turn. */
export interface BrickBox {
  at: [number, number, number]
  size: [number, number, number]
  colour: string
  template: string
  part: string
  kind: string
  turn: number
  /** Build order. */
  seq: number
}

export interface KitIssue {
  code: string
  design: string
  op: number[]
  message: string
}

/** What the compiler's summary says a design provides (`crates/kit` §12.4). */
export interface KitSummary {
  design: string
  hash: string
  mount: string
  footprint: [number, number]
  height: number
  tags: string[]
  capabilities: string[]
  seats: number
  workstation: boolean
  /** A workstation's seat port from the footprint centre, mm `[x, z]`, unturned (ADR-0088); null otherwise; absent from older kits. */
  seat_at?: [number, number] | null
  work_surface: number
  lights: number
  storage: number
  screens: number
  doors: number
  windows: number
  surfaces: string[]
  ports: unknown[]
  parts: number
  studs: number
  cost: number
}

export interface CompileResult {
  ok: boolean
  issues: KitIssue[]
  summary: KitSummary | null
  /** The design's content hash (empty when the JSON itself is refused). */
  hash: string
  bricks: BrickBox[]
  /** Surfaces by the build order of the part that carries them. */
  surfaces: Map<number, string>
  ports: Port[]
  bounds: [number, number, number] | null
  mount: string | null
}

const STUD_M = 0.0625
const PLATE_M = 0.025

/** Compile a design JSON (string or object) and read everything the editor shows. */
export function compileDesign(kit: EditorKit, design: unknown, params = ''): CompileResult {
  const json = typeof design === 'string' ? design : JSON.stringify(design)
  const build = kit.compile(json, params)
  try {
    return readBuild(kit, build, () => {
      try {
        return kit.hashDesign(json)
      } catch {
        return ''
      }
    })
  } finally {
    build.free()
  }
}

/** Compile a shipped design by id with its defaults. */
export function compileShipped(kit: EditorKit, id: string): CompileResult {
  const build = kit.compileShipped(id, '')
  try {
    return readBuild(kit, build, () => build.hash())
  } finally {
    build.free()
  }
}

function readBuild(kit: EditorKit, build: ReturnType<EditorKit['compile']>, hash: () => string): CompileResult {
  const parts = catalogueOf(kit).parts
  const ok = build.ok()
  const issues = JSON.parse(build.issuesJson()) as KitIssue[]
  const summary = JSON.parse(build.summaryJson()) as KitSummary | null
  const bricks: BrickBox[] = []
  for (let g = 0; g < build.groupCount(); g++) {
    const colour = build.groupColour(g)
    const template = build.groupTemplate(g)
    const t = build.groupTransforms(g)
    const m = build.groupMeta(g)
    for (let i = 0; i * 7 < t.length; i++) {
      const [cx, cy, cz, sx, sy, sz, turn] = t.subarray(i * 7, i * 7 + 7)
      const [fx, fz] = turn % 2 ? [sz, sx] : [sx, sz]
      const w = Math.round(fx / STUD_M)
      const d = Math.round(fz / STUD_M)
      const h = Math.round(sy / PLATE_M)
      const def = parts[m[i * 3 + 2]]
      bricks.push({
        at: [Math.round(cx / STUD_M - w / 2), Math.round(cz / STUD_M - d / 2), Math.round(cy / PLATE_M - h / 2)],
        size: [w, d, h],
        colour,
        template,
        part: def?.id ?? '',
        kind: def?.kind ?? 'special',
        turn,
        seq: m[i * 3],
      })
    }
  }
  bricks.sort((a, b) => a.seq - b.seq)
  let info: { bounds?: [number, number, number]; mount?: string; ports?: Port[]; surfaces?: Array<{ name: string; seq: number }> } = {}
  try {
    info = (JSON.parse(build.infoJson()) as typeof info | null) ?? {}
  } catch {
    // no info for a refused design
  }
  return {
    ok,
    issues,
    summary,
    hash: hash(),
    bricks,
    surfaces: new Map((info.surfaces ?? []).map((s) => [s.seq, s.name])),
    ports: info.ports ?? [],
    bounds: info.bounds ?? null,
    mount: info.mount ?? null,
  }
}

/**
 * Any compiled design as editable cells: standard bricks, plates and tiles
 * become cells of their material; special parts stay whole with their turn,
 * colour and surface; ports come evaluated. Parameters take their defaults.
 */
export function importCompiled(kit: EditorKit, r: CompileResult, meta: { id: string; name: string; tags?: string[] }): EditorDesign | null {
  if (!r.ok || !r.bounds) return null
  const [w, d, h] = r.bounds
  const mount = (r.mount ?? 'floor') as EditorDesign['mount']
  let design = emptyDesign({ id: meta.id, name: meta.name, footprint: [w, d], height: h, mount })
  const specials: PartPlacement[] = []
  const byMaterial = new Map<string, Array<{ at: [number, number, number]; size: [number, number, number] }>>()
  for (const b of r.bricks) {
    if (b.kind === 'brick' || b.kind === 'plate' || b.kind === 'tile') {
      const k = `${b.kind}|${b.colour}`
      const list = byMaterial.get(k) ?? []
      list.push({ at: b.at, size: b.size })
      byMaterial.set(k, list)
    } else {
      const size = partSize(kit, b.part)
      if (!size) continue
      const surface = r.surfaces.get(b.seq)
      specials.push({ part: b.part, at: b.at, turn: b.turn, colour: b.colour, size, ...(surface ? { surface } : {}) })
    }
  }
  for (const [k, regions] of byMaterial) {
    const [m, c] = k.split('|')
    design = writeRegions(design, regions, { m: m as Material, c })
  }
  return { ...design, parts: specials, ports: r.ports.map((p) => ({ id: p.id, at: p.at, accepts: p.accepts, ...(p.turn ? { turn: p.turn } : {}) })), tags: meta.tags ?? [] }
}

/** The compiled brick that covers a cell, if any. */
export function brickAt(bricks: readonly BrickBox[], x: number, z: number, y: number): BrickBox | null {
  for (const b of bricks) {
    if (x >= b.at[0] && x < b.at[0] + b.size[0] && z >= b.at[1] && z < b.at[1] + b.size[1] && y >= b.at[2] && y < b.at[2] + b.size[2]) return b
  }
  return null
}
