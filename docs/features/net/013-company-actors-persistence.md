---
id: FEAT-013
title: "Company actors, command log and snapshots"
status: planned
importance: critical
paths:
  - "crates/server/src/actors/**"
  - "crates/server/src/persistence/**"
  - "crates/server/migrations/**"
adrs:
  - ADR-0003
  - ADR-0008
---

# Company actors, command log and snapshots

One tokio actor per company owns the authoritative `World`, appends commands to an event-sourced log
in Postgres and writes daily snapshots (00:00) with a sim version.

Decisions: [ADR-0003](../../adr/0003-deterministic-lockstep-server-authority.md), [ADR-0008](../../adr/0008-postgres-only-infrastructure.md).

## Acceptance criteria

- [ ] Restart restores every company to the same hash from snapshot + log (`sqlx::test`).
- [ ] Actor tests run under `tokio::time::pause` with deterministic timing.
- [ ] Snapshots from an older sim version are re-derived by replay or rejected loudly.

## Evidence

- `server/nextest`
