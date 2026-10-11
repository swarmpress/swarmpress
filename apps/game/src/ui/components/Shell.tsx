/**
 * The app shell (ADR-0086, the mockups in `ui/`): the sections along the top
 * (Town, Building, Plan, Factory, Staff, Projects), the sidebar with the
 * company's site and every CEO tool with its count, and the quick ways out
 * (the Studio, the repository). The 3D town fills the space between them;
 * the panels open as the inspector on the right. Every control here does
 * something real: a section the source cannot offer is not shown.
 */
import { repoUrl } from '../links'
import { SECTIONS, sectionOf, sectionOffered } from '../sections'
import { useStore, type PanelId } from '../store'
import { Icon } from './common'

export function Logo() {
  return (
    <div class="shell-logo" aria-hidden="true">
      <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true" focusable="false">
        {/* A 2 × 2 brick: two studs over a body. */}
        <rect x="3" y="11" width="24" height="15" rx="3" fill="#f2b632" />
        <rect x="6" y="6" width="7" height="6" rx="2" fill="#f2b632" />
        <rect x="17" y="6" width="7" height="6" rx="2" fill="#f2b632" />
        <rect x="3" y="11" width="24" height="3" fill="#d99a14" />
      </svg>
      <span class="shell-wordmark">
        swarm<span class="shell-dot">.</span>press
      </span>
    </div>
  )
}

export function TopBar() {
  const store = useStore()
  const current = sectionOf(store.panel.value ?? null, store.studioTab.value ?? 'town')
  return (
    <div class="shell-top">
      <Logo />
      <nav class="shell-sections" aria-label="Sections">
        <ul>
          {SECTIONS.filter((s) => sectionOffered(s, store.panels)).map((s) => (
            <li key={s.id}>
              <button
                type="button"
                class={`shell-section${current === s.id ? ' is-active' : ''}`}
                aria-current={current === s.id ? 'page' : undefined}
                onClick={() => store.openSection(s.id)}
              >
                <span class="shell-section-icon">
                  <Icon name={s.icon} size={22} />
                </span>
                <span class="shell-section-text">
                  <span class="shell-section-label">{s.label}</span>
                  <span class="shell-section-sub">{s.sub}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}

/** A tool's count in the sidebar, where the snapshot has one. */
function useCounts(): Partial<Record<PanelId, number>> {
  const store = useStore()
  const org = store.org.value
  const plan = store.plan.value
  return {
    plan: plan.items.filter((i) => i.phases.some((p) => p.state !== 'done')).length,
    org: org.staff.length,
    projects: org.projects.length,
  }
}

export function Sidebar({ children }: { children: preact.ComponentChildren }) {
  const store = useStore()
  const repo = store.site.repo
  const url = repoUrl(store.site)
  const studio = store.panels.some((p) => p.id === 'blueprint')
  return (
    <aside class="shell-side" aria-label="Company">
      <div class="shell-site">
        <span class="shell-site-thumb" aria-hidden="true">
          <Icon name="town" size={20} />
        </span>
        <span class="shell-site-text">
          <span class="shell-site-name">{repo ? repo.split('/').pop() : 'Your company'}</span>
          <span class="shell-site-sub">
            <span class={`shell-dot-status${repo ? ' is-on' : ''}`} aria-hidden="true" />
            {repo ? 'Site connected' : 'No site yet'}
          </span>
        </span>
      </div>
      {children}
      <section class="shell-quick" aria-label="Quick actions">
        <h2 class="shell-side-title">Quick actions</h2>
        <ul>
          {studio && (
            <li>
              <button type="button" class="shell-quick-btn" onClick={() => store.openSection('building')}>
                <Icon name="building" /> Open the Studio
              </button>
            </li>
          )}
          {url && (
            <li>
              <a class="shell-quick-btn" href={url} target="_blank" rel="noopener noreferrer">
                <Icon name="projects" /> Open the site's repository
              </a>
            </li>
          )}
          <li>
            <button type="button" class="shell-quick-btn" onClick={() => store.openSection('town')}>
              <Icon name="town" /> Back to the town
            </button>
          </li>
        </ul>
      </section>
    </aside>
  )
}

export { useCounts }
