// The company's designs in its store (K-4, ADR-0087 decision 7; rule 6): saved as journalled text
// under the kit's hash, read back by hash and as a library, retired and kept again by events, and
// restored on a second device from the journal (ADR-0075), so a placed object's design is found
// there too. On the browser's CompanyStore (in-memory SQLite) with a fixed hasher; and the kit's
// own hash on the real kit when it is built.
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CompanyStore } from '../store'
import { MemorySqliteDriver } from '../store/sqlite-driver'
import { setDesignKit, type EditorKit } from '../ui/build/design-kit'
import type { DesignJson } from '../ui/build/design-model'
import { companyDesignStore, designKey, kitHash } from './design-store'

const COMPANY = 'company-1'
const design = (id: string, name: string, colour = 'red'): DesignJson => ({
  format: 'swarmpress.design.v1',
  id,
  name,
  footprint: [2, 2],
  height: 3,
  ops: [{ op: 'box', at: [0, 0, 0], size: [2, 2, 3], part: 'brick', colour }],
  provenance: { kind: 'player', player: 'local' },
})
/** A stand-in for the kit's hash: 64 hex digits from the text. */
const hash = async (json: string) => {
  let h = 0x811c9dc5
  for (let i = 0; i < json.length; i++) h = Math.imul(h ^ json.charCodeAt(i), 0x01000193)
  return (h >>> 0).toString(16).padStart(8, '0').repeat(8)
}
const open = async () => CompanyStore.open(await MemorySqliteDriver.open())
/** Lets the store's reads finish. */
const settle = async (n = 8) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0))
}

describe('the company design store', () => {
  it('keeps a design as journalled company text under its hash, and reads it back by hash', async () => {
    const store = await open()
    const designs = companyDesignStore(store, COMPANY, { hash })
    let told = 0
    designs.subscribe(() => told++)
    const d = design('chair-1', 'Chair')
    const { hash: h } = await designs.save(d)
    expect(h).toBe(await hash(JSON.stringify(d)))
    expect(told).toBeGreaterThan(0)
    // A brief record keyed `design:<hash>`, journalled (so it seals and syncs with the company).
    const rec = JSON.parse((await store.getBrief(COMPANY, designKey(h)))!) as { kind: string; hash: string; design: DesignJson }
    expect(rec).toMatchObject({ kind: 'design', hash: h, design: d })
    const texts = await store.textsAfter(0)
    expect(texts.some((t) => t.kind === 'brief' && t.key === designKey(h))).toBe(true)
    expect(designs.get(h)).toEqual(d)
    expect(designs.list()).toEqual([{ hash: h, design: d }])
    // The same design again is one record.
    await designs.save(d)
    expect((await store.textsAfter(0)).filter((t) => t.key === designKey(h))).toHaveLength(1)
  })

  it('reads a design it does not hold yet: undefined while reading, then the design; null for none', async () => {
    const store = await open()
    const d = design('lamp-1', 'Lamp', 'yellow')
    const { hash: h } = await companyDesignStore(store, COMPANY, { hash }).save(d)
    const other = companyDesignStore(store, COMPANY, { hash })
    let told = 0
    other.subscribe(() => told++)
    expect(other.get(h)).toBeUndefined()
    await settle()
    expect(told).toBe(1)
    expect(other.get(h)).toEqual(d)
    const missing = 'f'.repeat(64)
    expect(other.get(missing)).toBeUndefined()
    await settle()
    expect(other.get(missing)).toBeNull()
    // Not a hash at all: nothing to read.
    expect(other.get('nope')).toBeNull()
  })

  it('lists the library by name; retiring takes a design out (it stays resolvable), saving keeps it again', async () => {
    const store = await open()
    const designs = companyDesignStore(store, COMPANY, { hash })
    const a = await designs.save(design('b-1', 'Bench'))
    const b = await designs.save(design('a-1', 'Armchair', 'blue'))
    expect(designs.list()!.map((x) => x.design.name)).toEqual(['Armchair', 'Bench'])
    await designs.retire(a.hash)
    expect(designs.list()!.map((x) => x.hash)).toEqual([b.hash])
    expect(designs.get(a.hash)?.name).toBe('Bench')
    // A fresh reader sees the same library from the journal.
    const again = companyDesignStore(store, COMPANY, { hash })
    expect(again.list()).toBeUndefined()
    await settle()
    expect(again.list()!.map((x) => x.hash)).toEqual([b.hash])
    // Saved again: kept again, for every reader.
    await designs.save(design('b-1', 'Bench'))
    const third = companyDesignStore(store, COMPANY, { hash })
    third.list()
    await settle()
    expect(third.list()!.map((x) => x.design.name)).toEqual(['Armchair', 'Bench'])
  })

  it('travels with the company: a second device restored from the journal has the designs', async () => {
    const here = await open()
    const designs = companyDesignStore(here, COMPANY, { hash })
    const kept = await designs.save(design('desk-1', 'Standing desk', 'white'))
    const gone = await designs.save(design('box-1', 'Box'))
    await designs.retire(gone.hash)
    const there = await open()
    await there.applyTexts(COMPANY, await here.textsAfter(0))
    const restored = companyDesignStore(there, COMPANY, { hash })
    expect(restored.get(kept.hash)).toBeUndefined()
    restored.list()
    await settle()
    expect(restored.get(kept.hash)?.name).toBe('Standing desk')
    expect(restored.list()!.map((x) => x.hash)).toEqual([kept.hash])
    expect(restored.get(gone.hash)?.name).toBe('Box')
  })

  it('refuses to write in a read-only session, and refuses what is not a design', async () => {
    const store = await open()
    const designs = companyDesignStore(store, COMPANY, { hash, readOnly: () => 'another device holds the lease' })
    await expect(designs.save(design('x-1', 'X'))).rejects.toThrow('another device holds the lease')
    await expect(companyDesignStore(store, COMPANY, { hash }).save({ nope: true })).rejects.toThrow('Not a design')
    expect(await store.textsAfter(0)).toEqual([])
  })
})

const PKG = resolve(process.cwd(), '../../crates/kit-wasm/pkg') + '/'
const built = existsSync(`${PKG}kit_wasm.js`)

describe.skipIf(!built)('the company design store on the real kit', () => {
  it("keys a design by the kit's own hash and refuses one the kit does not build", async () => {
    const mod = (await import(/* @vite-ignore */ pathToFileURL(`${PKG}kit_wasm.js`).href)) as EditorKit & { initSync(m: { module: BufferSource }): unknown }
    mod.initSync({ module: readFileSync(`${PKG}kit_wasm_bg.wasm`) })
    setDesignKit(mod)
    try {
      const store = await open()
      const designs = companyDesignStore(store, COMPANY)
      const d = design('cube-1', 'Cube')
      const { hash: h } = await designs.save(d)
      expect(h).toBe(mod.hashDesign(JSON.stringify(d)))
      expect(await kitHash(JSON.stringify(d))).toBe(h)
      const floating: DesignJson = { ...d, id: 'float-1', ops: [{ op: 'box', at: [0, 0, 2], size: [1, 1, 1], part: 'brick', colour: 'red' }] }
      await expect(designs.save(floating)).rejects.toThrow(/refuses/)
    } finally {
      setDesignKit(null)
    }
  })
})
