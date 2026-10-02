import { describe, expect, it } from 'vitest'
import { PrefixLedger, prefixKey } from './prefix-ledger'
import type { UpstreamPrefixSnapshot } from './upstream'

const snap = (n: number): UpstreamPrefixSnapshot => ({ length: n, layout: `l${n}`, chunks: [] })
const SYS = [1, 2, 3]
const SYS_B = [1, 2, 9]

describe('PrefixLedger.plan', () => {
  it('resets when nothing is cached and there is no system prefix', () => {
    const l = new PrefixLedger()
    expect(l.plan([5, 6, 7], 0, 0)).toEqual({ kind: 'reset', cached: 0 })
  })

  it('primes a new system prefix, then rewinds to it for the next prompt', () => {
    const l = new PrefixLedger()
    const first = l.plan([...SYS, 10, 11], 3, 0)
    expect(first).toMatchObject({ kind: 'prime', cached: 3 })
    l.primed(SYS, snap(3))
    // The turn ran: prompt + two generated tokens, the last one not fed back.
    expect(l.commit([...SYS, 10, 11, 20, 21], 6)).toBe(true)
    expect(l.held()).toEqual([...SYS, 10, 11, 20])
    // A different user turn under the same system prompt.
    expect(l.plan([...SYS, 30, 31], 3, 6)).toEqual({ kind: 'rewind', cached: 3 })
    l.rewound()
    expect(l.length).toBe(3)
  })

  it('continues when the cache is a prefix of the new prompt (a turn that extends the last one)', () => {
    const l = new PrefixLedger()
    l.primed(SYS, null)
    l.commit([...SYS, 10, 20, 21], 5)
    expect(l.plan([...SYS, 10, 20, 21, 22, 40], 3, 5)).toEqual({ kind: 'continue', cached: 5 })
    // An identical prompt is not a continue: the engine needs at least one token to prefill.
    expect(l.plan([...SYS, 10, 20], 3, 5)).toEqual({ kind: 'rewind', cached: 3 })
  })

  it('reuses nothing when the cache moved behind its back', () => {
    const l = new PrefixLedger()
    l.primed(SYS, null)
    l.commit([...SYS, 10, 20], 5)
    // The real cache says 4, the ledger thinks 5.
    expect(l.plan([...SYS, 10, 20, 30], 3, 4).kind).toBe('prime')
    expect(l.plan([7, 8, 9], 0, 4)).toEqual({ kind: 'reset', cached: 0 })
  })

  it('imports a remembered snapshot when the system prefix comes back', () => {
    const l = new PrefixLedger()
    l.primed(SYS, snap(3))
    // Another system prompt takes over the single rewind point.
    expect(l.plan([...SYS_B, 10], 3, 3).kind).toBe('prime')
    l.cleared()
    l.primed(SYS_B, snap(3))
    // Back to the first one: its snapshot is still in memory.
    const plan = l.plan([...SYS, 11], 3, 3)
    expect(plan).toMatchObject({ kind: 'import', cached: 3, key: prefixKey(SYS) })
    if (plan.kind === 'import') expect(plan.snapshot.layout).toBe('l3')
  })

  it('keeps only the most recently used snapshots', () => {
    const l = new PrefixLedger({ maxSnapshots: 2 })
    for (const p of [[1], [2], [3]]) {
      l.cleared()
      l.primed(p, snap(1))
    }
    expect(l.snapshotCount()).toBe(2)
    l.cleared()
    expect(l.plan([1, 9], 1, 0).kind).toBe('prime') // [1] was evicted
    expect(l.plan([3, 9], 1, 0).kind).toBe('import')
    l.dropSnapshots()
    expect(l.snapshotCount()).toBe(0)
  })

  it('without rewind support only continues or resets', () => {
    const l = new PrefixLedger({ canRewind: false })
    expect(l.plan([...SYS, 10], 3, 0)).toEqual({ kind: 'reset', cached: 0 })
    l.commit([...SYS, 10, 20], 4)
    expect(l.plan([...SYS, 10, 20, 30], 3, 4)).toEqual({ kind: 'continue', cached: 4 })
    expect(l.plan([...SYS, 11], 3, 4)).toEqual({ kind: 'reset', cached: 0 })
  })
})

describe('PrefixLedger bookkeeping', () => {
  it('refuses a cache length that cannot be right', () => {
    const l = new PrefixLedger()
    expect(l.commit([1, 2, 3], 4)).toBe(false)
    expect(l.length).toBe(0)
    expect(l.commit([1, 2, 3], -1)).toBe(false)
  })

  it('clearing drops the rewind point; rewinding without one is a bug', () => {
    const l = new PrefixLedger()
    l.primed(SYS, null)
    expect(l.rewindLength).toBe(3)
    l.cleared()
    expect(l.rewindLength).toBe(-1)
    expect(() => l.rewound()).toThrow(/no rewind point/)
  })

  it('counts what it planned', () => {
    const l = new PrefixLedger()
    l.count('prime')
    l.count('rewind')
    l.count('rewind')
    expect(l.stats).toEqual({ continues: 0, rewinds: 2, imports: 0, primes: 1, resets: 0 })
  })

  it('prefixKey depends on content and length', () => {
    expect(prefixKey([1, 2, 3])).not.toBe(prefixKey([1, 2, 4]))
    expect(prefixKey([1, 2, 3])).toBe(prefixKey([1, 2, 3]))
    expect(prefixKey([70000, 1])).not.toBe(prefixKey([4464, 1]))
  })
})
