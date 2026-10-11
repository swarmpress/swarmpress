/**
 * The Data Studio's reading of the site's models (ADR-0086; the type subset of
 * `crates/blueprint/src/types.rs`): each named type's fields with their kind,
 * required-ness and enum values, the relations between the site's types (a
 * field whose type, or whose items' type, is a `$ref` to another site type),
 * and where a type is used (collections, the page types that render them,
 * tools' ports). Everything is derived from the schemas; nothing is invented.
 * The layout of the canvas is deterministic: the same models, the same picture.
 */
import type { SiteModels } from '../../blueprint/types'

/** A field's kind: what its icon, pill and brick show. */
export type FieldKind = 'text' | 'localized' | 'number' | 'integer' | 'boolean' | 'enum' | 'relation' | 'media' | 'object' | 'builtin' | 'json' | 'unknown'

/** The built-in types of the registry (`builtins()` in types.rs) a `$ref` may name besides the site's own. */
const BUILTIN = new Set(['string', 'integer', 'number', 'boolean', 'LocalizedString', 'Json', 'Media', 'Page', 'Article', 'FeedItem', 'SearchResult', 'Village', 'Trail', 'Transport', 'Category'])

export interface FieldType {
  kind: FieldKind
  /** A list of them (`type: array`). */
  list: boolean
  /** The pill's words: `Text`, `FerryRow[]`, `Enum`. */
  label: string
  /** The referenced type, for `$ref`s (site or built-in). */
  ref?: string
  /** An enum's values, in schema order. */
  values?: string[]
  /** An inline object's own fields. */
  fields?: Field[]
  /** The string's `format`, when the schema gives one. */
  format?: string
}

export interface Field {
  name: string
  type: FieldType
  required: boolean
  title?: string
  description?: string
}

export interface Model {
  name: string
  title?: string
  description?: string
  /** Whether the object is closed (`additionalProperties: false`). */
  closed: boolean
  /** The type's own shape when it is not an object (an enum, a list…). */
  shape?: FieldType
  fields: Field[]
}

/** One field of one site type referencing another site type. */
export interface Relation {
  from: string
  field: string
  to: string
  many: boolean
  required: boolean
}

type Schema = Record<string, unknown>

const isObj = (v: unknown): v is Schema => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)

/** The name a `$ref` names (`#/types/Name` or `Name`, as types.rs reads it). */
export function refName(ref: string): string {
  return ref.startsWith('#/types/') ? ref.slice('#/types/'.length) : ref
}

/** A schema's type, as the field list shows it. `site`: the site's own type names. */
export function typeOf(schema: unknown, site: ReadonlySet<string>): FieldType {
  if (!isObj(schema)) return { kind: 'unknown', list: false, label: 'Unknown' }
  const ref = str(schema.$ref)
  if (ref) {
    const name = refName(ref)
    if (site.has(name)) return { kind: 'relation', list: false, label: name, ref: name }
    if (name === 'LocalizedString') return { kind: 'localized', list: false, label: 'Localized text', ref: name }
    if (name === 'Media') return { kind: 'media', list: false, label: 'Media', ref: name }
    if (name === 'Json') return { kind: 'json', list: false, label: 'Json', ref: name }
    if (name === 'string') return { kind: 'text', list: false, label: 'Text', ref: name }
    if (name === 'integer' || name === 'number' || name === 'boolean') return typeOf({ type: name }, site)
    if (BUILTIN.has(name)) return { kind: 'builtin', list: false, label: name, ref: name }
    return { kind: 'unknown', list: false, label: name, ref: name }
  }
  if (Array.isArray(schema.enum)) {
    return { kind: 'enum', list: false, label: 'Enum', values: schema.enum.filter((v): v is string => typeof v === 'string') }
  }
  // `type` may be a list with `null` (an optional value); its other member names the type.
  const t = Array.isArray(schema.type) ? schema.type.find((x) => x !== 'null') : schema.type
  switch (t) {
    case 'string': {
      const format = str(schema.format)
      return { kind: 'text', list: false, label: format ? `Text (${format})` : 'Text', ...(format ? { format } : {}) }
    }
    case 'integer':
      return { kind: 'integer', list: false, label: 'Integer' }
    case 'number':
      return { kind: 'number', list: false, label: 'Number' }
    case 'boolean':
      return { kind: 'boolean', list: false, label: 'Boolean' }
    case 'array': {
      const item = typeOf(schema.items, site)
      return { ...item, list: true, label: `${item.label}[]` }
    }
    case 'object':
      return { kind: 'object', list: false, label: 'Object', fields: fieldsOfSchema(schema, site) }
    default:
      return { kind: 'unknown', list: false, label: typeof t === 'string' ? t : 'Unknown' }
  }
}

/** An object schema's fields in `properties` order. */
function fieldsOfSchema(schema: Schema, site: ReadonlySet<string>): Field[] {
  const props = isObj(schema.properties) ? schema.properties : {}
  const required = new Set(Array.isArray(schema.required) ? schema.required.filter((r): r is string => typeof r === 'string') : [])
  return Object.entries(props).map(([name, s]) => ({
    name,
    type: typeOf(s, site),
    required: required.has(name),
    ...(isObj(s) && str(s.title) ? { title: str(s.title) } : {}),
    ...(isObj(s) && str(s.description) ? { description: str(s.description) } : {}),
  }))
}

/** The fields of a JSON-schema-like type: `properties` names, in order. */
export function fieldsOf(schema: unknown): string[] {
  return isObj(schema) && isObj(schema.properties) ? Object.keys(schema.properties) : []
}

export interface DataModels {
  models: Model[]
  relations: Relation[]
}

/** The site's types as models (sorted by name) and the relations between them. */
export function readModels(types: Record<string, unknown> | undefined): DataModels {
  const names = Object.keys(types ?? {}).sort((a, b) => a.localeCompare(b))
  const site = new Set(names)
  const models: Model[] = names.map((name) => {
    const s = (types ?? {})[name]
    const o = isObj(s) ? s : {}
    const object = o.type === 'object' || (o.type === undefined && isObj(o.properties) && !o.$ref)
    return {
      name,
      ...(str(o.title) ? { title: str(o.title) } : {}),
      ...(str(o.description) ? { description: str(o.description) } : {}),
      closed: o.additionalProperties === false,
      ...(object ? {} : { shape: typeOf(s, site) }),
      fields: object ? fieldsOfSchema(o, site) : [],
    }
  })
  const relations: Relation[] = []
  for (const m of models) {
    for (const f of m.fields) {
      if (f.type.kind === 'relation' && f.type.ref) relations.push({ from: m.name, field: f.name, to: f.type.ref, many: f.type.list, required: f.required })
    }
  }
  return { models, relations }
}

/** Where a type is used on the site: its collections, the page types that render them, the tools' ports. */
export interface Usage {
  collections: { id: string; from: string; order?: string; limit?: number; items?: number; pageTypes: string[] }[]
  tools: { id: string; port: string; dir: 'input' | 'output'; expr: string }[]
}

/** The type a type expression names (`Name`, `Name[]`, `Name?`). */
function exprName(expr: string): string {
  return expr.replace(/\?$/, '').replace(/\[\]$/, '')
}

export function usageOf(name: string, models: SiteModels): Usage {
  const bp = models.blueprint
  const collections = (bp?.collections ?? [])
    .filter((c) => c.type === name)
    .map((c) => ({
      id: c.id,
      from: c.from,
      ...(c.order ? { order: c.order } : {}),
      ...(c.limit !== undefined ? { limit: c.limit } : {}),
      ...(c.items !== undefined ? { items: c.items } : {}),
      pageTypes: (bp?.page_types ?? []).filter((p) => p.source.kind === 'collection-item' && p.source.collection === c.id).map((p) => p.id),
    }))
  const tools: Usage['tools'] = []
  for (const t of models.tools ?? []) {
    for (const [dir, ports] of [
      ['input', t.graph.inputs ?? {}],
      ['output', t.graph.outputs ?? {}],
    ] as const) {
      for (const [port, expr] of Object.entries(ports)) if (exprName(expr) === name) tools.push({ id: t.id, port, dir, expr })
    }
  }
  return { collections, tools }
}

/** The canvas's geometry: a card per model, placed on a grid. */
export const CARD_W = 204
export const HEAD_H = 46
export const ROW_H = 24
const PAD_B = 14
export const GAP_X = 86
const GAP_Y = 84
const MARGIN = 22
/** Every other column sits a little lower: islands, not a spreadsheet. */
const STAGGER = 30

export interface Placed {
  name: string
  x: number
  y: number
  w: number
  h: number
}

export function cardHeight(m: Model): number {
  return HEAD_H + Math.max(1, m.fields.length) * ROW_H + PAD_B
}

/**
 * The order of the cards: connected models next to each other. Components are
 * ordered by their first name; inside one, a walk from its first root (a model
 * nothing points at, else its first name) along relations, by name.
 */
export function cardOrder(d: DataModels): string[] {
  const nbrs = new Map<string, string[]>(d.models.map((m) => [m.name, []]))
  const incoming = new Set(d.relations.filter((r) => r.from !== r.to).map((r) => r.to))
  for (const r of d.relations) {
    if (r.from === r.to) continue
    nbrs.get(r.from)?.push(r.to)
    nbrs.get(r.to)?.push(r.from)
  }
  for (const list of nbrs.values()) list.sort((a, b) => a.localeCompare(b))
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of d.models) {
    if (seen.has(m.name)) continue
    // The component, then its root.
    const comp: string[] = []
    const stack = [m.name]
    const inComp = new Set([m.name])
    while (stack.length) {
      const n = stack.pop()!
      comp.push(n)
      for (const x of nbrs.get(n) ?? []) if (!inComp.has(x)) (inComp.add(x), stack.push(x))
    }
    comp.sort((a, b) => a.localeCompare(b))
    const root = comp.find((n) => !incoming.has(n)) ?? comp[0]
    const queue = [root]
    seen.add(root)
    while (queue.length) {
      const n = queue.shift()!
      out.push(n)
      for (const x of nbrs.get(n) ?? []) if (!seen.has(x)) (seen.add(x), queue.push(x))
    }
  }
  return out
}

/** The cards' places and the canvas's size. */
export function layout(d: DataModels): { cards: Placed[]; width: number; height: number } {
  const order = cardOrder(d)
  const byName = new Map(d.models.map((m) => [m.name, m]))
  const n = order.length
  const cols = n <= 1 ? 1 : n <= 4 ? 2 : 3
  const cards: Placed[] = []
  let y = MARGIN
  for (let row = 0; row * cols < n; row++) {
    const names = order.slice(row * cols, row * cols + cols)
    let tallest = 0
    names.forEach((name, col) => {
      const h = cardHeight(byName.get(name)!)
      const dy = col % 2 === 1 ? STAGGER : 0
      cards.push({ name, x: MARGIN + col * (CARD_W + GAP_X), y: y + dy, w: CARD_W, h })
      tallest = Math.max(tallest, h + dy)
    })
    y += tallest + GAP_Y
  }
  const width = MARGIN * 2 + Math.min(cols, n) * CARD_W + (Math.min(cols, n) - 1) * GAP_X
  return { cards, width, height: y - GAP_Y + MARGIN }
}

/** A relation's line: from the field's row on one card to the other card's head; its caption's place. */
export function edgePath(from: Placed, fieldIndex: number, to: Placed): { d: string; mid: { x: number; y: number } } {
  const y1 = from.y + HEAD_H + fieldIndex * ROW_H + ROW_H / 2
  const y2 = to.y + HEAD_H / 2
  if (from.name === to.name) {
    // A type that refers to itself: a loop off its right edge.
    const x = from.x + from.w
    return { d: `M${x} ${y1} C${x + 60} ${y1} ${x + 60} ${y2} ${x} ${y2}`, mid: { x: x + 46, y: (y1 + y2) / 2 } }
  }
  const right = to.x >= from.x + from.w
  const left = to.x + to.w <= from.x
  if (right || left) {
    const x1 = right ? from.x + from.w : from.x
    const x2 = right ? to.x : to.x + to.w
    const c = (x2 - x1) / 2
    return { d: `M${x1} ${y1} C${x1 + c} ${y1} ${x2 - c} ${y2} ${x2} ${y2}`, mid: { x: (x1 + x2) / 2, y: (y1 + y2) / 2 } }
  }
  // The same column: out of the right edge and back into the other card's right edge.
  const x = from.x + from.w
  const bulge = 70
  return { d: `M${x} ${y1} C${x + bulge} ${y1} ${x + bulge} ${y2} ${x} ${y2}`, mid: { x: x + bulge * 0.75, y: (y1 + y2) / 2 } }
}
