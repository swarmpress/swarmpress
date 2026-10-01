---
id: FEAT-015
title: "Postgres job queue"
status: planned
importance: critical
paths:
  - "crates/server/src/jobs/**"
  - "crates/server/tests/jobs*.rs"
adrs:
  - ADR-0008
  - ADR-0011
---

# Postgres job queue

Jobs claimed with `SELECT … FOR UPDATE SKIP LOCKED`, leases, attempts with backoff, unique
idempotency keys, priorities and `LISTEN/NOTIFY` wake-ups with a polling fallback.

Decisions: [ADR-0008](../../adr/0008-postgres-only-infrastructure.md), [ADR-0011](../../adr/0011-orchestrator-owns-state-transitions.md).

## Acceptance criteria

- [ ] Lease expiry re-queues; a crashed worker never loses a job.
- [ ] Idempotency key prevents double commits on retry.
- [ ] Poison jobs stop after the retry limit and open a ticket.

## Evidence

- `server/nextest`
