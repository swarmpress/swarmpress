import { render } from 'preact'
import { effect } from '@preact/signals'
import { Overlay } from './components/Overlay'
import type { GameDataSource } from './data-source'
import { hudBusiness } from './hud'
import { FIXTURE_NOW, MockDataSource } from './mock-source'
import { createOverlayStore, PANELS, type OverlayStore } from './store'
import { hasOrgApi, WasmDataSource } from './wasm-source'
import './overlay.css'

export type { GameDataSource } from './data-source'
export { MockDataSource } from './mock-source'
export { WasmDataSource, hasOrgApi } from './wasm-source'

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
}

/** Global keyboard shortcuts: panel letters and 1–7, Escape closes. */
export function handleShortcut(store: OverlayStore, e: KeyboardEvent): boolean {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return false
  if (e.key === 'Escape') {
    if (store.profile.value) store.closeProfile()
    else if (store.selectedItem.value && store.panel.value === 'plan') store.selectedItem.value = null
    else if (store.panel.value) store.panel.value = null
    else return false
    return true
  }
  if (isTyping(e.target)) return false
  const k = e.key.toLowerCase()
  const panel = PANELS.find((p, i) => p.key === k || String(i + 1) === k)
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
      booksKept: !!org.executive.cfo && f.booksKept !== false,
      openTickets: open.length,
      highTickets: open.filter((t) => t.priority === 'high').length,
    }
  })
  return {
    store,
    dispose() {
      window.removeEventListener('keydown', onKey)
      stopHud()
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
