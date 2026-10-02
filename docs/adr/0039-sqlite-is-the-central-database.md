# ADR-0039 — SQLite is the central database

**Status:** Accepted (supersedes ADR-0008); amended by ADR-0046, ADR-0049
**Date:** 2026-10-01

## Context

With local-first companies (ADR-0038), the central service holds a small, well-defined dataset:
- accounts and sessions;
- the credits ledger and entitlements;
- projects, tracker keys and GitHub installation links;
- the offline event inbox, webhook deliveries and company leases;
- tracker raw events and rollups;
- leaderboard facts;
- sync blobs (company logs and snapshots).

The product owner questioned running Postgres at all.

## Decision

- The central service uses **SQLite** (WAL mode) embedded in the Rust server binary, through
  `sqlx`'s sqlite driver with runtime-checked queries. Migrations live in
  `crates/server/migrations-sqlite/`.
- **Large blobs** (company log segments and snapshots) are files on disk, or object storage later.
  SQLite stores the index rows that point to them.
- **Concurrency:**
  - one writer connection with a queued write path;
  - readers in parallel;
  - credits-ledger mutations in `BEGIN IMMEDIATE` transactions, with SQL checks (Σ entries = 0,
    no negative balance) and idempotency keys;
  - Postgres's `SKIP LOCKED`/`LISTEN/NOTIFY` replaced by in-process queues and notifications (one
    server process).
- **Backup:** Litestream (or periodic `VACUUM INTO`) to object storage.
- Storage sits behind repository traits. If scale demands it, Postgres can return later without
  touching the callers.

## Consequences

- Zero-ops central DB, single binary, trivially reproducible in tests: an in-memory or temp-file
  database per test, so the Postgres test cluster is no longer needed.
- Running one server process is a constraint. That's fine for MVP and early scale; scaling out
  later means sharding by company, or Postgres.
- Postgres-specific SQL in the merged server crate is ported to SQLite: JSONB becomes JSON text,
  UUID becomes TEXT, BIGSERIAL becomes INTEGER PRIMARY KEY, and the trigger syntax changes. Tests
  are ported with it.
