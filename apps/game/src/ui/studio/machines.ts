/**
 * The Factory workbench's model (FEAT-103, ADR-0077): a tool graph
 * (`swarmpress.tool.v1`, crates/blueprint/src/tools.rs) edited in the Studio's
 * grammar. Machines come from the closed node catalogue with sensible
 * defaults; tubes join an outlet to an inlet. Every candidate tube is judged
 * by the site's own tool checker (`check_tool`, blueprint-wasm): allowed when
 * it adds no issue the graph did not have, refused with the checker's reason.
 * Pure: the checker is passed in. Ports mirror `Node::in_ports`/`out_ports`.
 */
import type { ModelIssue, ToolGraph, ToolNode } from '../../blueprint/types'

const str = (v: unknown) => (typeof v === 'string' ? v : null)

export interface Ports {
  ins: { port: string; required: boolean }[]
  outs: string[]
}

/** The ports a node reads and writes (tools.rs `in_ports`, `out_ports`). */
export function portsOf(n: ToolNode): Ports {
  switch (n.kind) {
    case 'input':
      return { ins: [], outs: ['out'] }
    case 'output':
      return { ins: [{ port: 'in', required: true }], outs: [] }
    case 'connector':
      return { ins: [{ port: 'params', required: false }], outs: ['out'] }
    case 'op':
      return {
        ins: n.op === 'filter' ? [{ port: 'in', required: true }, { port: 'param', required: false }] : n.op === 'merge' ? [{ port: 'in', required: true }, { port: 'b', required: true }] : [{ port: 'in', required: true }],
        outs: ['out'],
      }
    case 'condition':
      return {
        ins: [{ port: 'in', required: true }],
        outs: n.test === 'switch' ? [...(Array.isArray(n.cases) ? (n.cases as string[]) : []), 'else'] : ['yes', 'no'],
      }
    case 'agent':
    case 'skill':
      return { ins: [{ port: 'in', required: true }], outs: ['out'] }
    default: {
      // n8n (ADR-0076): numbered ports.
      const ins = Math.max(1, Math.min(4, Number(n.inputs ?? 1)))
      const outs = Math.max(1, Math.min(8, Number(n.outputs ?? 1)))
      return { ins: ['in', 'in1', 'in2', 'in3'].slice(0, ins).map((port) => ({ port, required: false })), outs: Array.from({ length: outs }, (_, k) => (k === 0 ? 'out' : `out${k}`)) }
    }
  }
}

/** One part of the machine tray: a node kind with its defaults. */
export interface MachinePart {
  id: string
  label: string
  /** Tray group. */
  group: 'flow' | 'fetch' | 'shape' | 'decide' | 'people'
  shape: string
  description: string
  make: (id: string) => Omit<ToolNode, 'id'>
}

export const MACHINE_PARTS: readonly MachinePart[] = [
  { id: 'input', label: 'Input', group: 'flow', shape: 'input', description: 'A hopper: what the tool is given (a page, an item, the site)', make: () => ({ kind: 'input', port: 'in' }) },
  { id: 'output', label: 'Output', group: 'flow', shape: 'output', description: 'A chute: what the tool makes, for a storey to show', make: () => ({ kind: 'output', port: 'out' }) },
  { id: 'http-get', label: 'Web page', group: 'fetch', shape: 'connector', description: 'Fetch JSON from an https address', make: () => ({ kind: 'connector', connector: 'http-get', url: 'https://example.org/data.json', returns: 'Json' }) },
  { id: 'rss', label: 'Feed', group: 'fetch', shape: 'connector', description: 'Read an RSS or Atom feed', make: () => ({ kind: 'connector', connector: 'rss', url: 'https://example.org/feed.xml', returns: 'FeedItem[]' }) },
  { id: 'web-search', label: 'Web search', group: 'fetch', shape: 'connector', description: 'Search the web (counted against the run’s limits)', make: () => ({ kind: 'connector', connector: 'web-search', query: 'Cinque Terre', returns: 'SearchResult[]' }) },
  { id: 'knowledge', label: 'Site knowledge', group: 'fetch', shape: 'connector', description: 'The site’s own pages, media or entities', make: () => ({ kind: 'connector', connector: 'knowledge', query: 'pages', returns: 'Page[]' }) },
  { id: 'pick', label: 'Pick', group: 'shape', shape: 'op', description: 'Take one field out', make: () => ({ kind: 'op', op: 'pick', path: 'title', returns: 'string' }) },
  { id: 'map', label: 'Map', group: 'shape', shape: 'op', description: 'Reshape each item', make: () => ({ kind: 'op', op: 'map', fields: { title: 'title' }, returns: 'Json' }) },
  { id: 'filter', label: 'Filter', group: 'shape', shape: 'op', description: 'Keep the items that match', make: () => ({ kind: 'op', op: 'filter', where: { path: 'title', cmp: 'contains', value: '' } }) },
  { id: 'sort', label: 'Sort', group: 'shape', shape: 'op', description: 'Order the items', make: () => ({ kind: 'op', op: 'sort', path: 'title' }) },
  { id: 'limit', label: 'Limit', group: 'shape', shape: 'op', description: 'Keep the first few', make: () => ({ kind: 'op', op: 'limit', count: 5 }) },
  { id: 'merge', label: 'Merge', group: 'shape', shape: 'op', description: 'Join two lists', make: () => ({ kind: 'op', op: 'merge' }) },
  { id: 'format', label: 'Format', group: 'shape', shape: 'op', description: 'Write text from a template', make: () => ({ kind: 'op', op: 'format', template: '{title}' }) },
  { id: 'compare', label: 'If', group: 'decide', shape: 'condition', description: 'Two ways on: yes or no', make: () => ({ kind: 'condition', test: 'compare', path: 'count', cmp: 'gt', value: 0 }) },
  { id: 'exists', label: 'If there is', group: 'decide', shape: 'condition', description: 'Yes when a field is there', make: () => ({ kind: 'condition', test: 'exists', path: 'title' }) },
  { id: 'switch', label: 'Switch', group: 'decide', shape: 'condition', description: 'One way per case, then else', make: () => ({ kind: 'condition', test: 'switch', path: 'kind', cases: ['a', 'b'] }) },
  { id: 'agent', label: 'Staff step', group: 'people', shape: 'agent', description: 'A staff member does a step (a model call, within the run’s limits)', make: () => ({ kind: 'agent', role: 'writer', tier: 'low', instruction: 'Summarise this in one sentence.', output: 'string' }) },
]

export const MACHINE_GROUPS: Record<MachinePart['group'], string> = { flow: 'In and out', fetch: 'Fetch', shape: 'Shape', decide: 'Decide', people: 'Staff' }

/** A fresh node id for a part: lowercase, digits and `-` (blueprint `valid_id`), `limit`, `limit-2`, … */
export function nodeIdFor(graph: ToolGraph, part: MachinePart): string {
  const taken = new Set(graph.nodes.map((n) => n.id))
  const stem = part.id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'machine'
  if (!taken.has(stem)) return stem
  let n = 2
  while (taken.has(`${stem}-${n}`)) n++
  return `${stem}-${n}`
}

const clone = (g: ToolGraph): ToolGraph => JSON.parse(JSON.stringify(g)) as ToolGraph

/** The graph with a part placed; an input or output also declares its port on the tool (as `Json`). */
export function addMachine(graph: ToolGraph, part: MachinePart): { graph: ToolGraph; id: string } {
  const id = nodeIdFor(graph, part)
  const next = clone(graph)
  const node = { id, ...part.make(id) } as ToolNode
  if (node.kind === 'input') {
    const taken = Object.keys(next.inputs ?? {})
    let port = 'in'
    for (let k = 2; taken.includes(port); k++) port = `in${k}`
    node.port = port
    next.inputs = { ...(next.inputs ?? {}), [port]: 'Json' }
  }
  if (node.kind === 'output') {
    const used = new Set(next.nodes.filter((n) => n.kind === 'output').map((n) => str(n.port)))
    let port = 'out'
    for (let k = 2; used.has(port); k++) port = `out${k}`
    node.port = port
    next.outputs = { ...next.outputs, [port]: next.outputs[port] ?? 'Json' }
  }
  next.nodes.push(node)
  return { graph: next, id }
}

/** The graph without a node and its tubes. */
export function removeMachine(graph: ToolGraph, id: string): ToolGraph {
  const next = clone(graph)
  next.nodes = next.nodes.filter((n) => n.id !== id)
  next.edges = next.edges.filter(([a, b]) => a.split('.')[0] !== id && b.split('.')[0] !== id)
  return next
}

/** The graph with a node's fields replaced (its id stays; tubes follow it). */
export function updateMachine(graph: ToolGraph, id: string, patch: Record<string, unknown>): ToolGraph {
  const next = clone(graph)
  const i = next.nodes.findIndex((n) => n.id === id)
  if (i >= 0) next.nodes[i] = { ...next.nodes[i], ...patch, id, kind: next.nodes[i].kind } as ToolNode
  for (const [k, v] of Object.entries(next.nodes[i] ?? {})) if (v === undefined) delete (next.nodes[i] as Record<string, unknown>)[k]
  return next
}

/** The graph with a tube from `from` (`node.port`) to `to`; an inlet takes one tube, so an old one into it goes. */
export function connect(graph: ToolGraph, from: string, to: string): ToolGraph {
  const next = clone(graph)
  next.edges = [...next.edges.filter(([, b]) => b !== to), [from, to]]
  return next
}

export function disconnect(graph: ToolGraph, from: string, to: string): ToolGraph {
  const next = clone(graph)
  next.edges = next.edges.filter(([a, b]) => !(a === from && b === to))
  return next
}

/** A new, empty tool: on demand, one output. */
export function newTool(id: string, name: string): ToolGraph {
  return { format: 'swarmpress.tool.v1', id, name: { en: name || id }, outputs: { out: 'Json' }, nodes: [], edges: [], triggers: [{ kind: 'on-demand' }] }
}

export interface TubeVerdict {
  to: string
  ok: boolean
  reason: string | null
  next: ToolGraph | null
}

const issueKey = (i: ModelIssue) => `${i.code}\u0000${i.message}`

/** Whether a tube from `from` may go into `to` (module docs). */
export function judgeTube(check: (g: ToolGraph) => ModelIssue[], graph: ToolGraph, from: string, to: string): TubeVerdict {
  if (from.split('.')[0] === to.split('.')[0]) return { to, ok: false, reason: 'A machine cannot feed itself.', next: null }
  if (graph.edges.some(([a, b]) => a === from && b === to)) return { to, ok: false, reason: 'This tube is already there.', next: null }
  const next = connect(graph, from, to)
  const before = new Set(check(graph).map(issueKey))
  const fresh = check(next).filter((i) => !before.has(issueKey(i)))
  return fresh.length ? { to, ok: false, reason: fresh[0].message, next: null } : { to, ok: true, reason: null, next }
}

/** Every inlet of every other machine judged for a tube from `from`. */
export function judgeTubes(check: (g: ToolGraph) => ModelIssue[], graph: ToolGraph, from: string): Map<string, TubeVerdict> {
  const out = new Map<string, TubeVerdict>()
  for (const n of graph.nodes) for (const p of portsOf(n).ins) out.set(`${n.id}.${p.port}`, judgeTube(check, graph, from, `${n.id}.${p.port}`))
  return out
}
