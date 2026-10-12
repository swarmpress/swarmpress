// @vitest-environment jsdom
// The company's designs on the offline source (K-4): the WasmDataSource keeps them in memory with
// localStorage as its cache (and takes in the earlier browser library), keyed by the kit's hash;
// `designOf` resolves a hash; changes are announced with the `designs` topic. The company library
// saves through the source, replaces a design's earlier version and retires on delete.
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { DataTopic } from '../data-source'
import { WasmDataSource, type SimOrgApi } from '../wasm-source'
import { acceptedHash, designColour, memoryDesignStore, STORE_KEY } from './company-designs'
import { setDesignKit, type EditorKit } from './design-kit'
import { companyLibrary, LIBRARY_KEY } from './design-library'
import type { DesignJson } from './design-model'

const design = (id: string, name: string, colour = 'red', at: [number, number, number] = [0, 0, 0]): DesignJson => ({
  format: 'swarmpress.design.v1',
  id,
  name,
  footprint: [4, 4],
  height: 3,
  ops: [{ op: 'box', at, size: [2, 2, 3], part: 'brick', colour }],
  provenance: { kind: 'player', player: 'local' },
})

const fakeSim = (): SimOrgApi => ({
  org_json: () => JSON.stringify({ ceo: { name: 'You' }, executive: {}, departments: [], staff: [], projects: [] }),
  finance_json: () => '{}',
  inbox_json: () => JSON.stringify({ tickets: [], secretaryQueue: [] }),
  apply_command_json: () => undefined,
  day: () => 0,
  minute_of_day: () => 0,
})

const settle = async (n = 6) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0))
}

const PKG = resolve(process.cwd(), '../../crates/kit-wasm/pkg') + '/'
const built = existsSync(`${PKG}kit_wasm.js`)
let kit: EditorKit
beforeAll(async () => {
  if (!built) return
  const mod = (await import(/* @vite-ignore */ pathToFileURL(`${PKG}kit_wasm.js`).href)) as EditorKit & { initSync(m: { module: BufferSource }): unknown }
  mod.initSync({ module: readFileSync(`${PKG}kit_wasm_bg.wasm`) })
  kit = mod
  setDesignKit(mod)
})
afterAll(() => setDesignKit(null))
afterEach(() => localStorage.clear())

describe('designColour', () => {
  it('is the colour of most of the volume, else the fallback', () => {
    const d = { ops: [...design('a', 'A', 'red').ops, { op: 'box' as const, at: [0, 0, 3] as [number, number, number], size: [4, 4, 3] as [number, number, number], part: 'brick' as const, colour: 'blue' }] }
    expect(designColour(d)).toBe('blue')
    expect(designColour({ ops: [] })).toBe('grey-light')
  })
})

describe('the memory design store', () => {
  const h = async (json: string) => (json.length.toString(16) + 'a'.repeat(64)).slice(0, 64)
  it('saves, resolves, lists, retires and keeps again; persists in localStorage', async () => {
    const s = memoryDesignStore(h)
    let told = 0
    s.subscribe(() => told++)
    const a = await s.save(design('a-1', 'Bench'))
    const b = await s.save(design('b-1', 'Armchair', 'blue'))
    expect(told).toBe(2)
    expect(s.get(a.hash)?.name).toBe('Bench')
    expect(s.get('0'.repeat(64))).toBeNull()
    expect(s.list()!.map((x) => x.design.name)).toEqual(['Armchair', 'Bench'])
    await s.retire(a.hash)
    expect(s.list()!.map((x) => x.hash)).toEqual([b.hash])
    expect(s.get(a.hash)?.name).toBe('Bench')
    // Another page in this browser reads the cache.
    const next = memoryDesignStore(h)
    expect(next.list()!.map((x) => x.hash)).toEqual([b.hash])
    await next.save(design('a-1', 'Bench'))
    expect(next.list()).toHaveLength(2)
    expect(JSON.parse(localStorage.getItem(STORE_KEY)!).retired).toEqual([])
  })

  it('takes in the earlier browser library once, under its recorded hashes', () => {
    const hash = 'c'.repeat(64)
    localStorage.setItem(LIBRARY_KEY, JSON.stringify([{ id: 'x-1', name: 'Old', hash, parts: 1, colour: 'red', design: design('x-1', 'Old') }]))
    expect(memoryDesignStore(h).get(hash)?.name).toBe('Old')
  })
})

describe.skipIf(!built)('designs on the offline source (real kit)', () => {
  it("keeps designs under the kit's hash, resolves them and announces the designs topic", async () => {
    const src = new WasmDataSource(fakeSim(), { personas: [] })
    const topics: DataTopic[][] = []
    const off = src.subscribe((t) => t && topics.push(t))
    expect(src.designsWhere()).toBe('browser')
    const d = design('cube-1', 'Cube')
    const { hash } = await src.saveDesign(d)
    expect(hash).toBe(kit.hashDesign(JSON.stringify(d)))
    expect(src.designOf(hash)).toEqual(d)
    expect(src.listDesigns()!.map((x) => x.hash)).toEqual([hash])
    expect(topics.some((t) => t.includes('designs'))).toBe(true)
    // Only what the kit builds: a floating brick is refused.
    await expect(src.saveDesign(design('float-1', 'Float', 'red', [0, 0, 2]))).rejects.toThrow(/refuses/)
    await src.retireDesign(hash)
    expect(src.listDesigns()).toEqual([])
    expect(src.designOf(hash)).toEqual(d)
    off()
  })

  it('acceptedHash is the kit hash of what it builds', () => {
    const json = JSON.stringify(design('cube-2', 'Cube'))
    expect(acceptedHash(kit, json)).toBe(kit.hashDesign(json))
    expect(() => acceptedHash(kit, JSON.stringify(design('f', 'F', 'red', [0, 0, 4])))).toThrow(/refuses/)
  })

  it('the company library saves through the source, replaces a design’s earlier version and retires on delete', async () => {
    const src = new WasmDataSource(fakeSim(), { personas: [] })
    const keeper = { designs: () => src.listDesigns(), saveDesign: (x: object) => src.saveDesign(x), retireDesign: (h: string) => src.retireDesign(h) }
    const lib = companyLibrary(keeper, () => 1)
    expect(lib.where).toBe('company')
    const v1 = design('chair-1', 'Chair')
    await lib.save({ id: v1.id, name: v1.name, hash: '', parts: 1, colour: 'red', design: v1 }, { ok: true })
    const v2 = { ...v1, ops: [{ ...v1.ops[0], colour: 'blue' }] }
    await lib.save({ id: v2.id, name: v2.name, hash: '', parts: 1, colour: 'blue', design: v2 }, { ok: true })
    const list = lib.list()!
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ name: 'Chair', colour: 'blue', parts: 1, hash: kit.hashDesign(JSON.stringify(v2)) })
    await lib.rename(list[0].id, 'Blue chair')
    expect(lib.list()!.map((x) => x.name)).toEqual(['Blue chair'])
    await lib.delete(lib.list()![0].id)
    expect(lib.list()).toEqual([])
    await expect(Promise.resolve().then(() => lib.save({ ...list[0] }, { ok: false }))).rejects.toThrow()
    await settle()
  })
})
