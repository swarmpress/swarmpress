/**
 * The company's designs in its store (K-4, ADR-0087 decision 7; CLAUDE.md rule 6): text records
 * of the company store, journalled like every other company text (ADR-0075), so they seal, sync
 * and restore with the company and a placed object's design is found on every device.
 *
 * Records (written through the store's brief records, whose write is first-wins and journalled):
 * - `design:<hash>`: `{kind: 'design', hash, design}`, the design JSON under the kit's hash.
 *   Content-addressed and never rewritten: an object placed on it can always be drawn.
 * - `design-event:<hash>:<n>`: `{kind: 'design-event', op: 'keep' | 'retire', hash}`, the
 *   library's keep and retire events, applied in journal order.
 *
 * The library is read once from the journal (its `brief` texts with these keys); a single design
 * is read by its key. Nothing here enters the sim: a `PlaceObject` carries only the hash and the
 * kit's summary (rule 2).
 */
import { acceptedHash, asDesign, byName, isDesignHash, type CompanyDesign, type DesignStore } from '../ui/build/company-designs'
import { getDesignKit } from '../ui/build/design-kit'
import type { DesignJson } from '../ui/build/design-model'

/** The part of the CompanyStore designs are kept in. */
export interface DesignTextStore {
  putBrief(company: string, briefRef: string, recordJson: string): Promise<void>
  getBrief(company: string, briefRef: string): Promise<string | null>
  /** The text journal, oldest first, after `after` (`CompanyStore.textsAfter`). */
  textsAfter(after: number, maxBytes?: number): Promise<Array<{ n: number; kind: string; key: string; value: string }>>
}

export const designKey = (hash: string) => `design:${hash}`
const EVENT_PREFIX = 'design-event:'

export interface CompanyDesignStoreOptions {
  /** The hash of a design the kit accepts (throws otherwise); the kit's by default. */
  hash?: (json: string) => Promise<string>
  /** Why this session cannot write (read-only); saves and retires are refused with it. */
  readOnly?: () => string | null
  /** A unique suffix for event keys. */
  nonce?: () => string
}

/** The kit's hash of a design it accepts. */
export const kitHash = async (json: string) => acceptedHash(await getDesignKit(), json)

export function companyDesignStore(store: DesignTextStore, company: string, opts: CompanyDesignStoreOptions = {}): DesignStore {
  const hashOf = opts.hash ?? kitHash
  const nonce = opts.nonce ?? (() => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`)
  /** Designs read or written, by hash; `null`: the store has none. */
  const known = new Map<string, DesignJson | null>()
  const reading = new Set<string>()
  /** The library's state per hash after the events read: kept unless the last event retired it. */
  const retired = new Set<string>()
  /** Hashes in the library (saved here or found in the journal). */
  const library = new Set<string>()
  let scanned = false
  let scan: Promise<void> | null = null
  const listeners = new Set<() => void>()
  const emit = () => listeners.forEach((l) => l())

  const record = (value: string): { design?: DesignJson | null; event?: { op: string; hash: string } } => {
    try {
      const r = JSON.parse(value) as { kind?: string; hash?: unknown; design?: unknown; op?: unknown }
      if (r.kind === 'design' && isDesignHash(r.hash)) return { design: asDesign(r.design) }
      if (r.kind === 'design-event' && isDesignHash(r.hash) && (r.op === 'keep' || r.op === 'retire')) return { event: { op: r.op, hash: r.hash } }
    } catch {
      // not a design record
    }
    return {}
  }

  const ensureScanned = () =>
    (scan ??= (async () => {
      let after = 0
      for (;;) {
        const rows = await store.textsAfter(after, 4 << 20)
        if (!rows.length) break
        for (const t of rows) {
          after = t.n
          if (t.kind !== 'brief') continue
          if (t.key.startsWith('design:')) {
            const hash = t.key.slice('design:'.length)
            const d = record(t.value).design
            if (!isDesignHash(hash) || !d) continue
            if (!known.get(hash)) known.set(hash, d)
            library.add(hash)
          } else if (t.key.startsWith(EVENT_PREFIX)) {
            const e = record(t.value).event
            if (!e) continue
            if (e.op === 'retire') retired.add(e.hash)
            else retired.delete(e.hash)
          }
        }
      }
      scanned = true
      emit()
    })().catch((err: unknown) => {
      console.warn('[designs] the company designs could not be read', err)
      scanned = true
      emit()
    }))

  const writeEvent = (op: 'keep' | 'retire', hash: string) =>
    store.putBrief(company, `${EVENT_PREFIX}${hash}:${nonce()}`, JSON.stringify({ kind: 'design-event', op, hash }))

  const refuse = () => {
    const why = opts.readOnly?.()
    if (why) throw new Error(why)
  }

  return {
    where: 'company',
    async save(design) {
      refuse()
      const d = asDesign(design)
      if (!d) throw new Error('Not a design')
      const json = JSON.stringify(design)
      const hash = await hashOf(json)
      await ensureScanned()
      // First write wins: the same design saved twice is one record.
      await store.putBrief(company, designKey(hash), JSON.stringify({ kind: 'design', hash, design }))
      if (retired.has(hash)) await writeEvent('keep', hash)
      known.set(hash, d)
      library.add(hash)
      retired.delete(hash)
      emit()
      return { hash }
    },
    get(hash) {
      if (known.has(hash)) return known.get(hash)
      if (!isDesignHash(hash)) return null
      if (!reading.has(hash)) {
        reading.add(hash)
        void store
          .getBrief(company, designKey(hash))
          .then((text) => (text == null ? null : (record(text).design ?? null)))
          .catch(() => null)
          .then((d) => {
            reading.delete(hash)
            known.set(hash, d)
            emit()
          })
      }
      return undefined
    },
    list() {
      if (!scanned) {
        void ensureScanned()
        return undefined
      }
      const out: CompanyDesign[] = []
      for (const hash of library) {
        const design = known.get(hash)
        if (design && !retired.has(hash)) out.push({ hash, design })
      }
      return out.sort(byName)
    },
    async retire(hash) {
      refuse()
      await ensureScanned()
      if (!library.has(hash) || retired.has(hash)) return
      await writeEvent('retire', hash)
      retired.add(hash)
      emit()
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
}
