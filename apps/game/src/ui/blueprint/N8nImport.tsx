/**
 * Importing an n8n workflow as a site tool (FEAT-096, ADR-0076). The CEO
 * drops an n8n export (the workflow's JSON) or pastes it. The import maps it
 * node for node without a model and shows, before anything is written:
 *
 * - how each node was taken (runs as n8n does, sealed, trigger, input,
 *   flattened, dropped) and why a node is sealed;
 * - what the tool will need: the manifest the Rust checker derives
 *   (capabilities, origins, or "any website" for a computed host) and the
 *   checker's issues;
 * - the credentials its requests sign in with, and the site tools its
 *   Execute Workflow nodes call.
 *
 * "Install" writes the tool through `PUT /api/site/blueprint` (the CEO's
 * edit); a tool with checker issues cannot be installed.
 */
import { useState } from 'preact/hooks'
import { importN8n, type N8nImport, type N8nWorkflow } from '@swarm-press/toolgraph'
import type { SiteModels, ToolGraph } from '../../blueprint/types'
import { checkTool, toolManifest, type BlueprintApi } from '../../blueprint/wasm'
import { Badge, Notice } from '../components/common'
import { useStore } from '../store'
import { Issues } from './Inspector'

const kebab = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)

const AS_LABEL: Record<N8nImport['mapping'][number]['as'], { text: string; tone: 'good' | 'bad' | 'neutral' }> = {
  n8n: { text: 'runs', tone: 'good' },
  sealed: { text: 'sealed', tone: 'bad' },
  trigger: { text: 'trigger', tone: 'neutral' },
  input: { text: 'input', tone: 'neutral' },
  flattened: { text: 'flattened', tone: 'neutral' },
  dropped: { text: 'dropped', tone: 'neutral' },
}

/** An n8n export's workflow: the JSON of a workflow, or of a template wrapping one (`{ workflow }`). */
export function parseN8nExport(text: string): N8nWorkflow {
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch (e) {
    throw new Error(`not JSON: ${(e as Error).message}`)
  }
  const wf = (v && typeof v === 'object' && 'workflow' in v ? (v as { workflow: unknown }).workflow : v) as Partial<N8nWorkflow> | null
  if (!wf || !Array.isArray(wf.nodes) || typeof wf.connections !== 'object') throw new Error('not an n8n workflow (no nodes and connections)')
  return wf as N8nWorkflow
}

export function N8nImportPanel({ models, api, ctx }: { models: SiteModels; api: BlueprintApi | null; ctx: string }) {
  const store = useStore()
  const [wf, setWf] = useState<N8nWorkflow | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [id, setId] = useState('')
  const [calls, setCalls] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const canSave = !!store.source.saveBlueprint

  const load = (text: string) => {
    try {
      const w = parseN8nExport(text)
      setWf(w)
      setError(null)
      setId(kebab(w.name ?? '') || 'imported-workflow')
      setCalls({})
    } catch (e) {
      setWf(null)
      setError((e as Error).message)
    }
  }

  const out = wf && id ? importN8n(wf, id, { tools: calls }) : null
  const graph = out?.graph as unknown as ToolGraph | undefined
  const issues = graph && api ? checkTool(api, graph, ctx) : []
  const manifest = graph && api ? toolManifest(api, graph) : null
  const caps = Array.isArray(manifest?.capabilities) ? (manifest!.capabilities as string[]) : []
  const origins = Array.isArray(manifest?.origins) ? (manifest!.origins as string[]) : []
  const replaces = models.tools.some((t) => t.id === id)
  const workflowsToMap = (wf?.nodes ?? []).filter((n) => n.type === 'n8n-nodes-base.executeWorkflow' && !n.disabled)
  const wfId = (n: N8nWorkflow['nodes'][number]) => {
    const p = n.parameters?.workflowId
    return String(p && typeof p === 'object' ? ((p as { value?: unknown }).value ?? '') : (p ?? ''))
  }

  const install = async () => {
    if (!graph || !store.source.saveBlueprint) return
    setBusy(true)
    try {
      await store.source.saveBlueprint({ base_hash: models.hash, tools: { [id]: graph }, message: `Import the n8n workflow ${wf?.name ?? id} as the tool ${id}` })
      await store.source.reloadSiteModels?.()
      store.say(`${id}: the n8n workflow is installed as a tool`, 'ok')
      setWf(null)
    } catch (e) {
      const body = (e as { body?: { issues?: unknown[] } }).body
      store.say(`${id}: not installed: ${(e as Error).message}${body?.issues ? ` (${body.issues.length} issues)` : ''}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <details class="card bp-n8n" open={!!wf}>
      <summary>Import an n8n workflow</summary>
      <p class="small">
        Drop an n8n export (the workflow's JSON) or paste it. Its nodes run as they do in n8n: expressions and Code nodes in a sandbox without access to anything, requests
        through the central proxy, models on the hosted model. Nothing is installed until you install it.
      </p>
      <div class="inline-form">
        <label class="field-inline">
          Workflow file
          <input
            type="file"
            accept=".json,application/json"
            onChange={async (e) => {
              const f = e.currentTarget.files?.[0]
              e.currentTarget.value = ''
              if (f) load(await f.text())
            }}
          />
        </label>
      </div>
      <textarea class="bp-n8n-paste" rows={3} placeholder="…or paste the workflow JSON here" aria-label="n8n workflow JSON" onChange={(e) => e.currentTarget.value.trim() && load(e.currentTarget.value)} />
      {error && (
        <Notice tone="bad" title="Not an n8n workflow">
          {error}
        </Notice>
      )}
      {wf && out && (
        <div class="bp-n8n-preview" data-n8n-preview={id}>
          <label class="field-inline">
            Tool id
            <input value={id} onInput={(e) => setId(kebab(e.currentTarget.value))} />
          </label>
          {replaces && <p class="small">A tool with this id exists: installing replaces it.</p>}
          <h4>{wf.name ?? id}</h4>
          <ul class="bp-n8n-map">
            {out.mapping.map((m) => (
              <li key={m.node} data-as={m.as}>
                <Badge tone={AS_LABEL[m.as].tone}>{AS_LABEL[m.as].text}</Badge> {m.node} <span class="muted small">{m.type.replace(/^.*\./, '')}</span>
              </li>
            ))}
          </ul>
          {workflowsToMap.length > 0 && (
            <div class="inline-form">
              {workflowsToMap.map((n) => (
                <label key={n.name} class="field-inline">
                  {n.name} calls
                  <select value={calls[wfId(n)] ?? ''} onChange={(e) => setCalls({ ...calls, [wfId(n)]: e.currentTarget.value })}>
                    <option value="">(choose a site tool)</option>
                    {models.tools.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.id}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          )}
          {out.issues.length > 0 && (
            <ul class="bp-n8n-issues small">
              {out.issues.map((i, k) => (
                <li key={k} data-code={i.code}>
                  <strong>{i.code}</strong> {i.node}: {i.message}
                </li>
              ))}
            </ul>
          )}
          <p class="small">
            It will need{' '}
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
            {caps.includes('web') && (origins.length ? <> from {origins.join(', ')}</> : <strong> from any public website</strong>)}.
          </p>
          <Issues issues={issues} />
          {canSave && (
            <button type="button" class="btn" disabled={busy || issues.length > 0 || !api} onClick={() => void install()} title={issues.length ? 'Fix or replace the steps with issues first' : 'Write the tool to the site'}>
              {busy ? 'Installing…' : `Install ${id}`}
            </button>
          )}
        </div>
      )}
    </details>
  )
}
