import type { NewPlanPost } from './data-source'
import { POST_TYPES, type PlanJson, type PlanPost, type PlanText, type PostType, type WorkItemJson, type WorkItemStatus } from './plan-types'

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
 *
 * The CEO's own posts (comments) live in the same store. Its post API takes
 * the orchestrator's types only, so `toStorePost` files them as `status`
 * posts with the real type in `payload.ui_type`, and `normalizePost` turns
 * them back.
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

/** Payload key of a stored post that carries its real (UI) type. */
const UI_TYPE = 'ui_type'
/** The store type a UI post is filed under (an orchestrator type with no side effects for readers). */
const STORE_TYPE = 'status'

/**
 * A post written by the UI (a CEO comment) in the shape the CompanyStore's
 * post API accepts (`Store::append_post`: orchestrator post types only).
 * Author, game time and text are stored as they are.
 */
export function toStorePost(post: NewPlanPost): WirePost {
  const { type, payload, ...rest } = post
  return { ...rest, type: STORE_TYPE, payload: { ...(payload ?? {}), [UI_TYPE]: type } }
}

export function normalizePost(raw: WirePost, item: string, index: number): PlanPost {
  const payload = { ...(raw.payload ?? {}) } as Record<string, unknown>
  // A UI post stored through `toStorePost`: back to its real type.
  const filed = str(payload[UI_TYPE])
  const uiType = filed && (POST_TYPES as string[]).includes(filed) ? (filed as PostType) : null
  if (uiType) delete payload[UI_TYPE]
  const type = uiType ?? raw.type
  const post: PlanPost = {
    ...(raw as unknown as PlanPost),
    id: raw.id ?? `${item}-post-${index + 1}`,
    type: type as PostType,
    author: raw.author || 'system',
    text: raw.text ?? '',
  }
  if (raw.payload != null && (!uiType || Object.keys(payload).length)) post.payload = payload
  else delete post.payload
  if (raw.to != null) post.to = raw.to
  switch (type) {
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
        if (pr != null || path || merged) {
          post.artifact = { label, path }
          // What the panels link: the pull request and, once merged, its commit.
          if (pr != null) post.artifact.pr = pr
          if (merged) post.artifact.commit = merged
        }
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
    return { skeleton: { site: sk.site ?? null, goals: sk.goals ?? [], workstreams: sk.workstreams ?? [], items: sk.items ?? [] }, text: null }
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

/** Plan text keyed by a brief or workstream ref (ADR-0069) or the site audit (`site:audit`, ADR-0070), not by a work item. */
export const BOARD_TEXT_KEY = /^(brief|workstream|site):/

/**
 * The board's plan text joined to the sim's ids (ADR-0069): an item without
 * text of its own takes its brief's (`brief:<briefRefText>`, before its first
 * draft names it), a workstream its title (`workstream:<textRef>`), the
 * sim's goal its name.
 */
export function withBoardText(plan: PlanJson, text: PlanText): PlanText {
  let items: PlanText['items'] | null = null
  for (const it of plan.items) {
    if (text.items[it.id]?.title || !it.briefRefText) continue
    const brief = text.items[`brief:${it.briefRefText}`]
    if (!brief) continue
    items ??= { ...text.items }
    items[it.id] = brief
  }
  let workstreams: PlanText['workstreams'] | null = null
  for (const ws of plan.workstreams) {
    if (text.workstreams[ws.id] || !ws.textRef) continue
    const t = text.items[`workstream:${ws.textRef}`]
    if (!t) continue
    workstreams ??= { ...text.workstreams }
    workstreams[ws.id] = { title: t.title, description: '' }
  }
  // The sim's one goal per project (monthly readers) has no text of its own.
  let goals: PlanText['goals'] | null = null
  for (const g of plan.goals) {
    if (text.goals[g.id] || g.metric !== 'monthly-readers') continue
    goals ??= { ...text.goals }
    goals[g.id] = { title: 'Monthly readers' }
  }
  return items || workstreams || goals
    ? { ...text, items: items ?? text.items, workstreams: workstreams ?? text.workstreams, goals: goals ?? text.goals }
    : text
}

/**
 * Join the skeleton with items that exist only as text (the orchestrator
 * writes text for work items the sim skeleton may not export yet), so every
 * thread is reachable in the Plan panel.
 */
export function withTextOnlyItems(plan: PlanJson, text: PlanText, project: string | null): PlanJson {
  const known = new Set(plan.items.map((i) => i.id))
  const ids = [...new Set([...Object.keys(text.items), ...Object.keys(text.posts)])].filter((id) => !known.has(id) && !BOARD_TEXT_KEY.test(id))
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
