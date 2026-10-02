import type { PlanJson, PlanPost, PlanText, PostType, WorkItemJson, WorkItemStatus } from './plan-types'

/**
 * The plan-text wire shape, as the orchestrator's `Store::plan_json` writes it
 * (crates/orchestrator/src/store.rs) and the wasm `Sim.plan_json()` /
 * browser store will return it:
 *
 *   { items: { [id]: { title, brief } }, todos?, workstreams?, goals?,
 *     posts: { [id]: [ { id?, item?, type, author, to?, text, payload? } ] } }
 *
 * The orchestrator writes the post types minutes / artifact / handoff /
 * review / status, with type-specific data in `payload` (review:
 * `{verdict, score}`, artifact: `{pr, branch, path, sha, revision}` or
 * `{pr, merged_sha}`, minutes: `{job, brief}`). Posts carry no game time yet.
 * `normalizePlanText` turns that into the UI's `PlanText`; posts that are
 * already in UI shape (the mock fixtures) pass through unchanged.
 */
export interface WirePost {
  id?: string
  item?: string
  type: string
  author: string
  to?: string | null
  text: string
  payload?: Record<string, unknown> | null
  day?: number
  minute?: number
  [extra: string]: unknown
}

export interface PlanTextWire {
  items?: Record<string, { title?: string; brief?: string }>
  todos?: Record<string, string>
  workstreams?: Record<string, { title: string; description: string }>
  goals?: Record<string, { title: string }>
  posts?: Record<string, WirePost[]>
}

export const EMPTY_PLAN_TEXT: PlanText = { items: {}, todos: {}, workstreams: {}, goals: {}, posts: {} }
export const EMPTY_PLAN: PlanJson = { goals: [], workstreams: [], items: [] }

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined)

export function normalizePost(raw: WirePost, item: string, index: number): PlanPost {
  const payload = (raw.payload ?? {}) as Record<string, unknown>
  const post: PlanPost = {
    ...(raw as unknown as PlanPost),
    id: raw.id ?? `${item}-post-${index + 1}`,
    type: raw.type as PostType,
    author: raw.author || 'system',
    text: raw.text ?? '',
  }
  if (raw.payload != null) post.payload = payload
  if (raw.to != null) post.to = raw.to
  switch (raw.type) {
    case 'review': {
      const v = str(payload.verdict)
      if (!post.verdict && (v === 'approve' || v === 'changes' || v === 'reject')) post.verdict = v
      if (post.score == null && num(payload.score) != null) post.score = num(payload.score)
      break
    }
    case 'artifact': {
      if (!post.artifact) {
        const pr = num(payload.pr)
        const merged = str(payload.merged_sha)
        const path = str(payload.path)
        const branch = str(payload.branch)
        const label = merged ? `commit ${merged.slice(0, 7)}` : (branch ?? (pr != null ? `PR #${pr}` : (path ?? 'artifact')))
        if (pr != null || path || merged) post.artifact = { label, path }
      }
      break
    }
    case 'minutes': {
      const brief = payload.brief as { title?: unknown } | undefined
      if (!post.meeting) post.meeting = str(brief?.title) ? `Standup · ${String(brief!.title)}` : 'Standup'
      if (!post.attendees) {
        // Transcript excerpt lines are `staff-N: text`.
        const speakers = [...new Set(post.text.split('\n').map((l) => /^(staff-\d+|ceo):/.exec(l)?.[1]).filter(Boolean) as string[])]
        if (speakers.length) post.attendees = speakers
      }
      break
    }
  }
  return post
}

/** Accepts the orchestrator wire shape or an already-normalized `PlanText`. */
export function normalizePlanText(raw: PlanTextWire | PlanText | null | undefined): PlanText {
  if (!raw) return structuredClone(EMPTY_PLAN_TEXT)
  const items: PlanText['items'] = {}
  for (const [id, t] of Object.entries(raw.items ?? {})) items[id] = { title: t.title ?? '', brief: t.brief ?? '' }
  const posts: PlanText['posts'] = {}
  for (const [id, list] of Object.entries(raw.posts ?? {})) posts[id] = (list as WirePost[]).map((p, i) => normalizePost(p, id, i))
  return {
    items,
    todos: { ...(raw.todos ?? {}) },
    workstreams: { ...(raw.workstreams ?? {}) },
    goals: { ...(raw.goals ?? {}) },
    posts,
  }
}

/**
 * `plan_json` may be the sim skeleton (publishing-plan.md §7: `items` is an
 * array) or the text document (`items` is a map, `posts` present). Split a
 * parsed document into whichever parts it has.
 */
export function splitPlanJson(doc: unknown): { skeleton: PlanJson | null; text: PlanText | null } {
  if (!doc || typeof doc !== 'object') return { skeleton: null, text: null }
  const d = doc as Record<string, unknown>
  if (Array.isArray(d.items)) {
    const sk = d as unknown as Partial<PlanJson>
    return { skeleton: { goals: sk.goals ?? [], workstreams: sk.workstreams ?? [], items: sk.items ?? [] }, text: null }
  }
  return { skeleton: null, text: normalizePlanText(d as PlanTextWire) }
}

/** Status of an item known only from its thread (no sim skeleton yet). */
export function statusFromThread(posts: PlanPost[]): WorkItemStatus {
  let status: WorkItemStatus = 'planned'
  for (const p of posts) {
    if (p.type === 'minutes') status = 'in-progress'
    else if (p.type === 'handoff') status = 'in-review'
    else if (p.type === 'review') status = p.verdict === 'approve' ? 'approved' : p.verdict === 'reject' ? 'blocked' : 'in-progress'
    else if (p.type === 'artifact' && (p.payload?.merged_sha || /merged/i.test(p.text))) status = 'published'
    else if (p.type === 'status') {
      if (p.toStatus) status = p.toStatus as WorkItemStatus
      else if (/deployed|published/i.test(p.text)) status = 'published'
      else if (/blocked|failed/i.test(p.text)) status = 'blocked'
    }
  }
  return status
}

/**
 * Join the skeleton with items that exist only as text (the orchestrator
 * writes text for work items the sim skeleton may not export yet), so every
 * thread is reachable in the Plan panel.
 */
export function withTextOnlyItems(plan: PlanJson, text: PlanText, project: string | null): PlanJson {
  const known = new Set(plan.items.map((i) => i.id))
  const ids = [...new Set([...Object.keys(text.items), ...Object.keys(text.posts)])].filter((id) => !known.has(id))
  if (!ids.length) return plan
  const extra: WorkItemJson[] = ids.map((id) => {
    const posts = text.posts[id] ?? []
    const owner = posts.find((p) => p.type === 'review')?.author ?? posts.find((p) => p.type === 'handoff')?.to ?? null
    return {
      id,
      project: project ?? '',
      workstream: null,
      kind: 'article',
      status: statusFromThread(posts),
      priority: 'normal',
      owner: owner && owner.startsWith('staff-') ? owner : null,
      phases: [],
      todos: [],
      dependsOn: [],
      dueDay: null,
      publishDay: null,
      tickets: [],
      textOnly: true,
    }
  })
  return { ...plan, items: [...plan.items, ...extra] }
}
