-- First-party analytics tracker (ADR-0032).
--
-- Privacy by construction: no IP address and no user-agent column exists
-- anywhere in this schema (a test introspects information_schema to keep it
-- that way). Visitors are counted with a salted hash whose salt rotates at
-- UTC midnight and is then destroyed.

-- The current day's salt, shared by all server processes. Deleted once it
-- expires (the next UTC midnight), after which yesterday's hashes can no
-- longer be recomputed from (ip, ua).
CREATE TABLE tracker_salts (
    day         DATE PRIMARY KEY,
    salt        BYTEA NOT NULL CHECK (length(salt) = 32),
    expires_at  TIMESTAMPTZ NOT NULL
);

-- Raw events, short retention (SIMPRESS_TRACKER_RAW_RETENTION_DAYS).
CREATE TABLE tracker_events (
    id               BIGSERIAL PRIMARY KEY,
    project_id       UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    ts               TIMESTAMPTZ NOT NULL DEFAULT now(),
    type             TEXT NOT NULL CHECK (type IN ('pageview', 'engagement', 'scroll', 'outbound')),
    path             TEXT NOT NULL CHECK (length(path) BETWEEN 1 AND 512),
    lang             TEXT NOT NULL DEFAULT '',
    ref_domain       TEXT,
    utm_source       TEXT,
    utm_medium       TEXT,
    utm_campaign     TEXT,
    viewport         TEXT NOT NULL DEFAULT '' CHECK (viewport IN ('', 'mobile', 'tablet', 'desktop')),
    engaged_ms       INTEGER CHECK (engaged_ms IS NULL OR engaged_ms >= 0),
    scroll_pct       SMALLINT CHECK (scroll_pct IS NULL OR scroll_pct IN (25, 50, 75, 100)),
    outbound_domain  TEXT,
    visitor_hash     BIGINT NOT NULL,
    session_hash     BIGINT NOT NULL
);
CREATE INDEX tracker_events_project_ts_idx ON tracker_events (project_id, ts);
CREATE INDEX tracker_events_ts_idx ON tracker_events (ts);

-- Hourly rollup: project x day x page x language x source. `source` is the
-- session's first-touch source (utm_source, else referrer domain, else 'direct').
CREATE TABLE analytics_daily (
    project_id       UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    day              DATE NOT NULL,
    path             TEXT NOT NULL,
    lang             TEXT NOT NULL,
    source           TEXT NOT NULL,
    sessions         INTEGER NOT NULL,
    visitors         INTEGER NOT NULL,
    pageviews        INTEGER NOT NULL,
    engaged_ms_sum   BIGINT NOT NULL,
    engaged_count    INTEGER NOT NULL,
    scroll_75_count  INTEGER NOT NULL,
    outbound_count   INTEGER NOT NULL,
    PRIMARY KEY (project_id, day, path, lang, source)
);

-- Per project x day totals (distinct sessions/visitors cannot be summed from
-- the per-page rows once raw events are gone).
CREATE TABLE analytics_daily_totals (
    project_id        UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    day               DATE NOT NULL,
    sessions          INTEGER NOT NULL,
    visitors          INTEGER NOT NULL,
    pageviews         INTEGER NOT NULL,
    engaged_sessions  INTEGER NOT NULL,
    engaged_ms_sum    BIGINT NOT NULL,
    PRIMARY KEY (project_id, day)
);

-- Nightly integer signals for the sim (Cmd::AnalyticsSignals). `pending`
-- until the company actor has injected the command.
CREATE TABLE analytics_signals (
    project_id        UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    day               DATE NOT NULL,
    sessions          INTEGER NOT NULL,
    visitors          INTEGER NOT NULL,
    pageviews         INTEGER NOT NULL,
    engagement_pm     INTEGER NOT NULL CHECK (engagement_pm BETWEEN 0 AND 1000),
    top_pages_digest  BIGINT NOT NULL,
    status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied')),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    applied_at        TIMESTAMPTZ,
    PRIMARY KEY (project_id, day)
);
CREATE INDEX analytics_signals_pending_idx ON analytics_signals (status) WHERE status = 'pending';
