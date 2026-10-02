import { PANELS, StoreContext, useStore, type OverlayStore, type PanelId } from '../store'
import { Icon, Panel } from './common'
import { Finance } from './Finance'
import { Hiring } from './Hiring'
import { Inbox } from './Inbox'
import { OrgChart } from './OrgChart'
import { Performance } from './Performance'
import { Plan } from './Plan'
import { ProfileCard } from './ProfileCard'
import { Projects } from './Projects'

const PANEL_VIEW: Record<PanelId, () => preact.JSX.Element> = {
  plan: Plan,
  org: OrgChart,
  projects: Projects,
  finance: Finance,
  inbox: Inbox,
  hiring: Hiring,
  performance: Performance,
}

export function Toolbar() {
  const store = useStore()
  const active = store.panel.value
  const open = store.inbox.value.tickets.filter((t) => t.status === 'open')
  const high = open.filter((t) => t.priority === 'high').length
  return (
    <nav class="toolbar" aria-label="CEO tools">
      <ul>
        {store.panels.map((p, i) => (
          <li key={p.id}>
            <button
              type="button"
              class={`tool${active === p.id ? ' is-active' : ''}${i === 0 ? ' is-primary' : ''}`}
              aria-pressed={active === p.id}
              aria-controls={active === p.id ? `panel-${p.id}` : undefined}
              aria-keyshortcuts={`${p.key.toUpperCase()} ${i + 1}`}
              title={`${p.label} (${p.key.toUpperCase()} or ${i + 1})`}
              onClick={() => store.togglePanel(p.id)}
            >
              <Icon name={p.icon} />
              <span class="tool-label">{p.label}</span>
              {p.id === 'inbox' && open.length > 0 && (
                <span class={`tool-count${high ? ' is-high' : ''}`}>
                  {open.length}
                  <span class="sr-only"> open tickets{high ? `, ${high} high priority` : ''}</span>
                </span>
              )}
              <kbd aria-hidden="true">{p.key.toUpperCase()}</kbd>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}

function Toast() {
  const store = useStore()
  const t = store.toast.value
  return (
    <div class="toast-host" role="status" aria-live="polite">
      {t && (
        <div key={t.id} class={`toast toast-${t.tone}`}>
          {t.text}
        </div>
      )}
    </div>
  )
}

/** Before the first snapshot arrives from the (async) data source. */
function Loading({ id }: { id: PanelId }) {
  const def = PANELS.find((p) => p.id === id)!
  return (
    <Panel id={id} title={def.label}>
      <p class="muted" role="status">
        Loading…
      </p>
    </Panel>
  )
}

function Body() {
  const store = useStore()
  const id = store.panel.value
  const View = id ? PANEL_VIEW[id] : null
  return (
    <>
      <Toolbar />
      {id && View && (store.ready.value ? <View /> : <Loading id={id} />)}
      <ProfileCard />
      <Toast />
    </>
  )
}

export function Overlay({ store }: { store: OverlayStore }) {
  return (
    <StoreContext.Provider value={store}>
      {/* Keys typed into form fields must not reach the game's camera shortcuts. */}
      <div
        class="ceo-overlay"
        onKeyDown={(e) => {
          const t = e.target as HTMLElement
          if (e.key !== 'Escape' && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) e.stopPropagation()
        }}
      >
        <Body />
      </div>
    </StoreContext.Provider>
  )
}
