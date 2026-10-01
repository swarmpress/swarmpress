-- SimPress server schema, v1.
-- Postgres is the only infrastructure (ADR-0008). Content lives in site repos;
-- these tables hold players, the event-sourced sim log, the job queue and audits.

CREATE TABLE users (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    github_id   BIGINT NOT NULL UNIQUE,
    login       TEXT NOT NULL,
    name        TEXT,
    avatar_url  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Session tokens are never stored in clear: id = hex(sha256(cookie token)).
CREATE TABLE sessions (
    id          TEXT PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions(user_id);
CREATE INDEX sessions_expires_idx ON sessions(expires_at);

-- One company (publishing house) per player. created_at is the sim epoch:
-- the authoritative step is (now - created_at) / 100 ms.
CREATE TABLE companies (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id     UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    name              TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
    seed              BIGINT NOT NULL,
    day_real_minutes  INTEGER NOT NULL CHECK (day_real_minutes > 0),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Event-sourced command log. Replaying (latest snapshot + commands ordered by
-- step, seq) reproduces the authoritative world exactly.
CREATE TABLE sim_commands (
    company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    step        BIGINT NOT NULL CHECK (step >= 0),
    seq         INTEGER NOT NULL CHECK (seq >= 0),
    payload     BYTEA NOT NULL,
    user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (company_id, step, seq)
);

-- Snapshot at `step` is the world state right after stepping into `step`,
-- before any command of that step is applied.
CREATE TABLE sim_snapshots (
    company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    step        BIGINT NOT NULL CHECK (step >= 0),
    hash        BIGINT NOT NULL,
    payload     BYTEA NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (company_id, step)
);

-- Durable job queue (SELECT ... FOR UPDATE SKIP LOCKED + LISTEN/NOTIFY).
CREATE TABLE jobs (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id       UUID REFERENCES companies(id) ON DELETE CASCADE,
    kind             TEXT NOT NULL,
    executor         TEXT NOT NULL CHECK (executor IN ('browser', 'claude')),
    min_tier         SMALLINT NOT NULL DEFAULT 0 CHECK (min_tier >= 0),
    priority         INTEGER NOT NULL DEFAULT 0,
    payload          JSONB NOT NULL DEFAULT '{}'::jsonb,
    status           TEXT NOT NULL DEFAULT 'queued'
                     CHECK (status IN ('queued', 'running', 'succeeded', 'dead', 'cancelled')),
    attempts         INTEGER NOT NULL DEFAULT 0,
    max_attempts     INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
    run_after        TIMESTAMPTZ NOT NULL DEFAULT now(),
    lease_owner      TEXT,
    lease_until      TIMESTAMPTZ,
    idempotency_key  TEXT UNIQUE,
    result           JSONB,
    error            TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX jobs_ready_idx ON jobs (executor, priority DESC, run_after)
    WHERE status = 'queued';
CREATE INDEX jobs_company_ready_idx ON jobs (company_id, executor)
    WHERE status = 'queued';
CREATE INDEX jobs_lease_idx ON jobs (lease_until) WHERE status = 'running';

-- Audit of every LLM call (Claude and browser-executed).
CREATE TABLE llm_calls (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id         UUID REFERENCES jobs(id) ON DELETE SET NULL,
    company_id     UUID REFERENCES companies(id) ON DELETE SET NULL,
    executor       TEXT NOT NULL,
    model          TEXT NOT NULL,
    status         TEXT NOT NULL,
    input_tokens   INTEGER,
    output_tokens  INTEGER,
    latency_ms     INTEGER,
    request        JSONB,
    response       JSONB,
    error          TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX llm_calls_company_idx ON llm_calls (company_id, created_at);

-- GitHub webhook dedupe (X-GitHub-Delivery).
CREATE TABLE webhook_deliveries (
    id            BIGSERIAL PRIMARY KEY,
    delivery_id   TEXT NOT NULL UNIQUE,
    event         TEXT NOT NULL,
    payload       JSONB NOT NULL,
    received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at  TIMESTAMPTZ
);
