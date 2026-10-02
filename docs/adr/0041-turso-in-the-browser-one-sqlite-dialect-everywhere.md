# ADR-0041 — Turso in the browser; one SQLite dialect everywhere

**Status:** Accepted (supersedes the DuckDB-wasm part of ADR-0038); amended by ADR-0046
**Date:** 2026-10-01

## Context

ADR-0038 put each company's data in DuckDB-wasm on OPFS, and ADR-0039 put the central service on
SQLite. The product owner asked whether Turso (tursodatabase/turso, an SQLite-compatible engine
rewritten in Rust) should run on both client and server.

The browser workload is transactional, not analytical:
- appending sim command-log segments and snapshots;
- plan items and posts, briefs, artifacts, transcripts;
- small, frequent writes and point reads.

KPI analytics run centrally on the tracker. DuckDB is a columnar OLAP engine: a poor fit for
this workload, and the largest download of the options (`@duckdb/duckdb-wasm` is about 150 MB
unpacked).

The options were checked on 2026-10-01:

| Option | Version | Browser | Download | Notes |
|---|---|---|---|---|
| `@tursodatabase/database-wasm` | 0.8.1 | yes, OPFS | 3.9 MB gzip wasm | pre-1.0; threads need shared memory, so the page must be cross-origin isolated |
| `@sqlite.org/sqlite-wasm` | 3.53.4 | yes, OPFS | about 1 MB | the reference engine; no MVCC |
| `@duckdb/duckdb-wasm` | 1.33 | yes, OPFS | largest | OLAP; a second SQL dialect |
| `@tursodatabase/sync` | 0.8.1 | yes | — | syncs **only with Turso Cloud** |

A spike in headless Chromium (the Playwright build; Vite with COOP `same-origin` and COEP `require-corp`) was successful:
- `connect('swarmpress.db')` on OPFS;
- 1,000 inserts in one transaction plus `json_extract`, in about 1.7 s including the cold wasm
  load;
- after a reload, all rows were still there.

## Decision

- **Browser:** the company store is **Turso wasm (`@tursodatabase/database-wasm`) on OPFS**,
  running in its own worker and replacing DuckDB-wasm. It sits behind the `Store` interface that
  the orchestrator bridge calls (`docs/mvp.md`).
- **Fallback:** `@sqlite.org/sqlite-wasm` (OPFS SAH pool) implements the same `Store` with the
  same SQL and the same migrations. The fallback is chosen when the page is not cross-origin
  isolated, or when Turso fails to open. Both are exercised in the Playwright suite.
- **Server:** stays on SQLite through `sqlx` (ADR-0039). Moving to the `turso` crate (0.8.1)
  later is a driver swap, not a data migration, because the file format and dialect are shared.
  We take it when Turso reaches 1.0, or when the single writer becomes a bottleneck
  (`BEGIN CONCURRENT`/MVCC). The credits ledger is the one place we don't run a pre-1.0 engine.
- **One dialect:** client and server SQL are written in the SQLite subset that both Turso and
  SQLite accept: no extensions, plus JSON1 functions. Tests run the client migrations against
  both engines.
- **Sync:** stays our own: immutable command-log segments plus snapshots
  (`/api/sync/{company}/…`). Turso's sync engine is not used, because it syncs only with Turso
  Cloud, and the deterministic sim already gives an exact, compact replication unit (the
  command log).
- **The game page is cross-origin isolated:** COOP `same-origin` with COEP `credentialless`
  where supported, and `require-corp` otherwise.
  - Isolation also enables multithreaded onnxruntime-web for the local LLMs (ADR-0024).
  - Third-party embeds (the TV and radio of ADR-0035) use `<iframe credentialless>`, or are
    proxied/served with CORP. An embed that can't comply stays disabled, which matches
    `config/media.toml`'s default.

## Consequences

- One SQL dialect, one migration style, and one mental model from browser to server. The server
  can adopt Turso without touching the data.
- A smaller download than DuckDB. Even so, the 3.9 MB Turso wasm is lazy-loaded after the first
  frame and cached.
- **Negative:**
  - Turso is pre-1.0, so we keep the sqlite-wasm fallback and the central sync backups (the
    command log can rebuild the store).
  - Cross-origin isolation constrains embeds and some third-party resources. Safari lacks COEP
    `credentialless`, so it gets `require-corp` or the sqlite-wasm path.
  - Two engines in the test matrix.
- **Alternatives rejected:**
  - DuckDB-wasm: OLAP, a second dialect, size.
  - Turso sync: tied to Turso Cloud.
  - Turso on the server now: pre-1.0 under the credits ledger, and no need at current load.
