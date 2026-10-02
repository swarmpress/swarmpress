import { createContext } from 'preact'
import { useContext } from 'preact/hooks'
import { computed, signal, type ReadonlySignal } from '@preact/signals'
import { toJson, type Command, type CommandResult } from './commands'
import type { GameDataSource } from './data-source'
import { placeholderPersona, type Persona } from './personas'
import type { PlanJson, PlanText } from './plan-types'
import type { FinanceJson, InboxJson, OrgJson, PerformanceJson, StaffJson } from './types'

export type PanelId = 'plan' | 'org' | 'projects' | 'finance' | 'inbox' | 'hiring' | 'performance'

export interface PanelDef {
  id: PanelId
  label: string
  /** Single-letter shortcut (also 1–7 by position). */
  key: string
  icon: string
}

/** Toolbar order: the Plan is the primary instrument (ADR-0031). */
export const PANELS: PanelDef[] = [
  { id: 'plan', label: 'Plan', key: 'p', icon: 'plan' },
  { id: 'inbox', label: 'Inbox', key: 'i', icon: 'inbox' },
  { id: 'org', label: 'Org chart', key: 'o', icon: 'org' },
  { id: 'projects', label: 'Projects', key: 'j', icon: 'projects' },
  { id: 'finance', label: 'Finance', key: 'f', icon: 'finance' },
  { id: 'performance', label: 'Performance', key: 'k', icon: 'performance' },
  { id: 'hiring', label: 'Hiring', key: 'h', icon: 'hiring' },
]

/** Who a profile card shows: an employee (staff id) or a catalog persona (candidate). */
export type ProfileTarget = { staff: string } | { persona: string }

export interface Toast {
  id: number
  text: string
  tone: 'ok' | 'error'
}

export interface OverlayStore {
  source: GameDataSource
  org: ReadonlySignal<OrgJson>
  finance: ReadonlySignal<FinanceJson>
  inbox: ReadonlySignal<InboxJson>
  plan: ReadonlySignal<PlanJson>
  planText: ReadonlySignal<PlanText>
  performance: ReadonlySignal<PerformanceJson>
  now: ReadonlySignal<number>
  panel: ReturnType<typeof signal<PanelId | null>>
  profile: ReturnType<typeof signal<ProfileTarget | null>>
  selectedProject: ReturnType<typeof signal<string | null>>
  selectedItem: ReturnType<typeof signal<string | null>>
  toast: ReturnType<typeof signal<Toast | null>>
  /** Apply a command; shows a toast with the outcome. */
  run(cmd: Command, success?: string): CommandResult
  /** Validate without applying. */
  check(cmd: Command): CommandResult
  staff(id: string | null | undefined): StaffJson | undefined
  /** Persona for a staff id (placeholder when missing from the catalog). */
  personaOf(staffId: string): Persona
  /** Display name for `staff-N`, `ceo` or `system`. */
  nameOf(id: string | null | undefined): string
  projectName(id: string | null | undefined): string
  openProfile(t: ProfileTarget, opener?: HTMLElement | null): void
  closeProfile(): void
  togglePanel(id: PanelId): void
  /** Re-read the source (also called on every source change). */
  refresh(): void
  dispose(): void
}

export function createOverlayStore(source: GameDataSource): OverlayStore {
  const version = signal(0)
  const tick = signal(0)
  const read = <T>(f: () => T) => computed(() => (version.value, f()))
  const toast = signal<Toast | null>(null)
  let toastSeq = 0
  let toastTimer: ReturnType<typeof setTimeout> | null = null
  let profileOpener: HTMLElement | null = null

  const say = (text: string, tone: Toast['tone']) => {
    toast.value = { id: ++toastSeq, text, tone }
    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = setTimeout(() => (toast.value = null), 4000)
  }

  const store: OverlayStore = {
    source,
    org: read(() => source.getOrg()),
    finance: read(() => source.getFinance()),
    inbox: read(() => source.getInbox()),
    plan: read(() => source.getPlan()),
    planText: read(() => source.planStore.text()),
    performance: read(() => source.getPerformance()),
    now: computed(() => (version.value, tick.value, source.now())),
    panel: signal<PanelId | null>(null),
    profile: signal<ProfileTarget | null>(null),
    selectedProject: signal<string | null>(null),
    selectedItem: signal<string | null>(null),
    toast,
    run(cmd, success) {
      const r = source.apply(toJson(cmd))
      if (r.ok) {
        if (success) say(success, 'ok')
      } else say(r.reason ?? 'Rejected', 'error')
      return r
    },
    check: (cmd) => source.validate(toJson(cmd)),
    staff: (id) => (id ? store.org.value.staff.find((s) => s.id === id) : undefined),
    personaOf(staffId) {
      const s = store.staff(staffId)
      if (!s) return placeholderPersona(staffId)
      return source.getPersona(s.persona) ?? placeholderPersona(s.persona, s.role, s.department)
    },
    nameOf(id) {
      if (!id) return 'Unassigned'
      if (id === 'ceo') return 'You (CEO)'
      if (id === 'system') return 'System'
      return store.staff(id) ? store.personaOf(id).name : id
    },
    projectName: (id) => (id ? (store.org.value.projects.find((p) => p.id === id)?.name ?? id) : 'Company-wide'),
    openProfile(t, opener) {
      profileOpener = opener ?? (document.activeElement as HTMLElement | null)
      store.profile.value = t
    },
    closeProfile() {
      store.profile.value = null
      const el = profileOpener
      profileOpener = null
      if (el && el.isConnected) queueMicrotask(() => el.focus())
    },
    togglePanel(id) {
      store.panel.value = store.panel.value === id ? null : id
    },
    refresh() {
      version.value++
    },
    dispose() {
      unsubscribe()
      clearInterval(clock)
      if (toastTimer) clearTimeout(toastTimer)
    },
  }
  const unsubscribe = source.subscribe(() => store.refresh())
  // Game time moves without org changes; keep deadline countdowns current.
  const clock = setInterval(() => tick.value++, 1000)
  return store
}

export const StoreContext = createContext<OverlayStore | null>(null)

export function useStore(): OverlayStore {
  const s = useContext(StoreContext)
  if (!s) throw new Error('useStore() outside <StoreContext.Provider>')
  return s
}
