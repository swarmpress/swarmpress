/**
 * The Blueprint panel (FEAT-090, ADR-0072, design §5): the site's structure
 * as a flat brick canvas, and its tools as machines. The CEO edits a draft of
 * the blueprint; every edit is checked and diffed in the browser with the
 * server's own code (`blueprint-wasm`), and Save lands it through
 * `PUT /api/site/blueprint` on the hash it was made on.
 *
 * Positions on the canvas are editor layout, kept in this component for now:
 * design §5.1 puts them in `blueprint/layout.json` (outside the semantic
 * hash), which no route writes yet.
 *
 * "Ask the architect" (FEAT-095, design §5.3) addresses a staff member, not
 * a chatbot: the request becomes a structural work item drafted by the UX
 * designer (or, on the Tools tab, a tool built by the Web Developer), and
 * its proposal comes back as a StructureApproval ticket in the Inbox.
 */
import { useEffect, useMemo, useState } from 'preact/hooks'
import { buildingsOf, updateSlot } from '../../blueprint/model'
import type { Blueprint as BlueprintDoc, SiteModels } from '../../blueprint/types'
import { checkBlueprint, contextOf, diffBlueprints, loadBlueprintWasm, type BlueprintApi } from '../../blueprint/wasm'
import { BrickCanvas, type Layout, type Selection } from '../blueprint/Canvas'
import { Inspector, Issues } from '../blueprint/Inspector'
import { PartsBin } from '../blueprint/PartsBin'
import { ToolsDistrict } from '../blueprint/Tools'
import { useStore } from '../store'
import { Badge, Notice, Panel, TabPanel, Tabs } from './common'

type Tab = 'blueprint' | 'tools'
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'blueprint', label: 'Blueprint' },
  { id: 'tools', label: 'Tools' },
]

type Checker = { state: 'loading' | 'failed'; api: null } | { state: 'ready'; api: BlueprintApi }

/** The checker in the browser, loaded when the panel first opens. */
function useChecker(): Checker {
  const [c, setC] = useState<Checker>({ state: 'loading', api: null })
  useEffect(() => {
    let live = true
    loadBlueprintWasm().then(
      (api) => live && setC({ state: 'ready', api }),
      () => live && setC({ state: 'failed', api: null }),
    )
    return () => {
      live = false
    }
  }, [])
  return c
}

export function Blueprint() {
  const store = useStore()
  const models = store.siteModels.value
  const [tab, setTab] = useState<Tab>('blueprint')
  const checker = useChecker()
  return (
    <Panel id="blueprint" title="Site blueprint" wide>
      {!models ? (
        <p class="muted" role="status">
          The site's models are not loaded.
        </p>
      ) : (
        <>
          <p class="small muted" data-checker={checker.state}>
            {models.source === 'repo' ? 'From blueprint/site.json' : 'Read from the pages (imported)'} at {models.commit.slice(0, 7)} · hash {models.hash.slice(0, 12)} ·{' '}
            {models.blueprint.page_types.length} page types · {models.tools.length} tools
          </p>
          {checker.state === 'failed' && (
            <Notice tone="warn" title="The checker could not load">
              Edits are not checked here; the server still checks them when you save.
            </Notice>
          )}
          <Tabs label="Blueprint views" idPrefix="blueprint" tabs={TABS} value={tab} onChange={setTab} />
          <TabPanel idPrefix="blueprint" value={tab}>
            <AskArchitect key={tab} kind={tab === 'tools' ? 'tool' : 'structure'} />
            {tab === 'blueprint' ? (
              <BlueprintEditor key={`${models.commit}:${models.hash}`} models={models} api={checker.api} />
            ) : (
              <ToolsDistrict models={models} api={checker.api} ctx={contextOf(models)} />
            )}
          </TabPanel>
        </>
      )}
    </Panel>
  )
}

const ASK = {
  structure: {
    label: 'Ask the architect',
    who: 'the Information Architect (the UX designer)',
    placeholder: 'Add an author page type and link articles to it.',
  },
  tool: {
    label: 'Ask for a tool',
    who: 'the Web Developer',
    placeholder: 'Show the next ferries from each village, refreshed daily.',
  },
} as const

/** The request box (FEAT-095): text to the store as a brief, `Commission` to the sim. */
export function AskArchitect({ kind }: { kind: 'structure' | 'tool' }) {
  const store = useStore()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [refused, setRefused] = useState<string | null>(null)
  const can = !!store.source.commission
  const a = ASK[kind]
  const submit = async () => {
    if (!store.source.commission || !text.trim()) return
    setBusy(true)
    setRefused(null)
    try {
      const r = await store.source.commission(kind, text)
      if (r.ok) {
        setText('')
        store.say(`Asked ${a.who}: the proposal comes to your Inbox for approval.`, 'ok')
      } else setRefused(r.reason ?? 'The request was not taken.')
    } catch (e) {
      setRefused(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form
      class="bp-ask"
      aria-label={a.label}
      onSubmit={(e) => {
        e.preventDefault()
        if (!busy) void submit()
      }}
    >
      <label class="field">
        <span>{a.label}</span>
        <textarea rows={2} maxLength={1200} value={text} placeholder={a.placeholder} disabled={!can || busy} onInput={(e) => setText(e.currentTarget.value)} />
      </label>
      <p class="small muted">
        A request to {a.who}. Nothing changes on the site until you approve the proposal.
      </p>
      <button type="submit" class="btn" disabled={!can || busy || !text.trim()}>
        {busy ? 'Asking…' : a.label}
      </button>
      {!can && <span class="small muted"> This game cannot commission work on the site.</span>}
      {refused && (
        <p class="small error-text" role="alert">
          {refused}
        </p>
      )}
    </form>
  )
}

/** What a failed save carries (`CentralError`: `status`, parsed `body`). */
function failure(e: unknown): { status: number | null; issues: string[]; message: string } {
  const err = e as { status?: unknown; body?: unknown; message?: unknown }
  const body = err?.body as { error?: unknown; issues?: unknown } | null | undefined
  const issues = Array.isArray(body?.issues) ? body.issues.map(String) : []
  const message = typeof body?.error === 'string' ? body.error : typeof err?.message === 'string' ? err.message : String(e)
  return { status: typeof err?.status === 'number' ? err.status : null, issues, message }
}

function BlueprintEditor({ models, api }: { models: SiteModels; api: BlueprintApi | null }) {
  const store = useStore()
  const base = models.blueprint
  const [draft, setDraft] = useState<BlueprintDoc>(base)
  const [adopted, setAdopted] = useState(false)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [layout, setLayout] = useState<Layout>({})
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [refused, setRefused] = useState<string[] | null>(null)
  const [stale, setStale] = useState(false)
  const canSave = !!store.source.saveBlueprint
  const editing = canSave && (models.source === 'repo' || adopted)
  const ctx = useMemo(() => contextOf(models), [models])
  const issues = useMemo(() => (api ? checkBlueprint(api, draft, ctx) : draft === base ? models.issues : []), [api, draft, ctx, base, models])
  const changes = useMemo(() => (api && draft !== base ? diffBlueprints(api, base, draft) : []), [api, draft, base])
  const buildings = buildingsOf(draft, base, changes, issues)
  const changed = draft !== base && (changes.length > 0 || !api)
  const ready = editing && (changed || (models.source === 'imported' && adopted)) && issues.length === 0 && !saving && !stale

  const edit = (next: BlueprintDoc) => {
    setDraft(next)
    setRefused(null)
  }
  const addBlock = (type: string, slot: string, block: string) => {
    const s = draft.page_types.find((t) => t.id === type)?.slots?.find((x) => x.id === slot)
    if (!s || s.blocks.includes(block)) return
    edit(updateSlot(draft, type, slot, { blocks: [...s.blocks, block] }))
  }
  const discard = () => {
    setDraft(base)
    setRefused(null)
    setSelection(null)
  }
  const reload = async () => {
    await store.source.reloadSiteModels?.()
  }
  const save = async () => {
    if (!store.source.saveBlueprint) return
    setSaving(true)
    setRefused(null)
    try {
      const r = await store.source.saveBlueprint({ blueprint: draft, base_hash: models.hash, ...(message.trim() ? { message: message.trim() } : {}) })
      store.say(`Blueprint saved: ${r.changes.length} ${r.changes.length === 1 ? 'change' : 'changes'} (commit ${r.commit.slice(0, 7)})`, 'ok')
      setSaving(false)
      await reload()
    } catch (e) {
      const f = failure(e)
      setSaving(false)
      if (f.status === 422) {
        setRefused(f.issues.length ? f.issues : [f.message])
        store.say('The server refused the blueprint: see its issues', 'error')
      } else if (f.status === 409) {
        setStale(true)
        store.say('The blueprint changed since you began editing', 'error')
      } else store.say(`The blueprint was not saved: ${f.message}`, 'error')
    }
  }

  const selected = selection ? buildings.find((b) => b.type.id === selection.type && b.index != null) : undefined
  return (
    <div class="bp-editor">
      {models.source === 'imported' && !adopted && (
        <Notice title="Imported from the site's pages">
          <p class="small">This blueprint was read from the pages; the site does not store one yet. Saving stores it as blueprint/site.json.</p>
          {canSave && (
            <button type="button" class="btn" onClick={() => setAdopted(true)}>
              Start editing from this import
            </button>
          )}
        </Notice>
      )}
      {!canSave && <p class="small muted">This game cannot change the site: the blueprint is shown read-only.</p>}
      {stale && (
        <Notice tone="warn" title="The blueprint changed since you began editing">
          <p class="small">Someone else saved a new structure first. Reload it to see theirs; your edits here are discarded.</p>
          <button type="button" class="btn" onClick={() => void reload()}>
            Reload the blueprint
          </button>
        </Notice>
      )}
      <div class={`bp-layout${editing ? ' is-editing' : ''}${selected ? ' has-inspector' : ''}`}>
        {editing && <PartsBin draft={draft} customBlocks={models.context.custom_blocks} selection={selection} onChange={edit} onSelect={setSelection} onAddBlock={addBlock} />}
        <div class="bp-scroll">
          <BrickCanvas
            bp={draft}
            buildings={buildings}
            selected={selection}
            onSelect={setSelection}
            layout={layout}
            onMove={(type, dx, dy) =>
              setLayout((l) => {
                const at = l[type] ?? { dx: 0, dy: 0 }
                return { ...l, [type]: { dx: at.dx + dx, dy: at.dy + dy } }
              })
            }
            onDropBlock={editing ? addBlock : null}
          />
          <p class="small muted bp-legend">
            Storeys are coloured by their first block's intent; striped ones are optional; ★ the navigation. Shift + arrow keys move a focused building on the canvas (layout only, not part of
            the blueprint).
          </p>
        </div>
        {selected && selection && (
          <Inspector draft={draft} selection={selection} building={selected} changes={changes} editing={editing} onChange={edit} onSelect={setSelection} onClose={() => setSelection(null)} />
        )}
      </div>
      <section class="bp-status" aria-label="Draft">
        <h3 class="small">
          Issues {issues.length > 0 ? <Badge tone="bad">{issues.length}</Badge> : <Badge tone="good">none</Badge>}
        </h3>
        {!api && draft !== base && <p class="small muted">Checking happens on save: the checker is not loaded.</p>}
        <Issues issues={issues} />
        {refused && (
          <Notice tone="bad" title="The server refused the blueprint">
            <ul class="bp-issues" aria-label="Server issues">
              {refused.map((s, k) => (
                <li key={k}>{s}</li>
              ))}
            </ul>
          </Notice>
        )}
        {editing && (
          <>
            <h3 class="small">Changes {changes.length > 0 && <Badge tone="info">{changes.length}</Badge>}</h3>
            {changes.length === 0 ? (
              <p class="small muted">No changes yet.</p>
            ) : (
              <ul class="bp-changes" aria-label="Changes">
                {changes.map((c) => (
                  <li key={`${c.kind}:${c.subject}:${c.id}`} class={`bp-change is-${c.kind}`}>
                    <Badge tone={c.kind === 'added' ? 'good' : c.kind === 'removed' ? 'neutral' : 'warn'}>{c.kind}</Badge> {c.subject} <strong>{c.id}</strong>
                    {c.fields && c.fields.length > 0 && <span class="muted"> ({c.fields.join(', ')})</span>}
                  </li>
                ))}
              </ul>
            )}
            <div class="inline-form">
              <label class="field-inline">
                Note
                <input value={message} placeholder="What and why (optional)" onInput={(e) => setMessage(e.currentTarget.value)} />
              </label>
              <button type="button" class="btn is-proposed" disabled={!ready} onClick={() => void save()}>
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button type="button" class="btn btn-quiet" disabled={draft === base || saving} onClick={discard}>
                Discard
              </button>
              {issues.length > 0 && <span class="small muted">Fix the issues to save.</span>}
            </div>
          </>
        )}
      </section>
    </div>
  )
}
