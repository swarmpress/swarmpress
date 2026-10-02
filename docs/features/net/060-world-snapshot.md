---
id: FEAT-060
title: "World snapshot and pending-job re-issue"
status: in-progress
importance: critical
paths:
  - crates/sim-core/src/snapshot.rs
  - crates/sim-core/src/plan.rs
  - crates/sim-core/tests/snapshot.rs
  - crates/sim-core/benches/restore.rs
  - crates/client-wasm/src/lib.rs
  - crates/client-wasm/tests/snapshot_wasm.rs
  - packages/runner/test/snapshot.test.ts
  - apps/game/src/catchup/replay.ts
  - apps/game/src/catchup/replay.test.ts
  - apps/game/src/sync/segments.ts
  - apps/game/src/sync/segments.test.ts
  - apps/game/e2e/mvp.spec.ts
adrs:
  - ADR-0046
  - ADR-0038
---

# World snapshot and pending-job re-issue

Increment A3. Before it a "checkpoint" was `{scenario, seed, step, hash, lastSeq}` and every
restore, even a reload, replayed the command log from the seed, so the cost grew with the
company's age.

This feature adds a real snapshot:
- `Sim.snapshot()` returns the postcard-encoded `World` behind a 42-byte header (magic, snapshot
  format, world format, `SimConfig`, step, hash). Layout: `docs/architecture/sim.md`, "Snapshots".
- `Sim.from_snapshot(bytes)` rebuilds the world and verifies the hash on load. A mismatch or an
  unknown sim build is an error, never a silent fallback.
- `reissue_pending_jobs()` re-emits `Effect::RequestJob` for jobs the sim still waits on, because
  `World.effects` is not serialised. The request is rebuilt from state the world already holds
  (work item, phase, meeting), so the world's encoding and the golden hashes did not change.
- The browser stores and uploads a `swarmpress.snapshot.v1` record: the checkpoint fields plus the
  world bytes. `restoreSim` loads the newest snapshot and replays only the commands after it.
  Replay from the seed stays as the path for records without a world and as the audit path
  (`?restore=replay`).

What exists:
- `crates/sim-core/src/snapshot.rs`, `World::reissue_pending_jobs` in `plan.rs`, the four
  `client-wasm` exports, the record format in `sync/segments.ts`, `restoreSim` in
  `catchup/replay.ts`, and the session's restore and checkpoints.
- The sim build a snapshot belongs to is `sim_core::snapshot::WORLD_FORMAT`. It must be bumped
  whenever the golden hash moves; a test fails until it is and says what to update.

Still to do:
- A fresh device still downloads every log segment before it restores from the snapshot; reading
  only the tail needs the head compare-and-swap of FEAT-012 (increment A2).
- Keeping several snapshots centrally (ADR-0046: the last three plus one per week); the server
  holds one.
- The snapshot is the world-snapshot half of a base (ADR-0056). The text and record parts are
  FEAT-061.

Depends on: nothing. FEAT-061, FEAT-063 and FEAT-065 depend on it.

## Acceptance criteria

- [ ] Golden: snapshot → restore → N steps gives the same hash as an uninterrupted run, natively,
      under wasm-bindgen-test and under Bun.
- [ ] A restored world re-issues exactly the jobs that were pending, with the same job ids.
- [ ] A snapshot with a wrong hash or another sim build is refused.
- [ ] Restore time is bounded by the commands after the snapshot (benchmark), not by history.
- [ ] `mvp.spec.ts`: reload and fresh-context restores start from a snapshot.

## Evidence

- `swarmpress/nextest` (`crates/sim-core/tests/snapshot.rs`)
- `net/nextest` and `swarmpress/wasm-bindgen-test` (`crates/client-wasm/tests/snapshot_wasm.rs`)
- `runner/bun-test` (`packages/runner/test/snapshot.test.ts`)
- `game/vitest` (`replay.test.ts`, `segments.test.ts`)
- `swarmpress/criterion` (`crates/sim-core/benches/restore.rs`)
- `game/playwright-mvp`
