/**
 * The parts bin (design §5.1): the closed catalogue. Core blocks grouped by
 * category and coloured by intent, the site's own blocks, and the page-type
 * template. Nothing can be placed that the checker would not know. A block
 * goes into the selected storey by its button (or by dragging it onto a
 * storey of the canvas).
 */
import { useState } from 'preact/hooks'
import { blockColour, CATALOGUE, CATEGORY_LABEL, hexOf, type CatalogueBlock } from '../../blueprint/colours'
import { addPageType, freshId } from '../../blueprint/model'
import type { Blueprint } from '../../blueprint/types'
import type { Selection } from './Canvas'

export const BLOCK_MIME = 'application/x-swarmpress-block'

export function PartsBin({
  draft,
  customBlocks,
  selection,
  onChange,
  onSelect,
  onAddBlock,
}: {
  draft: Blueprint
  customBlocks: string[]
  selection: Selection | null
  onChange: (bp: Blueprint) => void
  onSelect: (s: Selection) => void
  onAddBlock: (type: string, slot: string, block: string) => void
}) {
  const [id, setId] = useState('')
  const [label, setLabel] = useState('')
  const [route, setRoute] = useState('')
  const groups = new Map<string, CatalogueBlock[]>()
  for (const b of CATALOGUE) groups.set(b.category, [...(groups.get(b.category) ?? []), b])
  const custom = customBlocks.map((type) => ({ type, category: 'custom', intent: 'inform' as const, description: 'A block of this site' }))
  if (custom.length) groups.set('custom', custom)
  const target = selection?.slot ? selection : null
  const slot = target ? draft.page_types.find((t) => t.id === target.type)?.slots?.find((s) => s.id === target.slot) : undefined
  const taken = new Set(draft.page_types.map((t) => t.id))
  const newId = id.trim()
  const clash = newId !== '' && taken.has(newId)
  return (
    <nav class="bp-bin" aria-label="Parts bin">
      <section aria-labelledby="bp-bin-type">
        <h3 id="bp-bin-type">New page type</h3>
        <form
          class="bp-bin-form"
          onSubmit={(e) => {
            e.preventDefault()
            if (!newId || clash) return
            onChange(addPageType(draft, { id: newId, label: label.trim() || newId, route: route.trim() || undefined }))
            onSelect({ type: newId })
            setId('')
            setLabel('')
            setRoute('')
          }}
        >
          <label class="field">
            Id
            <input value={id} placeholder={freshId('page', taken)} onInput={(e) => setId(e.currentTarget.value)} aria-invalid={clash} />
          </label>
          {clash && <p class="small bad-text">A page type {newId} exists.</p>}
          <label class="field">
            Label
            <input value={label} onInput={(e) => setLabel(e.currentTarget.value)} />
          </label>
          <label class="field">
            Route
            <input value={route} placeholder="/{lang}/…/{slug}" onInput={(e) => setRoute(e.currentTarget.value)} />
          </label>
          <button type="submit" class="btn" disabled={!newId || clash}>
            Add page type
          </button>
        </form>
      </section>
      <section aria-labelledby="bp-bin-blocks">
        <h3 id="bp-bin-blocks">Blocks</h3>
        <p class="small muted">{slot ? `Adds to the storey ${target!.slot} of ${target!.type}.` : 'Select a storey to add blocks to it.'}</p>
        {[...groups.entries()].map(([cat, blocks]) => (
          <details key={cat} open={cat === 'core' || cat === 'custom'}>
            <summary>
              {CATEGORY_LABEL[cat] ?? cat} <span class="muted">({blocks.length})</span>
            </summary>
            <ul class="bp-bin-list">
              {blocks.map((b) => {
                const has = !!slot?.blocks.includes(b.type)
                return (
                  <li key={b.type}>
                    <button
                      type="button"
                      class="bp-part"
                      draggable
                      disabled={has}
                      aria-disabled={!slot}
                      title={`${b.description} (${cat === 'custom' ? 'site' : b.intent})`}
                      aria-label={`Add ${b.type}${slot ? ` to ${target!.slot}` : ''}`}
                      onDragStart={(e) => e.dataTransfer?.setData(BLOCK_MIME, b.type)}
                      onClick={() => slot && target && onAddBlock(target.type, target.slot!, b.type)}
                    >
                      <span class="bp-swatch" style={{ background: hexOf(cat === 'custom' ? 'grey-light' : blockColour(b.type)) }} aria-hidden="true" />
                      {b.type}
                    </button>
                  </li>
                )
              })}
            </ul>
          </details>
        ))}
      </section>
    </nav>
  )
}
