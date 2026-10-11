/**
 * The Data Studio (ADR-0086, the mockup `isometric_data_studio_dashboard`):
 * the site's content models, read-only, from the site's models (`types`).
 *
 * - **Canvas:** each model a card on a studded baseplate, a type icon per
 *   field, the relations between the site's types drawn as lines with a
 *   caption; the cards are a listbox (click, arrows, Home/End).
 * - **Inspector:** the selected model's fields with type pills, its relations
 *   in and out, what validates it, and where the site uses it (collections,
 *   the page types rendering them, tools' ports).
 * - **Bricks:** the field types the site uses, a 2 × 2 brick each, counted.
 *
 * This build cannot change the site's models, so nothing here edits (rule 11).
 * Text is data: names and words come from the schemas and the blueprint.
 */
import { useMemo, useRef, useState } from 'preact/hooks'
import type { SiteModels } from '../../blueprint/types'
import { Tabs, TabPanel } from '../components/common'
import { BrickIcon } from './bricks'
import { edgePath, layout, readModels, usageOf, type Field, type FieldKind, type FieldType, type Model, type Relation } from './data-model'

export { fieldsOf } from './data-model'

/** A field kind's words in the brick strip and its brick's colour (palette hexes, `kit/palette.json`). */
const KIND: Record<FieldKind, { label: string; brick: string }> = {
  text: { label: 'Text', brick: '#e6e1d6' },
  localized: { label: 'Localized text', brick: '#dec69b' },
  number: { label: 'Number', brick: '#1e5aa8' },
  integer: { label: 'Integer', brick: '#6074a1' },
  boolean: { label: 'Boolean', brick: '#58ab41' },
  enum: { label: 'Enum', brick: '#f5c518' },
  relation: { label: 'Relation', brick: '#3f3364' },
  media: { label: 'Media', brick: '#e07a1f' },
  object: { label: 'Object', brick: '#789081' },
  builtin: { label: 'Built-in type', brick: '#9b8c6c' },
  json: { label: 'Json', brick: '#a3a8ab' },
  unknown: { label: 'Unknown type', brick: '#c4281c' },
}
const KIND_ORDER: FieldKind[] = ['text', 'localized', 'number', 'integer', 'boolean', 'enum', 'media', 'relation', 'object', 'builtin', 'json', 'unknown']

/** The cards' header colours, in turn by the canvas order: the bricks of an island. */
const CARD_TONES = ['yellow', 'blue', 'green', 'red', 'plum', 'orange'] as const

/** A field kind's glyph (16 × 16, `currentColor`). */
function KindIcon({ kind }: { kind: FieldKind }) {
  const p = { fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' } as const
  const g = (() => {
    switch (kind) {
      case 'text':
        return <path {...p} d="M3 3.5h10M8 3.5v9.5" />
      case 'localized':
        return (
          <g {...p}>
            <circle cx="8" cy="8" r="5.5" />
            <path d="M2.5 8h11M8 2.5c-2.2 3-2.2 8 0 11M8 2.5c2.2 3 2.2 8 0 11" />
          </g>
        )
      case 'number':
      case 'integer':
        return <path {...p} d="M6 2.5 4.8 13.5M11.2 2.5 10 13.5M2.8 6h11M2.2 10.2h11" />
      case 'boolean':
        return (
          <g {...p}>
            <rect x="1.5" y="4.5" width="13" height="7" rx="3.5" />
            <circle cx="11" cy="8" r="1.8" fill="currentColor" />
          </g>
        )
      case 'enum':
        return <path {...p} d="M2.5 4h1M6 4h7.5M2.5 8h1M6 8h7.5M2.5 12h1M6 12h7.5" />
      case 'relation':
        return <path {...p} d="M7 9.5a2.8 2.8 0 0 0 4 0l2-2a2.8 2.8 0 0 0-4-4l-.8.8M9 6.5a2.8 2.8 0 0 0-4 0l-2 2a2.8 2.8 0 0 0 4 4l.8-.8" />
      case 'media':
        return (
          <g {...p}>
            <rect x="2" y="3" width="12" height="10" rx="1.5" />
            <path d="m2.5 11.5 3.5-3.5 3 3 2-2 2.5 2.5" />
            <circle cx="10.5" cy="6" r="1" />
          </g>
        )
      case 'object':
        return <path {...p} d="M6 2.5c-1.6 0-2 .8-2 2v1.6c0 1-.6 1.9-1.5 1.9.9 0 1.5.9 1.5 1.9v1.6c0 1.2.4 2 2 2M10 2.5c1.6 0 2 .8 2 2v1.6c0 1 .6 1.9 1.5 1.9-.9 0-1.5.9-1.5 1.9v1.6c0 1.2-.4 2-2 2" />
      case 'builtin':
        return <path {...p} d="M8 2 13.5 5v6L8 14 2.5 11V5L8 2ZM2.5 5 8 8l5.5-3M8 8v6" />
      case 'json':
        return <path {...p} d="M5.5 3 2.5 8l3 5M10.5 3l3 5-3 5" />
      default:
        return <path {...p} d="M5.8 5.8a2.3 2.3 0 1 1 3 2.2c-.6.3-.8.8-.8 1.5M8 12.2v.1" />
    }
  })()
  return (
    <svg class={`ds-icon ds-icon-${kind}`} width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {g}
    </svg>
  )
}

/** A field type's pill: its kind's colour, its words. */
function TypePill({ type }: { type: FieldType }) {
  return <span class={`ds-pill ds-pill-${type.kind}`}>{type.label}</span>
}

/** "has many" / "has one": the caption of a relation, the field's name in it. */
function caption(r: Relation): string {
  return `${r.from} has ${r.many ? 'many' : 'one'} ${r.field}`
}

export function DataStudio({ models }: { models: SiteModels }) {
  const data = useMemo(() => readModels(models.types), [models.types])
  const geo = useMemo(() => layout(data), [data])
  const byName = useMemo(() => new Map(data.models.map((m) => [m.name, m])), [data])
  const order = geo.cards.map((c) => c.name)
  const [picked, setPicked] = useState<string | null>(null)
  const selected = picked && byName.has(picked) ? picked : (order[0] ?? null)
  const canvas = useRef<HTMLDivElement>(null)

  if (data.models.length === 0) return <EmptyState models={models} />

  const select = (name: string, focus = false) => {
    setPicked(name)
    if (focus) {
      queueMicrotask(() => {
        const el = [...(canvas.current?.querySelectorAll<HTMLElement>('[data-model]') ?? [])].find((c) => c.dataset.model === name)
        el?.focus()
        el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
      })
    }
  }
  const onKey = (e: KeyboardEvent) => {
    const i = selected ? order.indexOf(selected) : -1
    let next = -1
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = Math.min(order.length - 1, i + 1)
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = Math.max(0, i - 1)
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = order.length - 1
    if (next < 0) return
    e.preventDefault()
    e.stopPropagation()
    select(order[next], true)
  }

  const linked = new Set(data.relations.filter((r) => r.from === selected || r.to === selected).flatMap((r) => [r.from, r.to]))
  const place = new Map(geo.cards.map((c) => [c.name, c]))
  const kinds = new Map<FieldKind, number>()
  for (const m of data.models) for (const f of m.fields) kinds.set(f.type.kind, (kinds.get(f.type.kind) ?? 0) + 1)
  const fieldCount = data.models.reduce((n, m) => n + m.fields.length, 0)

  return (
    <section class="ds" aria-label="Data models">
      <header class="ds-head">
        <svg class="ds-head-icon" width="30" height="30" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <g fill="none" stroke="currentColor" stroke-width="1.8">
            <ellipse cx="12" cy="5.5" rx="7.5" ry="3" />
            <path d="M4.5 5.5v13c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-13M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3" />
          </g>
        </svg>
        <div>
          <h3 class="ds-title">Data models</h3>
          <p class="ds-sub">
            {data.models.length} {data.models.length === 1 ? 'model' : 'models'} · {fieldCount} fields · {data.relations.length}{' '}
            {data.relations.length === 1 ? 'relation' : 'relations'} · read-only in this build
          </p>
        </div>
      </header>
      <div class="ds-body">
        <div class="ds-stage">
          <div class="ds-canvas" ref={canvas}>
            <div class="ds-plate" style={{ width: `${geo.width}px`, height: `${geo.height}px` }}>
              <svg class="ds-lines" width={geo.width} height={geo.height} viewBox={`0 0 ${geo.width} ${geo.height}`} aria-hidden="true" focusable="false">
                {data.relations.map((r) => {
                  const a = place.get(r.from)
                  const b = place.get(r.to)
                  if (!a || !b) return null
                  const idx = byName.get(r.from)!.fields.findIndex((f) => f.name === r.field)
                  const { d } = edgePath(a, idx, b)
                  const on = r.from === selected || r.to === selected
                  return (
                    <g key={`${r.from}.${r.field}`} class={`ds-edge${on ? ' is-on' : ''}${selected && !on ? ' is-dim' : ''}`} data-relation={`${r.from}.${r.field}>${r.to}`}>
                      <path class="ds-edge-under" d={d} />
                      <path class="ds-edge-line" d={d} stroke-dasharray={r.required ? undefined : '7 5'} />
                    </g>
                  )
                })}
              </svg>
              <div class="ds-cards" role="listbox" aria-label="Content models" aria-orientation="horizontal" onKeyDown={onKey}>
                {geo.cards.map((c, i) => {
                  const m = byName.get(c.name)!
                  const on = c.name === selected
                  return (
                    <div
                      key={c.name}
                      role="option"
                      id={`ds-model-${c.name}`}
                      data-model={c.name}
                      aria-selected={on}
                      aria-label={`${m.name}, ${m.fields.length} ${m.fields.length === 1 ? 'field' : 'fields'}`}
                      tabIndex={on ? 0 : -1}
                      class={`ds-card ds-tone-${CARD_TONES[i % CARD_TONES.length]}${on ? ' is-selected' : ''}${selected && !on && !linked.has(c.name) ? ' is-far' : ''}`}
                      style={{ left: `${c.x}px`, top: `${c.y}px`, width: `${c.w}px`, height: `${c.h}px` }}
                      onClick={() => select(c.name, true)}
                    >
                      <span class="ds-card-head">
                        <span class="ds-card-chip" aria-hidden="true" />
                        <span class="ds-card-name">{m.name}</span>
                        <span class="ds-card-count">{m.fields.length}</span>
                      </span>
                      <span class="ds-card-fields">
                        {m.fields.length === 0 ? (
                          <span class="ds-card-field is-shape">{m.shape ? m.shape.label : 'no fields'}</span>
                        ) : (
                          m.fields.map((f) => (
                            <span key={f.name} class="ds-card-field" title={f.type.label}>
                              <KindIcon kind={f.type.kind} />
                              <span class="ds-card-field-name">{f.name}</span>
                              {f.required && (
                                <span class="ds-star" title="required">
                                  *
                                </span>
                              )}
                            </span>
                          ))
                        )}
                      </span>
                    </div>
                  )
                })}
              </div>
              {data.relations.map((r) => {
                const a = place.get(r.from)
                const b = place.get(r.to)
                if (!a || !b) return null
                const idx = byName.get(r.from)!.fields.findIndex((f) => f.name === r.field)
                const { mid } = edgePath(a, idx, b)
                const on = r.from === selected || r.to === selected
                return (
                  <span
                    key={`${r.from}.${r.field}`}
                    class={`ds-caption${on ? ' is-on' : ''}${selected && !on ? ' is-dim' : ''}`}
                    style={{ left: `${mid.x}px`, top: `${mid.y}px` }}
                    aria-hidden="true"
                  >
                    {caption(r)}
                    {r.field !== r.to && <span class="ds-caption-to">{r.to}</span>}
                  </span>
                )
              })}
            </div>
          </div>
          <section class="ds-strip" aria-label="Field types on this site">
            <h4 class="ds-strip-title">Field types on this site</h4>
            <ul class="ds-bricks">
              {KIND_ORDER.filter((k) => kinds.has(k)).map((k) => (
                <li key={k} class="ds-brick" data-kind={k}>
                  <BrickIcon colour={KIND[k].brick} size={44} />
                  <span class="ds-brick-label">{KIND[k].label}</span>
                  <span class="ds-brick-count">
                    {kinds.get(k)} {kinds.get(k) === 1 ? 'field' : 'fields'}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
        {selected && <Inspector model={byName.get(selected)!} models={models} relations={data.relations} onSelect={(n) => select(n, true)} />}
      </div>
    </section>
  )
}

type InspectorTab = 'fields' | 'relations' | 'validation'
const INSPECTOR_TABS: Array<{ id: InspectorTab; label: string }> = [
  { id: 'fields', label: 'Fields' },
  { id: 'relations', label: 'Relations' },
  { id: 'validation', label: 'Validation' },
]

function FieldRows({ fields, nested = false }: { fields: Field[]; nested?: boolean }) {
  return (
    <ul class={`ds-fields${nested ? ' is-nested' : ''}`} aria-label={nested ? 'Nested fields' : 'Fields'}>
      {fields.map((f) => (
        <li key={f.name} class="ds-field" data-field={f.name}>
          <span class="ds-field-row">
            <KindIcon kind={f.type.kind} />
            <span class="ds-field-name">{f.name}</span>
            {f.required && <span class="ds-req">required</span>}
            <TypePill type={f.type} />
          </span>
          {(f.title || f.description) && <span class="ds-field-note">{[f.title, f.description].filter(Boolean).join(' · ')}</span>}
          {f.type.values && <span class="ds-field-note">{f.type.values.join(' · ')}</span>}
          {f.type.fields && f.type.fields.length > 0 && <FieldRows fields={f.type.fields} nested />}
        </li>
      ))}
    </ul>
  )
}

function Inspector({ model, models, relations, onSelect }: { model: Model; models: SiteModels; relations: Relation[]; onSelect: (name: string) => void }) {
  const [tab, setTab] = useState<InspectorTab>('fields')
  const out = relations.filter((r) => r.from === model.name)
  const into = relations.filter((r) => r.to === model.name)
  const usage = usageOf(model.name, models)
  const required = model.fields.filter((f) => f.required)
  const enums = model.fields.filter((f) => f.type.values)
  const issues = (models.issues ?? []).filter((i) => i.path === `/types/${model.name}` || i.path.startsWith(`/types/${model.name}/`))
  return (
    <aside class="ds-inspector" aria-label={`Model ${model.name}`}>
      <header class="ds-insp-head">
        <h3 class="ds-insp-name">{model.name}</h3>
        {model.title && <p class="ds-insp-title">{model.title}</p>}
        {model.description && <p class="ds-insp-desc">{model.description}</p>}
        <p class="ds-insp-meta">
          {model.fields.length} {model.fields.length === 1 ? 'field' : 'fields'} · {required.length} required
          {model.shape ? ` · ${model.shape.label}` : ''}
        </p>
      </header>
      <Tabs label="Model details" idPrefix="ds" tabs={INSPECTOR_TABS} value={tab} onChange={setTab} />
      <TabPanel idPrefix="ds" value={tab}>
        {tab === 'fields' &&
          (model.fields.length ? <FieldRows fields={model.fields} /> : <p class="muted small">{model.shape ? `Not an object: ${model.shape.label}.` : 'This model has no fields.'}</p>)}
        {tab === 'relations' && (
          <>
            <h4>Points to</h4>
            {out.length ? (
              <ul class="ds-rels" aria-label="Points to">
                {out.map((r) => (
                  <li key={r.field}>
                    <span class="ds-field-name">{r.field}</span>
                    <span class="ds-rel-card">{r.many ? 'many' : 'one'}</span>
                    <button type="button" class="ds-rel-link" onClick={() => onSelect(r.to)}>
                      {r.to}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p class="muted small">No field refers to another model.</p>
            )}
            <h4>Pointed at by</h4>
            {into.length ? (
              <ul class="ds-rels" aria-label="Pointed at by">
                {into.map((r) => (
                  <li key={`${r.from}.${r.field}`}>
                    <button type="button" class="ds-rel-link" onClick={() => onSelect(r.from)}>
                      {r.from}
                    </button>
                    <span class="ds-field-name">{r.field}</span>
                    <span class="ds-rel-card">{r.many ? 'many' : 'one'}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p class="muted small">No model refers to this one.</p>
            )}
          </>
        )}
        {tab === 'validation' && (
          <ul class="ds-rules" aria-label="Validation">
            <li>{required.length ? `Required: ${required.map((f) => f.name).join(', ')}` : 'No field is required.'}</li>
            <li>{model.closed ? 'Closed: no fields beyond these.' : 'Open: other fields are allowed.'}</li>
            {enums.map((f) => (
              <li key={f.name}>
                {f.name}: one of {f.type.values!.join(', ')}
              </li>
            ))}
            {issues.map((i) => (
              <li key={`${i.code}${i.path}${i.message}`} class="bad-text">
                {i.code}: {i.message}
              </li>
            ))}
          </ul>
        )}
      </TabPanel>
      <section class="ds-usage" aria-label="Where it is used">
        <h4>Collection settings</h4>
        {usage.collections.length ? (
          usage.collections.map((c) => (
            <dl key={c.id} class="ds-settings">
              <dt>Collection</dt>
              <dd>{c.id}</dd>
              <dt>Source</dt>
              <dd>{c.from}</dd>
              {c.order && (
                <>
                  <dt>Order</dt>
                  <dd>{c.order}</dd>
                </>
              )}
              {c.limit !== undefined && (
                <>
                  <dt>Limit</dt>
                  <dd>{c.limit}</dd>
                </>
              )}
              {c.items !== undefined && (
                <>
                  <dt>Items</dt>
                  <dd>{c.items}</dd>
                </>
              )}
              <dt>Page types</dt>
              <dd>{c.pageTypes.length ? c.pageTypes.join(', ') : 'none renders its items'}</dd>
            </dl>
          ))
        ) : (
          <p class="muted small">No collection stores this model.</p>
        )}
        {usage.tools.length > 0 && (
          <>
            <h4>Tools</h4>
            <ul class="ds-rels" aria-label="Tools">
              {usage.tools.map((t) => (
                <li key={`${t.id}.${t.dir}.${t.port}`}>
                  <span class="ds-field-name">{t.id}</span>
                  <span class="ds-rel-card">
                    {t.dir} {t.port}
                  </span>
                  <span class="ds-pill ds-pill-relation">{t.expr}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </aside>
  )
}

/** No types: say what the site has instead (a WordPress site's post types carry no typed fields). */
function EmptyState({ models }: { models: SiteModels }) {
  const wp = (models as { engine?: string }).engine === 'wordpress'
  const types = models.blueprint?.page_types ?? []
  return (
    <section class="ds" aria-label="Data models">
      <div class="ds-empty" role="status">
        <BrickIcon colour="#f2f0ea" size={56} />
        <h3 class="ds-title">No content models</h3>
        {wp ? (
          <p>
            This WordPress site's post types{types.length ? ` (${types.map((t) => t.id).join(', ')})` : ''} come without typed fields, so there is no model to
            draw.
          </p>
        ) : (
          <p>The site declares no content types in its blueprint.</p>
        )}
      </div>
    </section>
  )
}
