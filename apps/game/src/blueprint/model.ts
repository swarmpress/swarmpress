/**
 * The brick canvas's pure logic (design §5.1, FEAT-090): the street order of
 * the buildings, the view of a draft against the blueprint it was made on
 * (diff marks, issues per storey), the CEO's edits as functions from a
 * blueprint to a new one, and the layered layout of a tool's machine.
 * Nothing here draws; the components in `ui/blueprint/` do.
 */
import type { Blueprint, BlueprintChange, BlueprintPageType, BlueprintSlot, ModelIssue, ToolGraph, ToolNode } from './types'

export type Mark = 'added' | 'removed' | 'changed' | null

/** Buildings in navigation order, then in declaration order: town.rs `street()`. */
export function streetOrder(bp: Blueprint): BlueprintPageType[] {
  const seen = new Set<string>()
  const out: BlueprintPageType[] = []
  const byId = new Map(bp.page_types.map((t) => [t.id, t]))
  for (const n of bp.navigation ?? []) {
    const t = n.page_type ? byId.get(n.page_type) : undefined
    if (t && !seen.has(t.id)) {
      seen.add(t.id)
      out.push(t)
    }
  }
  for (const t of bp.page_types) {
    if (!seen.has(t.id)) {
      seen.add(t.id)
      out.push(t)
    }
  }
  return out
}

export interface StoreyView {
  slot: BlueprintSlot
  /** Its index in the draft's slots; null for a removed (ghosted) storey. */
  index: number | null
  mark: Mark
  fields: string[]
  issues: ModelIssue[]
}

export interface BuildingView {
  type: BlueprintPageType
  /** Its index in the draft's `page_types`; null for a removed (ghosted) building. */
  index: number | null
  mark: Mark
  fields: string[]
  /** Issues of the type itself (not of one of its storeys). */
  issues: ModelIssue[]
  storeys: StoreyView[]
  /** Named by the site's navigation. */
  nav: boolean
}

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`)

/**
 * The buildings to draw for `draft`, made on `base`: the draft's in street
 * order with their storeys, then the removed ones ghosted; a removed storey is
 * ghosted at its old place. `issues` are the draft's (paths index the draft).
 */
export function buildingsOf(draft: Blueprint, base: Blueprint, changes: BlueprintChange[], issues: ModelIssue[]): BuildingView[] {
  const change = (subject: BlueprintChange['subject'], id: string) => changes.find((c) => c.subject === subject && c.id === id)
  const index = new Map(draft.page_types.map((t, i) => [t.id, i]))
  const nav = new Set((draft.navigation ?? []).map((n) => n.page_type).filter((x): x is string => !!x))
  const baseTypes = new Map(base.page_types.map((t) => [t.id, t]))

  const building = (t: BlueprintPageType, i: number | null): BuildingView => {
    const prefix = i == null ? null : `/page_types/${i}`
    const c = i == null ? undefined : change('page-type', t.id)
    const storeys: StoreyView[] = (t.slots ?? []).map((slot, j) => {
      const sc = change('slot', `${t.id}/${slot.id}`)
      return {
        slot,
        index: j,
        mark: c?.kind === 'added' ? 'added' : (sc?.kind ?? null),
        fields: sc?.fields ?? [],
        issues: prefix ? issues.filter((x) => under(x.path, `${prefix}/slots/${j}`)) : [],
      }
    })
    // Storeys the draft removed: ghosted where they stood.
    const old = baseTypes.get(t.id)
    if (i != null && old) {
      ;(old.slots ?? []).forEach((slot, j) => {
        if (change('slot', `${t.id}/${slot.id}`)?.kind !== 'removed') return
        storeys.splice(Math.min(j, storeys.length), 0, { slot, index: null, mark: 'removed', fields: [], issues: [] })
      })
    }
    return {
      type: t,
      index: i,
      mark: i == null ? 'removed' : (c?.kind ?? null),
      fields: c?.fields ?? [],
      issues: prefix ? issues.filter((x) => under(x.path, prefix) && !x.path.startsWith(`${prefix}/slots/`)) : [],
      storeys,
      nav: nav.has(t.id),
    }
  }

  const out = streetOrder(draft).map((t) => building(t, index.get(t.id) ?? null))
  for (const t of streetOrder(base)) {
    if (!index.has(t.id)) out.push(building(t, null))
  }
  return out
}

/** A slot's occurrence in words: "required, once", "optional, up to 3", "any number". */
export function occurrence(slot: BlueprintSlot): string {
  const min = slot.min ?? 0
  const max = slot.max
  if (max === undefined) return min === 0 ? 'optional, any number of blocks' : `required, at least ${min}`
  if (min === 0) return max === 1 ? 'optional, at most one block' : `optional, up to ${max} blocks`
  if (min === max) return min === 1 ? 'required, exactly one block' : `required, exactly ${min} blocks`
  return `required, ${min} to ${max} blocks`
}

/** A repeated storey (more than one block may stand in it) is drawn double height, as in the town. */
export const repeated = (slot: BlueprintSlot) => slot.max === undefined || slot.max > 1

// ---- edits: each returns a new blueprint, never mutates --------------------

const clone = (bp: Blueprint): Blueprint => JSON.parse(JSON.stringify(bp)) as Blueprint

function withType(bp: Blueprint, id: string, f: (t: BlueprintPageType) => void): Blueprint {
  const next = clone(bp)
  const t = next.page_types.find((x) => x.id === id)
  if (t) f(t)
  return next
}

export function addPageType(bp: Blueprint, t: { id: string; label: string; route?: string }): Blueprint {
  const next = clone(bp)
  next.page_types.push({
    id: t.id,
    label: { en: t.label },
    ...(t.route ? { route: t.route } : {}),
    source: { kind: 'page' },
    slots: [],
  })
  return next
}

/** Removes a page type with the relationships and navigation entries that name it. */
export function removePageType(bp: Blueprint, id: string): Blueprint {
  const next = clone(bp)
  next.page_types = next.page_types.filter((t) => t.id !== id)
  if (next.relationships) next.relationships = next.relationships.filter((r) => r.from !== id && r.to !== id)
  if (next.navigation) next.navigation = next.navigation.filter((n) => n.page_type !== id)
  return next
}

export function updatePageType(bp: Blueprint, id: string, patch: { label?: string; route?: string }): Blueprint {
  return withType(bp, id, (t) => {
    if (patch.label !== undefined) t.label = { ...t.label, en: patch.label }
    if (patch.route !== undefined) {
      if (patch.route) t.route = patch.route
      else delete t.route
    }
  })
}

export function addSlot(bp: Blueprint, typeId: string, slot: BlueprintSlot): Blueprint {
  return withType(bp, typeId, (t) => {
    t.slots = [...(t.slots ?? []), slot]
  })
}

export function removeSlot(bp: Blueprint, typeId: string, slotId: string): Blueprint {
  return withType(bp, typeId, (t) => {
    t.slots = (t.slots ?? []).filter((s) => s.id !== slotId)
  })
}

/** Moves a storey up (-1, earlier on the page) or down (+1). */
export function moveSlot(bp: Blueprint, typeId: string, slotId: string, delta: -1 | 1): Blueprint {
  return withType(bp, typeId, (t) => {
    const slots = t.slots ?? []
    const i = slots.findIndex((s) => s.id === slotId)
    const j = i + delta
    if (i < 0 || j < 0 || j >= slots.length) return
    ;[slots[i], slots[j]] = [slots[j], slots[i]]
  })
}

/** Sets a storey's blocks, min or max (`max: null` removes the bound). */
export function updateSlot(bp: Blueprint, typeId: string, slotId: string, patch: { blocks?: string[]; min?: number; max?: number | null }): Blueprint {
  return withType(bp, typeId, (t) => {
    const s = (t.slots ?? []).find((x) => x.id === slotId)
    if (!s) return
    if (patch.blocks) s.blocks = patch.blocks
    if (patch.min === 0) delete s.min
    else if (patch.min !== undefined) s.min = patch.min
    if (patch.max === null) delete s.max
    else if (patch.max !== undefined) s.max = patch.max
  })
}

type Relationship = NonNullable<Blueprint['relationships']>[number]

export function addRelationship(bp: Blueprint, r: Relationship): Blueprint {
  const next = clone(bp)
  next.relationships = [...(next.relationships ?? []), r]
  return next
}

export function removeRelationship(bp: Blueprint, index: number): Blueprint {
  const next = clone(bp)
  next.relationships = (next.relationships ?? []).filter((_, i) => i !== index)
  return next
}

/** The diff id of a relationship (diff.rs): `from>to:kind`. */
export const relationshipId = (r: Relationship) => `${r.from}>${r.to}:${r.kind}`

/** A fresh id with this stem that `taken` does not have: `body`, `body-2`, … */
export function freshId(stem: string, taken: Iterable<string>): string {
  const have = new Set(taken)
  if (!have.has(stem)) return stem
  let n = 2
  while (have.has(`${stem}-${n}`)) n++
  return `${stem}-${n}`
}

// ---- tools: the factory district ----------------------------------------

export interface MachineNode {
  node: ToolNode
  /** The longest path from a node without inputs (an input, or a connector that fetches on its own). */
  layer: number
  /** Its place within the layer, by node id. */
  row: number
  /** The type it hands on (its `returns`, the input's port type, or what flows in); null when unknown. */
  type: string | null
}

export interface MachineEdge {
  from: string
  fromPort: string
  to: string
  toPort: string
  type: string | null
}

export interface MachineLayout {
  nodes: MachineNode[]
  edges: MachineEdge[]
  layers: number
  rows: number
}

const split = (ref: string): [string, string] => {
  const dot = ref.indexOf('.')
  return dot < 0 ? [ref, ''] : [ref.slice(0, dot), ref.slice(dot + 1)]
}

/** Byte order of ids, as Rust's `BTreeMap` sorts them. */
const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/**
 * The deterministic layered drawing of design §4.3: a node's layer is its
 * longest path from a source, nodes within a layer are ordered by id. It
 * does not depend on any editor position.
 */
export function layoutTool(graph: ToolGraph): MachineLayout {
  const nodes = graph.nodes
  const ids = new Set(nodes.map((n) => n.id))
  const edges = graph.edges.map(([a, b]) => {
    const [from, fromPort] = split(a)
    const [to, toPort] = split(b)
    return { from, fromPort, to, toPort }
  })
  const known = edges.filter((e) => ids.has(e.from) && ids.has(e.to))
  // Kahn's order with the ready set sorted by id: deterministic, and a cycle (the checker's issue) still terminates.
  const indeg = new Map(nodes.map((n) => [n.id, 0]))
  for (const e of known) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1)
  const ready = nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id).sort(byId)
  const order: string[] = []
  const left = new Map(indeg)
  while (ready.length > 0) {
    const id = ready.shift()!
    order.push(id)
    for (const e of known.filter((x) => x.from === id)) {
      const d = (left.get(e.to) ?? 0) - 1
      left.set(e.to, d)
      if (d === 0) {
        ready.push(e.to)
        ready.sort(byId)
      }
    }
  }
  for (const n of nodes.map((x) => x.id).sort(byId)) if (!order.includes(n)) order.push(n)

  const layer = new Map<string, number>()
  const type = new Map<string, string | null>()
  const node = new Map(nodes.map((n) => [n.id, n]))
  for (const id of order) {
    const into = known.filter((e) => e.to === id)
    layer.set(id, into.reduce((m, e) => (order.indexOf(e.from) < order.indexOf(id) ? Math.max(m, (layer.get(e.from) ?? 0) + 1) : m), 0))
    const n = node.get(id)!
    const inflow = into.find((e) => e.toPort === 'in') ?? into[0]
    const passed = inflow ? (type.get(inflow.from) ?? null) : null
    const s = (k: string) => (typeof n[k] === 'string' ? (n[k] as string) : null)
    type.set(
      id,
      n.kind === 'input'
        ? (graph.inputs?.[s('port') ?? ''] ?? null)
        : n.kind === 'agent'
          ? (s('output') ?? s('returns'))
          : n.kind === 'output'
            ? (graph.outputs[s('port') ?? ''] ?? passed)
            : (s('returns') ?? passed),
    )
  }
  const layers = Math.max(0, ...layer.values()) + 1
  const out: MachineNode[] = []
  let rows = 0
  for (let l = 0; l < layers; l++) {
    const here = nodes.filter((n) => layer.get(n.id) === l).sort((a, b) => byId(a.id, b.id))
    rows = Math.max(rows, here.length)
    here.forEach((n, row) => out.push({ node: n, layer: l, row, type: type.get(n.id) ?? null }))
  }
  return {
    nodes: out,
    edges: edges.map((e) => ({ ...e, type: type.get(e.from) ?? null })),
    layers: nodes.length ? layers : 0,
    rows,
  }
}

/** A trigger in words. */
export function triggerText(t: NonNullable<ToolGraph['triggers']>[number]): string {
  if (t.kind === 'on-demand') return 'on demand'
  if (t.kind === 'build') return 'at every site build'
  return t.every_game_days === 1 ? 'every game day' : `every ${t.every_game_days} game days`
}
