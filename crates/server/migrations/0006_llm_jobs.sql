-- Hosted model calls (ADR-0067): one row per `POST /api/llm/generate`, written
-- before the provider is called and finished after it answers. The daily
-- budget is the sum of `cost_micros` of the company's rows since the start of
-- the UTC day.
--
--   pending ──answer──► ok | incomplete
--           ──error───► failed
--
-- Plain SQLite subset (ADR-0041): integers are unix milliseconds and
-- millionths of a US dollar; the text values are written by `llm.rs` only.
CREATE TABLE llm_jobs (
    id                 TEXT PRIMARY KEY,
    company_id         TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    user_id            TEXT NOT NULL,
    -- What the call is for (`draft`, `review`, `meeting`, `bench`, …), from the client.
    kind               TEXT NOT NULL,
    model              TEXT NOT NULL,
    tier_requested     TEXT NOT NULL,
    -- The tier the provider reports it used; NULL until it answers.
    tier_returned      TEXT,
    reasoning_effort   TEXT NOT NULL,
    status             TEXT NOT NULL,
    input_tokens       INTEGER NOT NULL DEFAULT 0,
    cached_tokens      INTEGER NOT NULL DEFAULT 0,
    output_tokens      INTEGER NOT NULL DEFAULT 0,
    reasoning_tokens   INTEGER NOT NULL DEFAULT 0,
    cost_micros        INTEGER NOT NULL DEFAULT 0,
    attempts           INTEGER NOT NULL DEFAULT 0,
    response_id        TEXT,
    error              TEXT,
    created_at         INTEGER NOT NULL,
    finished_at        INTEGER
);

CREATE INDEX llm_jobs_company_day ON llm_jobs (company_id, created_at);
