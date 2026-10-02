import { createContext } from 'preact'
import { useContext } from 'preact/hooks'
import { batch, computed, signal, type ReadonlySignal } from '@preact/signals'
import { toJson, type Command, type CommandResult } from './commands'
import { readSnapshot, type GameDataSource, type GameSnapshot } from './data-source'
import { placeholderPersona, type Persona } from './personas'
import type { PlanJson, PlanText } from './plan-types'
import { EMPTY_PLAN, EMPTY_PLAN_TEXT, withTextOnlyItems } from './plan-wire'
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
  /** False until the first snapshot has been read from the source. */
  ready: ReadonlySignal<boolean>
  org: ReadonlySignal<OrgJson>
  finance: ReadonlySignal<FinanceJson>
  inbox: ReadonlySignal<InboxJson>
  /** Skeleton joined with text-only items (orchestrator threads without a sim item). */
  plan: ReadonlySignal<PlanJson>
  planText: ReadonlySignal<PlanText>
  performance: ReadonlySignal<PerformanceJson>
  personas: ReadonlySignal<Persona[]>
  now: ReadonlySignal<number>
  panel: ReturnType<typeof signal<PanelId | null>>
  profile: ReturnType<typeof signal<ProfileTarget | null>>
  selectedProject: ReturnType<typeof signal<string | null>>
  selectedItem: ReturnType<typeof signal<string | null>>
  toast: ReturnType<typeof signal<Toast | null>>
  /** Apply a command, then re-read the source; shows a toast with the outcome. */
  run(cmd: Command, success?: string): Promise<CommandResult>
  /**
   * Validation for rendering (enables/disables actions). Synchronous over the
   * async source: returns the verdict cached for the current snapshot, or
   * `PENDING` ("Checking…") and re-renders when the source answers.
   */
  check(cmd: Command): CommandResult
  /** Post a CEO comment to a work item's thread (text only; never enters the sim). */
  comment(item: string, text: string): Promise<void>
  staff(id: string | null | undefined): StaffJson | undefined
  persona(slug: string): Persona | undefined
  /** Persona for a staff id (placeholder when missing from the catalog). */
  personaOf(staffId: string): Persona
  /** Display name for `staff-N`, `ceo` or `system`. */
  nameOf(id: string | null | undefined): string
  projectName(id: string | null | undefined): string
  openProfile(t: ProfileTarget, opener?: HTMLElement | null): void
  closeProfile(): void
  togglePanel(id: PanelId): void
  /** Re-read the source (also called on every source change); resolves when the snapshot is in. */
  refresh(): Promise<void>
  dispose(): void
}

const EMPTY_SNAPSHOT: GameSnapshot = {
  org: { ceo: { name: 'You' }, executive: { cfo: null, secretary: null, delegation: 'off' }, departments: [], staff: [], projects: [] } as unknown as OrgJson,
  finance: {
    cashEur: 0,
    runwayDays: null,
    dailyBurnEur: 0,
    month: 0,
    company: { revenueEur: 0, salariesEur: 0, rentEur: 0, upkeepEur: 0, agencyEur: 0 },
    projects: [],
    alerts: [],
  } as unknown as FinanceJson,
  inbox: { delegation: 'off', tickets: [], secretaryQueue: [] } as unknown as InboxJson,
  plan: EMPTY_PLAN,
  planText: EMPTY_PLAN_TEXT,
  performance: { asOfDay: 0, projects: [], report: null },
  personas: [],
  now: 0,
}

/** What `check()` returns while the source is still answering. */
export const PENDING: CommandResult = Object.freeze({ ok: false, reason: 'Checking…' })

export function createOverlayStore(source: GameDataSource): OverlayStore {
  const snap = signal<GameSnapshot>(EMPTY_SNAPSHOT)
  const ready = signal(false)
  const clock = signal(0)
  /** Validation verdicts for the current snapshot, keyed by command JSON. */
  const checks = signal(new Map<string, CommandResult>())
  const asked = new Set<string>()
  let generation = 0
  let disposed = false
  const toast = signal<Toast | null>(null)
  let toastSeq = 0
  let toastTimer: ReturnType<typeof setTimeout> | null = null
  let profileOpener: HTMLElement | null = null

  const say = (text: string, tone: Toast['tone']) => {
    toast.value = { id: ++toastSeq, text, tone }
    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = setTimeout(() => (toast.value = null), 4000)
  }

  // One read at a time; a change during a read schedules exactly one more.
  let inflight: Promise<void> | null = null
  let again = false
  const load = (): Promise<void> => {
    if (inflight) {
      again = true
      return inflight
    }
    inflight = (async () => {
      do {
        again = false
        const next = await readSnapshot(source)
        if (disposed) return
        generation++
        asked.clear()
        batch(() => {
          checks.value = new Map()
          snap.value = next
          clock.value = next.now
          ready.value = true
        })
      } while (again && !disposed)
    })().finally(() => (inflight = null))
    return inflight
  }

  const tickClock = () =>
    void source.now().then((n) => {
      if (!disposed) clock.value = n
    })

  const store: OverlayStore = {
    source,
    ready,
    org: computed(() => snap.value.org),
    finance: computed(() => snap.value.finance),
    inbox: computed(() => snap.value.inbox),
    plan: computed(() => withTextOnlyItems(snap.value.plan, snap.value.planText, snap.value.org.projects[0]?.id ?? null)),
    planText: computed(() => snap.value.planText),
    performance: computed(() => snap.value.performance),
    personas: computed(() => snap.value.personas),
    now: clock,
    panel: signal<PanelId | null>(null),
    profile: signal<ProfileTarget | null>(null),
    selectedProject: signal<string | null>(null),
    selectedItem: signal<string | null>(null),
    toast,
    async run(cmd, success) {
      const r = await source.apply(toJson(cmd))
      if (r.ok) {
        await load()
        if (success) say(success, 'ok')
      } else say(r.reason ?? 'Rejected', 'error')
      return r
    },
    check(cmd) {
      const json = toJson(cmd)
      const cached = checks.value.get(json)
      if (cached) return cached
      if (asked.has(json)) return PENDING
      asked.add(json)
      const gen = generation
      const settle = (r: CommandResult) => {
        if (disposed || gen !== generation) return
        checks.value = new Map(checks.peek()).set(json, r)
      }
      source.validate(json).then(settle, (e: unknown) => settle({ ok: false, reason: e instanceof Error ? e.message : String(e) }))
      return PENDING
    },
    async comment(item, text) {
      const now = clock.peek()
      await source.appendPost(item, { type: 'comment', author: 'ceo', day: Math.floor(now / 1440), minute: now % 1440, text })
      await load()
    },
    staff: (id) => (id ? store.org.value.staff.find((s) => s.id === id) : undefined),
    persona: (slug) => store.personas.value.find((p) => p.slug === slug),
    personaOf(staffId) {
      const s = store.staff(staffId)
      if (!s) return placeholderPersona(staffId)
      return store.persona(s.persona) ?? placeholderPersona(s.persona, s.role, s.department)
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
    refresh: load,
    dispose() {
      disposed = true
      unsubscribe()
      clearInterval(ticker)
      if (toastTimer) clearTimeout(toastTimer)
    },
  }
  const unsubscribe = source.subscribe((topics) => {
    if (topics && topics.length === 1 && topics[0] === 'clock') tickClock()
    else void load()
  })
  // Game time moves without org changes; keep deadline countdowns current.
  const ticker = setInterval(tickClock, 1000)
  void load()
  return store
}

export const StoreContext = createContext<OverlayStore | null>(null)

export function useStore(): OverlayStore {
  const s = useContext(StoreContext)
  if (!s) throw new Error('useStore() outside <StoreContext.Provider>')
  return s
}
