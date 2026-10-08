/**
 * The instruction booklet (FEAT-101, ADR-0077): a change set (a staff
 * proposal, or the CEO's own draft before it is saved) as numbered building
 * steps, like a brick set's instructions. One step per semantic change
 * (`blueprint::Change`), grouped into bags: one bag per building (page type)
 * in street order, the site-wide changes (globals, collections, navigation,
 * intent) last. Each step's model is the base with the changes up to it
 * applied (`apply_changes`, the server's own code); its callout lists the
 * parts it adds and takes away. Pure: the apply function is passed in.
 */
import { streetOrder } from '../../blueprint/model'
import type { Blueprint, BlueprintChange } from '../../blueprint/types'

/** The bag of the site-wide changes. */
export const SITE_BAG = '(site)'

export interface BookletStep {
  /** 0-based position in the booklet. */
  index: number
  change: BlueprintChange
  /** The page type the step builds on, or `SITE_BAG`. */
  bag: string
  /** The model before and after this step. */
  before: Blueprint
  after: Blueprint
  /** The callout: `+ editorial-hero`, `− callout`, `+ storey hero`. */
  parts: string[]
}

export interface Bag {
  id: string
  label: string
  steps: BookletStep[]
}

export interface Booklet {
  steps: BookletStep[]
  bags: Bag[]
}

/** The page type a change builds on: a type's own id, a slot's type, a relationship's source; else the site. */
export function bagOf(change: BlueprintChange): string {
  switch (change.subject) {
    case 'page-type':
      return change.id
    case 'slot':
      return change.id.split('/')[0]
    case 'relationship':
      return change.id.split('>')[0]
    default:
      return SITE_BAG
  }
}

const typeOf = (bp: Blueprint, id: string) => bp.page_types.find((t) => t.id === id)

/** All the blocks of a type's storeys, as a multiset. */
function blocksOf(bp: Blueprint, type: string): Map<string, number> {
  const m = new Map<string, number>()
  for (const s of typeOf(bp, type)?.slots ?? []) for (const b of s.blocks) m.set(b, (m.get(b) ?? 0) + 1)
  return m
}

/** The callout of a step: storeys and blocks that appear or go. */
export function partsOf(before: Blueprint, after: Blueprint, change: BlueprintChange): string[] {
  const bag = bagOf(change)
  if (bag === SITE_BAG || change.subject === 'relationship') return [`${change.kind === 'removed' ? '−' : change.kind === 'added' ? '+' : '~'} ${change.subject} ${change.id}`]
  const out: string[] = []
  if (change.subject === 'page-type' && change.kind !== 'changed') out.push(`${change.kind === 'added' ? '+' : '−'} building ${change.id}`)
  const slotsB = new Set((typeOf(before, bag)?.slots ?? []).map((s) => s.id))
  const slotsA = new Set((typeOf(after, bag)?.slots ?? []).map((s) => s.id))
  for (const s of slotsA) if (!slotsB.has(s)) out.push(`+ storey ${s}`)
  for (const s of slotsB) if (!slotsA.has(s)) out.push(`− storey ${s}`)
  const b = blocksOf(before, bag)
  const a = blocksOf(after, bag)
  for (const [k, n] of a) for (let i = 0; i < n - (b.get(k) ?? 0); i++) out.push(`+ ${k}`)
  for (const [k, n] of b) for (let i = 0; i < n - (a.get(k) ?? 0); i++) out.push(`− ${k}`)
  if (!out.length) out.push(`~ ${change.subject} ${change.id}${change.fields?.length ? ` (${change.fields.join(', ')})` : ''}`)
  return out
}

/**
 * The booklet of `changes` from `base` to `proposal`. `apply` gives the base
 * with a subset of the changes applied (null when it cannot: the step then
 * shows the previous model, and the last step the whole proposal).
 */
export function bookletOf(base: Blueprint, proposal: Blueprint, changes: BlueprintChange[], apply: (changes: BlueprintChange[]) => Blueprint | null): Booklet {
  // Bags in street order (the proposal's, then types only the base has), the site last.
  const order = [...streetOrder(proposal).map((t) => t.id), ...streetOrder(base).map((t) => t.id)]
  const rank = (bag: string) => (bag === SITE_BAG ? Number.MAX_SAFE_INTEGER : (order.indexOf(bag) + 1 || order.length + 1))
  // A relationship is built once both its buildings stand: in the bag of the later one.
  const bagIn = (c: BlueprintChange) => {
    if (c.subject !== 'relationship') return bagOf(c)
    const [from, rest] = c.id.split('>')
    const to = (rest ?? '').split(':')[0]
    return rank(to) > rank(from) ? to : from
  }
  const sorted = changes.map((c, i) => ({ c, i })).sort((x, y) => rank(bagIn(x.c)) - rank(bagIn(y.c)) || (x.c.subject === 'relationship' ? 1 : 0) - (y.c.subject === 'relationship' ? 1 : 0) || x.i - y.i).map((x) => x.c)
  const steps: BookletStep[] = []
  let before = base
  sorted.forEach((change, index) => {
    const last = index === sorted.length - 1
    const after = apply(sorted.slice(0, index + 1)) ?? (last ? proposal : before)
    steps.push({ index, change, bag: bagIn(change), before, after, parts: partsOf(before, after, change) })
    before = after
  })
  const bags: Bag[] = []
  for (const s of steps) {
    let bag = bags.find((b) => b.id === s.bag)
    if (!bag) {
      const t = typeOf(s.after, s.bag) ?? typeOf(s.before, s.bag)
      bag = { id: s.bag, label: s.bag === SITE_BAG ? 'The site' : (t?.label.en ?? Object.values(t?.label ?? {})[0] ?? s.bag), steps: [] }
      bags.push(bag)
    }
    bag.steps.push(s)
  }
  return { steps, bags }
}
