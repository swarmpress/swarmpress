/**
 * The instruction booklet (FEAT-101, ADR-0077; design brick-studio.md §3): a
 * change set shown as numbered building steps, one per change, in bags per
 * building. Each step shows the building it works on in front elevation,
 * with the storeys it touches outlined and the rest dimmed, and a callout of
 * the parts it adds and takes away. The same view reviews a staff proposal
 * (the StructureApproval ticket's answers) and the CEO's own draft before it
 * is saved ("Build it" saves). Text is data: JSX text only.
 */
import { render, type ComponentChildren } from 'preact'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import { buildingsOf } from '../../blueprint/model'
import type { Blueprint, BlueprintChange } from '../../blueprint/types'
import { BrickCanvas } from '../blueprint/Canvas'
import { bookletOf, SITE_BAG, type BookletStep } from './steps'
import { Elevation } from './Building'

/**
 * Draws its children in a container of its own at the overlay's root: a panel
 * (with its backdrop filter) would otherwise clip a fixed layer to itself.
 * Plain Preact (`preact/compat`'s portal would switch every form field's
 * `onChange` to React's semantics); the children take props only, no context.
 */
function Layer({ children }: { children: ComponentChildren }) {
  const box = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    const div = document.createElement('div')
    ;(document.querySelector('.ceo-overlay') ?? document.body).appendChild(div)
    box.current = div
    return () => {
      render(null, div)
      div.remove()
      box.current = null
    }
  }, [])
  useLayoutEffect(() => {
    if (box.current) render(<>{children}</>, box.current)
  })
  return null
}

export interface BookletAction {
  label: string
  onClick: () => void
  primary?: boolean
  disabled?: boolean
}

/** JSON with sorted keys: the server's and `apply_changes`' serialisations order fields differently. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(v)
}

/**
 * The storeys a step touches: those that differ between the model before and
 * after it (new, gone or changed). Null when none differ (a label or route
 * change): nothing is dimmed then.
 */
function touched(step: BookletStep): Set<string> | null {
  const slots = (bp: Blueprint) => new Map((bp.page_types.find((t) => t.id === step.bag)?.slots ?? []).map((x) => [x.id, canonical({ ...x, min: x.min ?? 0 })]))
  const before = slots(step.before)
  const after = slots(step.after)
  const out = new Set<string>()
  for (const [id, json] of after) if (before.get(id) !== json) out.add(id)
  for (const id of before.keys()) if (!after.has(id)) out.add(id)
  return out.size ? out : null
}

function StepModel({ step }: { step: BookletStep }) {
  if (step.bag === SITE_BAG || step.change.subject === 'relationship') {
    const buildings = buildingsOf(step.after, step.before, [step.change], [])
    return (
      <div class="st-scroll">
        <BrickCanvas bp={step.after} buildings={buildings} selected={null} onSelect={() => undefined} layout={{}} onMove={null} onDropBlock={null} />
      </div>
    )
  }
  const gone = step.change.subject === 'page-type' && step.change.kind === 'removed'
  const shown = gone ? step.before : step.after
  const views = buildingsOf(step.after, step.before, [step.change], [])
  const view = views.find((b) => b.type.id === step.bag)
  if (!view) return <p class="muted">{`The building ${step.bag} is not in this step.`}</p>
  return <Elevation bp={shown} view={view} highlight={touched(step)} />
}

export function Booklet({
  title,
  summary,
  base,
  proposal,
  changes,
  apply,
  actions,
  onClose,
}: {
  title: string
  summary?: string
  base: Blueprint
  proposal: Blueprint
  changes: BlueprintChange[]
  /** The base with these changes applied (`apply_changes`), null when it cannot. */
  apply: (changes: BlueprintChange[]) => Blueprint | null
  actions: BookletAction[]
  onClose: () => void
}) {
  const book = useMemo(() => bookletOf(base, proposal, changes, apply), [base, proposal, changes, apply])
  const [at, setAt] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const n = book.steps.length
  const step = book.steps[Math.min(at, n - 1)]
  useEffect(() => ref.current?.focus(), [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return
      if (e.key === 'ArrowRight') setAt((i) => Math.min(n - 1, i + 1))
      else if (e.key === 'ArrowLeft') setAt((i) => Math.max(0, i - 1))
      else if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      } else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [n, onClose])
  const bag = step ? book.bags.find((b) => b.id === step.bag) : undefined
  return (
    <Layer>
    <div class="st-booklet-backdrop">
      <div ref={ref} class="st-booklet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
        <header class="st-booklet-head">
          <h3>{title}</h3>
          <span class="small muted">
            {n} {n === 1 ? 'step' : 'steps'} in {book.bags.length} {book.bags.length === 1 ? 'bag' : 'bags'}
          </span>
          <button type="button" class="icon-btn" aria-label="Close the booklet" onClick={onClose}>
            ×
          </button>
        </header>
        {summary && <p class="ticket-summary">{summary}</p>}
        {!step ? (
          <p class="muted">Nothing to build: this change set is empty.</p>
        ) : (
          <div class="st-booklet-page">
            <aside class="st-booklet-side">
              <div class="st-step-number" aria-live="polite">
                <span>{step.index + 1}</span>
                <small>of {n}</small>
              </div>
              <p class="small">
                Bag <strong>{bag?.label ?? step.bag}</strong>
              </p>
              <ul class="st-callout" aria-label="Parts in this step">
                {step.parts.map((p, k) => (
                  <li key={k} class={p.startsWith('+') ? 'is-add' : p.startsWith('−') ? 'is-remove' : 'is-change'}>
                    {p}
                  </li>
                ))}
              </ul>
              <ol class="st-bags" aria-label="Bags">
                {book.bags.map((b) => (
                  <li key={b.id} class={b.id === step.bag ? 'is-active' : ''}>
                    <button type="button" class="link-btn" onClick={() => setAt(b.steps[0].index)}>
                      {b.label}
                    </button>{' '}
                    <span class="muted">({b.steps.length})</span>
                  </li>
                ))}
              </ol>
            </aside>
            <div class="st-booklet-model" data-step={step.index}>
              <StepModel step={step} />
            </div>
          </div>
        )}
        <footer class="st-booklet-foot">
          <button type="button" class="btn btn-quiet" disabled={at === 0} onClick={() => setAt((i) => Math.max(0, i - 1))}>
            ← Back
          </button>
          <input type="range" min={0} max={Math.max(0, n - 1)} value={Math.min(at, Math.max(0, n - 1))} aria-label="Step" onInput={(e) => setAt(Number(e.currentTarget.value))} disabled={n < 2} />
          <button type="button" class="btn btn-quiet" disabled={at >= n - 1} onClick={() => setAt((i) => Math.min(n - 1, i + 1))}>
            Next →
          </button>
          <span class="st-booklet-actions">
            {actions.map((a) => (
              <button key={a.label} type="button" class={`btn${a.primary ? ' is-proposed' : ''}`} disabled={a.disabled} onClick={a.onClick}>
                {a.label}
              </button>
            ))}
          </span>
        </footer>
      </div>
    </div>
    </Layer>
  )
}
