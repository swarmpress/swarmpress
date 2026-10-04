/**
 * The eval harness's store and gateway (FEAT-036): in memory, nothing leaves
 * the machine. The store implements orchestrator-wasm's `OrchestratorStore`
 * over maps (records are kept as the JSON text the orchestrator wrote); the
 * gateway records each draft the way the central gateway would commit it,
 * with what the gateway's checks say about it, and never merges.
 */

/** A text record store with the orchestrator's interface (crates/orchestrator-wasm `OrchestratorStore`). */
export class MemoryOrchestratorStore {
  readonly briefs = new Map<string, string>()
  readonly artifacts = new Map<string, string>()
  readonly transcripts: { jobId: number; seq: number; speaker: string; text: string }[] = []
  readonly items = new Map<string, { title: string | null; brief: string | null }>()
  readonly posts = new Map<string, Record<string, unknown>[]>()
  readonly stages = new Map<string, string>()
  private claims = new Map<string, string>()
  private nextPost = 0

  private key(company: string, id: string): string {
    return `${company}\u0000${id}`
  }

  putBrief(company: string, briefRef: string, recordJson: string): void {
    this.briefs.set(this.key(company, briefRef), recordJson)
  }
  getBrief(company: string, briefRef: string): string | null {
    return this.briefs.get(this.key(company, briefRef)) ?? null
  }
  claimBrief(company: string, briefRef: string, workItem: string): boolean {
    const k = this.key(company, briefRef)
    const have = this.claims.get(k)
    if (have === undefined) {
      this.claims.set(k, workItem)
      return true
    }
    return have === workItem
  }
  putArtifact(company: string, workItem: string, recordJson: string): void {
    this.artifacts.set(this.key(company, workItem), recordJson)
  }
  getArtifact(company: string, workItem: string): string | null {
    return this.artifacts.get(this.key(company, workItem)) ?? null
  }
  appendTranscript(_company: string, jobId: number, seq: number, speaker: string, text: string): void {
    this.transcripts.push({ jobId, seq, speaker, text })
  }
  setItemText(_company: string, item: string, title: string | null, brief: string | null): void {
    this.items.set(item, { title, brief })
  }
  appendPost(_company: string, item: string, postJson: string): string {
    const post = JSON.parse(postJson) as Record<string, unknown>
    const list = this.posts.get(item) ?? []
    if (typeof post.dedupe === 'string') {
      const have = list.find((p) => p.dedupe === post.dedupe)
      if (have) return String(have.id)
    }
    const id = `post-${++this.nextPost}`
    list.push({ ...post, id })
    this.posts.set(item, list)
    return id
  }
  planJson(_company: string): string {
    const posts: Record<string, Record<string, unknown>[]> = {}
    for (const [item, list] of this.posts) posts[item] = list.slice(-50)
    const items: Record<string, unknown> = {}
    for (const [id, t] of this.items) items[id] = { id, title: t.title, brief: t.brief }
    return JSON.stringify({ items, posts })
  }
  getStage(company: string, jobId: number, stage: string, index: number): string | null {
    return this.stages.get(this.key(company, `${jobId}:${stage}:${index}`)) ?? null
  }
  putStage(company: string, jobId: number, stage: string, index: number, rowJson: string): string {
    const k = this.key(company, `${jobId}:${stage}:${index}`)
    const have = this.stages.get(k)
    if (have !== undefined) return have
    this.stages.set(k, rowJson)
    return rowJson
  }
}

/** One draft as the local gateway received it. */
export interface CommittedDraft {
  number: number
  contentId: string
  path: string
  workItem: string | null
  message: string
  headSha: string
  /** What the central gateway would refuse (`orchestrator::eval::gateway_checks`); empty: accepted. */
  issues: string[]
  /** Another content id has an open draft on the same path (the gateway's one-PR-per-path rule). */
  pathTaken: boolean
}

/** FNV-1a, 32 bit, hex: a stable stand-in for a commit sha. */
export function shortHash(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/**
 * orchestrator-wasm's `OrchestratorGateway`, locally: a draft gets a pull
 * request number per content id and a head sha from its text. `check` is the
 * gateway's checks (the harness passes `evalOp('gateway_checks')`). A draft
 * the real gateway would refuse is still recorded and accepted here, so the
 * pipeline keeps going and the eval counts the refusal.
 */
export class LocalGateway {
  readonly drafts: CommittedDraft[] = []
  private numbers = new Map<string, number>()
  constructor(private check: (contentId: string, path: string, pageJson: string) => string[]) {}

  async openDraft(contentId: string, path: string, pageJson: string, message: string, workItem: string | null): Promise<{ number: number; branch: string; head_sha: string }> {
    let number = this.numbers.get(contentId)
    if (number === undefined) {
      number = this.numbers.size + 1
      this.numbers.set(contentId, number)
    }
    const headSha = `${shortHash(pageJson)}${shortHash(`${contentId}:${message}`)}`.padEnd(40, '0')
    const pathTaken = this.drafts.some((d) => d.path === path && d.contentId !== contentId)
    this.drafts.push({ number, contentId, path, workItem, message, headSha, issues: this.check(contentId, path, pageJson), pathTaken })
    return { number, branch: `drafts/content-${contentId}`, head_sha: headSha }
  }

  async merge(): Promise<string> {
    throw new Error('the eval harness never merges')
  }
}
