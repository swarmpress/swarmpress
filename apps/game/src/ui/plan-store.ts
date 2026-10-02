import type { PlanPost, PlanText } from './plan-types'

/**
 * Plan text (titles, briefs, todo text, thread posts), keyed by sim ids
 * (publishing-plan.md §6). Text never enters the sim: online it comes from the
 * server (`/api/projects/:id/plan` + `PlanPost` WS frames), offline from this
 * in-memory store with the same API.
 */
export interface PlanStore {
  /** Snapshot of all text. Treat as read-only. */
  text(): PlanText
  posts(item: string): PlanPost[]
  /** Append a post to an item's thread (append-only); returns it with its id. */
  addPost(item: string, post: Omit<PlanPost, 'id'>): PlanPost
  /** Mark a proposal post as accepted (the only in-place change a thread allows). */
  markAccepted(item: string, post: string): void
  /** Title and brief of a (new) work item. */
  putItem(item: string, text: { title: string; brief: string }): void
  subscribe(onChange: () => void): () => void
}

export class MemoryPlanStore implements PlanStore {
  private data: PlanText
  private listeners = new Set<() => void>()
  private seq: number

  constructor(initial: PlanText) {
    this.data = structuredClone(initial)
    const ids = Object.values(this.data.posts)
      .flat()
      .map((p) => Number(p.id.replace(/\D/g, '')) || 0)
    this.seq = Math.max(0, ...ids)
  }

  text() {
    return this.data
  }

  posts(item: string) {
    return this.data.posts[item] ?? []
  }

  addPost(item: string, post: Omit<PlanPost, 'id'>): PlanPost {
    const full = { ...post, id: `post-${++this.seq}` } as PlanPost
    this.data = { ...this.data, posts: { ...this.data.posts, [item]: [...this.posts(item), full] } }
    this.emit()
    return full
  }

  markAccepted(item: string, post: string) {
    const posts = this.posts(item).map((p) => (p.id === post ? { ...p, accepted: true } : p))
    this.data = { ...this.data, posts: { ...this.data.posts, [item]: posts } }
    this.emit()
  }

  putItem(item: string, text: { title: string; brief: string }) {
    this.data = { ...this.data, items: { ...this.data.items, [item]: text } }
    this.emit()
  }

  subscribe(onChange: () => void) {
    this.listeners.add(onChange)
    return () => void this.listeners.delete(onChange)
  }

  private emit() {
    this.listeners.forEach((l) => l())
  }
}
