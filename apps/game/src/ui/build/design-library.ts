/**
 * The design library (ADR-0087 decision 7): the player's finished designs,
 * kept and previewed. Only designs the kit's compiler accepts are saved.
 *
 * Two libraries: `companyLibrary`, over the data source's design store (K-4:
 * the designs live with the company, keyed by the kit's hash, so placed
 * objects resolve to them on every device; CLAUDE.md rule 6), and
 * `localStorageLibrary`, the fallback for a source that keeps no designs:
 * this browser's localStorage, one key per scope. The editor says which one
 * is in use.
 */
import { designColour, type CompanyDesign } from './company-designs'
import type { DesignJson } from './design-model'

export interface SavedDesign {
  id: string
  name: string
  /** The design's content hash (the kit's `hashDesign`). */
  hash: string
  /** Parts after the kit's merge. */
  parts: number
  /** The palette id of most of its bricks (its icon colour). */
  colour: string
  design: DesignJson
}

export interface DesignLibrary {
  /** Where the designs live: with the company (synced with its records) or in this browser only. */
  readonly where: 'company' | 'browser'
  /** The designs; `undefined` while the company's are being read. */
  list(): SavedDesign[] | undefined
  get(id: string): SavedDesign | null
  /** Save, or replace the entry of the same design id. Throws (rejects) unless the compiler accepted the design. */
  save(entry: SavedDesign, compiled: { ok: boolean }): void | Promise<void>
  /** Rename; the name is part of the design, so its new hash comes along when known. */
  rename(id: string, name: string, hash?: (design: DesignJson) => string): void | Promise<void>
  delete(id: string): void | Promise<void>
}

/** The overlay store's design methods the company library uses (structurally `OverlayStore`). */
export interface DesignKeeper {
  designs(): CompanyDesign[] | undefined
  saveDesign(design: object): Promise<{ hash: string }>
  retireDesign(hash: string): Promise<void>
}

/**
 * The library over the company's design store: an entry's id is its design hash. Saving a design
 * again under the same design id keeps the new version and retires the earlier ones (they stay
 * resolvable for objects placed with them); renaming saves the renamed design (a new hash).
 * `partsOf` counts a design's parts (the kit's compile), once per hash.
 */
export function companyLibrary(keeper: DesignKeeper, partsOf: (design: DesignJson) => number | null): DesignLibrary {
  const parts = new Map<string, number | null>()
  const entry = (d: CompanyDesign): SavedDesign => {
    if (!parts.has(d.hash)) parts.set(d.hash, partsOf(d.design))
    return { id: d.hash, name: d.design.name, hash: d.hash, parts: parts.get(d.hash) ?? 0, colour: designColour(d.design), design: d.design }
  }
  const list = () => keeper.designs()?.map(entry)
  /** Retire the library's other versions of a design id (not `keep`). */
  const retireOthers = async (designId: string, keep: string) => {
    for (const d of keeper.designs() ?? []) if (d.design.id === designId && d.hash !== keep) await keeper.retireDesign(d.hash)
  }
  return {
    where: 'company',
    list,
    get: (id) => list()?.find((d) => d.id === id) ?? null,
    async save(e, compiled) {
      if (!compiled.ok) throw new Error('only a design the kit compiles can be saved')
      const { hash } = await keeper.saveDesign(e.design)
      await retireOthers(e.design.id, hash)
    },
    async rename(id, name) {
      const n = name.trim()
      const d = keeper.designs()?.find((x) => x.hash === id)
      if (!n || !d || n === d.design.name) return
      const { hash } = await keeper.saveDesign({ ...d.design, name: n })
      if (hash !== id) await keeper.retireDesign(id)
    },
    delete: (id) => keeper.retireDesign(id),
  }
}

export const LIBRARY_KEY = 'swarmpress.designs.v1'

/** A storage that may be missing or throw (private windows, blocked site data). */
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

function defaultStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/**
 * The library over localStorage under `swarmpress.designs.v1[.scope]`. Without
 * storage it keeps the designs in memory for this page.
 */
export function localStorageLibrary(scope?: string, storage: StorageLike | null = defaultStorage()): Omit<DesignLibrary, 'list'> & { list(): SavedDesign[] } {
  const storageKey = scope ? `${LIBRARY_KEY}.${scope}` : LIBRARY_KEY
  let memory: SavedDesign[] = []
  const read = (): SavedDesign[] => {
    if (!storage) return memory
    try {
      const raw = storage.getItem(storageKey)
      const list = raw ? (JSON.parse(raw) as unknown) : []
      return Array.isArray(list) ? (list as SavedDesign[]).filter((d) => d && typeof d.id === 'string' && d.design) : []
    } catch {
      return memory
    }
  }
  const write = (list: SavedDesign[]) => {
    memory = list
    if (!storage) return
    try {
      storage.setItem(storageKey, JSON.stringify(list))
    } catch {
      // full or blocked: kept for this page only
    }
  }
  return {
    where: 'browser',
    list: () => read().sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
    get: (id) => read().find((d) => d.id === id) ?? null,
    save(entry, compiled) {
      if (!compiled.ok) throw new Error('only a design the kit compiles can be saved')
      const list = read().filter((d) => d.id !== entry.id)
      write([...list, entry])
    },
    rename(id, name, hash) {
      const n = name.trim()
      if (!n) return
      write(
        read().map((d) => {
          if (d.id !== id) return d
          const design = { ...d.design, name: n }
          return { ...d, name: n, design, hash: hash ? hash(design) : d.hash }
        }),
      )
    },
    delete(id) {
      write(read().filter((d) => d.id !== id))
    },
  }
}
