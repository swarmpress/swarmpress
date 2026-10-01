# ADR-0008 — Postgres as the only infrastructure (state, queue, notify)

**Status:** Accepted
**Date:** 2026-10-01

## Context

The legacy stack ran Postgres, Temporal, NATS + JetStream, an outbox worker and an event-trigger
service. Most of its runtime bugs lived in the seams between them:
- outbox draining;
- JetStream not being initialised when a worker started;
- workflow determinism;
- non-unique workflow ids.

SimPress needs four kinds of storage and delivery:
- durable state (companies, command logs, snapshots, transcripts, tickets, `llm_calls`);
- a job queue with leases and retries (LLM jobs, GitHub operations, SiteAudits);
- wake-ups (a new job, a finished job, a webhook);
- per-company sequencing.

The last of these is already provided by the in-process company actor.

## Decision

Postgres is the only infrastructure dependency (`docker-compose.yml` runs only Postgres).

- **State.** sqlx with compile-time-checked queries. Migrations live in
  `crates/server/migrations/` and are applied at start-up.
- **Job queue.** A `jobs` table, claimed with
  `SELECT … FOR UPDATE SKIP LOCKED`. Each job has:
  - a `lease_until` deadline;
  - an `attempts` count with exponential backoff;
  - an `idempotency_key` (unique) so retries never double-commit;
  - a `priority`.
- **Wake-ups.** `LISTEN/NOTIFY` on `jobs_ready` and `company_<id>`. Polling every 5 s is the
  fallback, so a lost notify never stalls work.
- **Workflows** are Rust state machines in the sim and in `agents`
  ([ADR-0011](0011-orchestrator-owns-state-transitions.md)). Durable progress is the command log
  plus the job table, not a workflow engine.
- Large blobs (meeting transcripts, LLM request and response bodies) are compressed in Postgres
  `bytea`, or in object storage later if needed. Content itself lives in the site repo
  ([ADR-0009](0009-site-repo-canonical-github-app.md)).

Alternatives considered:

- **Temporal.** Rejected. Proven heavy and fragile in the legacy stack, and redundant once the sim
  owns the state machines.
- **NATS, Redis or another queue broker.** Rejected. Another service to run, monitor and keep
  consistent with Postgres. `SKIP LOCKED` comfortably handles our throughput (well under 100 jobs
  per second).
- **An in-memory queue.** Rejected. Jobs must survive restarts, because LLM jobs take minutes.

## Consequences

- Positive: one service to operate, back up and test (`sqlx::test` gives each test a real,
  isolated database).
- Positive: transitions and the jobs they request commit in one transaction. That rules out
  outbox divergence.
- Negative: Postgres becomes the scaling bottleneck. One instance is sized for thousands of
  companies, and sharding by company id is the escape hatch.
- Negative: we own the queue semantics (lease expiry, poison jobs, dedupe). They are covered by
  dedicated server tests.
