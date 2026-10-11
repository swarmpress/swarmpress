/**
 * Ask the office designer (FEAT-084, ADR-0087 decision 6): the CEO's words and a brief of numbers
 * for one room. The source stores them and logs `CommissionInterior`; the sim opens an Interior
 * work item whose Draft the office designer runs, and its plan comes back as a Build Approval
 * ticket (Economic mode) or goes straight to the builders (Sandbox). Nothing here builds anything
 * (rule 3, rule 11): the button only asks, and shows what the sim answered.
 */
import { useState } from 'preact/hooks'
import { useStore } from '../store'
import { BRIEF_FIELDS, EMPTY_BRIEF, isOfficeDesigner, type InteriorBrief } from './interior'
import type { BuildLayout } from './types'

export const WORDS_MAX = 600

export function AskOfficeDesigner({ layout, room, onRoom }: { layout: BuildLayout; room: string | null; onRoom: (id: string) => void }) {
  const store = useStore()
  const [words, setWords] = useState('')
  const [brief, setBrief] = useState<InteriorBrief>(EMPTY_BRIEF)
  const [budget, setBudget] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  const designer = store.org.value.staff.find((s) => isOfficeDesigner(s.role)) ?? null
  const target = layout.rooms.find((r) => r.id === room) ?? null
  const can = store.canCommissionInterior
  const hiring = store.panels.some((p) => p.id === 'hiring')
  const budgetEur = budget.trim() === '' ? null : Number(budget)
  const budgetBad = budgetEur !== null && !(Number.isFinite(budgetEur) && budgetEur > 0)
  const asked = words.trim() !== '' || BRIEF_FIELDS.some((f) => brief[f.key] > 0)
  /** Why the request cannot go yet; null when it can. */
  const why = !can
    ? 'Not available in this game.'
    : !designer
      ? 'Needs an office designer.'
      : !target
        ? 'Choose a room first.'
        : budgetBad
          ? 'The budget is a positive amount in euros, or empty for none.'
          : !asked
            ? 'Describe the room, or ask for at least one thing.'
            : null

  const submit = async () => {
    if (why || !target) return
    setBusy(true)
    setResult(null)
    const input = { room: target.id, words: words.trim(), brief: { ...brief, max_cost_cents: budgetEur === null ? null : Math.round(budgetEur * 100) } }
    const r = await store.commissionInterior(input)
    setBusy(false)
    if (r.ok) {
      const name = designer ? store.nameOf(designer.id) : 'The office designer'
      const next = layout.buildMode === 'sandbox' ? 'the builders start as soon as the plan is ready.' : 'the plan comes to your Inbox for approval.'
      setResult({ ok: true, text: `${name} is on it: ${next}` })
      setWords('')
    } else setResult({ ok: false, text: r.reason ?? 'The sim did not take the request.' })
  }

  return (
    <section aria-labelledby="build-designer-h">
      <h3 id="build-designer-h" class="build-h">
        Ask the office designer
      </h3>
      {!can ? (
        <p class="build-hint muted" role="note">
          This game cannot ask the office designer yet: the sim has no way to take the request.
        </p>
      ) : (
        !designer && (
          <div class="build-hint build-designer-hire" role="note">
            <p class="muted">No office designer on the staff. Hire one to have rooms furnished from your words.</p>
            {hiring && (
              <button type="button" class="btn" onClick={() => (store.panel.value = 'hiring')}>
                Open Hiring
              </button>
            )}
          </div>
        )
      )}
      <form
        class="build-gesture build-designer"
        aria-label="Ask the office designer"
        onSubmit={(e) => {
          e.preventDefault()
          if (!busy) void submit()
        }}
      >
        <fieldset class="build-designer-set" disabled={!can || !designer || busy}>
          <legend class="sr-only">The room and the brief</legend>
          <label class="build-field build-room-pick" for="build-designer-room">
            <span>The room</span>
            <select id="build-designer-room" value={target?.id ?? ''} onChange={(e) => onRoom((e.currentTarget as HTMLSelectElement).value)}>
              {!target && <option value="">Choose a room</option>}
              {layout.rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label} ({r.w} × {r.d} m)
                </option>
              ))}
            </select>
          </label>
          <label class="field" for="build-designer-words">
            <span>What should the room be?</span>
            <textarea
              id="build-designer-words"
              rows={3}
              maxLength={WORDS_MAX}
              value={words}
              placeholder="A meeting room for eight with a whiteboard"
              onInput={(e) => setWords(e.currentTarget.value)}
            />
          </label>
          <div class="build-fields">
            {BRIEF_FIELDS.map((f) => (
              <label key={f.key} class="build-field" for={`build-designer-${f.key}`}>
                <span>{f.label}</span>
                <input
                  id={`build-designer-${f.key}`}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={f.max}
                  step={1}
                  value={brief[f.key]}
                  onInput={(e) => {
                    const v = Math.round(Number((e.currentTarget as HTMLInputElement).value))
                    if (Number.isFinite(v)) setBrief({ ...brief, [f.key]: Math.max(0, Math.min(f.max, v)) })
                  }}
                />
              </label>
            ))}
            <label class="build-field" for="build-designer-budget">
              <span>Budget, € (optional)</span>
              <input id="build-designer-budget" type="number" inputMode="decimal" min={0} step={0.01} value={budget} placeholder="No limit" onInput={(e) => setBudget((e.currentTarget as HTMLInputElement).value)} />
            </label>
          </div>
        </fieldset>
        <div class="build-row">
          <button type="submit" class="btn btn-primary" disabled={!!why || busy} aria-describedby="build-designer-why">
            {busy ? 'Asking…' : 'Ask for a plan'}
          </button>
          <span id="build-designer-why" class="build-action-note">
            {why ?? (layout.buildMode === 'sandbox' ? 'Sandbox: the builders start as soon as the plan is ready.' : 'Nothing is built until you approve the plan in your Inbox.')}
          </span>
        </div>
        {result && (
          <p class={`build-verdict ${result.ok ? 'is-ok' : 'is-bad'}`} role={result.ok ? 'status' : 'alert'}>
            <span class="build-verdict-dot" aria-hidden="true" />
            {result.ok ? result.text : `Not taken: ${result.text}`}
          </p>
        )}
      </form>
    </section>
  )
}
