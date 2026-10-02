import { render } from 'preact'
import { signal } from '@preact/signals'
import { eurCompact } from './format'

export interface HudState {
  clock: string
  day: number
  renderer: string
  version: string
  fps: number
}

/** Company numbers the CEO overlay feeds into the HUD (organization.md §6–7). */
export interface HudBusiness {
  cashEur: number
  runwayDays: number | null
  /** false without a CFO: "books not kept". */
  booksKept: boolean
  openTickets: number
  highTickets: number
}

const state = signal<HudState>({ clock: '--:--', day: 0, renderer: '', version: '', fps: 0 })
export const hudBusiness = signal<HudBusiness | null>(null)

export function HudBusinessStats({ b }: { b: HudBusiness }) {
  return (
    <span class="hud-business">
      <span class="hud-stat" title="Cash">
        <span class="hud-label">Cash</span> {eurCompact(b.cashEur)}
      </span>
      {b.booksKept ? (
        <span class={`hud-stat${b.runwayDays != null && b.runwayDays < 30 ? ' is-warn' : ''}`} title="Runway">
          <span class="hud-label">Runway</span> {b.runwayDays == null ? '—' : `${b.runwayDays} d`}
        </span>
      ) : (
        <span class="hud-stat is-warn">Books not kept</span>
      )}
      <span class={`hud-stat${b.highTickets > 0 ? ' is-alert' : ''}`} title="Open tickets">
        <span class="hud-label">Inbox</span> {b.openTickets}
        {b.highTickets > 0 && <span class="hud-high"> · {b.highTickets} high</span>}
      </span>
    </span>
  )
}

function Hud() {
  const s = state.value
  const b = hudBusiness.value
  return (
    <div class="hud" role="status" aria-live="off">
      <span class="hud-clock">
        Day {s.day + 1} · {s.clock}
      </span>
      {b && <HudBusinessStats b={b} />}
      <span class="hud-meta">
        {s.renderer} · {s.fps} fps · {s.version}
      </span>
    </div>
  )
}

/** Heads-up display: clock and renderer, plus company numbers once the CEO overlay is mounted (ADR-0018). */
export function mountHud(el: HTMLElement) {
  render(<Hud />, el)
  return {
    set(next: HudState) {
      const prev = state.peek()
      if (prev.clock !== next.clock || prev.fps !== next.fps || prev.renderer !== next.renderer) state.value = next
    },
  }
}
