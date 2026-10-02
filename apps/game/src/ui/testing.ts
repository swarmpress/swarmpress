/** Helpers for the overlay's vitest suites (jsdom). Not used at runtime. */
import { MockDataSource, type MockOptions } from './mock-source'
import { mountOverlay } from './mount'

export function setup(opts: MockOptions = {}) {
  const source = new MockDataSource(opts)
  const el = document.createElement('div')
  document.body.appendChild(el)
  const handle = mountOverlay(el, source)
  return {
    source,
    store: handle.store,
    el,
    cleanup() {
      handle.dispose()
      el.remove()
    },
  }
}

/** Let signal updates and Preact's debounced re-render flush. */
export const flush = () => new Promise((r) => setTimeout(r, 0))
