/**
 * The boot screen (FEAT-080): what the page shows while wasm, the renderer
 * and, for a company session, login, store, lease and restore run. It lists
 * the stages with the current one marked, and turns into a visible error when
 * boot fails (the page also keeps `document.body.dataset.error`, which the
 * e2e specs read).
 *
 * The same component, as a `card` in a corner, shows the local model's
 * startup (ui/model-card.ts, ADR-0057): the office stays usable while the
 * model loads, so the card never covers the page. It adds a note per stage
 * (bytes downloaded, what the runtime says), a message with buttons (the
 * first-time explanation, "the model is running in another tab") and errors
 * with actions of their own (retry, reload the model).
 *
 * Plain DOM, no framework: it has to be up before anything else is loaded.
 */
import './boot-screen.css'

export interface BootStage {
  id: string
  label: string
}

/** The offline page: the sim, the renderer, the office scene. */
export const DEMO_STAGES: BootStage[] = [
  { id: 'wasm', label: 'Simulation' },
  { id: 'renderer', label: 'Renderer' },
  { id: 'scene', label: 'Office' },
]

/** A company session (`?central=1`): the session's own stages between the renderer and the scene. */
export const SESSION_STAGES: BootStage[] = [
  { id: 'wasm', label: 'Simulation' },
  { id: 'renderer', label: 'Renderer' },
  { id: 'login', label: 'Sign in' },
  { id: 'store', label: 'Company store' },
  { id: 'lease', label: 'Company lease' },
  { id: 'restore', label: 'Restore the company' },
  { id: 'orchestrator', label: 'Orchestrator and model' },
  { id: 'scene', label: 'Office' },
]

export type StageState = 'pending' | 'active' | 'done' | 'skipped' | 'failed'

/** A button under the message or the error. */
export interface BootAction {
  label: string
  /** The one the player most likely wants (styled as the main button). */
  primary?: boolean
  run(): void
}

export interface BootScreen {
  /** Stage `id` started: the stages before it are done. An unknown id is ignored. */
  stage(id: string): void
  /** Sets one stage's state and note directly (a view of state kept elsewhere). An unknown id is ignored. */
  mark(id: string, state: StageState, note?: string | null): void
  /** A message with buttons below the stages; `null` takes it away. */
  prompt(text: string | null, actions?: BootAction[]): void
  /**
   * Boot failed: the active stage is marked, the error shown, with a reload
   * button, or with `actions` instead of it.
   */
  fail(error: unknown, opts?: { actions?: BootAction[] }): void
  /** Boot finished: the screen leaves. */
  done(): void
  readonly el: HTMLElement
}

export interface BootScreenOptions {
  reload?: () => void
  /** The element's id. Default `boot-screen`. */
  id?: string
  /** The heading. Default "swarm.press". */
  title?: string
  /** The accessible name. Default "Starting swarm.press". */
  label?: string
  /** `screen` covers the page (boot); `card` sits in a corner and leaves the page usable. Default `screen`. */
  variant?: 'screen' | 'card'
  /** What an error starts with; `''` shows the error alone. Default "swarm.press could not start". */
  failPrefix?: string
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

function buttons(actions: BootAction[]): HTMLElement {
  const row = document.createElement('div')
  row.className = 'boot-actions'
  for (const a of actions) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = a.primary ? 'boot-reload' : 'boot-secondary'
    b.textContent = a.label
    b.addEventListener('click', () => a.run())
    row.append(b)
  }
  return row
}

export function mountBootScreen(parent: HTMLElement, stages: BootStage[], opts: BootScreenOptions = {}): BootScreen {
  const el = document.createElement('div')
  el.id = opts.id ?? 'boot-screen'
  el.className = opts.variant === 'card' ? 'boot-screen is-card' : 'boot-screen'
  el.dataset.state = 'loading'
  el.setAttribute('role', 'status')
  el.setAttribute('aria-live', 'polite')
  el.setAttribute('aria-label', opts.label ?? 'Starting swarm.press')

  const title = document.createElement(opts.variant === 'card' ? 'h2' : 'h1')
  title.className = 'boot-title'
  title.textContent = opts.title ?? 'swarm.press'

  const progress = document.createElement('progress')
  progress.className = 'boot-progress'
  progress.max = stages.length
  progress.value = 0
  progress.setAttribute('aria-label', opts.variant === 'card' ? `${opts.title ?? 'Startup'} progress` : 'Boot progress')

  const list = document.createElement('ol')
  list.className = 'boot-stages'
  const items = new Map<string, HTMLLIElement>()
  for (const s of stages) {
    const li = document.createElement('li')
    li.dataset.stage = s.id
    li.dataset.state = 'pending' satisfies StageState
    li.textContent = s.label
    items.set(s.id, li)
    list.append(li)
  }

  const note = document.createElement('div')
  note.className = 'boot-message'
  note.hidden = true

  const message = document.createElement('div')
  message.className = 'boot-error'
  message.hidden = true

  el.append(title, progress, list, note, message)
  parent.append(el)

  let active = -1
  const mark = (index: number, state: StageState) => {
    const li = items.get(stages[index]?.id)
    if (li) li.dataset.state = state
  }

  return {
    el,
    stage(id) {
      const index = stages.findIndex((s) => s.id === id)
      if (index < 0 || el.dataset.state === 'error') return
      for (let i = 0; i < index; i++) mark(i, 'done')
      mark(index, 'active')
      active = index
      progress.value = index
      el.dataset.stage = id
    },
    mark(id, state, text) {
      const index = stages.findIndex((s) => s.id === id)
      const li = items.get(id)
      if (index < 0 || !li) return
      li.dataset.state = state
      const label = stages[index].label
      if (text) {
        const span = document.createElement('span')
        span.className = 'boot-stage-note'
        span.textContent = text
        li.replaceChildren(label, span)
      } else li.replaceChildren(label)
      if (state === 'active' || state === 'failed') {
        active = index
        el.dataset.stage = id
      }
      progress.value = stages.filter((s) => ['done', 'skipped'].includes(items.get(s.id)?.dataset.state ?? '')).length
    },
    prompt(text, actions = []) {
      if (text === null) {
        note.hidden = true
        note.replaceChildren()
        return
      }
      const p = document.createElement('p')
      p.className = 'boot-message-text'
      p.textContent = text
      note.replaceChildren(p, ...(actions.length ? [buttons(actions)] : []))
      note.hidden = false
    },
    fail(error, failOpts = {}) {
      el.dataset.state = 'error'
      el.setAttribute('role', 'alert')
      el.setAttribute('aria-live', 'assertive')
      if (active >= 0) mark(active, 'failed')
      const where = active >= 0 ? ` (${stages[active].label.toLowerCase()})` : ''
      const prefix = opts.failPrefix ?? 'swarm.press could not start'
      const text = document.createElement('p')
      text.className = 'boot-error-text'
      text.textContent = prefix ? `${prefix}${where}: ${errorText(error)}` : errorText(error)
      const actions = failOpts.actions ?? [{ label: 'Reload', primary: true, run: () => (opts.reload ?? (() => location.reload()))() }]
      message.replaceChildren(text, buttons(actions))
      message.hidden = false
    },
    done() {
      el.remove()
    },
  }
}
