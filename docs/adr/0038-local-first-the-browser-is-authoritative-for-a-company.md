# ADR-0038 — Local-first: the browser is authoritative for a company

**Status:** Accepted (supersedes ADR-0003's server authority, ADR-0008, ADR-0020's server actor;
amends ADR-0025)
**Date:** 2026-10-01

## Context

The product owner wants everything that can live in the player's browser to live there: game
state, the company's data, the local LLM staff and the orchestration. A central service stays
only for what must be shared, secret or trusted. Running an authoritative sim actor and all
company data on a central Postgres server conflicts with that. It also costs operations effort,
and it duplicates what the deterministic sim already gives us.

## Decision

- **The browser is the company's home and authority.**
  - The deterministic sim (sim-core in wasm) runs in the browser.
  - The company's data lives in **DuckDB-wasm persisted to OPFS**: the sim command log and
    snapshots, plan text and threads, briefs and artifacts, transcripts, memories, opinions,
    analytics copies and the director log.
  - The orchestrator runs in the browser too: the `orchestrator` crate compiled to wasm, with
    local LLM staff (ADR-0024).
- **Time away is replayed, not simulated live.** On reopen, the browser fast-forwards the sim
  from its last snapshot to the current wall-clock step. The deterministic **fallback director**
  (ADR-0036) and default ticket answers (organization.md §7) keep the company living through the
  gap. Events that happened centrally while the player was away are merged in step order: deploy
  results, tracker signals, credit grants, webhook outcomes.
- **One active device per company.** Tabs elect a leader with Web Locks (ADR-0025). Across
  devices, a central **lease** decides which device holds the company. The other device gets a
  read-only view from the last synced state.
- **The central service** (ADR-0039) keeps only:
  - accounts and auth;
  - the credits ledger and entitlements (ADR-0033);
  - GitHub App credentials, with a **content gateway** that performs repo operations on the
    browser's behalf under `PathPolicy`;
  - the webhook receiver and an **offline event inbox** per company;
  - the tracker collector and rollups (ADR-0032);
  - leaderboard facts (SiteAudit-verified);
  - **sync and backup**: the company's append-only log plus periodic snapshots, so a lost
    browser, a new device or a cleared cache can restore the company;
  - the web-fetch and Firecrawl proxies (ADR-0040).
- **Secrets never reach the browser.** GitHub writes, paid APIs and credit spending all go
  through central endpoints that authenticate the player and check the company lease.

## Consequences

- The server shrinks a lot. The lockstep WebSocket and per-company actors are retired. A thin
  event channel pushes offline-inbox items and plan or deploy notifications to the active
  device.
- The server's Postgres code paths (plan store, job queue, actors) move. The plan store moves to
  the browser. The browser-job queue becomes in-browser scheduling. The central parts move to
  SQLite (ADR-0039).
- **Trust:** a modified client can fake its own sim. That's fine, because the leaderboard counts
  only centrally verified facts (SiteAudit, merged PRs, tracker), and credits are central.
- **Catch-up cost:** a week away is about 600k steps (60-minute days) of fast-forward. sim-core
  runs about 0.1 µs per step natively; the budget for wasm is under 2 s per week away. That
  needs a benchmark, plus coarse mode (ADR-0020) where necessary.
- **Data durability:** OPFS can be evicted by the browser. The client requests persistent
  storage and syncs the log centrally after every settled day.
