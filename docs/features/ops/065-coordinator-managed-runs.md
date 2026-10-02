---
id: FEAT-065
title: "Company coordinator and managed continuity runs"
status: planned
importance: high
paths:
  - crates/server/src/coordinator.rs
  - crates/server/src/db/coordinator.rs
  - crates/server/tests/coordinator.rs
  - crates/server/src/app.rs
adrs:
  - ADR-0048
  - ADR-0049
  - ADR-0045
  - ADR-0052
---

# Company coordinator and managed continuity runs

Increment A8. The coordinator is the `company_executors` row (current executor, lease expiry,
epoch, `next_wake_at`, `active_run_id`) plus one tokio task in the existing server process. There
is no external queue (ADR-0049).

- The task scans `next_wake_at <= now`; `events::publish` sets a wake for the company.
- A wake spawns `swarmpress continue` as executor kind `cloud` under a semaphore, with a per-run
  token scoped to the company and the run. Containers are a later host for the same command.
- The run is a spend request whose hold bounds it, inside the player's **mandate** (total cap,
  per-job cap, categories, expiry). It is also capped by wall time, job count and steps.
- Pacing is "at most K game days per real day and C credits". On any cap the run seals, sets the
  next wake and releases.
- The cloud never forces a live browser lease. A browser that returns sends `request` and the
  run finishes its job, seals and releases.

Depends on: FEAT-063, FEAT-064, FEAT-069, FEAT-070.

## Acceptance criteria

- [ ] With a manual clock: a due wake spawns exactly one run; a second wake while a run is active
      does not.
- [ ] Each bound (wall time, jobs, steps, hold) stops the run with a sealed log and a next wake.
- [ ] No mandate, an expired mandate or an empty balance spawns nothing.
- [ ] An over-threshold spend request during a run defaults to Reject and the work waits.

## Evidence

- `server/nextest`
