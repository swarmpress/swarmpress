/**
 * The boot screen (FEAT-080): what the page shows while wasm, the renderer
 * and, for a company session, login, store, lease and restore run. It lists
 * the stages with the current one marked, and turns into a visible error when
 * boot fails (the page also keeps `document.body.dataset.error`, which the
 * e2e specs read).
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

export type StageState = 'pending' | 'active' | 'done' | 'failed'

export interface BootScreen {
  /** Stage `id` started: the stages before it are done. An unknown id is ignored. */
  stage(id: string): void
  /** Boot failed: the active stage is marked, the error shown, with a reload button. */
  fail(error: unknown): void
  /** Boot finished: the screen leaves. */
  done(): void
  readonly el: HTMLElement
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function mountBootScreen(parent: HTMLElement, stages: BootStage[], opts: { reload?: () => void } = {}): BootScreen {
  const el = document.createElement('div')
  el.id = 'boot-screen'
  el.className = 'boot-screen'
  el.dataset.state = 'loading'
  el.setAttribute('role', 'status')
  el.setAttribute('aria-live', 'polite')
  el.setAttribute('aria-label', 'Starting swarm.press')

  const title = document.createElement('h1')
  title.className = 'boot-title'
  title.textContent = 'swarm.press'

  const progress = document.createElement('progress')
  progress.className = 'boot-progress'
  progress.max = stages.length
  progress.value = 0
  progress.setAttribute('aria-label', 'Boot progress')

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

  const message = document.createElement('div')
  message.className = 'boot-error'
  message.hidden = true

  el.append(title, progress, list, message)
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
    fail(error) {
      el.dataset.state = 'error'
      el.setAttribute('role', 'alert')
      el.setAttribute('aria-live', 'assertive')
      if (active >= 0) mark(active, 'failed')
      const where = active >= 0 ? ` (${stages[active].label.toLowerCase()})` : ''
      const text = document.createElement('p')
      text.className = 'boot-error-text'
      text.textContent = `swarm.press could not start${where}: ${errorText(error)}`
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'boot-reload'
      button.textContent = 'Reload'
      button.addEventListener('click', () => (opts.reload ?? (() => location.reload()))())
      message.replaceChildren(text, button)
      message.hidden = false
    },
    done() {
      el.remove()
    },
  }
}
