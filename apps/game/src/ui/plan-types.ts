/**
 * The media & publishing plan (docs/game-design/publishing-plan.md, ADR-0031).
 *
 * `PlanJson` is the deterministic skeleton from `Sim.plan_json(project?)` (§7);
 * `PlanText` is the text joined client-side from the plan store (orchestrator
 * `plan_json` wire shape, normalized by plan-wire.ts; server REST or
 * the offline mock), keyed by the same ids.
 */

export type WorkItemStatus =
  | 'backlog'
  | 'planned'
  | 'in-progress'
  | 'in-review'
  | 'approved'
  | 'scheduled'
  | 'published'
  | 'blocked'
  | 'cancelled'

export const STATUS_ORDER: WorkItemStatus[] = [
  'backlog',
  'planned',
  'in-progress',
  'in-review',
  'approved',
  'scheduled',
  'published',
  'blocked',
  'cancelled',
]

export type WorkPriority = 'urgent' | 'high' | 'normal' | 'low'
export const PRIORITY_ORDER: WorkPriority[] = ['urgent', 'high', 'normal', 'low']

export type PhaseKind =
  | 'research'
  | 'outline'
  | 'draft'
  | 'media'
  | 'links-seo'
  | 'review'
  | 'publish'
  | 'translate'
  | 'design'
  | 'build'
  | 'ops'
  | 'analysis'
  | string

export type PhaseState = 'pending' | 'working' | 'done' | 'blocked' | string

export interface PhaseJson {
  kind: PhaseKind
  assignee: string | null
  state: PhaseState
  /** 0..1 */
  progress: number
  estimateMinutes: number
  /** UI extension: true when the phase is outsourced to the Agency (Claude). */
  agency?: boolean
}

export interface TodoJson {
  id: string
  assignee: string | null
  done: boolean
}

export interface WorkItemJson {
  id: string
  project: string
  workstream: string | null
  /** UI extension: the goal the item serves (field `goal` in §1). */
  goal?: string | null
  kind: string
  status: WorkItemStatus
  priority: WorkPriority
  owner: string | null
  phases: PhaseJson[]
  todos: TodoJson[]
  dependsOn: string[]
  dueDay: number | null
  publishDay: number | null
  tickets: string[]
  /** UI extension: languages the item publishes in (calendar rows). */
  languages?: string[]
  /** UI extension: game day work started, for the timeline. */
  startDay?: number | null
  /** UI only: known from plan text (orchestrator threads) but not in the sim skeleton. */
  textOnly?: boolean
}

export interface WorkstreamJson {
  id: string
  project: string
  status: 'active' | 'paused' | 'done' | string
}

export interface GoalJson {
  id: string
  metric: string
  target: number
  current: number
}

export interface PlanJson {
  goals: GoalJson[]
  workstreams: WorkstreamJson[]
  items: WorkItemJson[]
}

export type PostType =
  | 'comment'
  | 'handoff'
  | 'todo-add'
  | 'todo-done'
  | 'review'
  | 'question'
  | 'decision'
  | 'status'
  | 'minutes'
  | 'proposal'
  | 'artifact'
  /** `ContentPerformance` follow-up from the data scientist (organization.md §6a). */
  | 'performance'
  /** The CEO's note with a Send back at the publish gate (ADR-0059): what the revision should fix. */
  | 'send-back-note'

export const POST_TYPES: PostType[] = [
  'comment',
  'handoff',
  'todo-add',
  'todo-done',
  'review',
  'question',
  'decision',
  'status',
  'minutes',
  'proposal',
  'artifact',
  'performance',
  'send-back-note',
]

export interface PlanPost {
  id: string
  type: PostType
  /** `staff-N`, `ceo`, or `system`. */
  author: string
  /** Game time; absent on orchestrator posts until the store stamps them. */
  day?: number
  minute?: number
  text: string
  /** Type-specific data as the orchestrator writes it (see plan-wire.ts). */
  payload?: Record<string, unknown>
  /** handoff: receiving staff. */
  to?: string | null
  /** review */
  verdict?: 'approve' | 'changes' | 'reject'
  score?: number
  /** question: answered in-thread or escalated to a ticket. */
  answeredBy?: string | null
  ticket?: string | null
  /** minutes: meeting name and attendees. */
  meeting?: string
  attendees?: string[]
  /** proposal: what is proposed; accepted when the CEO/EiC took it. */
  proposal?: { title: string; kind: string; workstream?: string | null }
  accepted?: boolean
  /** status: transition. */
  from?: string
  toStatus?: string
  /**
   * artifact: `url` when the post carries one (fixtures); `pr` and `commit`
   * (the merged sha) from the orchestrator's payload, linked through the
   * source's `SiteLinks` (links.ts).
   */
  artifact?: { label: string; url?: string; path?: string; pr?: number; commit?: string }
  /** todo-add / todo-done */
  todo?: string
  /** performance (ContentPerformance) */
  metrics?: {
    window: string
    views: number
    engagedPct: number
    scrollDepthPct?: number
    outboundClicks?: number
    /** vs the workstream median, in percent (+38 = 38% better). */
    vsMedianPct?: number
  }
}

export interface PlanText {
  items: Record<string, { title: string; brief: string }>
  todos: Record<string, string>
  workstreams: Record<string, { title: string; description: string }>
  goals: Record<string, { title: string }>
  posts: Record<string, PlanPost[]>
}
