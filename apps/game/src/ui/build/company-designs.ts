/**
 * The company's designs (ADR-0065 §4, K-4; ADR-0087 decision 7; CLAUDE.md rule 6): the player's
 * own kit designs, kept with the company and addressed by the kit's design hash, so a placed
 * object (`PlaceObject{design: hash}`) resolves to its design on every device that has the
 * company's text. The sim only ever sees the hash and the compiled summary (rule 2).
 *
 * The store is content-addressed and append-only: a design, once saved, stays (objects may stand
 * on it). The library's view of it is a log of keep and retire events over those designs: deleting
 * a design from the library retires it (it is still drawn where it stands); saving it again keeps it.
 *
 * Two stores implement it: the session's, over the company store's journalled text
 * (`session/design-store.ts`), which syncs with the company; and `memoryDesignStore` for the
 * offline demo, in memory with this browser's localStorage as its cache.
 */
import type { CompileResult, EditorKit } from './design-kit'
import { LIBRARY_KEY } from './design-library'
import type { DesignJson } from './design-model'

/** A design the company keeps, by its hash. */
export interface CompanyDesign {
  hash: string
  design: DesignJson
}

/** What a data source keeps its designs in. */
export interface DesignStore {
  /** Where the designs live, for the library's note. */
  readonly where: 'company' | 'browser'
  /** Saves a design the kit accepts; resolves with its hash. Saving a retired design keeps it again. */
  save(design: object): Promise<{ hash: string }>
  /** The design of a hash: `undefined` while it is being read (`subscribe` tells when), `null` when the company has none. */
  get(hash: string): DesignJson | null | undefined
  /** The library: designs kept and not retired, by name; `undefined` while being read. */
  list(): CompanyDesign[] | undefined
  /** Takes a design out of the library (it stays resolvable: objects may stand on it). */
  retire(hash: string): Promise<void>
  /** Called whenever a read completes or a save or retire changes something. */
  subscribe(fn: () => void): () => void
}

/** A design hash as the kit writes it. */
export const isDesignHash = (h: unknown): h is string => typeof h === 'string' && /^[0-9a-f]{64}$/.test(h)

/** The design JSON of a stored value, or null when it is not one. */
export function asDesign(v: unknown): DesignJson | null {
  const d = v && typeof v === 'object' ? (v as Partial<DesignJson>) : null
  return d && typeof d.id === 'string' && typeof d.name === 'string' && Array.isArray(d.ops) && Array.isArray(d.footprint) ? (d as DesignJson) : null
}

/** The library order: by name, then hash. */
export const byName = (a: CompanyDesign, b: CompanyDesign) => a.design.name.localeCompare(b.design.name) || a.hash.localeCompare(b.hash)

/**
 * The hash of a design the kit accepts (the kit's `hashDesign`); throws with the kit's issues
 * when it refuses it: the company keeps only designs the kit builds.
 */
export function acceptedHash(kit: Pick<EditorKit, 'compile' | 'hashDesign'>, json: string): string {
  const build = kit.compile(json, '')
  try {
    if (!build.ok()) {
      const issues = JSON.parse(build.issuesJson()) as Array<{ message?: string }>
      throw new Error(`The kit refuses this design: ${issues.map((i) => i.message ?? '').filter(Boolean).slice(0, 2).join('; ') || 'issues'}`)
    }
  } finally {
    build.free()
  }
  const hash = kit.hashDesign(json)
  if (!isDesignHash(hash)) throw new Error('The kit gave no hash for this design')
  return hash
}

/** The palette id of most of a design's volume (its icon colour), from its ops. */
export function designColour(d: Pick<DesignJson, 'ops'>, fallback = 'grey-light'): string {
  const n = new Map<string, number>()
  for (const op of d.ops) {
    const v = op.op === 'box' ? Math.max(1, op.size[0] * op.size[1] * op.size[2]) : 1
    n.set(op.colour, (n.get(op.colour) ?? 0) + v)
  }
  let best = fallback
  let most = 0
  for (const [c, k] of [...n].sort((a, b) => a[0].localeCompare(b[0]))) if (k > most) (best = c), (most = k)
  return best
}

/** The facts a tile shows of a design, compiled once per hash. */
export type DesignFacts = Pick<CompileResult, 'ok' | 'summary' | 'hash'>

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

function defaultStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/** The offline store's cache key in localStorage. */
export const STORE_KEY = 'swarmpress.designs.store.v1'

/**
 * The offline demo's design store: in memory, cached in this browser's localStorage (it has no
 * company store to sync). At first use it takes in the designs of the earlier browser library
 * (`swarmpress.designs.v1`), each under the hash the library recorded.
 */
export function memoryDesignStore(hashOf: (json: string) => Promise<string>, storage: StorageLike | null = defaultStorage()): DesignStore {
  const designs = new Map<string, DesignJson>()
  const retired = new Set<string>()
  const listeners = new Set<() => void>()
  const emit = () => listeners.forEach((l) => l())
  const persist = () => {
    if (!storage) return
    try {
      storage.setItem(STORE_KEY, JSON.stringify({ designs: Object.fromEntries(designs), retired: [...retired] }))
    } catch {
      // full or blocked: kept for this page only
    }
  }
  if (storage) {
    try {
      const raw = storage.getItem(STORE_KEY)
      const saved = raw ? (JSON.parse(raw) as { designs?: Record<string, unknown>; retired?: unknown[] }) : null
      for (const [h, d] of Object.entries(saved?.designs ?? {})) {
        const design = asDesign(d)
        if (isDesignHash(h) && design) designs.set(h, design)
      }
      for (const h of saved?.retired ?? []) if (isDesignHash(h)) retired.add(h)
      // The earlier browser library's designs, once (they keep their recorded hash).
      const legacy = raw ? null : storage.getItem(LIBRARY_KEY)
      for (const e of legacy ? ((JSON.parse(legacy) as Array<{ hash?: unknown; design?: unknown }>) ?? []) : []) {
        const design = asDesign(e?.design)
        if (isDesignHash(e?.hash) && design) designs.set(e.hash, design)
      }
    } catch {
      // unreadable cache: start empty
    }
  }
  return {
    where: 'browser',
    async save(design) {
      const d = asDesign(design)
      if (!d) throw new Error('Not a design')
      const hash = await hashOf(JSON.stringify(design))
      designs.set(hash, d)
      retired.delete(hash)
      persist()
      emit()
      return { hash }
    },
    get: (hash) => designs.get(hash) ?? null,
    list: () =>
      [...designs]
        .filter(([h]) => !retired.has(h))
        .map(([hash, design]) => ({ hash, design }))
        .sort(byName),
    async retire(hash) {
      if (!designs.has(hash) || retired.has(hash)) return
      retired.add(hash)
      persist()
      emit()
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
}
