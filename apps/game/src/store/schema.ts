/**
 * The company store's migrations: one set for every engine, in the plain
 * SQLite subset that Turso and SQLite both accept (ADR-0041): no extensions,
 * virtual tables, triggers, CHECKs, generated columns, AUTOINCREMENT or
 * WITHOUT ROWID. JSON lives in TEXT columns; bytes in BLOBs; instants are
 * unix ms INTEGERs.
 *
 * Append a migration to change the schema; never edit a shipped one.
 */

export interface Migration {
  version: number
  name: string
  sql: string
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'company store',
    sql: `
CREATE TABLE command_log (
  seq INTEGER PRIMARY KEY,
  step INTEGER NOT NULL,
  kind TEXT NOT NULL,
  payload BLOB NOT NULL
);
CREATE INDEX command_log_step ON command_log (step);

CREATE TABLE snapshots (
  step INTEGER PRIMARY KEY,
  bytes BLOB NOT NULL,
  hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE briefs (
  company TEXT NOT NULL,
  brief_ref TEXT NOT NULL,
  record TEXT NOT NULL,
  work_item TEXT,
  PRIMARY KEY (company, brief_ref)
);

CREATE TABLE artifacts (
  company TEXT NOT NULL,
  work_item TEXT NOT NULL,
  record TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (company, work_item)
);

CREATE TABLE transcripts (
  company TEXT NOT NULL,
  job_id INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  speaker TEXT NOT NULL,
  text TEXT NOT NULL,
  PRIMARY KEY (company, job_id, seq)
);

CREATE TABLE plan_items (
  company TEXT NOT NULL,
  item TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  brief TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (company, item)
);

CREATE TABLE plan_posts (
  id INTEGER PRIMARY KEY,
  company TEXT NOT NULL,
  item TEXT NOT NULL,
  type TEXT NOT NULL,
  post TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX plan_posts_item ON plan_posts (company, item, id);

CREATE TABLE kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`,
  },
  {
    // ADR-0061: the site's knowledge pack (GET /api/gateway/knowledge), one
    // row per site commit, the pack's JSON text verbatim. The newest is what
    // the session binds when the network fails.
    version: 2,
    name: 'site knowledge',
    sql: `
CREATE TABLE site_knowledge (
  commit_sha TEXT PRIMARY KEY,
  etag TEXT NOT NULL,
  pack TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);
CREATE INDEX site_knowledge_fetched ON site_knowledge (fetched_at);
`,
  },
  {
    // ADR-0058 (FEAT-032, FEAT-078): the staged jobs' stage results (keyed by
    // job, stage and index; first write wins), the dedupe keys of plan posts
    // (a re-run job never posts twice) and the lean activity record (one row
    // per stage attempt and one per job, shaped for ADR-0056 work records).
    // New tables only: no ALTER of a shipped table.
    version: 3,
    name: 'staged jobs and activity',
    sql: `
CREATE TABLE job_stages (
  company TEXT NOT NULL,
  job_id INTEGER NOT NULL,
  stage TEXT NOT NULL,
  idx INTEGER NOT NULL,
  input_hash TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (company, job_id, stage, idx)
);

CREATE TABLE post_dedupe (
  company TEXT NOT NULL,
  dedupe TEXT NOT NULL,
  post_id INTEGER NOT NULL,
  PRIMARY KEY (company, dedupe)
);

CREATE TABLE activity (
  id INTEGER PRIMARY KEY,
  company TEXT NOT NULL,
  job_id INTEGER NOT NULL,
  stage TEXT NOT NULL,
  idx INTEGER NOT NULL,
  attempt INTEGER NOT NULL,
  kind TEXT NOT NULL,
  revision INTEGER NOT NULL,
  work_item TEXT,
  staff TEXT,
  role TEXT,
  persona TEXT,
  model TEXT,
  tokens_in INTEGER NOT NULL,
  tokens_out INTEGER NOT NULL,
  wall_ms INTEGER NOT NULL,
  game_step INTEGER,
  day INTEGER,
  minute INTEGER,
  result TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX activity_key ON activity (company, job_id, stage, idx, attempt);
CREATE INDEX activity_job ON activity (company, job_id, id);
`,
  },
]

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version
