/**
 * CompanyStore: the company's data in the browser (ADR-0038, ADR-0041).
 *
 * - The orchestrator's text store (`OrchestratorStore`, the JSON contract of
 *   `orchestrator::Store`): briefs, artifacts, transcripts, plan items and
 *   posts, and the plan view (`planJson`).
 * - The sim's command log and snapshots (`appendCommands`, `commandsAfter`,
 *   `putSnapshot`, `latestSnapshot`).
 * - A small key/value table (event cursor, device id, ...).
 *
 * Every engine runs the same SQL (schema.ts). Records the orchestrator hands
 * over are JSON text and are stored verbatim: artifact records carry
 * `brief_ref`, a u64 a JS number cannot hold exactly.
 */
import type { RunResult, SqlDriver, SqlStatement, StoreEngine } from './driver'
import { toBytes, toNumber } from './driver'
import { MIGRATIONS } from './schema'

/** Post types the orchestrator writes (orchestrator::POST_TYPES). */
export const POST_TYPES = ['minutes', 'artifact', 'handoff', 'review', 'status'] as const

/** Newest posts per item in the plan view (orchestrator::PLAN_POSTS_PER_ITEM). */
export const PLAN_POSTS_PER_ITEM = 50

export interface CommandRecord {
  /** Log position; assigned by the store when absent. */
  seq?: number
  step: number
  kind: string
  /** postcard bytes of the command. */
  payload: Uint8Array
}

export interface StoredCommand extends CommandRecord {
  seq: number
}

export interface Snapshot {
  step: number
  bytes: Uint8Array
  /** World hash at `step` (hex or decimal text). */
  hash: string
  createdAt: number
}

export interface PlanPost {
  id: string
  item: string
  type: string
  author: string
  to?: string
  text: string
  payload: unknown
  [k: string]: unknown
}

export interface Plan {
  items: Record<string, { title: string; brief: string }>
  todos: Record<string, unknown>
  workstreams: Record<string, unknown>
  goals: Record<string, unknown>
  posts: Record<string, PlanPost[]>
}

export interface TranscriptLine {
  job_id: number
  seq: number
  speaker: string
  text: string
}

/** The orchestrator-wasm store contract (see crates/orchestrator-wasm). */
export interface OrchestratorStore {
  putBrief(company: string, briefRef: string, recordJson: string): Promise<void>
  getBrief(company: string, briefRef: string): Promise<string | null>
  claimBrief(company: string, briefRef: string, workItem: string): Promise<boolean>
  putArtifact(company: string, workItem: string, recordJson: string): Promise<void>
  getArtifact(company: string, workItem: string): Promise<string | null>
  appendTranscript(company: string, jobId: number, seq: number, speaker: string, text: string): Promise<void>
  setItemText(company: string, item: string, title: string | null, brief: string | null): Promise<void>
  appendPost(company: string, item: string, postJson: string): Promise<string>
  planJson(company: string): Promise<string>
}

/** A stored knowledge pack (`site_knowledge`, keyed by commit). */
export interface SiteKnowledgeRow {
  commit: string
  etag: string
  /** The pack's JSON text, as the server sent it. */
  pack: string
  fetchedAt: number
}

function knowledgeRow(r: { commit_sha: string; etag: string; pack: string; fetched_at: number }): SiteKnowledgeRow {
  return { commit: String(r.commit_sha), etag: String(r.etag), pack: String(r.pack), fetchedAt: toNumber(r.fetched_at) }
}

function splitStatements(sql: string): string[] {
  return sql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

export class CompanyStore implements OrchestratorStore {
  private constructor(
    readonly driver: SqlDriver,
    /** Why a preferred engine was not used (automatic selection), if so. */
    readonly fallbackReason: string | null,
  ) {}

  get engine(): StoreEngine {
    return this.driver.engine
  }

  get persistent(): boolean {
    return this.driver.persistent
  }

  /** Opens the store on a driver and applies pending migrations. */
  static async open(driver: SqlDriver, fallbackReason: string | null = null): Promise<CompanyStore> {
    const store = new CompanyStore(driver, fallbackReason)
    await store.migrate()
    return store
  }

  private async migrate(): Promise<void> {
    await this.driver.exec(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)',
    )
    const done = new Set(
      (await this.driver.all<{ version: number }>('SELECT version FROM schema_migrations')).map((r) => toNumber(r.version)),
    )
    for (const m of MIGRATIONS) {
      if (done.has(m.version)) continue
      await this.driver.batch([
        ...splitStatements(m.sql).map((sql) => ({ sql })),
        { sql: 'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)', params: [m.version, m.name, Date.now()] },
      ])
    }
  }

  async schemaVersion(): Promise<number> {
    const rows = await this.driver.all<{ v: number | null }>('SELECT MAX(version) AS v FROM schema_migrations')
    return rows[0]?.v == null ? 0 : toNumber(rows[0].v)
  }

  close(): Promise<void> {
    return this.driver.close()
  }

  // ------------------------------------------------------------ orchestrator Store

  async putBrief(company: string, briefRef: string, recordJson: string): Promise<void> {
    const rec = JSON.parse(recordJson) as { work_item?: string | null }
    await this.driver.run('INSERT OR IGNORE INTO briefs (company, brief_ref, record, work_item) VALUES (?, ?, ?, ?)', [
      company,
      briefRef,
      recordJson,
      typeof rec.work_item === 'string' ? rec.work_item : null,
    ])
  }

  async getBrief(company: string, briefRef: string): Promise<string | null> {
    const rows = await this.driver.all<{ record: string; work_item: string | null }>(
      'SELECT record, work_item FROM briefs WHERE company = ? AND brief_ref = ?',
      [company, briefRef],
    )
    if (rows.length === 0) return null
    // Brief records hold only small numbers (job ids), so a parse is exact.
    const rec = JSON.parse(String(rows[0].record)) as Record<string, unknown>
    rec.work_item = rows[0].work_item ?? null
    return JSON.stringify(rec)
  }

  async claimBrief(company: string, briefRef: string, workItem: string): Promise<boolean> {
    const r = await this.driver.run(
      'UPDATE briefs SET work_item = ? WHERE company = ? AND brief_ref = ? AND work_item IS NULL',
      [workItem, company, briefRef],
    )
    if (r.changes > 0) return true
    const rows = await this.driver.all('SELECT 1 AS x FROM briefs WHERE company = ? AND brief_ref = ?', [company, briefRef])
    if (rows.length === 0) throw new Error(`unknown brief_ref ${briefRef}`)
    return false
  }

  async putArtifact(company: string, workItem: string, recordJson: string): Promise<void> {
    await this.driver.run('INSERT OR REPLACE INTO artifacts (company, work_item, record, updated_at) VALUES (?, ?, ?, ?)', [
      company,
      workItem,
      recordJson,
      Date.now(),
    ])
  }

  async getArtifact(company: string, workItem: string): Promise<string | null> {
    const rows = await this.driver.all<{ record: string }>('SELECT record FROM artifacts WHERE company = ? AND work_item = ?', [
      company,
      workItem,
    ])
    return rows.length ? String(rows[0].record) : null
  }

  async appendTranscript(company: string, jobId: number, seq: number, speaker: string, text: string): Promise<void> {
    await this.driver.run('INSERT OR IGNORE INTO transcripts (company, job_id, seq, speaker, text) VALUES (?, ?, ?, ?, ?)', [
      company,
      jobId,
      seq,
      speaker,
      text,
    ])
  }

  async setItemText(company: string, item: string, title: string | null, brief: string | null): Promise<void> {
    await this.driver.batch([
      { sql: 'INSERT OR IGNORE INTO plan_items (company, item) VALUES (?, ?)', params: [company, item] },
      {
        sql: 'UPDATE plan_items SET title = COALESCE(?, title), brief = COALESCE(?, brief) WHERE company = ? AND item = ?',
        params: [title, brief, company, item],
      },
    ])
  }

  async appendPost(company: string, item: string, postJson: string): Promise<string> {
    const post = JSON.parse(postJson) as Record<string, unknown>
    if (post === null || typeof post !== 'object' || Array.isArray(post)) throw new Error('post must be a JSON object')
    const type = post.type
    if (typeof type !== 'string' || !(POST_TYPES as readonly string[]).includes(type)) {
      throw new Error(`unknown post type ${JSON.stringify(type)}`)
    }
    delete post.id
    delete post.item
    const r = await this.driver.run('INSERT INTO plan_posts (company, item, type, post, created_at) VALUES (?, ?, ?, ?, ?)', [
      company,
      item,
      type,
      JSON.stringify(post),
      Date.now(),
    ])
    return `post-${r.lastInsertRowid}`
  }

  async planJson(company: string): Promise<string> {
    return JSON.stringify(await this.plan(company))
  }

  // ------------------------------------------------------------ plan / transcripts (reads)

  /** The plan view (publishing-plan.md §7): posts oldest first, newest 50 per item. */
  async plan(company: string): Promise<Plan> {
    const items = await this.driver.all<{ item: string; title: string; brief: string }>(
      'SELECT item, title, brief FROM plan_items WHERE company = ? ORDER BY item',
      [company],
    )
    const posts = await this.driver.all<{ id: number; item: string; post: string }>(
      'SELECT id, item, post FROM plan_posts WHERE company = ? ORDER BY item, id',
      [company],
    )
    const plan: Plan = { items: {}, todos: {}, workstreams: {}, goals: {}, posts: {} }
    for (const r of items) plan.items[String(r.item)] = { title: String(r.title), brief: String(r.brief) }
    for (const r of posts) {
      const item = String(r.item)
      const p = { ...(JSON.parse(String(r.post)) as object), id: `post-${toNumber(r.id)}`, item } as PlanPost
      ;(plan.posts[item] ??= []).push(p)
    }
    for (const [k, list] of Object.entries(plan.posts)) {
      if (list.length > PLAN_POSTS_PER_ITEM) plan.posts[k] = list.slice(list.length - PLAN_POSTS_PER_ITEM)
    }
    return plan
  }

  async transcripts(company: string): Promise<TranscriptLine[]> {
    const rows = await this.driver.all<{ job_id: number; seq: number; speaker: string; text: string }>(
      'SELECT job_id, seq, speaker, text FROM transcripts WHERE company = ? ORDER BY job_id, seq',
      [company],
    )
    return rows.map((r) => ({ job_id: toNumber(r.job_id), seq: toNumber(r.seq), speaker: String(r.speaker), text: String(r.text) }))
  }

  // ------------------------------------------------------------ sim log + snapshots

  /** Appends commands in one transaction; returns their seqs. */
  async appendCommands(cmds: CommandRecord[]): Promise<number[]> {
    if (cmds.length === 0) return []
    const stmts: SqlStatement[] = cmds.map((c) =>
      c.seq == null
        ? { sql: 'INSERT INTO command_log (step, kind, payload) VALUES (?, ?, ?)', params: [c.step, c.kind, c.payload] }
        : { sql: 'INSERT INTO command_log (seq, step, kind, payload) VALUES (?, ?, ?, ?)', params: [c.seq, c.step, c.kind, c.payload] },
    )
    const res: RunResult[] = await this.driver.batch(stmts)
    return cmds.map((c, i) => c.seq ?? res[i].lastInsertRowid)
  }

  /** Commands with `step > after`, in log order. */
  async commandsAfter(after: number): Promise<StoredCommand[]> {
    const rows = await this.driver.all<{ seq: number; step: number; kind: string; payload: unknown }>(
      'SELECT seq, step, kind, payload FROM command_log WHERE step > ? ORDER BY seq',
      [after],
    )
    return rows.map((r) => ({ seq: toNumber(r.seq), step: toNumber(r.step), kind: String(r.kind), payload: toBytes(r.payload) }))
  }

  /** The highest log seq (0 when empty). */
  async lastSeq(): Promise<number> {
    const rows = await this.driver.all<{ s: number | null }>('SELECT MAX(seq) AS s FROM command_log')
    return rows[0]?.s == null ? 0 : toNumber(rows[0].s)
  }

  /** Stores a snapshot (replacing one at the same step); keeps the newest `keep`. */
  async putSnapshot(step: number, bytes: Uint8Array, hash: string, keep = 3): Promise<void> {
    await this.driver.batch([
      { sql: 'INSERT OR REPLACE INTO snapshots (step, bytes, hash, created_at) VALUES (?, ?, ?, ?)', params: [step, bytes, hash, Date.now()] },
      {
        sql: 'DELETE FROM snapshots WHERE step NOT IN (SELECT step FROM snapshots ORDER BY step DESC LIMIT ?)',
        params: [Math.max(1, keep)],
      },
    ])
  }

  async latestSnapshot(): Promise<Snapshot | null> {
    const rows = await this.driver.all<{ step: number; bytes: unknown; hash: string; created_at: number }>(
      'SELECT step, bytes, hash, created_at FROM snapshots ORDER BY step DESC LIMIT 1',
    )
    if (rows.length === 0) return null
    const r = rows[0]
    return { step: toNumber(r.step), bytes: toBytes(r.bytes), hash: String(r.hash), createdAt: toNumber(r.created_at) }
  }

  // ------------------------------------------------------------ site knowledge

  /**
   * Stores the knowledge pack of `commit` (its JSON text, verbatim) as the
   * newest, replacing a row of the same commit; keeps the newest `keep`.
   */
  async putKnowledge(row: { commit: string; etag: string; pack: string }, keep = 2): Promise<void> {
    // `fetched_at` orders the rows: strictly increasing, also within one millisecond.
    const last = await this.driver.all<{ t: number | null }>('SELECT MAX(fetched_at) AS t FROM site_knowledge')
    const at = Math.max(Date.now(), last[0]?.t == null ? 0 : toNumber(last[0].t) + 1)
    await this.driver.batch([
      {
        sql: 'INSERT OR REPLACE INTO site_knowledge (commit_sha, etag, pack, fetched_at) VALUES (?, ?, ?, ?)',
        params: [row.commit, row.etag, row.pack, at],
      },
      {
        sql: 'DELETE FROM site_knowledge WHERE commit_sha NOT IN (SELECT commit_sha FROM site_knowledge ORDER BY fetched_at DESC, commit_sha LIMIT ?)',
        params: [Math.max(1, keep)],
      },
    ])
  }

  /** The newest stored pack (the last one fetched), or null. */
  async latestKnowledge(): Promise<SiteKnowledgeRow | null> {
    const rows = await this.driver.all<{ commit_sha: string; etag: string; pack: string; fetched_at: number }>(
      'SELECT commit_sha, etag, pack, fetched_at FROM site_knowledge ORDER BY fetched_at DESC, commit_sha LIMIT 1',
    )
    return rows.length ? knowledgeRow(rows[0]) : null
  }

  /** The stored pack of `commit`, or null. */
  async knowledgeAt(commit: string): Promise<SiteKnowledgeRow | null> {
    const rows = await this.driver.all<{ commit_sha: string; etag: string; pack: string; fetched_at: number }>(
      'SELECT commit_sha, etag, pack, fetched_at FROM site_knowledge WHERE commit_sha = ?',
      [commit],
    )
    return rows.length ? knowledgeRow(rows[0]) : null
  }

  // ------------------------------------------------------------ kv

  async getKv(key: string): Promise<string | null> {
    const rows = await this.driver.all<{ value: string }>('SELECT value FROM kv WHERE key = ?', [key])
    return rows.length ? String(rows[0].value) : null
  }

  async setKv(key: string, value: string): Promise<void> {
    await this.driver.run('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)', [key, value])
  }

  async deleteKv(key: string): Promise<void> {
    await this.driver.run('DELETE FROM kv WHERE key = ?', [key])
  }
}
