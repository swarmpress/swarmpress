import { render } from 'preact'
import { effect } from '@preact/signals'
import { Overlay } from './components/Overlay'
import type { GameDataSource } from './data-source'
import { hudBusiness, hudNow } from './hud'
import { booksKept } from './rules'
import { FIXTURE_NOW, MockDataSource } from './mock-source'
import { createOverlayStore, type OverlayStore } from './store'
import { hasOrgApi, WasmDataSource } from './wasm-source'
import './overlay.css'

export type { GameDataSource } from './data-source'
export { MockDataSource } from './mock-source'
export { WasmDataSource, hasOrgApi } from './wasm-source'

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
}

/** Global keyboard shortcuts: panel letters and the panel's position (1–9), Escape closes. */
export function handleShortcut(store: OverlayStore, e: KeyboardEvent): boolean {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return false
  if (e.key === 'Escape') {
    if (store.article.value) store.closeArticle()
    else if (store.profile.value) store.closeProfile()
    else if (store.selectedItem.value && store.panel.value === 'plan') store.selectedItem.value = null
    else if (store.panel.value) store.panel.value = null
    else return false
    return true
  }
  if (isTyping(e.target)) return false
  const k = e.key.toLowerCase()
  const panel = store.panels.find((p, i) => p.key === k || String(i + 1) === k)
  if (!panel) return false
  store.togglePanel(panel.id)
  return true
}

/**
 * Mount the CEO management overlay (ADR-0018) into `el`. Returns the store
 * (for tests and dev tools) and a dispose function.
 */
export function mountOverlay(el: HTMLElement, source: GameDataSource) {
  const store = createOverlayStore(source)
  render(<Overlay store={store} />, el)
  const onKey = (e: KeyboardEvent) => {
    if (handleShortcut(store, e)) e.preventDefault()
  }
  window.addEventListener('keydown', onKey)
  const stopHud = effect(() => {
    const f = store.finance.value
    const org = store.org.value
    const open = store.inbox.value.tickets.filter((t) => t.status === 'open')
    hudBusiness.value = {
      cashEur: f.cashEur,
      runwayDays: f.runwayDays,
      booksKept: booksKept(f, org),
      openTickets: open.length,
      highTickets: open.filter((t) => t.priority === 'high').length,
    }
  })
  // The HUD's "Now" strip (U4): the job in flight (jobs run one at a time), named like the chip names it.
  const stopNow = effect(() => {
    const job = store.live.value[0]
    if (!job) {
      hudNow.value = null
      return
    }
    const s = job.staff ? store.staff(job.staff) : undefined
    const name = s ? store.personaOf(s.id).name : job.persona ? (store.persona(job.persona)?.name ?? null) : null
    hudNow.value = {
      jobId: job.jobId,
      who: name ? name.split(' ')[0] : null,
      kind: job.kind,
      stage: job.label,
      elapsedMs: job.elapsedMs,
      open: () => store.openActivity(job.jobId),
    }
  })
  return {
    store,
    dispose() {
      window.removeEventListener('keydown', onKey)
      stopHud()
      stopNow()
      hudNow.value = null
      hudBusiness.value = null
      store.dispose()
      render(null, el)
    },
  }
}

/**
 * Pick the data source: the wasm sim once it exposes the organization API
 * (feature-detected), otherwise the fixture-backed mock. `?ui=mock` forces
 * the mock.
 */
export function selectDataSource(sim: unknown, params: URLSearchParams, clock?: () => number): GameDataSource {
  if (params.get('ui') !== 'mock' && hasOrgApi(sim)) return new WasmDataSource(sim)
  if (!clock) return new MockDataSource()
  // Fixture deadlines are relative to the fixture's clock; advance it with the sim.
  const start = clock()
  return new MockDataSource({ clock: () => FIXTURE_NOW + clock() - start })
}
