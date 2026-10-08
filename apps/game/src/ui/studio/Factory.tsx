/**
 * The Factory workbench (FEAT-103, ADR-0077; design brick-studio.md §3.3):
 * the site's tools built in the Studio's grammar. Machines come from the
 * closed node catalogue in the tray; a click places one. Tubes join an outlet
 * to an inlet: pick an outlet (the round studs on a machine's right) and the
 * inlets light up, green where the site's tool checker accepts the tube, a
 * red seam with its reason where it does not; click a lit inlet to connect.
 * The inspector edits a machine in words (Simple) or as JSON (Advanced), and
 * the tool itself (name, triggers, the types it takes and makes). Saving
 * writes the changed tools through `PUT /api/site/blueprint` (`tools`, on the
 * base hash); the server checks them again.
 *
 * Layout is the deterministic layered drawing (`layoutTool`): no positions to
 * keep. Text from the graph is data: JSX text only.
 */
import { useEffect, useMemo, useState } from 'preact/hooks'
import { hexOf, inkOn, typeColour } from '../../blueprint/colours'
import { freshId, layoutTool } from '../../blueprint/model'
import type { ModelIssue, SiteModels, ToolGraph, ToolNode } from '../../blueprint/types'
import { checkTool, type BlueprintApi } from '../../blueprint/wasm'
import { Issues } from '../blueprint/Inspector'
import { n8nShape, nodeCaption } from '../blueprint/Tools'
import { Badge, Notice, TabPanel, Tabs } from '../components/common'
import { useStore } from '../store'
import { snapClick } from './bricks'
import { addMachine, disconnect, judgeTubes, MACHINE_GROUPS, MACHINE_PARTS, newTool, portsOf, removeMachine, updateMachine, type MachinePart, type TubeVerdict } from './machines'
import { commit, historyOf, redo, undo, type History } from './history'

const COL = 190
const ROW = 92
const W = 132
const H = 52
const PAD = 52
const OK = '#7fcf9a'
const NO = '#ff5a4f'

type Tools = Record<string, ToolGraph>
type Selection = { node: string } | { tube: [string, string] } | null

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const shapeOf = (n: ToolNode) => (n.kind === 'n8n' ? n8nShape(str(n.type)) : n.kind)
const SHAPE_FILL: Record<string, string> = { input: 'sand', output: 'sand', connector: 'denim', op: 'grey-dark', condition: 'olive', agent: 'blue', skill: 'caramel', code: 'sage' }

/** What a failed save carries (`CentralError`). */
function failure(e: unknown): { status: number | null; issues: string[]; message: string } {
  const err = e as { status?: unknown; body?: unknown; message?: unknown }
  const body = err?.body as { error?: unknown; issues?: unknown } | null | undefined
  return {
    status: typeof err?.status === 'number' ? err.status : null,
    issues: Array.isArray(body?.issues) ? body.issues.map(String) : [],
    message: typeof body?.error === 'string' ? body.error : typeof err?.message === 'string' ? err.message : String(e),
  }
}

/** One tool's machine, editable: machines, ports, tubes, and the lit inlets while a tube is in hand. */
function MachineBench({
  graph,
  issues,
  selection,
  holding,
  verdicts,
  editing,
  onSelect,
  onPickOutlet,
  onConnect,
}: {
  graph: ToolGraph
  issues: ModelIssue[]
  selection: Selection
  holding: string | null
  verdicts: Map<string, TubeVerdict> | null
  editing: boolean
  onSelect: (s: Selection) => void
  onPickOutlet: (ref: string | null) => void
  onConnect: (to: string) => void
}) {
  const lay = layoutTool(graph)
  const at = new Map(lay.nodes.map((n) => [n.node.id, { x: PAD + n.layer * COL, y: PAD + 10 + n.row * ROW }]))
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]))
  const portY = (y: number, k: number, n: number) => y + (H * (k + 1)) / (n + 1)
  const outAt = (id: string, port: string) => {
    const p = at.get(id)
    const n = nodeById.get(id)
    if (!p || !n) return null
    const outs = portsOf(n).outs
    return { x: p.x + W, y: portY(p.y, Math.max(0, outs.indexOf(port)), outs.length) }
  }
  const inAt = (id: string, port: string) => {
    const p = at.get(id)
    const n = nodeById.get(id)
    if (!p || !n) return null
    const ins = portsOf(n).ins.map((x) => x.port)
    return { x: p.x, y: portY(p.y, Math.max(0, ins.indexOf(port)), ins.length) }
  }
  const width = Math.max(560, PAD * 2 + Math.max(1, lay.layers) * COL - (COL - W))
  const height = Math.max(200, PAD * 2 + 10 + Math.max(1, lay.rows) * ROW - (ROW - H))
  const flagged = new Set(issues.map((i) => i.path.match(/^\/nodes\/(\d+)/)?.[1]).filter(Boolean).map((k) => graph.nodes[Number(k)]?.id))
  const key = (e: KeyboardEvent, f: () => void) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      f()
    }
  }
  return (
    <svg class="st-factory" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="group" aria-label={`Machine ${graph.id}: ${graph.nodes.length} machines, ${graph.edges.length} tubes`} data-factory={graph.id}>
      <rect class="bp-plate" x={0} y={0} width={width} height={height} />
      {graph.edges.map(([a, b]) => {
        const [fa, pa] = a.split('.')
        const [fb, pb] = b.split('.')
        const s = outAt(fa, pa)
        const t = inAt(fb, pb)
        if (!s || !t) return null
        const mid = (s.x + t.x) / 2
        const type = lay.nodes.find((n) => n.node.id === fa)?.type ?? null
        const sel = selection && 'tube' in selection && selection.tube[0] === a && selection.tube[1] === b
        const d = `M${s.x} ${s.y} C${mid} ${s.y} ${mid} ${t.y} ${t.x} ${t.y}`
        return (
          <g
            key={`${a}>${b}`}
            class="st-tube"
            data-edge={`${a}>${b}`}
            role="button"
            tabIndex={0}
            aria-pressed={!!sel}
            aria-label={`Tube from ${a} to ${b}${type ? `, carrying ${type}` : ''}`}
            onClick={() => onSelect({ tube: [a, b] })}
            onKeyDown={(e) => key(e, () => onSelect({ tube: [a, b] }))}
          >
            <title>{`${a} → ${b}${type ? `: ${type}` : ''}`}</title>
            <path d={d} fill="none" stroke="transparent" stroke-width={14} />
            <path d={d} fill="none" stroke={sel ? '#e3b864' : '#00000080'} stroke-width={sel ? 10 : 8} />
            <path d={d} fill="none" stroke={hexOf(typeColour(type))} stroke-width={5} />
          </g>
        )
      })}
      {lay.nodes.map(({ node: n, type }) => {
        const { x, y } = at.get(n.id)!
        const ports = portsOf(n)
        const sel = selection && 'node' in selection && selection.node === n.id
        const fill = hexOf(SHAPE_FILL[shapeOf(n)] ?? 'grey-dark')
        return (
          <g key={n.id} class="st-machine" data-node={n.id} data-kind={n.kind}>
            <g role="button" tabIndex={0} aria-pressed={!!sel} aria-label={`Machine ${n.id}: ${nodeCaption(n)}${flagged.has(n.id) ? ', has issues' : ''}`} onClick={() => onSelect({ node: n.id })} onKeyDown={(e) => key(e, () => onSelect({ node: n.id }))}>
              {Array.from({ length: 4 }, (_, k) => (
                <rect key={k} x={x + 14 + k * 30} y={y - 4} width={12} height={4} rx={1.5} fill={fill} />
              ))}
              <rect x={x} y={y} width={W} height={H} rx={4} fill={fill} stroke={flagged.has(n.id) ? NO : sel ? '#e3b864' : 'rgba(0,0,0,0.45)'} stroke-width={flagged.has(n.id) || sel ? 3 : 1} />
              <rect x={x + 2} y={y + 2} width={W - 4} height={3} rx={1.5} fill="rgba(255,255,255,0.2)" />
              <text x={x + 10} y={y + 21} class="st-machine-id" fill={inkOn(fill)}>
                {n.id}
              </text>
              <text x={x + 10} y={y + 37} class="st-machine-caption" fill={inkOn(fill)}>
                {nodeCaption(n).slice(0, 22)}
              </text>
              {type && (
                <text x={x + 10} y={y + H + 13} class="bp-small">
                  {type}
                </text>
              )}
            </g>
            {/* Inlets: on the left; lit while a tube is in hand. */}
            {ports.ins.map((p, k) => {
              const ref = `${n.id}.${p.port}`
              const v = verdicts?.get(ref)
              const cy = portY(y, k, ports.ins.length)
              return (
                <g
                  key={`in-${p.port}`}
                  class={`st-inlet${v ? (v.ok ? ' is-ok' : ' is-no') : ''}`}
                  data-inlet={ref}
                  role={holding ? 'button' : undefined}
                  tabIndex={holding ? 0 : -1}
                  aria-disabled={holding ? !v?.ok : undefined}
                  aria-label={holding ? (v?.ok ? `Connect into ${ref}` : `Inlet ${ref}: not allowed. ${v?.reason ?? ''}`) : undefined}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (v?.ok) onConnect(ref)
                  }}
                  onKeyDown={(e) => key(e, () => v?.ok && onConnect(ref))}
                >
                  <title>{v ? (v.ok ? `Into ${ref}` : (v.reason ?? 'Not here')) : `${p.port}${p.required ? ' (needed)' : ''}`}</title>
                  <rect x={x - 7} y={cy - 6} width={8} height={12} rx={2} fill={v ? (v.ok ? OK : NO) : '#c9ccd1'} opacity={v && !v.ok ? 0.6 : 1} />
                  <text x={x - 10} y={cy + 3} text-anchor="end" class="st-port-text">
                    {p.port === 'in' ? '' : p.port}
                  </text>
                </g>
              )
            })}
            {/* Outlets: round studs on the right; pick one to carry a tube. */}
            {ports.outs.map((port, k) => {
              const ref = `${n.id}.${port}`
              const on = holding === ref
              const cy = portY(y, k, ports.outs.length)
              return (
                <g
                  key={`out-${port}`}
                  class={`st-outlet${on ? ' is-held' : ''}`}
                  data-outlet={ref}
                  role="button"
                  tabIndex={editing ? 0 : -1}
                  aria-pressed={on}
                  aria-disabled={!editing}
                  aria-label={`Outlet ${ref}${on ? ': carrying a tube' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (editing) onPickOutlet(on ? null : ref)
                  }}
                  onKeyDown={(e) => key(e, () => editing && onPickOutlet(on ? null : ref))}
                >
                  <title>{`Out: ${port}`}</title>
                  <circle cx={x + W} cy={cy} r={on ? 8 : 6} fill={on ? '#e3b864' : '#e8e6e3'} stroke="#1b1f2a" stroke-width={1.5} />
                  {port !== 'out' && (
                    <text x={x + W - 10} y={cy + 3} text-anchor="end" class="st-port-text">
                      {port}
                    </text>
                  )}
                </g>
              )
            })}
          </g>
        )
      })}
      {!graph.nodes.length && (
        <text x={PAD} y={PAD + 30} class="bp-small">
          An empty machine: place parts from the tray below (an input, something to fetch, an output).
        </text>
      )}
    </svg>
  )
}

/** A text field that commits on change (blur or Enter), not on every key. */
function Field({ label, value, onChange, disabled, multiline }: { label: string; value: string; onChange: (v: string) => void; disabled: boolean; multiline?: boolean }) {
  return (
    <label class="field">
      <span>{label}</span>
      {multiline ? (
        <textarea rows={3} value={value} disabled={disabled} onChange={(e) => onChange(e.currentTarget.value)} />
      ) : (
        <input value={value} disabled={disabled} onChange={(e) => onChange(e.currentTarget.value)} />
      )}
    </label>
  )
}

function Choice({ label, value, options, onChange, disabled }: { label: string; value: string; options: string[]; onChange: (v: string) => void; disabled: boolean }) {
  return (
    <label class="field">
      <span>{label}</span>
      <select value={value} disabled={disabled} onChange={(e) => onChange(e.currentTarget.value)}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  )
}

const CONNECTORS = ['http-get', 'rss', 'web-search', 'knowledge', 'store-read', 'tool']
const OPS = ['pick', 'map', 'filter', 'sort', 'limit', 'merge', 'split', 'format', 'validate']
const TESTS = ['compare', 'exists', 'switch']
const CMPS = ['eq', 'ne', 'gt', 'lt', 'contains']
const TIERS = ['low', 'mid', 'high']
type Mode = 'simple' | 'advanced'
const MODES: Array<{ id: Mode; label: string }> = [
  { id: 'simple', label: 'Simple' },
  { id: 'advanced', label: 'Advanced' },
]

/** The words-first editor of one machine (Simple), or its JSON (Advanced). */
function NodeInspector({ graph, node, editing, onChange, onRemove }: { graph: ToolGraph; node: ToolNode; editing: boolean; onChange: (g: ToolGraph) => void; onRemove: () => void }) {
  const [mode, setMode] = useState<Mode>('simple')
  const [json, setJson] = useState(JSON.stringify(node, null, 2))
  const [bad, setBad] = useState<string | null>(null)
  useEffect(() => setJson(JSON.stringify(node, null, 2)), [node])
  const set = (patch: Record<string, unknown>) => onChange(updateMachine(graph, node.id, patch))
  const d = !editing
  const s = (k: string) => str(node[k])
  const ioType = (side: 'inputs' | 'outputs', port: string) => (side === 'inputs' ? graph.inputs?.[port] : graph.outputs[port]) ?? ''
  const setIo = (side: 'inputs' | 'outputs', oldPort: string, port: string, type: string) => {
    const g = updateMachine(graph, node.id, { port })
    const map = { ...(side === 'inputs' ? (g.inputs ?? {}) : g.outputs) }
    delete map[oldPort]
    map[port] = type
    if (side === 'inputs') g.inputs = map
    else g.outputs = map
    onChange(g)
  }
  return (
    <aside class="bp-inspector st-node-inspector" aria-label={`Machine ${node.id}`}>
      <div class="bp-inspector-head">
        <h3>
          {node.id} <span class="muted small">{node.kind}</span>
        </h3>
        {editing && (
          <button type="button" class="btn btn-danger-quiet" onClick={onRemove}>
            Remove
          </button>
        )}
      </div>
      <Tabs label="Inspector view" idPrefix="st-node" tabs={MODES} value={mode} onChange={setMode} />
      <TabPanel idPrefix="st-node" value={mode}>
        {mode === 'advanced' ? (
          <>
            <textarea class="bp-json" rows={12} value={json} disabled={d} aria-label="Machine JSON" onInput={(e) => setJson(e.currentTarget.value)} />
            {bad && <p class="small bad-text">{bad}</p>}
            {editing && (
              <button
                type="button"
                class="btn"
                onClick={() => {
                  try {
                    const v = JSON.parse(json) as Record<string, unknown>
                    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('A machine is a JSON object.')
                    setBad(null)
                    set(v)
                  } catch (e) {
                    setBad(e instanceof Error ? e.message : String(e))
                  }
                }}
              >
                Apply
              </button>
            )}
          </>
        ) : (
          <div class="st-fields">
            {(node.kind === 'input' || node.kind === 'output') && (
              <>
                <Field label="Port" value={s('port')} disabled={d} onChange={(v) => v && setIo(node.kind === 'input' ? 'inputs' : 'outputs', s('port'), v, ioType(node.kind === 'input' ? 'inputs' : 'outputs', s('port')))} />
                <Field label="Type" value={ioType(node.kind === 'input' ? 'inputs' : 'outputs', s('port'))} disabled={d} onChange={(v) => setIo(node.kind === 'input' ? 'inputs' : 'outputs', s('port'), s('port'), v)} />
              </>
            )}
            {node.kind === 'connector' && (
              <>
                <Choice label="Fetches with" value={s('connector')} options={CONNECTORS} disabled={d} onChange={(v) => set({ connector: v })} />
                {(s('connector') === 'http-get' || s('connector') === 'rss') && <Field label="Address (https)" value={s('url')} disabled={d} onChange={(v) => set({ url: v })} />}
                {(s('connector') === 'web-search' || s('connector') === 'knowledge') && <Field label={s('connector') === 'knowledge' ? 'What (pages, media, entities)' : 'Search for'} value={s('query')} disabled={d} onChange={(v) => set({ query: v })} />}
                {s('connector') === 'store-read' && <Field label="Table" value={s('table')} disabled={d} onChange={(v) => set({ table: v })} />}
                {s('connector') === 'tool' && <Field label="Tool" value={s('tool')} disabled={d} onChange={(v) => set({ tool: v })} />}
                <Field label="Credential (a name, never a key)" value={s('credential')} disabled={d} onChange={(v) => set({ credential: v || undefined })} />
                <Field label="Returns (type)" value={s('returns')} disabled={d} onChange={(v) => set({ returns: v })} />
              </>
            )}
            {node.kind === 'op' && (
              <>
                <Choice label="Does" value={s('op')} options={OPS} disabled={d} onChange={(v) => set({ op: v })} />
                {['pick', 'split', 'sort'].includes(s('op')) && <Field label="Path" value={s('path')} disabled={d} onChange={(v) => set({ path: v })} />}
                {s('op') === 'sort' && (
                  <label class="field-inline">
                    <input type="checkbox" checked={!!node.desc} disabled={d} onChange={(e) => set({ desc: e.currentTarget.checked || undefined })} /> Descending
                  </label>
                )}
                {s('op') === 'limit' && <Field label="How many" value={String(node.count ?? '')} disabled={d} onChange={(v) => set({ count: Number(v) || 1 })} />}
                {s('op') === 'split' && <Field label="Separator" value={s('separator')} disabled={d} onChange={(v) => set({ separator: v })} />}
                {s('op') === 'format' && <Field label="Template ({field} placeholders)" value={s('template')} disabled={d} onChange={(v) => set({ template: v })} multiline />}
                {s('op') === 'filter' && (
                  <>
                    <Field label="Where: path" value={str((node.where as Record<string, unknown> | undefined)?.path)} disabled={d} onChange={(v) => set({ where: { ...((node.where as object) ?? {}), path: v } })} />
                    <Choice label="Where: compare" value={str((node.where as Record<string, unknown> | undefined)?.cmp) || 'eq'} options={CMPS} disabled={d} onChange={(v) => set({ where: { ...((node.where as object) ?? {}), cmp: v } })} />
                    <Field label="Where: value" value={String((node.where as Record<string, unknown> | undefined)?.value ?? '')} disabled={d} onChange={(v) => set({ where: { ...((node.where as object) ?? {}), value: v } })} />
                  </>
                )}
                {s('op') === 'map' && <Field label="Fields (field: path, one per line)" multiline value={Object.entries((node.fields as Record<string, string>) ?? {}).map(([k, v]) => `${k}: ${v}`).join('\n')} disabled={d} onChange={(v) => set({ fields: Object.fromEntries(v.split('\n').map((l) => l.split(':').map((x) => x.trim())).filter((p) => p[0] && p[1])) })} />}
                {['pick', 'map', 'validate'].includes(s('op')) && <Field label="Returns (type)" value={s('returns')} disabled={d} onChange={(v) => set({ returns: v || undefined })} />}
              </>
            )}
            {node.kind === 'condition' && (
              <>
                <Choice label="Test" value={s('test')} options={TESTS} disabled={d} onChange={(v) => set({ test: v })} />
                <Field label="Path" value={s('path')} disabled={d} onChange={(v) => set({ path: v })} />
                {s('test') === 'compare' && (
                  <>
                    <Choice label="Compare" value={s('cmp') || 'eq'} options={CMPS} disabled={d} onChange={(v) => set({ cmp: v })} />
                    <Field
                      label="Value"
                      value={typeof node.value === 'string' ? node.value : JSON.stringify(node.value ?? '')}
                      disabled={d}
                      onChange={(v) => {
                        let value: unknown = v
                        try {
                          value = JSON.parse(v)
                        } catch {
                          value = v
                        }
                        set({ value })
                      }}
                    />
                  </>
                )}
                {s('test') === 'switch' && <Field label="Cases (comma separated)" value={((node.cases as string[]) ?? []).join(', ')} disabled={d} onChange={(v) => set({ cases: v.split(',').map((x) => x.trim()).filter(Boolean) })} />}
              </>
            )}
            {node.kind === 'agent' && (
              <>
                <Field label="Role" value={s('role')} disabled={d} onChange={(v) => set({ role: v })} />
                <Choice label="Tier" value={s('tier') || 'low'} options={TIERS} disabled={d} onChange={(v) => set({ tier: v })} />
                <Field label="Instruction" value={s('instruction')} disabled={d} onChange={(v) => set({ instruction: v })} multiline />
                <Field label="Output (type)" value={s('output')} disabled={d} onChange={(v) => set({ output: v })} />
              </>
            )}
            {(node.kind === 'n8n' || node.kind === 'skill') && <p class="small muted">Edit this machine in the Advanced view.</p>}
          </div>
        )}
      </TabPanel>
    </aside>
  )
}

/** The tool itself: name, description, when it runs, what it takes and makes. */
function ToolSettings({ graph, editing, onChange }: { graph: ToolGraph; editing: boolean; onChange: (g: ToolGraph) => void }) {
  const d = !editing
  const trig = graph.triggers?.[0]
  const set = (patch: Partial<ToolGraph>) => onChange({ ...JSON.parse(JSON.stringify(graph)), ...patch } as ToolGraph)
  const types = (side: 'inputs' | 'outputs') => Object.entries((side === 'inputs' ? graph.inputs : graph.outputs) ?? {})
  return (
    <aside class="bp-inspector st-node-inspector" aria-label={`Tool ${graph.id}`}>
      <div class="bp-inspector-head">
        <h3>
          {graph.name.en ?? graph.id} <span class="muted small">tool</span>
        </h3>
      </div>
      <div class="st-fields">
        <Field label="Name" value={graph.name.en ?? ''} disabled={d} onChange={(v) => set({ name: { ...graph.name, en: v || graph.id } })} />
        <Field label="What it does" value={graph.description ?? ''} disabled={d} multiline onChange={(v) => set({ description: v || undefined })} />
        <Choice
          label="Runs"
          value={trig?.kind ?? 'on-demand'}
          options={['on-demand', 'build', 'schedule']}
          disabled={d}
          onChange={(v) => set({ triggers: [v === 'schedule' ? { kind: 'schedule', every_game_days: 1 } : ({ kind: v } as { kind: 'on-demand' } | { kind: 'build' })] })}
        />
        {trig?.kind === 'schedule' && <Field label="Every … game days" value={String(trig.every_game_days)} disabled={d} onChange={(v) => set({ triggers: [{ kind: 'schedule', every_game_days: Math.max(1, Number(v) || 1) }] })} />}
        {(['inputs', 'outputs'] as const).map((side) => (
          <div key={side}>
            <h4>{side === 'inputs' ? 'Takes' : 'Makes'}</h4>
            {types(side).length === 0 && <p class="small muted">nothing</p>}
            {types(side).map(([port, type]) => (
              <Field key={port} label={port} value={type} disabled={d} onChange={(v) => set({ [side]: { ...(side === 'inputs' ? graph.inputs : graph.outputs), [port]: v } } as Partial<ToolGraph>)} />
            ))}
          </div>
        ))}
      </div>
    </aside>
  )
}

/** The machine tray: the closed node catalogue by group; a click places a machine. */
function MachineTray({ disabled, onPlace }: { disabled: boolean; onPlace: (p: MachinePart) => void }) {
  const groups = Object.entries(MACHINE_GROUPS) as Array<[MachinePart['group'], string]>
  return (
    <section class="st-tray" aria-label="Machine tray">
      <div class="st-machine-groups">
        {groups.map(([g, label]) => (
          <div key={g} class="st-machine-group">
            <h4>{label}</h4>
            <ul class="st-tray-parts" role="list">
              {MACHINE_PARTS.filter((p) => p.group === g).map((p) => {
                const colour = hexOf(SHAPE_FILL[p.shape] ?? 'grey-dark')
                return (
                  <li key={p.id}>
                    <button type="button" class="st-part" disabled={disabled} title={p.description} aria-label={`Place ${p.label}`} data-machine-part={p.id} style={{ '--part': colour, '--part-ink': inkOn(colour) } as Record<string, string>} onClick={() => onPlace(p)}>
                      <span class="st-part-studs" aria-hidden="true" />
                      {p.label}
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}

export function FactoryWorkbench({ models, api, ctx, editing }: { models: SiteModels; api: BlueprintApi | null; ctx: string; editing: boolean }) {
  const store = useStore()
  const base = useMemo<Tools>(() => Object.fromEntries(models.tools.map((t) => [t.id, t.graph])), [models])
  const [history, setHistory] = useState<History<Tools>>(() => historyOf(base))
  const tools = history.present
  const ids = Object.keys(tools).sort()
  const [current, setCurrent] = useState<string | null>(ids[0] ?? null)
  const graph = current ? tools[current] : undefined
  const [selection, setSelection] = useState<Selection>(null)
  const [holding, setHolding] = useState<string | null>(null)
  const [newId, setNewId] = useState('')
  const [saving, setSaving] = useState(false)
  const [refused, setRefused] = useState<string[] | null>(null)
  const check = useMemo(() => (api ? (g: ToolGraph) => checkTool(api, g, ctx) : null), [api, ctx])
  const issues = useMemo(() => (graph && check ? check(graph) : []), [graph, check])
  const verdicts = useMemo(() => (holding && graph && check ? judgeTubes(check, graph, holding) : null), [holding, graph, check])
  const changed = ids.filter((id) => JSON.stringify(tools[id]) !== JSON.stringify(base[id]))
  const allIssues = useMemo(() => (check ? changed.flatMap((id) => check(tools[id]).map((i) => ({ ...i, path: `${id}${i.path}` }))) : []), [changed.join(','), tools, check])
  const edit = (g: ToolGraph) => {
    setHistory((h) => commit(h, { ...h.present, [g.id]: g }))
    setRefused(null)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)
      if (e.key === 'Escape' && holding) {
        e.stopPropagation()
        setHolding(null)
      } else if (!typing && editing && (e.key === 'Delete' || e.key === 'Backspace') && graph && selection) {
        e.preventDefault()
        if ('node' in selection) edit(removeMachine(graph, selection.node))
        else edit(disconnect(graph, selection.tube[0], selection.tube[1]))
        setSelection(null)
      } else if ((e.ctrlKey || e.metaKey) && !typing && editing && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        setHistory(e.shiftKey ? redo : undo)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  const save = async () => {
    if (!store.source.saveBlueprint || !changed.length) return
    setSaving(true)
    setRefused(null)
    try {
      const r = await store.source.saveBlueprint({ base_hash: models.hash, tools: Object.fromEntries(changed.map((id) => [id, tools[id]])) })
      store.say(`Built: ${changed.length} ${changed.length === 1 ? 'tool' : 'tools'} saved (commit ${r.commit.slice(0, 7)})`, 'ok')
      setSaving(false)
      await store.source.reloadSiteModels?.()
    } catch (e) {
      const f = failure(e)
      setSaving(false)
      setRefused(f.issues.length ? f.issues : [f.message])
      store.say(f.status === 409 ? 'The site changed since you began editing: reload it' : 'The tools were not saved: see the issues', 'error')
    }
  }

  const selectedNode = graph && selection && 'node' in selection ? graph.nodes.find((n) => n.id === selection.node) : undefined
  const holdVerdictOk = verdicts ? [...verdicts.values()].filter((v) => v.ok).length : 0
  return (
    <div class="st-factory-bench">
      {editing && (
        <div class="st-bar" role="toolbar" aria-label="Factory">
          <button type="button" class="btn btn-quiet" disabled={!history.past.length} onClick={() => setHistory(undo)}>
            ↶ Undo
          </button>
          <button type="button" class="btn btn-quiet" disabled={!history.future.length} onClick={() => setHistory(redo)}>
            ↷ Redo
          </button>
          <span class="small muted" role="status">
            {holding ? `Carrying a tube from ${holding}: ${holdVerdictOk ? 'click a green inlet' : 'no inlet takes it'}. Esc puts it down.` : 'Place machines from the tray; pick an outlet (●) to run a tube.'}
          </span>
        </div>
      )}
      <div class="st-factory-grid">
        <nav class="st-street" aria-label="Tools">
          {ids.map((id) => (
            <button
              key={id}
              type="button"
              class={`st-street-item${id === current ? ' is-active' : ''}`}
              aria-pressed={id === current}
              onClick={() => {
                setCurrent(id)
                setSelection(null)
                setHolding(null)
              }}
            >
              <span>
                {tools[id].name.en ?? id}
                {!base[id] ? <span class="st-mark is-added"> new</span> : changed.includes(id) ? <span class="st-mark is-changed"> changed</span> : null}
              </span>
            </button>
          ))}
          {editing && (
            <form
              class="st-new-tool"
              onSubmit={(e) => {
                e.preventDefault()
                const id = freshId(newId.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-') || 'tool', ids)
                setHistory((h) => commit(h, { ...h.present, [id]: newTool(id, newId.trim() || id) }))
                setCurrent(id)
                setSelection(null)
                setNewId('')
              }}
            >
              <label class="field">
                <span>New tool</span>
                <input value={newId} placeholder="ferry-times" onInput={(e) => setNewId(e.currentTarget.value)} />
              </label>
              <button type="submit" class="btn">
                Add tool
              </button>
            </form>
          )}
        </nav>
        <div class="st-stage">
          {!graph ? (
            <p class="muted">The site has no tools yet{editing ? ': add one on the left.' : '.'}</p>
          ) : (
            <>
              <div
                class="st-scroll"
                onClick={(e) => {
                  // Only a click on the bare plate clears the selection (a machine's own click bubbles here too).
                  if ((e.target as Element).classList?.contains('bp-plate')) {
                    setSelection(null)
                    setHolding(null)
                  }
                }}
              >
                <MachineBench
                  graph={graph}
                  issues={issues}
                  selection={selection}
                  holding={holding}
                  verdicts={verdicts}
                  editing={editing && !!check}
                  onSelect={(s) => {
                    setSelection(s)
                  }}
                  onPickOutlet={setHolding}
                  onConnect={(to) => {
                    const v = verdicts?.get(to)
                    if (!v?.next) return
                    edit(v.next)
                    snapClick()
                    setHolding(null)
                  }}
                />
              </div>
              <h3 class="small">Issues {issues.length ? <Badge tone="bad">{issues.length}</Badge> : <Badge tone="good">none</Badge>}</h3>
              <Issues issues={issues} />
            </>
          )}
        </div>
        {graph && selection && 'tube' in selection && (
          <aside class="bp-inspector st-node-inspector" aria-label="Tube">
            <h3>Tube</h3>
            <p class="small">
              {selection.tube[0]} → {selection.tube[1]}
            </p>
            {editing && (
              <button
                type="button"
                class="btn btn-danger-quiet"
                onClick={() => {
                  edit(disconnect(graph, selection.tube[0], selection.tube[1]))
                  setSelection(null)
                }}
              >
                Remove the tube
              </button>
            )}
          </aside>
        )}
        {graph && selectedNode && (
          <NodeInspector
            graph={graph}
            node={selectedNode}
            editing={editing}
            onChange={edit}
            onRemove={() => {
              edit(removeMachine(graph, selectedNode.id))
              setSelection(null)
            }}
          />
        )}
        {graph && !selection && <ToolSettings graph={graph} editing={editing} onChange={edit} />}
        {editing && graph && (
          <MachineTray
            disabled={!check}
            onPlace={(p) => {
              const r = addMachine(graph, p)
              edit(r.graph)
              snapClick()
              setSelection({ node: r.id })
            }}
          />
        )}
      </div>
      {editing && (
        <section class="bp-status" aria-label="Tools draft">
          {refused && (
            <Notice tone="bad" title="The server refused the tools">
              <ul class="bp-issues" aria-label="Server issues">
                {refused.map((x, k) => (
                  <li key={k}>{x}</li>
                ))}
              </ul>
            </Notice>
          )}
          <div class="inline-form">
            <span class="small">
              {changed.length ? `${changed.length} ${changed.length === 1 ? 'tool' : 'tools'} changed: ${changed.join(', ')}` : 'No changes yet.'}
            </span>
            <button type="button" class="btn is-proposed" disabled={!changed.length || allIssues.length > 0 || saving || !store.source.saveBlueprint} onClick={() => void save()}>
              {saving ? 'Saving…' : 'Save tools'}
            </button>
            <button
              type="button"
              class="btn btn-quiet"
              disabled={!changed.length || saving}
              onClick={() => {
                setHistory(historyOf(base))
                setSelection(null)
                setRefused(null)
              }}
            >
              Discard
            </button>
            {allIssues.length > 0 && <span class="small muted">Fix the issues to save.</span>}
          </div>
        </section>
      )}
    </div>
  )
}
