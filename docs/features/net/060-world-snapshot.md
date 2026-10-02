---
id: FEAT-060
title: "World snapshot and pending-job re-issue"
status: planned
importance: critical
paths:
  - crates/sim-core/src/world.rs
  - crates/sim-core/src/plan.rs
  - crates/sim-core/tests/snapshot.rs
  - crates/client-wasm/src/lib.rs
  - crates/client-wasm/tests/snapshot_wasm.rs
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

Increment A3. Today a "checkpoint" is `{scenario, seed, step, hash, lastSeq}` and every restore,
even a reload, replays the command log from the seed. The cost grows with the company's age.

This feature adds a real snapshot:
- `Sim.snapshot()` returns the postcard-encoded `World` with a small header (format, sim build,
  `SimConfig`, step, hash).
- `Sim.from_snapshot(bytes)` rebuilds the world and verifies the hash on load. A mismatch or an
  unknown sim build is an error, never a silent fallback.
- `reissue_pending_jobs()` re-emits `Effect::RequestJob` for jobs the sim still waits on, because
  `World.effects` is not serialised.
- `restore()` loads the newest snapshot and replays only the commands after it. Replay from the
  seed stays as the fallback and as the audit path.

Depends on: nothing. FEAT-061, FEAT-063 and FEAT-065 depend on it.

## Acceptance criteria

- [ ] Golden: snapshot → restore → N steps gives the same hash as an uninterrupted run, natively,
      under wasm-bindgen-test and under Bun.
- [ ] A restored world re-issues exactly the jobs that were pending, with the same job ids.
- [ ] A snapshot with a wrong hash or another sim build is refused.
- [ ] Restore time is bounded by the commands after the snapshot (benchmark), not by history.
- [ ] `mvp.spec.ts`: reload and fresh-context restores start from a snapshot.

## Evidence

- `swarmpress/nextest`
- `swarmpress/wasm-bindgen-test`
- `game/vitest`
- `game/playwright-mvp`
