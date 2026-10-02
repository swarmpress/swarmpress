---
id: FEAT-061
title: "Backup completeness: work records, the projection and the job ledger"
status: planned
importance: critical
paths:
  - crates/server/src/jobs.rs
  - crates/server/src/db/jobs.rs
  - crates/server/tests/jobs.rs
  - crates/server/src/sync.rs
  - crates/server/src/db/sync.rs
  - apps/game/src/store/schema.ts
  - apps/game/src/store/company-store.ts
  - apps/game/src/store/company-store.test.ts
  - apps/game/src/sync/records.ts
  - apps/game/src/sync/records.test.ts
  - apps/game/src/store/projection.ts
  - apps/game/src/store/projection.test.ts
  - apps/game/src/store/contract.test.ts
  - apps/game/src/orchestration/loop.ts
  - apps/game/src/orchestration/loop.test.ts
  - crates/orchestrator/src/store.rs
  - apps/game/e2e/mvp.spec.ts
adrs:
  - ADR-0056
  - ADR-0046
  - ADR-0045
---

# Backup completeness: work records, the projection and the job ledger

Increment A4. Sync carries only the command log and the checkpoint, so a new device or another
executor gets the sim state with empty plan threads, and a job pending at restore fails with an
unknown `brief_ref`. Nothing durable says which staff member, job or model produced a change.

- **Work records (ADR-0056):** one record per completed job, and one per batch of commands that
  belong to no job. A record holds the commands, the text records the job wrote (briefs, the
  artifact, plan posts, plan item text, transcript, extension rows), the attribution (staff
  member, job, model, executor epoch), the world hash and its parent's digest. It is committed
  in one local transaction when the job's outcome is logged.
- **Projection:** `plan_items`, `plan_posts`, `briefs`, `artifacts`, `transcripts` and extension
  tables are rebuilt from the record chain. A job's writes are pending text until it commits.
- **Write-once tree:** segments of records, bases (world snapshot plus projection rows) and
  points; SHA-256 digests with a domain prefix over the stored bytes.
- **Job ledger:** central `job_runs`, keyed by `(company, job_id, fingerprint)`, records claim,
  heartbeat and the outcome with its text. The flow is claim → run → complete → commit the
  record. The local `job.outcome.<id>` kv stays as a cache. A job id commits at most once, which
  replaces the post dedupe key.
- **Store contract:** one conformance suite runs against the in-memory driver as oracle and
  against sqlite-wasm, Turso and the runner's store.
- The events cursor and `deploys.pending` travel in the point; `sync.*` and `device.id` stay
  device-local.

Depends on: FEAT-013 (epoch lease), FEAT-012 (head CAS), FEAT-060 (snapshot).

## Acceptance criteria

- [ ] `mvp.spec.ts`: a fresh browser context shows the full plan thread (title and all posts).
- [ ] Every logged command belongs to exactly one record, and each record verifies against its
      digest and its parent.
- [ ] The projection rebuilt from the chain equals the live tables.
- [ ] A fresh context adopts a job whose outcome is in the ledger and re-runs nothing.
- [ ] A late completion from a fenced executor gets 409.
- [ ] Re-running a draft or review commits no second record and adds no duplicate post.
- [ ] The store contract suite passes on every engine.

## Evidence

- `server/nextest`
- `game/vitest`
- `game/playwright-mvp`
