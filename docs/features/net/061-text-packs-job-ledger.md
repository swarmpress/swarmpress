---
id: FEAT-061
title: "Backup completeness: text packs, job ledger and post dedupe"
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
  - apps/game/src/sync/packs.ts
  - apps/game/src/sync/packs.test.ts
  - apps/game/src/orchestration/loop.ts
  - apps/game/src/orchestration/loop.test.ts
  - crates/orchestrator/src/store.rs
  - apps/game/e2e/mvp.spec.ts
adrs:
  - ADR-0046
  - ADR-0045
---

# Backup completeness: text packs, job ledger and post dedupe

Increment A4. Sync carries only the command log and the checkpoint, so a new device or another
executor gets the sim state with empty plan threads, and a job pending at restore fails with an
unknown `brief_ref`.

- **Text packs:** the store's text tables (briefs, artifacts, transcripts, plan items and posts,
  extension tables) gain a `rowver` column. Changed rows are uploaded as immutable
  `text/<gen>/NNNNNN.jsonl` packs; a compaction writes a full base pack under a new generation.
- **Job ledger:** central `job_runs`, keyed by `(company, job_id, fingerprint)`, records claim,
  heartbeat and the outcome with its text bundle. The flow is claim → run → complete → apply to
  the sim. The local `job.outcome.<id>` kv stays as a cache.
- **Post dedupe:** plan posts carry a `dedupe` key (`job_id:n`), so a re-run never double-posts.
- The events cursor and `deploys.pending` travel with the sealed state; `sync.*` and `device.id`
  stay device-local.

Depends on: FEAT-013 (epoch lease), FEAT-012 (head CAS), FEAT-060 (snapshot).

## Acceptance criteria

- [ ] `mvp.spec.ts`: a fresh browser context shows the full plan thread (title and all posts).
- [ ] A fresh context adopts a job whose outcome is in the ledger and re-runs nothing.
- [ ] A late completion from a fenced executor gets 409.
- [ ] Re-running a draft or review adds no duplicate post.
- [ ] Packs resolve by pack order; compaction keeps the restored tables identical.

## Evidence

- `server/nextest`
- `game/vitest`
- `game/playwright-mvp`
