import { render } from 'preact'
import { signal } from '@preact/signals'

export interface HudState {
  clock: string
  day: number
  renderer: string
  version: string
  fps: number
}

const state = signal<HudState>({ clock: '--:--', day: 0, renderer: '', version: '', fps: 0 })

function Hud() {
  const s = state.value
  return (
    <div class="hud" role="status" aria-live="off">
      <span class="hud-clock">
        Day {s.day + 1} · {s.clock}
      </span>
      <span class="hud-meta">
        {s.renderer} · {s.fps} fps · {s.version}
      </span>
    </div>
  )
}

/** Minimal heads-up display; grows into the full overlay UI in M1 (ADR-0018). */
export function mountHud(el: HTMLElement) {
  render(<Hud />, el)
  return {
    set(next: HudState) {
      const prev = state.peek()
      if (prev.clock !== next.clock || prev.fps !== next.fps || prev.renderer !== next.renderer) state.value = next
    },
  }
}
