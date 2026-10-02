-- Executors, lease epochs and fencing (ADR-0045).
--
-- One coordinator row per company replaces `company_leases`. The row is
-- created by the first lease and never deleted: `epoch` is monotonic and is
-- never reset, so a release only clears the holder columns.
--
-- Plain SQLite subset (ADR-0041): integers are unix milliseconds.

CREATE TABLE company_executors (
    company_id         TEXT PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
    -- Rises by one on every change of holder; never on a renew.
    epoch              INTEGER NOT NULL DEFAULT 0 CHECK (epoch >= 0),
    -- The current holder; all NULL while the lease is released.
    holder_kind        TEXT CHECK (holder_kind IN ('browser', 'self', 'cloud')),
    holder_id          TEXT CHECK (holder_id IS NULL OR length(holder_id) BETWEEN 1 AND 128),
    lease_id           TEXT UNIQUE,
    acquired_at        INTEGER,
    renewed_at         INTEGER,
    -- Liveness only: an expired lease does not make anyone else the holder.
    expires_at         INTEGER,
    -- The sealed head of the company's history: the number of its last entry
    -- and that entry's digest (0 and NULL before anything was sealed). The
    -- compare-and-swap target of fenced writes; nothing moves it yet.
    head_number        INTEGER NOT NULL DEFAULT 0 CHECK (head_number >= 0),
    head_digest        TEXT,
    events_cursor      INTEGER NOT NULL DEFAULT 0,
    -- A pending graceful handover: who asked, and until when.
    handover_by        TEXT,
    handover_deadline  INTEGER,
    -- Continuity scheduling (ADR-0048); unused until the coordinator exists.
    next_wake_at       INTEGER,
    wake_reason        TEXT,
    active_run_id      TEXT
);

INSERT INTO company_executors
    (company_id, epoch, holder_kind, holder_id, lease_id, acquired_at, renewed_at, expires_at)
SELECT company_id, 1, 'browser', device_id, lease_id, acquired_at, renewed_at, expires_at
FROM company_leases;

DROP TABLE company_leases;
