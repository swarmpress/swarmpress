-- SimPress central service schema (ADR-0038 local-first, ADR-0039 SQLite).
--
-- Conventions:
--   * ids are TEXT (uuid strings), except AUTOINCREMENT-like INTEGER PRIMARY KEY
--     sequences (events, tracker events);
--   * instants are INTEGER unix epoch milliseconds (`*_at`, `ts`);
--   * calendar days are TEXT 'YYYY-MM-DD' (UTC);
--   * JSON is TEXT checked with json_valid().
-- Plain SQLite subset that Turso also accepts (ADR-0041): no extensions, no
-- virtual tables, no FTS, no generated columns, no triggers, no STRICT.

-- ------------------------------------------------------------ accounts

-- A player signs in with GitHub OAuth (github_id) or, in development only,
-- with the dev login (dev_login, SIMPRESS_DEV_AUTH=1).
CREATE TABLE users (
    id          TEXT PRIMARY KEY,
    github_id   INTEGER UNIQUE,
    dev_login   TEXT UNIQUE,
    login       TEXT NOT NULL,
    name        TEXT,
    avatar_url  TEXT,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    CHECK (github_id IS NOT NULL OR dev_login IS NOT NULL)
);

-- Session tokens are never stored in clear: id = hex(sha256(cookie token)).
CREATE TABLE sessions (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

-- One company per player. The company itself (sim, plan, artifacts) lives in
-- the player's browser; this row is the central identity, the site repo
-- binding and the anchor for leases, events and sync blobs.
CREATE TABLE companies (
    id                TEXT PRIMARY KEY,
    owner_user_id     TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    name              TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
    seed              INTEGER NOT NULL,
    -- `owner/name` of the company's site repo (the content gateway's target).
    site_repo         TEXT NOT NULL,
    site_base_branch  TEXT NOT NULL DEFAULT 'main',
    created_at        INTEGER NOT NULL
);
CREATE INDEX companies_site_repo_idx ON companies (site_repo);

-- The device that currently holds the company (ADR-0038: one active device).
-- At most one row per company; expired rows are taken over in place.
CREATE TABLE company_leases (
    company_id   TEXT PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
    lease_id     TEXT NOT NULL UNIQUE,
    device_id    TEXT NOT NULL CHECK (length(device_id) BETWEEN 1 AND 128),
    acquired_at  INTEGER NOT NULL,
    renewed_at   INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL
);

-- ------------------------------------------------------------ events

-- The offline event inbox (deploy results, webhook outcomes, ...). `seq` is
-- global and monotonic; clients poll with `after=<last seq>`.
CREATE TABLE events (
    seq         INTEGER PRIMARY KEY,
    company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL CHECK (length(kind) BETWEEN 1 AND 64),
    payload     TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload)),
    created_at  INTEGER NOT NULL
);
CREATE INDEX events_company_seq_idx ON events (company_id, seq);

-- ------------------------------------------------------------ content gateway

-- Every draft PR the gateway opened, so merges are limited to the company's
-- own PRs and deploy webhooks map a merged sha back to the content id.
CREATE TABLE gateway_prs (
    company_id   TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    number       INTEGER NOT NULL,
    content_id   TEXT NOT NULL,
    work_item    TEXT,
    path         TEXT NOT NULL,
    branch       TEXT NOT NULL,
    head_sha     TEXT NOT NULL,
    merged_sha   TEXT,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    PRIMARY KEY (company_id, number)
);
CREATE INDEX gateway_prs_merged_idx ON gateway_prs (merged_sha);

-- GitHub webhook dedupe (X-GitHub-Delivery).
CREATE TABLE webhook_deliveries (
    delivery_id  TEXT PRIMARY KEY,
    event        TEXT NOT NULL,
    received_at  INTEGER NOT NULL
);

-- ------------------------------------------------------------ sync

-- Index rows for the company's append-only command-log segments. The bytes
-- are files under SIMPRESS_DATA_DIR; a segment never changes once written.
CREATE TABLE sync_segments (
    company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    segment     INTEGER NOT NULL CHECK (segment >= 0),
    sha256      TEXT NOT NULL,
    size        INTEGER NOT NULL CHECK (size >= 0),
    created_at  INTEGER NOT NULL,
    PRIMARY KEY (company_id, segment)
);

-- The latest snapshot per company (file on disk).
CREATE TABLE sync_snapshots (
    company_id  TEXT PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
    step        INTEGER NOT NULL CHECK (step >= 0),
    sha256      TEXT NOT NULL,
    size        INTEGER NOT NULL CHECK (size >= 0),
    updated_at  INTEGER NOT NULL
);

-- ------------------------------------------------------------ tracker (ADR-0032)

-- One row per publication a company runs. `tracker_key` is public: it is
-- embedded in the site's tracker snippet and is not a secret.
CREATE TABLE projects (
    id              TEXT PRIMARY KEY,
    company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    sim_project_id  TEXT NOT NULL,
    slug            TEXT NOT NULL CHECK (
                        length(slug) BETWEEN 1 AND 63
                        AND slug GLOB '[a-z0-9]*'
                        AND slug NOT GLOB '*[^a-z0-9-]*'),
    name            TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
    -- Registered site host, lowercase, no scheme/port (e.g. cinqueterre.travel).
    domain          TEXT CHECK (domain IS NULL OR (
                        length(domain) BETWEEN 1 AND 253
                        AND domain NOT GLOB '*[^a-z0-9.-]*')),
    repo            TEXT,
    tracker_key     TEXT NOT NULL UNIQUE,
    created_at      INTEGER NOT NULL,
    UNIQUE (company_id, sim_project_id),
    UNIQUE (company_id, slug)
);
CREATE INDEX projects_domain_idx ON projects (domain);

-- Privacy by construction: no IP address and no user-agent column exists
-- anywhere in this schema (a test introspects the schema to keep it so).
-- The current day's salt; deleted once it expires (next UTC midnight).
CREATE TABLE tracker_salts (
    day         TEXT PRIMARY KEY,
    salt        BLOB NOT NULL CHECK (length(salt) = 32),
    expires_at  INTEGER NOT NULL
);

-- Raw events, short retention (SIMPRESS_TRACKER_RAW_RETENTION_DAYS).
CREATE TABLE tracker_events (
    id               INTEGER PRIMARY KEY,
    project_id       TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    ts               INTEGER NOT NULL,
    type             TEXT NOT NULL CHECK (type IN ('pageview', 'engagement', 'scroll', 'outbound')),
    path             TEXT NOT NULL CHECK (length(path) BETWEEN 1 AND 512),
    lang             TEXT NOT NULL DEFAULT '',
    ref_domain       TEXT,
    utm_source       TEXT,
    utm_medium       TEXT,
    utm_campaign     TEXT,
    viewport         TEXT NOT NULL DEFAULT '' CHECK (viewport IN ('', 'mobile', 'tablet', 'desktop')),
    engaged_ms       INTEGER CHECK (engaged_ms IS NULL OR engaged_ms >= 0),
    scroll_pct       INTEGER CHECK (scroll_pct IS NULL OR scroll_pct IN (25, 50, 75, 100)),
    outbound_domain  TEXT,
    visitor_hash     INTEGER NOT NULL,
    session_hash     INTEGER NOT NULL
);
CREATE INDEX tracker_events_project_ts_idx ON tracker_events (project_id, ts);
CREATE INDEX tracker_events_ts_idx ON tracker_events (ts);

-- Rollup: project x day x page x language x source, where `source` is the
-- session's first-touch source (utm_source, else referrer domain, else 'direct').
CREATE TABLE analytics_daily (
    project_id       TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    day              TEXT NOT NULL,
    path             TEXT NOT NULL,
    lang             TEXT NOT NULL,
    source           TEXT NOT NULL,
    sessions         INTEGER NOT NULL,
    visitors         INTEGER NOT NULL,
    pageviews        INTEGER NOT NULL,
    engaged_ms_sum   INTEGER NOT NULL,
    engaged_count    INTEGER NOT NULL,
    scroll_75_count  INTEGER NOT NULL,
    outbound_count   INTEGER NOT NULL,
    PRIMARY KEY (project_id, day, path, lang, source)
);

-- Per project x day totals (distinct sessions/visitors cannot be summed from
-- the per-page rows once raw events are gone).
CREATE TABLE analytics_daily_totals (
    project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    day               TEXT NOT NULL,
    sessions          INTEGER NOT NULL,
    visitors          INTEGER NOT NULL,
    pageviews         INTEGER NOT NULL,
    engaged_sessions  INTEGER NOT NULL,
    engaged_ms_sum    INTEGER NOT NULL,
    PRIMARY KEY (project_id, day)
);

-- Nightly integer signals for the company's sim. `pending` until delivered.
CREATE TABLE analytics_signals (
    project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    day               TEXT NOT NULL,
    sessions          INTEGER NOT NULL,
    visitors          INTEGER NOT NULL,
    pageviews         INTEGER NOT NULL,
    engagement_pm     INTEGER NOT NULL CHECK (engagement_pm BETWEEN 0 AND 1000),
    top_pages_digest  INTEGER NOT NULL,
    status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied')),
    created_at        INTEGER NOT NULL,
    applied_at        INTEGER,
    PRIMARY KEY (project_id, day)
);
CREATE INDEX analytics_signals_status_idx ON analytics_signals (status);
