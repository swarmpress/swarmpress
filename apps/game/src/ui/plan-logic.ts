import type { PlanJson, PlanText, WorkItemJson } from './plan-types'
import type { OrgJson } from './types'

export interface BoardFilter {
  project: string | null
  workstream: string | null
  /** staff id: owner, a phase assignee or a todo assignee. */
  person: string | null
}

export const involves = (it: WorkItemJson, staff: string) =>
  it.owner === staff || it.phases.some((p) => p.assignee === staff) || it.todos.some((t) => t.assignee === staff)

export function filterItems(items: WorkItemJson[], f: BoardFilter): WorkItemJson[] {
  return items.filter(
    (it) =>
      (!f.project || it.project === f.project) &&
      (!f.workstream || it.workstream === f.workstream) &&
      (!f.person || involves(it, f.person)),
  )
}

/** The phase currently in play: first not-done phase. */
export const currentPhase = (it: WorkItemJson) => it.phases.find((p) => p.state !== 'done') ?? null

export const itemProgress = (it: WorkItemJson) => {
  const total = it.phases.reduce((n, p) => n + p.estimateMinutes, 0)
  if (!total) return it.status === 'published' ? 1 : 0
  return it.phases.reduce((n, p) => n + p.estimateMinutes * (p.state === 'done' ? 1 : p.progress), 0) / total
}

export const WORK_MINUTES_PER_WEEK = 5 * 8 * 60

export interface WorkloadRow {
  staff: string
  /** Capacity for project work per week, in minutes (allocation × 40h). */
  capacity: number
  /** Remaining assigned minutes per week bucket: [this week, next week, later]. */
  load: [number, number, number]
}

/** People × weeks: remaining estimated phase work by due week vs allocation (publishing-plan.md §5). */
export function workload(plan: PlanJson, org: OrgJson, today: number): WorkloadRow[] {
  const week = Math.floor(today / 7)
  const rows = new Map<string, WorkloadRow>()
  for (const s of org.staff) {
    const alloc = s.projects.reduce((n, a) => n + a.allocation, 0)
    rows.set(s.id, { staff: s.id, capacity: ((alloc || 100) / 100) * WORK_MINUTES_PER_WEEK, load: [0, 0, 0] })
  }
  for (const it of plan.items) {
    if (it.status === 'cancelled' || it.status === 'published') continue
    const due = it.dueDay ?? it.publishDay ?? today + 14
    const bucket = Math.max(0, Math.min(2, Math.floor(due / 7) - week))
    for (const p of it.phases) {
      if (!p.assignee || p.state === 'done') continue
      const r = rows.get(p.assignee)
      if (r) r.load[bucket] += p.estimateMinutes * (1 - p.progress)
    }
  }
  return [...rows.values()]
}

export type PlanView = 'board' | 'calendar' | 'timeline' | 'workload' | 'goals'

const isOpen = (it: WorkItemJson) => it.status !== 'published' && it.status !== 'cancelled'

/**
 * The plan views the skeleton has data for. The board always. The others
 * plot what the live sim does not export yet (a publish schedule, start and
 * due days, goals; its only `publishDay` is the day an item went live), so
 * they are left out instead of shown empty, and come back as soon as the
 * data does:
 * - calendar: an open item with a planned publish day;
 * - timeline: an item with a start day and a due or publish day;
 * - workload: an open item with a due or publish day (the week buckets);
 * - goals: a goal.
 */
export function availableViews(plan: PlanJson): PlanView[] {
  const views: PlanView[] = ['board']
  if (plan.items.some((i) => isOpen(i) && i.publishDay != null)) views.push('calendar')
  if (plan.items.some((i) => i.startDay != null && (i.dueDay ?? i.publishDay) != null)) views.push('timeline')
  if (plan.items.some((i) => isOpen(i) && (i.dueDay ?? i.publishDay) != null)) views.push('workload')
  if (plan.goals.length > 0) views.push('goals')
  return views
}

/** The newest editorial board's minutes (ADR-0069): its theme and big bets; null before the first board. */
export function latestBoard(text: PlanText): { theme: string; bigBets: string[]; item: string } | null {
  let best: { theme: string; bigBets: string[]; item: string } | null = null
  let bestKey = -1
  for (const [item, posts] of Object.entries(text.posts)) {
    for (const [i, p] of posts.entries()) {
      const theme = p.type === 'minutes' ? p.payload?.week_theme : undefined
      if (typeof theme !== 'string' || !theme.trim()) continue
      // newest by game time, then by thread order
      const key = (p.day ?? 0) * 1440 + (p.minute ?? 0) + i / 1000
      if (key < bestKey) continue
      bestKey = key
      const raw = Array.isArray(p.payload?.big_bets) ? (p.payload.big_bets as unknown[]) : []
      const bigBets = raw.filter((b): b is string => typeof b === 'string' && b.trim() !== '').map((b) => b.trim())
      best = { theme: theme.trim(), bigBets, item }
    }
  }
  return best
}
