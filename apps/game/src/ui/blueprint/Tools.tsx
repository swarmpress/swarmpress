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

const COL = 156
const ROW = 72
const W = 116
const H = 46
const PAD = 16

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
const shapeOf = (n: MachineNode['node']) => (n.kind === 'n8n' ? n8nShape(str(n.type) ?? '') : n.kind)

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

function Shape({ kind, x, y }: { kind: string; x: number; y: number }) {
  const fill = '#3a4152'
  switch (kind) {
    case 'input':
      return <polygon points={`${x},${y} ${x + W},${y} ${x + W - 14},${y + H} ${x + 14},${y + H}`} fill={fill} />
    case 'output':
      return <polygon points={`${x + 14},${y} ${x + W - 14},${y} ${x + W},${y + H} ${x},${y + H}`} fill={fill} />
    case 'condition':
      return <polygon points={`${x + 12},${y} ${x + W - 12},${y} ${x + W},${y + H / 2} ${x + W - 12},${y + H} ${x + 12},${y + H} ${x},${y + H / 2}`} fill={fill} />
    case 'connector':
      return (
        <>
          <rect x={x} y={y} width={W} height={H} rx={3} fill={fill} />
          <path d={`M${x + W - 26} ${y + 6} a12 12 0 0 0 18 18 z`} fill="#c9ccd1" />
        </>
      )
    case 'op':
      return (
        <>
          <rect x={x} y={y} width={W} height={H} rx={3} fill={fill} />
          <circle cx={x + W - 14} cy={y + 14} r={7} fill="none" stroke="#c9ccd1" stroke-width={3} stroke-dasharray="3 2" />
        </>
      )
    case 'agent':
      return (
        <>
          <rect x={x} y={y} width={W} height={H} rx={3} fill={fill} />
          <circle cx={x + W - 14} cy={y + 11} r={5} fill={hexOf('yellow')} />
          <rect x={x + W - 20} y={y + 17} width={12} height={10} rx={2} fill={hexOf('blue')} />
        </>
      )
    case 'code':
      return (
        <>
          <rect x={x} y={y} width={W} height={H} rx={3} fill={hexOf('sage')} />
          <rect x={x + W - 26} y={y + 6} width={18} height={12} rx={1} fill={hexOf('screen-blue')} />
        </>
      )
    case 'skill':
      return (
        <>
          <rect x={x} y={y} width={W} height={H} rx={2} fill={hexOf('caramel')} />
          <path d={`M${x} ${y} L${x + W} ${y + H} M${x + W} ${y} L${x} ${y + H}`} stroke="#00000040" stroke-width={2} />
        </>
      )
    default:
      return <rect x={x} y={y} width={W} height={H} rx={3} fill={fill} />
  }
}

function Machine({ tool }: { tool: SiteTool }) {
  const lay = layoutTool(tool.graph)
  const at = new Map(lay.nodes.map((n) => [n.node.id, { x: PAD + n.layer * COL, y: PAD + 6 + n.row * ROW }]))
  const width = PAD * 2 + Math.max(1, lay.layers) * COL - (COL - W)
  const height = PAD * 2 + 6 + Math.max(1, lay.rows) * ROW - (ROW - H)
  return (
    <svg class="bp-machine" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Machine ${tool.id}: ${lay.nodes.length} nodes in ${lay.layers} layers`}>
      <rect class="bp-plate" x={0} y={0} width={width} height={height} />
      {lay.edges.map((e, k) => {
        const a = at.get(e.from)
        const b = at.get(e.to)
        if (!a || !b) return null
        const x1 = a.x + W
        const y1 = a.y + H / 2
        const x2 = b.x
        const y2 = b.y + H / 2
        const mid = (x1 + x2) / 2
        const colour = typeColour(e.type)
        return (
          <g key={k} class="bp-tube" data-edge={`${e.from}.${e.fromPort}>${e.to}.${e.toPort}`} data-type={e.type ?? ''} data-colour={colour}>
            <title>{`${e.from}.${e.fromPort} → ${e.to}.${e.toPort}${e.type ? `: ${e.type}` : ''}`}</title>
            <path d={`M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`} fill="none" stroke="#00000080" stroke-width={8} />
            <path d={`M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`} fill="none" stroke={hexOf(colour)} stroke-width={5} />
          </g>
        )
      })}
      {lay.nodes.map((n) => {
        const { x, y } = at.get(n.node.id)!
        return (
          <g key={n.node.id} class="bp-node" data-node={n.node.id} data-kind={n.node.kind} data-shape={shapeOf(n.node)} data-layer={n.layer} data-row={n.row}>
            <title>{`${n.node.kind === 'n8n' ? `${str(n.node.name) ?? n.node.id} (n8n ${str(n.node.type) ?? ''})` : n.node.id}: ${KIND_LABEL[shapeOf(n.node)] ?? n.node.kind}${n.type ? `, hands on ${n.type}` : ''}`}</title>
            {Array.from({ length: 4 }, (_, k) => (
              <rect key={k} x={x + 10 + k * 26} y={y - 4} width={10} height={4} rx={1} fill="#c9ccd1" />
            ))}
            <Shape kind={shapeOf(n.node)} x={x} y={y} />
            <text x={x + 8} y={y + 18} class="bp-label" fill={inkOn('#3a4152')}>
              {n.node.id}
            </text>
            <text x={x + 8} y={y + 34} class="bp-small">
              {nodeCaption(n.node)}
            </text>
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
  return (
    <article class="card bp-tool" aria-labelledby={`bp-tool-${tool.id}`} data-tool={tool.id}>
      <header class="bp-tool-head">
        <h3 id={`bp-tool-${tool.id}`}>{g.name.en ?? Object.values(g.name)[0] ?? tool.id}</h3>
        <span class="muted small">
          {tool.id} · {tool.hash.slice(0, 8)}
        </span>
        {issues.length ? <Badge tone="bad">{issues.length} issues</Badge> : <Badge tone="good">checks</Badge>}
        {store.can('RunTool') && (
          <button
            type="button"
            class="btn btn-quiet"
            disabled={issues.length > 0}
            title={issues.length ? 'A tool with issues does not run' : 'Run it now: the sim asks for a run, the browser runs it in the sandbox'}
            onClick={() => void store.run({ RunTool: { tool_ref: toolRef(tool.hash) } }, `${tool.id}: run requested`)}
          >
            Run now
          </button>
        )}
      </header>
      {g.description && <p class="small">{g.description}</p>}
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
      <div class="bp-scroll">
        <Machine tool={tool} />
      </div>
      <Issues issues={issues} />
    </article>
  )
}

export function ToolsDistrict({ models, api, ctx }: { models: SiteModels; api: BlueprintApi | null; ctx: string }) {
  return (
    <div class="bp-district">
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
