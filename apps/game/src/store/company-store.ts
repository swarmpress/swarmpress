/**
 * CompanyStore: the company's data in the browser (ADR-0038, ADR-0041).
 *
 * - The orchestrator's text store (`OrchestratorStore`, the JSON contract of
 *   `orchestrator::Store`): briefs, artifacts, transcripts, plan items and
 *   posts (deduplicated by their `dedupe` key), the plan view (`planJson`)
 *   and the stage results of staged jobs (`getStage`/`putStage`, ADR-0058).
 * - The activity record (`putActivity`/`activity`, FEAT-078): one row per
 *   stage attempt and one per job; `activityPage` reads it a window of jobs
 *   at a time (the Activity panel).
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
export const POST_TYPES = ['minutes', 'artifact', 'handoff', 'review', 'status', 'performance'] as const

/** The store's tables (schema.ts), for `rowCounts`. */
export const STORE_TABLES = [
  'command_log',
  'snapshots',
  'briefs',
  'artifacts',
  'transcripts',
  'plan_items',
  'plan_posts',
  'kv',
  'site_knowledge',
  'job_stages',
  'post_dedupe',
  'activity',
] as const

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
  /** Every artifact record of the company, `[{work_item, record}]` with the record as stored (JSON text). */
  listArtifacts(company: string): Promise<{ work_item: string; record: string }[]>
  appendTranscript(company: string, jobId: number, seq: number, speaker: string, text: string): Promise<void>
  setItemText(company: string, item: string, title: string | null, brief: string | null): Promise<void>
  appendPost(company: string, item: string, postJson: string): Promise<string>
  planJson(company: string): Promise<string>
  /** A stage result `{input_hash, value}` as JSON text, or null. */
  getStage(company: string, jobId: number, stage: string, index: number): Promise<string | null>
  /** Stores `{input_hash, value}` unless the key has a row (first write wins); returns the stored row as JSON text. */
  putStage(company: string, jobId: number, stage: string, index: number, rowJson: string): Promise<string>
}

/**
 * One row of the activity record (ADR-0058 decision 9): a stage attempt
 * (`stage` = the stage, `attempt` from 1) or the job (`stage: 'job'`).
 * `detail` holds errors, repairs, words, score, pull request, branch and sha.
 */
export interface ActivityRow {
  job_id: number
  stage: string
  idx: number
  attempt: number
  kind: string
  revision: number
  work_item: string | null
  staff: string | null
  role: string | null
  persona: string | null
  model: string | null
  tokens_in: number
  tokens_out: number
  wall_ms: number
  game_step: number | null
  day: number | null
  minute: number | null
  result: string
  detail: Record<string, unknown>
}

/** An activity row as stored: the row plus the wall time it was written (a job row's: when the job ended). */
export interface StoredActivityRow extends ActivityRow {
  /** Unix ms. */
  created_at: number
}

/** A window of the activity record (`activityPage`): every row of the jobs in it. */
export interface ActivityPage {
  rows: StoredActivityRow[]
  /** Older jobs exist beyond the window. */
  more: boolean
}

const ACTIVITY_COLUMNS =
  'job_id, stage, idx, attempt, kind, revision, work_item, staff, role, persona, model, tokens_in, tokens_out, wall_ms, game_step, day, minute, result, detail'

function activityRow(r: Record<string, unknown>): ActivityRow {
  const num = (v: unknown) => (v == null ? null : toNumber(v as number))
  const str = (v: unknown) => (v == null ? null : String(v))
  return {
    job_id: toNumber(r.job_id as number),
    stage: String(r.stage),
    idx: toNumber(r.idx as number),
    attempt: toNumber(r.attempt as number),
    kind: String(r.kind),
    revision: toNumber(r.revision as number),
    work_item: str(r.work_item),
    staff: str(r.staff),
    role: str(r.role),
    persona: str(r.persona),
    model: str(r.model),
    tokens_in: toNumber(r.tokens_in as number),
    tokens_out: toNumber(r.tokens_out as number),
    wall_ms: toNumber(r.wall_ms as number),
    game_step: num(r.game_step),
    day: num(r.day),
    minute: num(r.minute),
    result: String(r.result),
    detail: JSON.parse(String(r.detail)) as Record<string, unknown>,
  }
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

  async listArtifacts(company: string): Promise<{ work_item: string; record: string }[]> {
    const rows = await this.driver.all<{ work_item: string; record: string }>(
      'SELECT work_item, record FROM artifacts WHERE company = ? ORDER BY work_item',
      [company],
    )
    return rows.map((r) => ({ work_item: String(r.work_item), record: String(r.record) }))
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

  /**
   * Appends a post; returns its id. A post with a `dedupe` key the company
   * already has is not written again: the existing post's id is returned
   * (the post and its key are written in one transaction).
   */
  async appendPost(company: string, item: string, postJson: string): Promise<string> {
    const post = JSON.parse(postJson) as Record<string, unknown>
    if (post === null || typeof post !== 'object' || Array.isArray(post)) throw new Error('post must be a JSON object')
    const type = post.type
    if (typeof type !== 'string' || !(POST_TYPES as readonly string[]).includes(type)) {
      throw new Error(`unknown post type ${JSON.stringify(type)}`)
    }
    delete post.id
    delete post.item
    const dedupe = typeof post.dedupe === 'string' && post.dedupe ? post.dedupe : null
    if (!dedupe) {
      const r = await this.driver.run('INSERT INTO plan_posts (company, item, type, post, created_at) VALUES (?, ?, ?, ?, ?)', [
        company,
        item,
        type,
        JSON.stringify(post),
        Date.now(),
      ])
      return `post-${r.lastInsertRowid}`
    }
    for (let attempt = 0; ; attempt++) {
      const have = await this.driver.all<{ post_id: number }>('SELECT post_id FROM post_dedupe WHERE company = ? AND dedupe = ?', [company, dedupe])
      if (have.length) return `post-${toNumber(have[0].post_id)}`
      const next = await this.driver.all<{ n: number | null }>('SELECT MAX(id) AS n FROM plan_posts')
      const id = (next[0]?.n == null ? 0 : toNumber(next[0].n)) + 1
      try {
        await this.driver.batch([
          { sql: 'INSERT INTO plan_posts (id, company, item, type, post, created_at) VALUES (?, ?, ?, ?, ?, ?)', params: [id, company, item, type, JSON.stringify(post), Date.now()] },
          { sql: 'INSERT INTO post_dedupe (company, dedupe, post_id) VALUES (?, ?, ?)', params: [company, dedupe, id] },
        ])
        return `post-${id}`
      } catch (e) {
        // Another write took the id (or the key) in between: look again.
        if (attempt >= 3) throw e
      }
    }
  }

  async planJson(company: string): Promise<string> {
    return JSON.stringify(await this.plan(company))
  }

  async getStage(company: string, jobId: number, stage: string, index: number): Promise<string | null> {
    const rows = await this.driver.all<{ input_hash: string; value: string }>(
      'SELECT input_hash, value FROM job_stages WHERE company = ? AND job_id = ? AND stage = ? AND idx = ?',
      [company, jobId, stage, index],
    )
    // The value stays JSON text (no JS parse): `{"input_hash": …, "value": <stored text>}`.
    return rows.length ? `{"input_hash":${JSON.stringify(String(rows[0].input_hash))},"value":${String(rows[0].value)}}` : null
  }

  async putStage(company: string, jobId: number, stage: string, index: number, rowJson: string): Promise<string> {
    const row = JSON.parse(rowJson) as { input_hash?: unknown; value?: unknown }
    if (typeof row.input_hash !== 'string' || !('value' in row)) throw new Error('a stage row is {input_hash, value}')
    // The value is kept as the text it came in (a JS parse would round a u64):
    // orchestrator-wasm writes `{"input_hash":"…","value":…}`.
    const prefix = `{"input_hash":${JSON.stringify(row.input_hash)},"value":`
    const value = rowJson.startsWith(prefix) && rowJson.endsWith('}') ? rowJson.slice(prefix.length, -1) : JSON.stringify(row.value)
    await this.driver.run(
      'INSERT OR IGNORE INTO job_stages (company, job_id, stage, idx, input_hash, value, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [company, jobId, stage, index, row.input_hash, value, Date.now()],
    )
    return (await this.getStage(company, jobId, stage, index))!
  }

  /** Stage keys stored for a job, in key order (tests and diagnostics). */
  async stages(company: string, jobId: number): Promise<{ stage: string; index: number; inputHash: string }[]> {
    const rows = await this.driver.all<{ stage: string; idx: number; input_hash: string }>(
      'SELECT stage, idx, input_hash FROM job_stages WHERE company = ? AND job_id = ? ORDER BY stage, idx',
      [company, jobId],
    )
    return rows.map((r) => ({ stage: String(r.stage), index: toNumber(r.idx), inputHash: String(r.input_hash) }))
  }

  /** Deletes the stage rows of the given jobs (the week-long run prunes finished jobs, docs/mvp.md W). */
  async deleteStages(company: string, jobIds: number[]): Promise<void> {
    for (const id of jobIds) await this.driver.run('DELETE FROM job_stages WHERE company = ? AND job_id = ?', [company, id])
  }

  /**
   * The jobs that have stage rows, each with the work item the activity
   * record names for it (`undefined`: no activity row, the item is not
   * known; `null`: a job without an item, a standup). The stage sweeper's
   * input (orchestration/sweeper.ts, FEAT-085). Two plain reads: no
   * correlated subquery (ADR-0041).
   */
  async stageJobs(company: string): Promise<{ jobId: number; workItem: string | null | undefined }[]> {
    const ids = (await this.driver.all<{ job_id: number }>('SELECT DISTINCT job_id FROM job_stages WHERE company = ? ORDER BY job_id', [company])).map((r) =>
      toNumber(r.job_id),
    )
    if (!ids.length) return []
    const items = new Map<number, string | null>()
    for (let i = 0; i < ids.length; i += 200) {
      const part = ids.slice(i, i + 200)
      const rows = await this.driver.all<{ job_id: number; work_item: string | null }>(
        `SELECT DISTINCT job_id, work_item FROM activity WHERE company = ? AND job_id IN (${part.map(() => '?').join(', ')})`,
        [company, ...part],
      )
      for (const r of rows) items.set(toNumber(r.job_id), r.work_item == null ? null : String(r.work_item))
    }
    return ids.map((jobId) => ({ jobId, workItem: items.has(jobId) ? items.get(jobId)! : undefined }))
  }

  /** Rows per table (diagnostics: the soak test's growth check, FEAT-085). */
  async rowCounts(): Promise<Record<string, number>> {
    const out: Record<string, number> = {}
    for (const t of STORE_TABLES) {
      const rows = await this.driver.all<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`)
      out[t] = toNumber(rows[0]?.n ?? 0)
    }
    return out
  }

  // ------------------------------------------------------------ activity (FEAT-078)

  /**
   * Writes one activity row. `replace` overwrites a row with the same
   * (job, stage, index, attempt); `keep` leaves an existing one (a reused
   * stage never overwrites the attempt that produced it).
   */
  async putActivity(company: string, row: ActivityRow, mode: 'replace' | 'keep' = 'replace'): Promise<void> {
    const verb = mode === 'keep' ? 'INSERT OR IGNORE' : 'INSERT OR REPLACE'
    await this.driver.run(
      `${verb} INTO activity (company, job_id, stage, idx, attempt, kind, revision, work_item, staff, role, persona, model, tokens_in, tokens_out, wall_ms, game_step, day, minute, result, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        company,
        row.job_id,
        row.stage,
        row.idx,
        row.attempt,
        row.kind,
        row.revision,
        row.work_item,
        row.staff,
        row.role,
        row.persona,
        row.model,
        Math.round(row.tokens_in),
        Math.round(row.tokens_out),
        Math.round(row.wall_ms),
        row.game_step,
        row.day,
        row.minute,
        row.result,
        JSON.stringify(row.detail ?? {}),
        Date.now(),
      ],
    )
  }

  /** The activity record, oldest job first, the job row after its stage rows. `jobId` limits it to one job. */
  async activity(company: string, jobId?: number): Promise<ActivityRow[]> {
    const rows = await this.driver.all<Record<string, unknown>>(
      `SELECT ${ACTIVITY_COLUMNS}
       FROM activity WHERE company = ?${jobId == null ? '' : ' AND job_id = ?'} ORDER BY job_id, id`,
      jobId == null ? [company] : [company, jobId],
    )
    return rows.map(activityRow)
  }

  /**
   * The Activity panel's bounded read (U4): every row of the newest `limit`
   * jobs, or of the newest `limit` jobs older than `before`. Newest job
   * first, each job's rows in the order they were written. Two reads on the
   * `(company, job_id, id)` index; the table is never read whole.
   */
  async activityPage(company: string, q: { limit: number; before?: number | null }): Promise<ActivityPage> {
    const limit = Math.max(1, Math.floor(q.limit))
    const before = q.before == null ? null : Math.floor(q.before)
    const ids = await this.driver.all<{ job_id: number }>(
      `SELECT job_id FROM activity WHERE company = ?${before == null ? '' : ' AND job_id < ?'} GROUP BY job_id ORDER BY job_id DESC LIMIT ?`,
      before == null ? [company, limit + 1] : [company, before, limit + 1],
    )
    const jobs = ids.slice(0, limit).map((r) => toNumber(r.job_id))
    if (jobs.length === 0) return { rows: [], more: false }
    const rows = await this.driver.all<Record<string, unknown>>(
      `SELECT ${ACTIVITY_COLUMNS}, created_at
       FROM activity WHERE company = ? AND job_id >= ? AND job_id <= ? ORDER BY job_id DESC, id`,
      [company, jobs[jobs.length - 1], jobs[0]],
    )
    return { rows: rows.map((r) => ({ ...activityRow(r), created_at: toNumber(r.created_at as number) })), more: ids.length > limit }
  }

  // ------------------------------------------------------------ plan / transcripts (reads)

  /**
   * The plan view (publishing-plan.md §7): posts oldest first, newest 50 per item.
   * Reads every post of the company: it grows with the items (about twenty a
   * week, docs/design/mvp-pipeline.md §7 leaves them alone) and is read once
   * per job, per standup and per UI change, never per step (FEAT-085).
   */
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

  /** One transcript row (a speech bubble's words, FEAT-025), or null. */
  async transcriptLine(company: string, jobId: number, seq: number): Promise<TranscriptLine | null> {
    const rows = await this.driver.all<{ speaker: string; text: string }>('SELECT speaker, text FROM transcripts WHERE company = ? AND job_id = ? AND seq = ?', [
      company,
      jobId,
      seq,
    ])
    const r = rows[0]
    return r ? { job_id: jobId, seq, speaker: String(r.speaker), text: String(r.text) } : null
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
