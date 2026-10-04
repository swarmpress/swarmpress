import { createContext } from 'preact'
import { useContext } from 'preact/hooks'
import { batch, computed, signal, type ReadonlySignal } from '@preact/signals'
import { commandName, NOT_AVAILABLE, toJson, type Command, type CommandName, type CommandResult } from './commands'
import { readSnapshot, type ArticleRecord, type GameDataSource, type GameSnapshot, type LiveJob, type SiteLinks } from './data-source'
import { placeholderPersona, type Persona } from './personas'
import type { PlanJson, PlanText, PostType } from './plan-types'
import { EMPTY_PLAN, EMPTY_PLAN_TEXT, withTextOnlyItems } from './plan-wire'
import type { FinanceJson, InboxJson, OrgJson, PerformanceJson, StaffJson } from './types'

export type PanelId = 'plan' | 'org' | 'projects' | 'finance' | 'inbox' | 'activity' | 'hiring' | 'performance'

export interface PanelDef {
  id: PanelId
  label: string
  /** Single-letter shortcut (also 1–9 by position). */
  key: string
  icon: string
}

/**
 * Toolbar order: the Plan is the primary instrument (ADR-0031), then what
 * needs the CEO and what the staff are doing. A store offers the ones its
 * source has data for (`store.panels`).
 */
export const PANELS: PanelDef[] = [
  { id: 'plan', label: 'Plan', key: 'p', icon: 'plan' },
  { id: 'inbox', label: 'Inbox', key: 'i', icon: 'inbox' },
  { id: 'activity', label: 'Activity', key: 'a', icon: 'activity' },
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
  /** The panels the source has data for, in toolbar order (Performance only with KPIs). */
  panels: PanelDef[]
  /** Where pull requests and published pages live; from the source, never a constant. */
  site: SiteLinks
  /** The house style's banned phrases, for an article's measured checks; null when the source has no list. */
  bannedPhrases: readonly string[] | null
  /**
   * The capability check for every action: does the source have this
   * command? `check` and `run` apply it too, so a missing command is never
   * validated or sent; a panel asks it to disable a control up front.
   */
  can(name: CommandName): boolean
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
  /**
   * The jobs in flight with their stage now (the orchestrator's progress
   * events): the Activity panel's pinned job and the HUD's "Now" strip. Read
   * with the clock, about once a second.
   */
  live: ReadonlySignal<LiveJob[]>
  panel: ReturnType<typeof signal<PanelId | null>>
  profile: ReturnType<typeof signal<ProfileTarget | null>>
  selectedProject: ReturnType<typeof signal<string | null>>
  selectedItem: ReturnType<typeof signal<string | null>>
  /** The work item whose article preview is open (a dialog over the panels); null when closed. */
  article: ReturnType<typeof signal<string | null>>
  /** The job the Activity panel opens on (expanded and focused), then clears; null for none. */
  activityJob: ReturnType<typeof signal<number | null>>
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
  /**
   * Post as the CEO to a work item's thread: a `comment`, or the
   * `send-back-note` of the publish gate. Resolves once the source has stored
   * the post, and rejects when it could not: a caller that sends a command
   * after the post waits for this first.
   */
  post(item: string, type: PostType, text: string, payload?: Record<string, unknown>): Promise<void>
  /**
   * The article of a work item (page, review, pull request, brief), for
   * rendering. Synchronous over the async source like `check`: `undefined`
   * while the first read is under way, `null` when the store has no article.
   * It is read again after every snapshot and keeps the last value meanwhile.
   */
  articleOf(item: string): ArticleRecord | null | undefined
  openArticle(item: string, opener?: HTMLElement | null): void
  closeArticle(): void
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
  /** Opens the Activity panel (when the source has a record), on `jobId` if given: the HUD's "Now" strip. */
  openActivity(jobId?: number | null): void
  /** Opens a work item in the Plan panel. */
  openItem(id: string): void
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
/** What `check()` and `run()` return for a command the source does not have. */
export const UNAVAILABLE: CommandResult = Object.freeze({ ok: false, reason: NOT_AVAILABLE })

export function createOverlayStore(source: GameDataSource): OverlayStore {
  const caps = source.capabilities()
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
  let articleOpener: HTMLElement | null = null
  /** Articles by work item, as last read; the generation each was asked at. */
  const articles = signal(new Map<string, ArticleRecord | null>())
  const articleAsked = new Map<string, number>()

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

  // The jobs in flight: read with the clock, set only when they changed (the elapsed time moves each second while one runs).
  const live = signal<LiveJob[]>([])
  let liveText = '[]'
  const refreshLive = () =>
    void source.getLiveJobs().then(
      (jobs) => {
        const text = JSON.stringify(jobs)
        if (disposed || text === liveText) return
        liveText = text
        live.value = jobs
      },
      () => undefined,
    )

  const tickClock = () => {
    refreshLive()
    void source.now().then((n) => {
      if (!disposed) clock.value = n
    })
  }

  const store: OverlayStore = {
    source,
    panels: PANELS.filter((p) => (p.id !== 'performance' || caps.performance) && (p.id !== 'activity' || !!caps.activity)),
    site: caps.site,
    bannedPhrases: caps.bannedPhrases ?? null,
    can: (name) => caps.commands.has(name),
    ready,
    org: computed(() => snap.value.org),
    finance: computed(() => snap.value.finance),
    inbox: computed(() => snap.value.inbox),
    plan: computed(() => withTextOnlyItems(snap.value.plan, snap.value.planText, snap.value.org.projects[0]?.id ?? null)),
    planText: computed(() => snap.value.planText),
    performance: computed(() => snap.value.performance),
    personas: computed(() => snap.value.personas),
    now: clock,
    live,
    panel: signal<PanelId | null>(null),
    profile: signal<ProfileTarget | null>(null),
    selectedProject: signal<string | null>(null),
    selectedItem: signal<string | null>(null),
    article: signal<string | null>(null),
    activityJob: signal<number | null>(null),
    toast,
    async run(cmd, success) {
      if (!store.can(commandName(cmd))) {
        say(NOT_AVAILABLE, 'error')
        return UNAVAILABLE
      }
      const r = await source.apply(toJson(cmd))
      if (r.ok) {
        await load()
        if (success) say(success, 'ok')
      } else say(r.reason ?? 'Rejected', 'error')
      return r
    },
    check(cmd) {
      if (!store.can(commandName(cmd))) return UNAVAILABLE
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
    comment: (item, text) => store.post(item, 'comment', text),
    async post(item, type, text, payload) {
      const now = clock.peek()
      await source.appendPost(item, { type, author: 'ceo', day: Math.floor(now / 1440), minute: now % 1440, text, ...(payload ? { payload } : {}) })
      await load()
    },
    articleOf(item) {
      const have = articles.value.get(item)
      if (articleAsked.get(item) !== generation) {
        articleAsked.set(item, generation)
        const settle = (rec: ArticleRecord | null) => {
          if (disposed) return
          const known = articles.peek()
          // The source hands back the same object for an unchanged article: nothing re-renders then.
          if (known.has(item) && known.get(item) === rec) return
          articles.value = new Map(known).set(item, rec)
        }
        source.getArticle(item).then(settle, () => settle(null))
      }
      return have
    },
    openArticle(item, opener) {
      articleOpener = opener ?? (document.activeElement as HTMLElement | null)
      store.article.value = item
    },
    closeArticle() {
      store.article.value = null
      const el = articleOpener
      articleOpener = null
      if (el && el.isConnected) queueMicrotask(() => el.focus())
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
      if (!store.panels.some((p) => p.id === id)) return
      store.panel.value = store.panel.value === id ? null : id
    },
    openActivity(jobId) {
      if (!store.panels.some((p) => p.id === 'activity')) return
      batch(() => {
        store.activityJob.value = jobId ?? null
        store.panel.value = 'activity'
      })
    },
    openItem(id) {
      batch(() => {
        store.selectedItem.value = id
        store.panel.value = 'plan'
      })
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
    // Game time and the activity record need no snapshot (the Activity panel reads its rows itself).
    if (topics && topics.length > 0 && topics.every((t) => t === 'clock' || t === 'activity')) tickClock()
    else void load()
  })
  // Game time moves without org changes; keep deadline countdowns (and the job in flight) current.
  const ticker = setInterval(tickClock, 1000)
  void load()
  refreshLive()
  return store
}

export const StoreContext = createContext<OverlayStore | null>(null)

export function useStore(): OverlayStore {
  const s = useContext(StoreContext)
  if (!s) throw new Error('useStore() outside <StoreContext.Provider>')
  return s
}
