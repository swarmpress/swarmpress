/**
 * The factory district (design §4.3): one machine per tool of the site, its
 * nodes as brick tiles in the deterministic layered layout (layer = longest
 * path from a source, ordered by id within a layer), its edges as tubes
 * coloured by the type flowing through them. Each card shows the tool's
 * triggers, its derived manifest (capabilities, origins) and its issues, the
 * server's and the browser checker's. An imported n8n node (ADR-0076) is the
 * machine of what it does. Above the machines: importing an n8n workflow and
 * the credentials the tools sign in with.
 */
import { N8N_TYPES } from '@swarm-press/toolgraph'
import { CredentialsPanel } from './Credentials'
import { N8nImportPanel } from './N8nImport'
import { hexOf, inkOn, typeColour } from '../../blueprint/colours'
import { layoutTool, triggerText, type MachineNode } from '../../blueprint/model'
import type { SiteModels, SiteTool, ModelIssue } from '../../blueprint/types'
import { checkTool, toolManifest, type BlueprintApi } from '../../blueprint/wasm'
import { Badge, Notice } from '../components/common'
import { useStore } from '../store'
import { toolRef } from '../../tools/runner'
import { Issues } from './Inspector'

const COL = 172
const ROW = 118
const W = 112
const H = 56
const PAD = 20

const KIND_LABEL: Record<string, string> = {
  input: 'hopper',
  output: 'chute',
  connector: 'dish',
  op: 'gearbox',
  condition: 'switch',
  agent: 'workstation',
  skill: 'crate',
  code: 'code bench',
}

/** The machine an n8n node stands as (as `n8n_machine` in machines.rs). */
export function n8nShape(type: string): string {
  const info = N8N_TYPES[type]
  if (!info) return 'skill'
  if (info.web || info.tool) return 'connector'
  if (info.llm) return 'agent'
  if (/\.(if|filter|switch)$/.test(type)) return 'condition'
  if (/\.(code|function|functionItem|dateTime)$/.test(type)) return 'code'
  return 'op'
}
export const shapeOf = (n: MachineNode['node']) => (n.kind === 'n8n' ? n8nShape(str(n.type) ?? '') : n.kind)

const str = (v: unknown) => (typeof v === 'string' ? v : null)

function hostOf(url: string | null): string | null {
  if (!url) return null
  try {
    return new URL(url.replace(/\{[^}]*\}/g, 'x')).host
  } catch {
    return null
  }
}

/** The words on a node's tile: what it is and its key parameter. */
export function nodeCaption(n: MachineNode['node']): string {
  switch (n.kind) {
    case 'input':
    case 'output':
      return `${n.kind} ${str(n.port) ?? ''}`.trim()
    case 'connector': {
      const host = hostOf(str(n.url))
      return `${str(n.connector) ?? 'connector'}${host ? ` · ${host}` : ''}`
    }
    case 'op':
      return `op ${str(n.op) ?? '?'}`
    case 'condition':
      return `if ${str(n.test) ?? '?'}`
    case 'agent':
      return `${str(n.role) ?? 'agent'} · ${str(n.tier) ?? 'tier?'}`
    case 'skill':
      return `${str(n.skill) ?? str(n.extension) ?? 'skill'}`
    case 'n8n': {
      const short = (str(n.type) ?? 'n8n').replace(/^.*\./, '')
      const params = (n.parameters ?? {}) as Record<string, unknown>
      const host = n8nShape(str(n.type) ?? '') === 'connector' ? hostOf(str(params.url)?.replace(/^=/, '').replace(/\{\{[^}]*\}\}/g, 'x') ?? null) : null
      return `${short}${host ? ` · ${host}` : ''}`
    }
    default:
      return n.kind
  }
}

/** A machine's brick colour (a palette id) by what it does, like the stations of a line: start green, fetch blue, shape orange, decide plum, staff yellow, ship red. */
export const SHAPE_FILL: Readonly<Record<string, string>> = { input: 'green', output: 'red', connector: 'blue', op: 'orange', condition: 'plum', agent: 'yellow', skill: 'caramel', code: 'sage' }
export const machineFill = (shape: string) => hexOf(SHAPE_FILL[shape] ?? 'grey-dark')

/** Shade a `#rrggbb` colour by `k` (below 1 darker, above lighter). */
function shade(hex: string, k: number): string {
  const n = Number.parseInt(hex.replace('#', ''), 16)
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(k > 1 ? v + (255 - v) * (k - 1) : v * k)))
  return `rgb(${c((n >> 16) & 255)}, ${c((n >> 8) & 255)}, ${c(n & 255)})`
}

/** The big icon on a machine's face (a 24-unit drawing): what the machine does. */
export function MachineGlyph({ shape, x, y, size, ink }: { shape: string; x: number; y: number; size: number; ink: string }) {
  const body = (() => {
    switch (shape) {
      case 'input':
        return <path d="M8 4.5v15l12-7.5z" fill={ink} stroke="none" />
      case 'output':
        return <path d="M12 3.5v11M7.5 8l4.5-4.5 4.5 4.5M4.5 14v5.5h15V14" />
      case 'connector':
        return (
          <>
            <circle cx={10} cy={10} r={6} />
            <path d="M14.5 14.5l5.5 5.5" />
          </>
        )
      case 'op':
        return (
          <>
            <circle cx={12} cy={12} r={3.6} />
            <path d="M12 3v3.2M12 17.8V21M3 12h3.2M17.8 12H21M5.6 5.6l2.3 2.3M16.1 16.1l2.3 2.3M5.6 18.4l2.3-2.3M16.1 7.9l2.3-2.3" />
          </>
        )
      case 'condition':
        return <path d="M3.5 12h6l5-6.5h6M9.5 12l5 6.5h6M17.5 3l3 2.5-3 2.5M17.5 16l3 2.5-3 2.5" />
      case 'agent':
        return (
          <>
            <circle cx={12} cy={8} r={4} />
            <path d="M4.5 21c0-4.2 3.4-6.5 7.5-6.5s7.5 2.3 7.5 6.5" />
          </>
        )
      case 'skill':
        return <path d="M4 7h16v13H4zM4 11h16M10 7v4M14 7v4" />
      case 'code':
        return <path d="M8.5 6.5L3 12l5.5 5.5M15.5 6.5L21 12l-5.5 5.5" />
      default:
        return <rect x={5} y={5} width={14} height={14} rx={2} />
    }
  })()
  return (
    <g transform={`translate(${x} ${y}) scale(${size / 24})`} fill="none" stroke={ink} stroke-width={2.4} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="fx-glyph">
      {body}
    </g>
  )
}

/** How deep a machine's top and side faces are drawn. */
export const DEPTH = 10
/** The plaque under a machine: its number and id. */
export const PLAQUE = 22

/**
 * A machine as a brick block on the line: the front face in its colour with
 * the big icon, the lit top with studs, the shaded side, and the dark plaque
 * under it with the station's number and the node's id (cut short to fit; the
 * whole id is in the title). A selected machine stands in a yellow glow; one
 * the checker flags wears a red seam and a red pin.
 */
export function MachineBlock({ x, y, w, h, shape, number, id, flagged, selected }: { x: number; y: number; w: number; h: number; shape: string; number: number; id: string; flagged?: boolean; selected?: boolean }) {
  const fill = machineFill(shape)
  const d = DEPTH
  const studs = Math.max(2, Math.min(4, Math.round(w / 32)))
  const gap = (w - 8) / studs
  const fit = Math.max(4, Math.floor((w - 30) / 6.6))
  const glyph = Math.min(30, h - 22)
  return (
    <g class="fx-block" data-fill={fill}>
      {selected && <rect class="fx-halo" x={x - 9} y={y - d - 11} width={w + d + 18} height={h + d + PLAQUE + 42} rx={10} fill="rgba(242, 182, 50, 0.2)" stroke="#f2b632" stroke-width={3} />}
      <rect x={x + 3} y={y + h - 2} width={w + d} height={8} rx={4} fill="rgba(60, 45, 20, 0.16)" />
      <path d={`M${x} ${y} L${x + d} ${y - d} L${x + w + d} ${y - d} L${x + w} ${y} Z`} fill={shade(fill, 1.22)} />
      <path d={`M${x + w} ${y} L${x + w + d} ${y - d} L${x + w + d} ${y + h - d} L${x + w} ${y + h} Z`} fill={shade(fill, 0.72)} />
      {Array.from({ length: studs }, (_, k) => {
        const cx = x + 4 + gap * (k + 0.5) + d / 2
        const cy = y - d / 2
        return (
          <g key={k}>
            <path d={`M${cx - 5} ${cy - 1} v3 a5 2.2 0 0 0 10 0 v-3`} fill={shade(fill, 0.8)} />
            <ellipse cx={cx} cy={cy - 1} rx={5} ry={2.2} fill={shade(fill, 1.32)} />
          </g>
        )
      })}
      <rect class="fx-front" x={x} y={y} width={w} height={h} rx={3} fill={fill} stroke={flagged ? '#c4281c' : 'rgba(0, 0, 0, 0.28)'} stroke-width={flagged ? 3 : 1} />
      <rect x={x + 3} y={y + 3} width={w - 6} height={3} rx={1.5} fill="rgba(255, 255, 255, 0.28)" pointer-events="none" />
      <MachineGlyph shape={shape} x={x + w / 2 - glyph / 2} y={y + (h - glyph) / 2 + 1} size={glyph} ink={inkOn(fill)} />
      {flagged && (
        <g class="fx-pin">
          <circle cx={x + w - 2} cy={y + 2} r={8} fill="#c4281c" stroke="#ffffff" stroke-width={1.5} />
          <text x={x + w - 2} y={y + 6} text-anchor="middle" class="fx-pin-text" fill="#ffffff">
            !
          </text>
        </g>
      )}
      <rect x={x + 2} y={y + h + 7} width={w - 4} height={PLAQUE} rx={6} fill="#26231f" />
      <circle cx={x + 14} cy={y + h + 7 + PLAQUE / 2} r={8} fill="#f2b632" />
      <text x={x + 14} y={y + h + 7 + PLAQUE / 2 + 4} text-anchor="middle" class="fx-plaque-no" fill="#26231f">
        {number}
      </text>
      <text x={x + 27} y={y + h + 7 + PLAQUE / 2 + 4} class="fx-plaque-id" fill="#ffffff">
        {id.length > fit ? `${id.slice(0, fit - 1)}…` : id}
      </text>
    </g>
  )
}

/** A belt between two machines (outlet to inlet), its rollers, and a crate riding it in the colour of the type it carries. */
export function Belt({ x1, y1, x2, y2, colour, selected }: { x1: number; y1: number; x2: number; y2: number; colour: string; selected?: boolean }) {
  const mid = (x1 + x2) / 2
  const d = `M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`
  // The curve's midpoint (t = 0.5 of this cubic) carries the crate.
  const cx = mid
  const cy = (y1 + y2) / 2
  return (
    <>
      {selected && <path d={d} fill="none" stroke="#f2b632" stroke-width={17} stroke-linecap="round" />}
      <path d={d} fill="none" stroke="#4d4f4b" stroke-width={11} stroke-linecap="round" />
      <path d={d} fill="none" stroke="#a3a8ab" stroke-width={6} stroke-dasharray="2.5 5" class="fx-rollers" />
      <rect x={cx - 7} y={cy - 9} width={14} height={11} rx={1.5} fill={hexOf(colour)} stroke="rgba(0, 0, 0, 0.45)" stroke-width={1} />
      <rect x={cx - 4} y={cy - 11} width={8} height={2.5} rx={1} fill={hexOf(colour)} stroke="rgba(0, 0, 0, 0.35)" stroke-width={0.8} />
    </>
  )
}

/** The light studded baseplate under a line (a pattern per drawing, so ids stay unique). */
export function Baseplate({ id, width, height }: { id: string; width: number; height: number }) {
  const pid = `fx-plate-${id.replace(/[^a-zA-Z0-9_-]/g, '_')}`
  return (
    <>
      <defs>
        <pattern id={pid} width={20} height={20} patternUnits="userSpaceOnUse">
          <rect width={20} height={20} fill="#ece7dc" />
          <circle cx={10} cy={10.8} r={5} fill="#dcd5c6" />
          <circle cx={10} cy={10} r={4.6} fill="#f3efe6" />
        </pattern>
      </defs>
      <rect class="bp-plate" x={0} y={0} width={width} height={height} rx={8} style={{ fill: `url(#${pid})` }} />
    </>
  )
}

/** The node ids an issue list points at (`/nodes/N…`). */
export function flaggedNodes(graph: { nodes: Array<{ id: string }> }, issues: ModelIssue[]): Set<string> {
  return new Set(issues.map((i) => i.path.match(/^\/nodes\/(\d+)/)?.[1]).filter((k): k is string => !!k).map((k) => graph.nodes[Number(k)]?.id).filter((id): id is string => !!id))
}

/**
 * The line's steps as a row of cards in the layered order (the mockup's
 * workflow card): the machine's colour and icon, its number and id, what it
 * does, and whether the checker flags it. With `onSelect`, a card is a button.
 */
export function StepCards({ nodes, flagged, selected, onSelect, label }: { nodes: MachineNode[]; flagged: Set<string>; selected?: string | null; onSelect?: (id: string) => void; label: string }) {
  if (!nodes.length) return null
  return (
    <ol class="fx-steps" aria-label={label}>
      {nodes.map(({ node: n }, k) => {
        const shape = shapeOf(n)
        const fill = machineFill(shape)
        const bad = flagged.has(n.id)
        const on = selected === n.id
        const body = (
          <>
            <span class="fx-step-tile" style={{ background: fill }} aria-hidden="true">
              <svg width={26} height={26} viewBox="0 0 26 26" focusable="false">
                <MachineGlyph shape={shape} x={1} y={1} size={24} ink={inkOn(fill)} />
              </svg>
            </span>
            <span class="fx-step-text">
              <span class="fx-step-title">
                <span class="fx-step-no" aria-hidden="true">
                  {k + 1}
                </span>
                {n.id}
              </span>
              <span class="fx-step-caption">{nodeCaption(n)}</span>
            </span>
            <span class={`fx-step-status${bad ? ' is-bad' : ' is-ok'}`} role="img" aria-label={bad ? 'has issues' : 'checks'}>
              {bad ? '!' : '✓'}
            </span>
          </>
        )
        return (
          <li key={n.id} class={`fx-step${on ? ' is-selected' : ''}${bad ? ' is-flagged' : ''}`} data-step={n.id}>
            {onSelect ? (
              <button type="button" class="fx-step-card" aria-pressed={on} aria-label={`Step ${k + 1}: ${n.id}, ${nodeCaption(n)}${bad ? ', has issues' : ''}`} onClick={() => onSelect(n.id)}>
                {body}
              </button>
            ) : (
              <div class="fx-step-card">{body}</div>
            )}
          </li>
        )
      })}
    </ol>
  )
}

function Machine({ tool, flagged }: { tool: SiteTool; flagged: Set<string> }) {
  const lay = layoutTool(tool.graph)
  const at = new Map(lay.nodes.map((n) => [n.node.id, { x: PAD + n.layer * COL, y: PAD + DEPTH + 4 + n.row * ROW }]))
  const width = PAD * 2 + Math.max(1, lay.layers) * COL - (COL - W) + DEPTH
  const height = PAD * 2 + DEPTH + 4 + Math.max(1, lay.rows) * ROW - (ROW - H) + PLAQUE + 22
  const number = new Map(lay.nodes.map((n, k) => [n.node.id, k + 1]))
  return (
    <svg class="bp-machine fx-line" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Machine ${tool.id}: ${lay.nodes.length} nodes in ${lay.layers} layers`}>
      <Baseplate id={`tool-${tool.id}`} width={width} height={height} />
      {lay.edges.map((e, k) => {
        const a = at.get(e.from)
        const b = at.get(e.to)
        if (!a || !b) return null
        const colour = typeColour(e.type)
        return (
          <g key={k} class="bp-tube" data-edge={`${e.from}.${e.fromPort}>${e.to}.${e.toPort}`} data-type={e.type ?? ''} data-colour={colour}>
            <title>{`${e.from}.${e.fromPort} → ${e.to}.${e.toPort}${e.type ? `: ${e.type}` : ''}`}</title>
            <Belt x1={a.x + W} y1={a.y + H / 2} x2={b.x} y2={b.y + H / 2} colour={colour} />
          </g>
        )
      })}
      {lay.nodes.map((n) => {
        const { x, y } = at.get(n.node.id)!
        return (
          <g key={n.node.id} class="bp-node" data-node={n.node.id} data-kind={n.node.kind} data-shape={shapeOf(n.node)} data-layer={n.layer} data-row={n.row}>
            <title>{`${n.node.kind === 'n8n' ? `${str(n.node.name) ?? n.node.id} (n8n ${str(n.node.type) ?? ''})` : n.node.id}: ${KIND_LABEL[shapeOf(n.node)] ?? n.node.kind}${n.type ? `, hands on ${n.type}` : ''}`}</title>
            <MachineBlock x={x} y={y} w={W} h={H} shape={shapeOf(n.node)} number={number.get(n.node.id) ?? 0} id={n.node.id} flagged={flagged.has(n.node.id)} />
            {n.type && (
              <text x={x + 2} y={y + H + PLAQUE + 20} class="fx-type">
                {n.type.length > 20 ? `${n.type.slice(0, 19)}…` : n.type}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

const key = (i: ModelIssue) => `${i.code}|${i.path}|${i.message}`

function ToolCard({ tool, api, ctx }: { tool: SiteTool; api: BlueprintApi | null; ctx: string }) {
  const store = useStore()
  const live = api ? checkTool(api, tool.graph, ctx) : []
  const seen = new Set(tool.issues.map(key))
  const issues = [...tool.issues, ...live.filter((i) => !seen.has(key(i)))]
  const manifest = (api ? toolManifest(api, tool.graph) : null) ?? tool.manifest
  const caps = Array.isArray(manifest.capabilities) ? (manifest.capabilities as string[]) : []
  const origins = Array.isArray(manifest.origins) ? (manifest.origins as string[]) : []
  const g = tool.graph
  const sig = (m: Record<string, string> | undefined) =>
    Object.entries(m ?? {})
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ') || 'none'
  const flagged = flaggedNodes(g, issues)
  const lay = layoutTool(g)
  return (
    <article class="card bp-tool fx-card" aria-labelledby={`bp-tool-${tool.id}`} data-tool={tool.id}>
      <header class="bp-tool-head fx-card-head">
        <h3 id={`bp-tool-${tool.id}`}>{g.name.en ?? Object.values(g.name)[0] ?? tool.id}</h3>
        <span class="muted small fx-card-id">
          {tool.id} · {tool.hash.slice(0, 8)}
        </span>
        {issues.length ? <Badge tone="bad">{issues.length} issues</Badge> : <Badge tone="good">checks</Badge>}
        {store.can('RunTool') && (
          <button
            type="button"
            class="btn fx-run"
            disabled={issues.length > 0}
            title={issues.length ? 'A tool with issues does not run' : 'Run it now: the sim asks for a run, the browser runs it in the sandbox'}
            onClick={() => void store.run({ RunTool: { tool_ref: toolRef(tool.hash) } }, `${tool.id}: run requested`)}
          >
            Run now
          </button>
        )}
      </header>
      {g.description && <p class="small fx-card-description">{g.description}</p>}
      <p class="small">
        Takes {sig(g.inputs)}; makes {sig(g.outputs)}. Runs {(g.triggers ?? []).map(triggerText).join(', ') || 'never (no trigger)'}.
      </p>
      <p class="small">
        Needs{' '}
        {caps.length ? (
          <span class="chips bp-inline-chips">
            {caps.map((c) => (
              <span key={c} class="chip">
                {c}
              </span>
            ))}
          </span>
        ) : (
          'no capabilities'
        )}
        {origins.length > 0 ? <> from {origins.join(', ')}</> : caps.includes('web') && g.nodes.some((n) => n.kind === 'n8n') ? <strong> from any public website</strong> : null}.
      </p>
      <div class="bp-scroll fx-scroll">
        <Machine tool={tool} flagged={flagged} />
      </div>
      <StepCards nodes={lay.nodes} flagged={flagged} label={`Steps of ${tool.id}`} />
      <Issues issues={issues} />
    </article>
  )
}

export function ToolsDistrict({ models, api, ctx }: { models: SiteModels; api: BlueprintApi | null; ctx: string }) {
  return (
    <div class="bp-district fx-district">
      <Notice title="The site's tools">
        Each tool is a machine: what it reads, what it makes, what it may reach. Ask for a new or changed tool on the Blueprint tab ("Ask for a tool"): the web developer builds it and you
        approve it. Or import an n8n workflow: it runs as it does in n8n. Tools run on their schedule, when a bound page is built, or now.
      </Notice>
      <N8nImportPanel models={models} api={api} ctx={ctx} />
      <CredentialsPanel models={models} />
      {models.tools.length === 0 && <p class="muted">The site has no tools yet.</p>}
      {models.tools.map((t) => (
        <ToolCard key={t.id} tool={t} api={api} ctx={ctx} />
      ))}
      {models.tool_errors.length > 0 && (
        <Notice tone="bad" title="Tools that could not be read">
          <ul>
            {models.tool_errors.map((e) => (
              <li key={e.path}>
                <code>{e.path}</code>: {e.error}
              </li>
            ))}
          </ul>
        </Notice>
      )}
    </div>
  )
}
