/**
 * The design library (ADR-0087 decision 7): the player's finished designs,
 * kept and previewed. Only designs the kit's compiler accepts are saved.
 *
 * Interim storage: the browser's localStorage, one key per scope (a company
 * when the caller knows it, else one shared key). A custom design cannot be
 * placed until the sim takes `PlaceObject` with a design summary (ADR-0065
 * §4, K-4); then designs travel with the company's work records (ADR-0056)
 * and this store goes.
 */
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
  list(): SavedDesign[]
  get(id: string): SavedDesign | null
  /** Save or replace by id. Throws unless the compiler accepted the design. */
  save(entry: SavedDesign, compiled: { ok: boolean }): void
  /** Rename; the name is part of the design, so its new hash comes along when known. */
  rename(id: string, name: string, hash?: (design: DesignJson) => string): void
  delete(id: string): void
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
export function localStorageLibrary(scope?: string, storage: StorageLike | null = defaultStorage()): DesignLibrary {
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
