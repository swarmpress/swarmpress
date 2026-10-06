/**
 * The inspector (design §5.1, "simple first, inspectable always"): the
 * simple view says what a building or storey is for in words, the advanced
 * view shows its JSON and its issues by path. While editing it carries the
 * controls for the selection: a type's label and route, its storeys and
 * relationships; a storey's blocks, min, max and place.
 */
import { useState } from 'preact/hooks'
import { blockColour, catalogueBlock, hexOf } from '../../blueprint/colours'
import {
  addRelationship,
  addSlot,
  freshId,
  moveSlot,
  occurrence,
  relationshipId,
  removePageType,
  removeRelationship,
  removeSlot,
  updatePageType,
  updateSlot,
  type BuildingView,
} from '../../blueprint/model'
import type { Blueprint, BlueprintChange, ModelIssue } from '../../blueprint/types'
import { Badge, Icon, TabPanel, Tabs } from '../components/common'
import type { Selection } from './Canvas'

type Mode = 'simple' | 'advanced'
const MODES: Array<{ id: Mode; label: string }> = [
  { id: 'simple', label: 'Simple' },
  { id: 'advanced', label: 'Advanced' },
]
const CARDINALITIES = ['one-to-one', 'one-to-many', 'many-to-one', 'many-to-many'] as const

export function Issues({ issues }: { issues: ModelIssue[] }) {
  if (issues.length === 0) return null
  return (
    <ul class="bp-issues" aria-label="Issues">
      {issues.map((i, k) => (
        <li key={k}>
          <Badge tone="bad">{i.code}</Badge> <code>{i.path}</code> {i.message}
        </li>
      ))}
    </ul>
  )
}

function BlockLine({ type }: { type: string }) {
  const meta = catalogueBlock(type)
  return (
    <li>
      <span class="bp-swatch" style={{ background: hexOf(blockColour(type)) }} aria-hidden="true" />
      <strong>{type}</strong>
      {meta ? (
        <span class="muted">
          {' '}
          ({meta.intent}): {meta.description}
        </span>
      ) : (
        <span class="muted"> (a block of this site)</span>
      )}
    </li>
  )
}

export function Inspector({
  draft,
  selection,
  building,
  changes,
  editing,
  onChange,
  onSelect,
  onClose,
}: {
  draft: Blueprint
  selection: Selection
  building: BuildingView | undefined
  changes: BlueprintChange[]
  editing: boolean
  onChange: (bp: Blueprint) => void
  onSelect: (s: Selection | null) => void
  onClose: () => void
}) {
  const [mode, setMode] = useState<Mode>('simple')
  const t = building?.type
  if (!t || building.index == null) return null
  const storey = selection.slot ? building.storeys.find((s) => s.slot.id === selection.slot && s.index != null) : undefined
  const slot = storey?.slot
  const title = slot ? `Storey ${slot.id}` : (t.label.en ?? t.id)
  const issues = slot ? storey.issues : building.issues
  const fields = slot ? storey.fields : building.fields
  const mark = slot ? storey.mark : building.mark
  const typeIndex = building.index
  const idPrefix = 'bp-inspector'
  return (
    <aside class="bp-inspector card" aria-labelledby="bp-inspector-title">
      <header class="bp-inspector-head">
        <h3 id="bp-inspector-title">
          {title}
          {slot && <span class="muted"> of {t.id}</span>}
        </h3>
        <button type="button" class="icon-btn" aria-label="Close the inspector" onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>
      {mark && (
        <p class="small">
          <Badge tone={mark === 'added' ? 'good' : mark === 'removed' ? 'neutral' : 'warn'}>{mark}</Badge>
          {fields.length > 0 && <span class="muted"> {fields.join(', ')}</span>}
        </p>
      )}
      <Tabs label="Inspector view" idPrefix={idPrefix} tabs={MODES} value={mode} onChange={setMode} />
      <TabPanel idPrefix={idPrefix} value={mode}>
        {mode === 'simple' ? (
          slot ? (
            <>
              <p class="small">This storey holds {occurrence(slot)}, chosen from:</p>
              <ul class="bp-blocks">
                {slot.blocks.map((b) => (
                  <BlockLine key={b} type={b} />
                ))}
              </ul>
              <p class="small">
                {slot.source
                  ? `Filled by the tool ${slot.source.tool}${slot.source.output ? ` (its ${slot.source.output})` : ''}, which hands in ${slot.source.accepts}.`
                  : 'Written by the staff: no tool feeds it.'}
              </p>
            </>
          ) : (
            <>
              <p class="small">
                {t.source.kind === 'page' ? 'Pages of their own' : `One page per item of the collection ${t.source.collection}`}
                {t.route ? ` at ${t.route}` : ''}
                {t.pages != null ? `; ${t.pages} pages today` : ''}.
              </p>
              {t.slots === undefined ? (
                <p class="small">Its body is not constrained: any blocks, in any order.</p>
              ) : (
                <p class="small">
                  {t.slots.length} storeys, top to bottom: {t.slots.map((s) => s.id).join(', ') || 'none yet'}.
                </p>
              )}
              {(t.uses ?? []).length > 0 && <p class="small">Shares {t.uses!.join(', ')} with the site.</p>}
              {(t.aliases ?? []).length > 0 && <p class="small muted">Also known as {t.aliases!.join(', ')}.</p>}
            </>
          )
        ) : (
          <>
            <pre class="bp-json" aria-label="JSON">
              {JSON.stringify(slot ?? t, null, 2)}
            </pre>
          </>
        )}
        <Issues issues={issues} />
      </TabPanel>
      {editing && (slot ? (
        <SlotControls draft={draft} typeId={t.id} slotId={slot.id} onChange={onChange} onSelect={onSelect} />
      ) : (
        <TypeControls draft={draft} typeIndex={typeIndex} changes={changes} onChange={onChange} onSelect={onSelect} />
      ))}
    </aside>
  )
}

function TypeControls({
  draft,
  typeIndex,
  changes,
  onChange,
  onSelect,
}: {
  draft: Blueprint
  typeIndex: number
  changes: BlueprintChange[]
  onChange: (bp: Blueprint) => void
  onSelect: (s: Selection | null) => void
}) {
  const t = draft.page_types[typeIndex]
  const slots = t.slots ?? []
  const [slotId, setSlotId] = useState('')
  const [to, setTo] = useState('')
  const [kind, setKind] = useState('links-to')
  const [card, setCard] = useState<(typeof CARDINALITIES)[number]>('one-to-many')
  const rels = (draft.relationships ?? []).map((r, i) => ({ r, i })).filter(({ r }) => r.from === t.id || r.to === t.id)
  const newSlot = slotId.trim() || freshId('storey', slots.map((s) => s.id))
  const added = new Set(changes.filter((c) => c.subject === 'relationship' && c.kind === 'added').map((c) => c.id))
  return (
    <section class="bp-controls" aria-label={`Edit ${t.id}`}>
      <label class="field">
        Label
        <input value={t.label.en ?? ''} onInput={(e) => onChange(updatePageType(draft, t.id, { label: e.currentTarget.value }))} />
      </label>
      <label class="field">
        Route
        <input value={t.route ?? ''} placeholder="/{lang}/…" onInput={(e) => onChange(updatePageType(draft, t.id, { route: e.currentTarget.value }))} />
      </label>
      <div class="inline-form">
        <label class="field-inline">
          New storey
          <input value={slotId} placeholder={newSlot} onInput={(e) => setSlotId(e.currentTarget.value)} aria-label="New storey id" />
        </label>
        <button
          type="button"
          class="btn"
          onClick={() => {
            onChange(addSlot(draft, t.id, { id: newSlot, blocks: [] }))
            setSlotId('')
            onSelect({ type: t.id, slot: newSlot })
          }}
        >
          Add storey
        </button>
      </div>
      <h4>Relationships</h4>
      {rels.length === 0 && <p class="small muted">None.</p>}
      <ul class="bp-rels">
        {rels.map(({ r, i }) => (
          <li key={i}>
            {r.from} → {r.to} <span class="muted">({r.kind}, {r.cardinality})</span> {added.has(relationshipId(r)) && <Badge tone="good">added</Badge>}{' '}
            <button type="button" class="btn btn-quiet" onClick={() => onChange(removeRelationship(draft, i))} aria-label={`Remove the relationship ${r.from} to ${r.to} (${r.kind})`}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <div class="inline-form">
        <label class="field-inline">
          To
          <select value={to} onChange={(e) => setTo(e.currentTarget.value)}>
            <option value="">Choose…</option>
            {draft.page_types.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id}
              </option>
            ))}
          </select>
        </label>
        <label class="field-inline">
          Kind
          <input value={kind} onInput={(e) => setKind(e.currentTarget.value)} />
        </label>
        <label class="field-inline">
          Cardinality
          <select value={card} onChange={(e) => setCard(e.currentTarget.value as (typeof CARDINALITIES)[number])}>
            {CARDINALITIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <button type="button" class="btn" disabled={!to || !kind.trim()} onClick={() => onChange(addRelationship(draft, { from: t.id, to, kind: kind.trim(), cardinality: card }))}>
          Add relationship
        </button>
      </div>
      <div class="actions-row">
        <button
          type="button"
          class="btn btn-danger-quiet"
          onClick={() => {
            onChange(removePageType(draft, t.id))
            onSelect(null)
          }}
        >
          Remove page type
        </button>
      </div>
    </section>
  )
}

function SlotControls({
  draft,
  typeId,
  slotId,
  onChange,
  onSelect,
}: {
  draft: Blueprint
  typeId: string
  slotId: string
  onChange: (bp: Blueprint) => void
  onSelect: (s: Selection | null) => void
}) {
  const t = draft.page_types.find((x) => x.id === typeId)
  const slots = t?.slots ?? []
  const i = slots.findIndex((s) => s.id === slotId)
  const slot = slots[i]
  if (!slot) return null
  const num = (v: string) => (v === '' ? null : Math.max(0, Math.floor(Number(v))))
  return (
    <section class="bp-controls" aria-label={`Edit storey ${slotId}`}>
      <h4>Blocks</h4>
      {slot.blocks.length === 0 && <p class="small muted">No blocks yet: add one from the parts bin.</p>}
      <ul class="bp-rels">
        {slot.blocks.map((b) => (
          <li key={b}>
            <span class="bp-swatch" style={{ background: hexOf(blockColour(b)) }} aria-hidden="true" />
            {b}{' '}
            <button type="button" class="btn btn-quiet" aria-label={`Remove the block ${b}`} onClick={() => onChange(updateSlot(draft, typeId, slotId, { blocks: slot.blocks.filter((x) => x !== b) }))}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <div class="inline-form">
        <label class="field-inline">
          Min
          <input type="number" min={0} value={slot.min ?? 0} onInput={(e) => onChange(updateSlot(draft, typeId, slotId, { min: num(e.currentTarget.value) ?? 0 }))} />
        </label>
        <label class="field-inline">
          Max
          <input type="number" min={0} value={slot.max ?? ''} placeholder="any" onInput={(e) => onChange(updateSlot(draft, typeId, slotId, { max: num(e.currentTarget.value) }))} />
        </label>
      </div>
      <div class="actions-row">
        <button type="button" class="btn" disabled={i === 0} onClick={() => onChange(moveSlot(draft, typeId, slotId, -1))}>
          Move up
        </button>
        <button type="button" class="btn" disabled={i === slots.length - 1} onClick={() => onChange(moveSlot(draft, typeId, slotId, 1))}>
          Move down
        </button>
        <button
          type="button"
          class="btn btn-danger-quiet"
          onClick={() => {
            onChange(removeSlot(draft, typeId, slotId))
            onSelect({ type: typeId })
          }}
        >
          Remove storey
        </button>
      </div>
    </section>
  )
}
