/**
 * The WordPress card (ADR-0079, plan M1): the startup stages of a company's WordPress
 * (session/wordpress-runtime.ts) in a corner of the office, built from the boot screen's `card`
 * variant like the model card. The office stays usable while WordPress starts; the card leaves
 * once the site is qualified and stays with the reason and a retry when a stage failed.
 */
import { WP_STAGES } from '../php/startup'
import type { WordPressRuntime, WordPressRuntimeInfo } from '../session/wordpress-runtime'
import { mountBootScreen, type BootScreen } from './boot-screen'

export const WORDPRESS_CARD_ID = 'wordpress-startup'

export function mountWordPressCard(rt: WordPressRuntime, parent: HTMLElement = document.body): { dispose(): void } {
  let screen: BootScreen | null = null
  let shown: string | null = null
  const close = () => {
    screen?.done()
    screen = null
    shown = null
  }
  const render = (i: WordPressRuntimeInfo) => {
    if (i.phase === 'ready') return close()
    const key = i.phase === 'starting' ? 'starting' : `${i.phase}:${i.error ?? ''}`
    if (key !== shown) {
      close()
      screen = mountBootScreen(parent, [...WP_STAGES], { id: WORDPRESS_CARD_ID, title: `WordPress · ${i.label}`, label: 'WordPress', variant: 'card', failPrefix: '' })
      shown = key
    }
    const s = screen!
    s.el.dataset.phase = i.phase
    for (const st of WP_STAGES) s.mark(st.id, i.stages[st.id].state, i.stages[st.id].detail)
    if (i.phase === 'blocked') {
      s.fail(`WordPress cannot run here: ${i.error ?? 'the PHP backend is not available'}. The office stays open; the site takes no work until it starts.`, {
        actions: [{ label: 'Try again', primary: true, run: () => void rt.retry().catch(() => undefined) }],
      })
    } else if (i.phase === 'failed') {
      s.fail(i.error ?? 'WordPress did not start', { actions: [{ label: 'Try again', primary: true, run: () => void rt.retry().catch(() => undefined) }] })
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
