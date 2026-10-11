// The design editor's model and its kit (ADR-0065 §6, ADR-0087 decision 7):
// edits produce the kit's design JSON, box fill and mirror, undo and redo, the
// compiler accepts an edited design and reports a floating brick, shipped
// designs import into cells and compile back to the same parts, and the
// library keeps only valid designs. The real kit is crates/kit-wasm/pkg
// (`cargo xtask wasm`); the tests that need it are skipped without it.
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { commit, historyOf, redo, undo } from '../studio/history'
import { brickAt, compileDesign, compileShipped, importCompiled, shippedDesigns, type EditorKit } from './design-kit'
import { localStorageLibrary, LIBRARY_KEY, type SavedDesign } from './design-library'
import {
  boxFill,
  brushById,
  copyRegion,
  dominantColour,
  emptyDesign,
  flip,
  freshId,
  fromDesignJson,
  key,
  mergeBoxes,
  paint,
  place,
  remove,
  stamp,
  toDesignJson,
  turnDesign,
  type EditorDesign,
} from './design-model'

const PKG = resolve(process.cwd(), '../../crates/kit-wasm/pkg') + '/'
const built = existsSync(`${PKG}kit_wasm.js`)
let kit: EditorKit
beforeAll(async () => {
  if (!built) return
  const mod = (await import(/* @vite-ignore */ pathToFileURL(`${PKG}kit_wasm.js`).href)) as EditorKit & { initSync(m: { module: BufferSource }): unknown }
  mod.initSync({ module: readFileSync(`${PKG}kit_wasm_bg.wasm`) })
  kit = mod
})

const blank = (w = 8, d = 8, h = 12): EditorDesign => emptyDesign({ id: 'my-test-0001', name: 'Test', footprint: [w, d], height: h })
const brick = (id: string) => brushById(id)

describe('editing ops', () => {
  it('place writes cells and the design JSON merges them into boxes', () => {
    let d = place(blank(), brick('brick-2x4'), 0, [0, 0, 0], 'red')
    expect(d.cells.size).toBe(2 * 4 * 3)
    d = place(d, brick('brick-2x4'), 0, [2, 0, 0], 'red')
    const j = toDesignJson(d, 'local')
    expect(j).toEqual({
      format: 'swarmpress.design.v1',
      id: 'my-test-0001',
      name: 'Test',
      footprint: [8, 8],
      height: 12,
      ops: [{ op: 'box', at: [0, 0, 0], size: [4, 4, 3], part: 'brick', colour: 'red' }],
      provenance: { kind: 'player', player: 'local' },
    })
  })

  it('turn swaps the brush footprint; out-of-bounds placement is refused', () => {
    const d = place(blank(), brick('plate-1x4'), 1, [0, 0, 0], 'blue')
    expect([...d.cells.keys()].sort()).toEqual([key(0, 0, 0), key(1, 0, 0), key(2, 0, 0), key(3, 0, 0)].sort())
    const same = place(d, brick('plate-1x4'), 1, [6, 0, 0], 'blue')
    expect(same).toBe(d)
  })

  it('remove and paint act on a region; a no-op returns the same value', () => {
    let d = place(blank(), brick('brick-2x2'), 0, [0, 0, 0], 'red')
    d = paint(d, { at: [0, 0, 0], size: [1, 2, 3] }, 'yellow')
    expect(mergeBoxes(d.cells)).toEqual([
      { op: 'box', at: [0, 0, 0], size: [1, 2, 3], part: 'brick', colour: 'yellow' },
      { op: 'box', at: [1, 0, 0], size: [1, 2, 3], part: 'brick', colour: 'red' },
    ])
    expect(paint(d, { at: [5, 5, 0], size: [1, 1, 1] }, 'blue')).toBe(d)
    d = remove(d, { at: [0, 0, 0], size: [2, 2, 3] })
    expect(d.cells.size).toBe(0)
  })

  it('box fill covers the dragged rectangle, the brush tall, in either drag direction', () => {
    const d = boxFill(blank(), [5, 3], [1, 0], 2, brick('plate-1x1'), 'sand')
    expect(mergeBoxes(d.cells)).toEqual([{ op: 'box', at: [1, 0, 2], size: [5, 4, 1], part: 'plate', colour: 'sand' }])
  })

  it('mirror symmetry writes the mirrored copy across the footprint centre', () => {
    const d = place(blank(10, 6), brick('brick-1x2'), 0, [1, 0, 0], 'black', { x: true, z: true })
    expect(mergeBoxes(d.cells)).toEqual([
      { op: 'box', at: [1, 0, 0], size: [1, 2, 3], part: 'brick', colour: 'black' },
      { op: 'box', at: [8, 0, 0], size: [1, 2, 3], part: 'brick', colour: 'black' },
      { op: 'box', at: [1, 4, 0], size: [1, 2, 3], part: 'brick', colour: 'black' },
      { op: 'box', at: [8, 4, 0], size: [1, 2, 3], part: 'brick', colour: 'black' },
    ])
  })

  it('flip and turn move cells, parts and ports', () => {
    let d = place(blank(6, 4), brick('plate-1x1'), 0, [0, 0, 0], 'red')
    d = { ...d, parts: [{ part: 'seat-4x4', at: [2, 0, 1], turn: 0, colour: 'red', size: [4, 4, 1] }], ports: [{ id: 'p', at: [1, 1, 0], accepts: ['seat'] }] }
    const f = flip(d, 'x')
    expect([...f.cells.keys()]).toEqual([key(5, 0, 0)])
    expect(f.parts[0].at).toEqual([0, 0, 1])
    expect(f.ports[0].at).toEqual([5, 1, 0])
    const t = turnDesign(d)
    expect(t.footprint).toEqual([4, 6])
    expect([...t.cells.keys()]).toEqual([key(3, 0, 0)])
    expect(t.parts[0]).toMatchObject({ at: [0, 2, 1], turn: 1 })
  })

  it('copy and stamp repeat a block of columns', () => {
    let d = place(blank(), brick('brick-1x2'), 0, [0, 0, 0], 'green')
    const clip = copyRegion(d, [0, 0], [0, 1], 0)
    expect(clip.size).toEqual([1, 2, 3])
    d = stamp(d, clip, [4, 4, 0])
    expect(mergeBoxes(d.cells)).toHaveLength(2)
  })

  it('undo and redo step through edits; a new edit drops the redo branch', () => {
    let h = historyOf(blank())
    h = commit(h, place(h.present, brick('brick-1x1'), 0, [0, 0, 0], 'red'))
    h = commit(h, place(h.present, brick('brick-1x1'), 0, [1, 0, 0], 'red'))
    expect(h.present.cells.size).toBe(6)
    h = undo(h)
    expect(h.present.cells.size).toBe(3)
    h = undo(h)
    expect(h.present.cells.size).toBe(0)
    h = redo(h)
    expect(h.present.cells.size).toBe(3)
    h = commit(h, place(h.present, brick('plate-1x1'), 0, [5, 5, 0], 'blue'))
    expect(h.future).toEqual([])
    expect(redo(h)).toBe(h)
  })

  it('the design JSON reads back into the same cells', () => {
    let d = place(blank(), brick('brick-2x3'), 0, [1, 1, 0], 'red')
    d = boxFill(d, [0, 0], [7, 7], 3, brick('tile-1x1'), 'sand')
    d = { ...d, parts: [{ part: 'round-brick-1x1', at: [0, 0, 4], turn: 0, colour: 'brass', size: [1, 1, 3] }] }
    const back = fromDesignJson(toDesignJson(d, 'local'), (p) => (p === 'round-brick-1x1' ? [1, 1, 3] : null))!
    expect(back.cells).toEqual(d.cells)
    expect(back.parts).toEqual(d.parts)
    expect(fromDesignJson({ format: 'swarmpress.design.v1', ops: [], params: {} }, () => null)).toBeNull()
  })

  it('fresh ids match the kit id pattern; the dominant colour is the colour of most cells', () => {
    const id = freshId('My Lovely Desk!!', () => 0.5)
    expect(id).toBe('my-my-lovely-desk-8000')
    expect(id).toMatch(/^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/)
    let d = place(blank(), brick('brick-2x2'), 0, [0, 0, 0], 'red')
    d = place(d, brick('plate-1x1'), 0, [4, 4, 0], 'blue')
    expect(dominantColour(d)).toBe('red')
  })
})

describe.skipIf(!built)('with the kit (kit-wasm)', () => {
  it('compiles an edited design: merged bricks, summary, hash', () => {
    let d = place(blank(), brick('brick-2x4'), 0, [0, 0, 0], 'red')
    d = place(d, brick('brick-2x4'), 0, [2, 0, 0], 'red')
    d = place(d, brick('plate-2x2'), 0, [1, 1, 3], 'yellow')
    const r = compileDesign(kit, toDesignJson(d, 'local'))
    expect(r.issues).toEqual([])
    expect(r.ok).toBe(true)
    expect(r.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(r.summary?.parts).toBe(r.bricks.length)
    // 4 × 4 × 3 of brick material merges into two 2 × 4 bricks, not 16 1 × 1s.
    expect(r.bricks.filter((b) => b.colour === 'red').length).toBeLessThanOrEqual(2)
    expect(brickAt(r.bricks, 1, 1, 3)?.colour).toBe('yellow')
  })

  it('reports a floating brick', () => {
    let d = place(blank(), brick('brick-2x2'), 0, [0, 0, 0], 'red')
    d = place(d, brick('brick-1x1'), 0, [5, 5, 6], 'blue')
    const r = compileDesign(kit, toDesignJson(d, 'local'))
    expect(r.ok).toBe(false)
    expect(r.issues.map((i) => i.code)).toContain('floating')
  })

  it('lists the shipped designs and imports each into cells that compile to the same bricks and capabilities', () => {
    const list = shippedDesigns(kit)
    expect(list.map((d) => d.id)).toContain('desk')
    for (const s of list) {
      const orig = compileShipped(kit, s.id)
      const d = importCompiled(kit, orig, { id: freshId(s.id), name: s.name, tags: s.tags })!
      expect(d, s.id).not.toBeNull()
      const again = compileDesign(kit, toDesignJson(d, 'local'))
      expect(again.issues, s.id).toEqual([])
      // The same bricks; the splitter may cut a few differently once the objects are one.
      expect(Math.abs(again.summary!.parts - orig.summary!.parts), s.id).toBeLessThanOrEqual(Math.ceil(orig.summary!.parts * 0.02))
      expect(again.summary?.capabilities, s.id).toEqual(orig.summary?.capabilities)
    }
  })

  it('the library saves only what the kit compiles, renames with a new hash, deletes', () => {
    const store = new Map<string, string>()
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) }
    const lib = localStorageLibrary(undefined, storage)
    const d = place(blank(), brick('brick-2x2'), 0, [0, 0, 0], 'red')
    const json = toDesignJson(d, 'local')
    const r = compileDesign(kit, json)
    const entry: SavedDesign = { id: d.id, name: d.name, hash: r.hash, parts: r.summary!.parts, colour: dominantColour(d)!, design: json }
    lib.save(entry, r)
    expect(JSON.parse(store.get(LIBRARY_KEY)!)).toHaveLength(1)
    expect(lib.get(d.id)?.parts).toBe(1)
    const floating = compileDesign(kit, toDesignJson(place(d, brick('brick-1x1'), 0, [5, 5, 6], 'blue'), 'local'))
    expect(() => lib.save({ ...entry, id: 'my-other-0002' }, floating)).toThrow()
    lib.rename(d.id, 'Red cube', (j) => kit.hashDesign(JSON.stringify(j)))
    expect(lib.get(d.id)?.name).toBe('Red cube')
    expect(lib.get(d.id)?.hash).not.toBe(r.hash)
    expect(localStorageLibrary(undefined, storage).list().map((s) => s.name)).toEqual(['Red cube'])
    lib.delete(d.id)
    expect(lib.list()).toEqual([])
  })
})
