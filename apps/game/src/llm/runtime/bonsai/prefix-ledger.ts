/**
 * Bookkeeping for the model's generation cache.
 *
 * The cache cannot be cut at an arbitrary token: the model's linear-attention
 * layers carry recurrent state, so it can only return to 0, stay where it is,
 * or go back to one captured rewind point. The ledger remembers which tokens
 * the cache holds and which prefix the rewind point covers, and decides for
 * each new prompt how much of it is already there:
 *
 *   continue  the cache is a prefix of the prompt (a repair turn that extends
 *             the previous one): prefill only the new tail
 *   rewind    the rewind point (the shared system prefix) matches: go back to
 *             it, prefill the rest
 *   import    a snapshot of this system prefix is in memory: restore it
 *   prime     a new system prefix: prefill it once, capture and snapshot it
 *   reset     nothing to reuse
 *
 * Reuse is decided by token content only, never by a label, so a wrong match
 * is impossible; a missed match only costs a prefill. The ledger never
 * touches the GPU: BonsaiLlm executes the plan and reports back.
 */
import type { UpstreamPrefixSnapshot } from './upstream'

export type LedgerPlan =
  | { kind: 'continue'; cached: number }
  | { kind: 'rewind'; cached: number }
  | { kind: 'import'; cached: number; key: string; snapshot: UpstreamPrefixSnapshot }
  | { kind: 'prime'; cached: number; key: string }
  | { kind: 'reset'; cached: 0 }

interface Snapshot {
  ids: number[]
  snapshot: UpstreamPrefixSnapshot
}

function startsWith(ids: number[], prefix: number[]): boolean {
  if (prefix.length > ids.length) return false
  for (let i = 0; i < prefix.length; i++) if (ids[i] !== prefix[i]) return false
  return true
}

/** FNV-1a over the ids; a lookup key only (matches are confirmed by comparing the ids). */
export function prefixKey(ids: number[]): string {
  let h = 0x811c9dc5
  for (const id of ids) {
    for (let s = 0; s < 32; s += 8) {
      h ^= (id >>> s) & 0xff
      h = Math.imul(h, 0x01000193)
    }
  }
  return `${ids.length}:${(h >>> 0).toString(16).padStart(8, '0')}`
}

export interface LedgerStats {
  continues: number
  rewinds: number
  imports: number
  primes: number
  resets: number
}

export class PrefixLedger {
  /** Token ids the cache holds, in order. */
  private ids: number[] = []
  /** Ids covered by the cache's rewind point, or null when it has none. */
  private rewindIds: number[] | null = null
  private snapshots = new Map<string, Snapshot>()
  readonly stats: LedgerStats = { continues: 0, rewinds: 0, imports: 0, primes: 0, resets: 0 }

  constructor(
    private o: {
      /** Snapshots kept in memory (each is the recurrent state plus the prefix's KV rows). Default 3. */
      maxSnapshots?: number
      /** False when the cache has no rewind point support; then only `continue` and `reset` are planned. */
      canRewind?: boolean
    } = {},
  ) {}

  get length(): number {
    return this.ids.length
  }

  get rewindLength(): number {
    return this.rewindIds?.length ?? -1
  }

  /** The ids the cache holds (a copy). */
  held(): number[] {
    return this.ids.slice()
  }

  /**
   * Decide how to serve `promptIds`. `prefixLength` is the length of the
   * system prefix inside the prompt (0 = none). `cacheLength` is the cache's
   * real length; a mismatch with the ledger means something else moved the
   * cache, and nothing is reused.
   */
  plan(promptIds: number[], prefixLength: number, cacheLength: number): LedgerPlan {
    const inSync = cacheLength === this.ids.length
    // The engine needs at least one token to prefill, so a full match is not a continue.
    if (inSync && this.ids.length > 0 && this.ids.length < promptIds.length && startsWith(promptIds, this.ids)) {
      return { kind: 'continue', cached: this.ids.length }
    }
    const canRewind = this.o.canRewind !== false
    if (inSync && canRewind && this.rewindIds && this.rewindIds.length < promptIds.length && startsWith(promptIds, this.rewindIds)) {
      return { kind: 'rewind', cached: this.rewindIds.length }
    }
    if (canRewind && prefixLength > 0 && prefixLength < promptIds.length) {
      const prefix = promptIds.slice(0, prefixLength)
      const key = prefixKey(prefix)
      const snap = this.snapshots.get(key)
      if (snap && snap.ids.length === prefix.length && startsWith(prefix, snap.ids)) {
        // Refresh its place in the LRU order.
        this.snapshots.delete(key)
        this.snapshots.set(key, snap)
        return { kind: 'import', cached: prefixLength, key, snapshot: snap.snapshot }
      }
      return { kind: 'prime', cached: prefixLength, key }
    }
    return { kind: 'reset', cached: 0 }
  }

  /** The plan was executed; count it. */
  count(kind: LedgerPlan['kind']): void {
    const k = ({ continue: 'continues', rewind: 'rewinds', import: 'imports', prime: 'primes', reset: 'resets' } as const)[kind]
    this.stats[k]++
  }

  /** The cache was emptied (which also drops its rewind point). */
  cleared(): void {
    this.ids = []
    this.rewindIds = null
  }

  /** The cache went back to its rewind point. */
  rewound(): void {
    if (!this.rewindIds) throw new Error('ledger: no rewind point')
    this.ids = this.rewindIds.slice()
  }

  /** The cache now holds exactly `prefix` and that is its rewind point. */
  primed(prefix: number[], snapshot?: UpstreamPrefixSnapshot | null): void {
    this.ids = prefix.slice()
    this.rewindIds = prefix.slice()
    if (snapshot) this.remember(prefix, snapshot)
  }

  private remember(prefix: number[], snapshot: UpstreamPrefixSnapshot): void {
    const key = prefixKey(prefix)
    this.snapshots.delete(key)
    this.snapshots.set(key, { ids: prefix.slice(), snapshot })
    const max = Math.max(0, this.o.maxSnapshots ?? 3)
    while (this.snapshots.size > max) {
      const oldest = this.snapshots.keys().next().value
      if (oldest === undefined) break
      this.snapshots.delete(oldest)
    }
  }

  /**
   * After a stream: `sequence` is everything that was prefilled or generated,
   * in order; the cache holds its first `cacheLength` tokens. Returns false
   * (and holds nothing) when the length cannot be right, so the caller resets.
   */
  commit(sequence: number[], cacheLength: number): boolean {
    if (cacheLength < 0 || cacheLength > sequence.length) {
      this.ids = []
      return false
    }
    this.ids = sequence.slice(0, cacheLength)
    // A rewind point beyond or different from what the cache holds no longer applies.
    if (this.rewindIds && !startsWith(this.ids, this.rewindIds)) this.rewindIds = null
    return true
  }

  /** Forget the snapshots (dispose, or a different model). */
  dropSnapshots(): void {
    this.snapshots.clear()
  }

  snapshotCount(): number {
    return this.snapshots.size
  }
}
