/**
 * The Studio's snap engine (FEAT-100, ADR-0077): where a picked brick may go
 * and why not. A block dropped on a storey joins its blocks; dropped in a gap
 * between storeys it becomes a new (optional) storey there. Every candidate
 * is judged by the site's own checker (`blueprint-wasm`, the same code the
 * server runs): a drop is allowed when it adds no issue the draft did not
 * have, and a refused drop carries the checker's first new issue as its
 * reason (the red seam's tooltip). Pure: the checker is passed in.
 */
import { freshId, insertSlot, updateSlot } from '../../blueprint/model'
import type { Blueprint, ModelIssue } from '../../blueprint/types'

export type DropTarget = { kind: 'storey'; type: string; slot: string } | { kind: 'gap'; type: string; index: number }

export interface Verdict {
  target: DropTarget
  ok: boolean
  /** Why not (the checker's words), null when allowed. */
  reason: string | null
  /** The draft after the drop, null when it cannot be made. */
  next: Blueprint | null
}

/** A stable key of a target, for maps and `data-drop` attributes. */
export const targetKey = (t: DropTarget): string => (t.kind === 'storey' ? `storey:${t.type}/${t.slot}` : `gap:${t.type}/${t.index}`)

/** Every place a block may be dropped on one page type: each storey, and each gap (above, between, below). */
export function dropTargets(bp: Blueprint, type: string): DropTarget[] {
  const t = bp.page_types.find((x) => x.id === type)
  if (!t || t.slots === undefined) return []
  const out: DropTarget[] = []
  t.slots.forEach((s, i) => {
    out.push({ kind: 'gap', type, index: i })
    out.push({ kind: 'storey', type, slot: s.id })
  })
  out.push({ kind: 'gap', type, index: t.slots.length })
  return out
}

/** The id a new storey for `block` gets: the block's name, made unique among the type's storeys. */
export function storeyIdFor(bp: Blueprint, type: string, block: string): string {
  const taken = (bp.page_types.find((t) => t.id === type)?.slots ?? []).map((s) => s.id)
  const stem = block.replace(/^x:/, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'storey'
  return taken.includes(stem) ? freshId(stem, taken) : stem
}

/** The draft with `block` dropped on `target`; null when the drop changes nothing or the target is gone. */
export function placeBlock(bp: Blueprint, target: DropTarget, block: string): Blueprint | null {
  const t = bp.page_types.find((x) => x.id === target.type)
  if (!t || t.slots === undefined) return null
  if (target.kind === 'storey') {
    const s = t.slots.find((x) => x.id === target.slot)
    if (!s || s.blocks.includes(block)) return null
    return updateSlot(bp, target.type, target.slot, { blocks: [...s.blocks, block] })
  }
  return insertSlot(bp, target.type, target.index, { id: storeyIdFor(bp, target.type, block), blocks: [block], min: 0 })
}

/** Issues compared without their path: a storey inserted above another moves the paths of everything below it. */
const issueKey = (i: ModelIssue) => `${i.code}\u0000${i.message}`

/** Whether `block` may go on `target`, and the draft if so (module docs). */
export function judgeDrop(check: (bp: Blueprint) => ModelIssue[], bp: Blueprint, target: DropTarget, block: string): Verdict {
  const next = placeBlock(bp, target, block)
  if (!next) return { target, ok: false, reason: target.kind === 'storey' ? 'This storey already has that block.' : 'This building takes any blocks: it has no storeys to place into.', next: null }
  const before = new Set(check(bp).map(issueKey))
  const fresh = check(next).filter((i) => !before.has(issueKey(i)))
  return fresh.length ? { target, ok: false, reason: fresh[0].message, next: null } : { target, ok: true, reason: null, next }
}

/** Every target of a type judged at once (when a brick is picked up): the studs that light green, the seams that stay red. */
export function judgeAll(check: (bp: Blueprint) => ModelIssue[], bp: Blueprint, type: string, block: string): Map<string, Verdict> {
  return new Map(dropTargets(bp, type).map((t) => [targetKey(t), judgeDrop(check, bp, t, block)]))
}
