import type { PlanJson, WorkItemJson } from './plan-types'
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
