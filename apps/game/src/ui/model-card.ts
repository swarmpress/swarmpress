/**
 * The local model's card (ADR-0057, R8): the startup stages of the session's
 * model runtime (session/model-runtime.ts) in a corner of the office, built
 * from the boot screen's `card` variant. The office stays open and usable
 * while the model loads; the HUD chip says the same in one line.
 *
 * It is a view: every button calls the runtime, and every change of the
 * runtime redraws it. It asks the player only where the player decides:
 * starting the model the first time, taking it over from another tab,
 * reloading it after a device loss, retrying, or choosing another backend
 * for the company when this one cannot run here (never chosen for them).
 */
import { BACKENDS, type BackendId } from '../llm/backend'
import { STARTUP_STAGES } from '../llm/startup'
import type { ModelRuntime, ModelRuntimeInfo } from '../session/model-runtime'
import { mountBootScreen, type BootAction, type BootScreen } from './boot-screen'

export const MODEL_CARD_ID = 'model-startup'

export interface ModelCardOptions {
  /** Navigates after the player chose another backend (the `llm` parameter is dropped so the stored choice applies). */
  reloadPage?: (url: URL) => void
}

export function mountModelCard(rt: ModelRuntime, parent: HTMLElement = document.body, opts: ModelCardOptions = {}): { dispose(): void } {
  let screen: BootScreen | null = null
  let shown: string | null = null
  const reloadPage = opts.reloadPage ?? ((url: URL) => location.assign(url))

  const close = () => {
    screen?.done()
    screen = null
    shown = null
  }

  const toggle = (el: HTMLElement) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'boot-card-toggle'
    b.textContent = 'Hide'
    b.setAttribute('aria-expanded', 'true')
    b.addEventListener('click', () => {
      const collapsed = el.dataset.collapsed !== 'true'
      el.dataset.collapsed = String(collapsed)
      b.textContent = collapsed ? 'Show' : 'Hide'
      b.setAttribute('aria-expanded', String(!collapsed))
    })
    el.insertBefore(b, el.children[1] ?? null)
  }

  const switchTo = (id: BackendId): BootAction => ({
    label: `Use ${BACKENDS[id].label} for this company`,
    run: () =>
      void rt.switchBackend(id).then(() => {
        const url = new URL(location.href)
        url.searchParams.delete('llm')
        reloadPage(url)
      }),
  })

  const render = (i: ModelRuntimeInfo) => {
    if (i.phase === 'scripted' || i.phase === 'read-only' || i.phase === 'ready') return close()
    // Each phase gets a fresh card: an error card does not turn back into progress by itself.
    const key = i.phase === 'starting' ? 'starting' : `${i.phase}:${i.error ?? ''}:${i.canTakeOver}`
    if (key !== shown) {
      close()
      screen = mountBootScreen(parent, [...STARTUP_STAGES], { id: MODEL_CARD_ID, title: i.label ?? 'Local model', label: 'Local model', variant: 'card', failPrefix: '' })
      shown = key
      if (i.phase === 'starting') toggle(screen.el)
    }
    const s = screen!
    s.el.dataset.phase = i.phase
    for (const st of STARTUP_STAGES) s.mark(st.id, i.stages[st.id].state, i.stages[st.id].detail)
    switch (i.phase) {
      case 'starting':
        s.prompt(null)
        break
      case 'explain':
        s.prompt(i.explain, [
          { label: 'Start the model', primary: true, run: () => rt.accept() },
          { label: 'Not now', run: () => rt.decline() },
        ])
        break
      case 'declined':
        s.prompt('The local model was not started. The office stays open; the game clock waits for the model.', [{ label: 'Start the model', primary: true, run: () => rt.accept() }])
        break
      case 'elsewhere':
        s.prompt(
          'The model is running in another tab of swarm.press. One model per browser: this tab runs no model work, and its clock waits until that tab closes.',
          i.canTakeOver ? [{ label: 'Take over here', primary: true, run: () => void rt.takeOver() }] : [],
        )
        break
      case 'blocked':
        s.fail(i.error ?? 'the model backend cannot be used here', {
          actions: [{ label: 'Try again', primary: true, run: () => void rt.retry() }, ...i.alternatives.map(switchTo)],
        })
        break
      case 'failed':
        s.fail(i.error ?? 'the model did not start', { actions: [{ label: 'Try again', primary: true, run: () => void rt.retry() }] })
        break
      case 'lost':
        s.fail(`The GPU device was lost (${i.error ?? 'no reason given'}). The call in progress was discarded; the company's state is kept. The clock waits until the model is loaded again.`, {
          actions: [{ label: 'Reload the model', primary: true, run: () => void rt.reload() }],
        })
        break
    }
  }

  const off = rt.onChange(render)
  render(rt.info())
  return {
    dispose() {
      off()
      close()
    },
  }
}
