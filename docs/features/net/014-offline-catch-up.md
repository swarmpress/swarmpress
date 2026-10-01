---
id: FEAT-014
title: "Offline catch-up and fast-forward"
status: planned
importance: high
paths:
  - crates/server/src/actors/fast_forward.rs
  - "crates/server/tests/catch_up*.rs"
  - crates/server/src/bin/loadtest.rs
adrs:
  - ADR-0020
---

# Offline catch-up and fast-forward

Idle companies are woken at their next scheduled event and fast-forwarded in whole-step batches with
the same deterministic `tick()`; ticket defaults apply at deadlines.

Decisions: [ADR-0020](../../adr/0020-real-time-ticks-offline-catch-up.md).

## Acceptance criteria

- [ ] Fast-forwarded and real-time-stepped companies reach the same hash.
- [ ] Load test: 200 companies × 1 simulated hour within the per-core budget (`cockpit.benchmark.v1`).

## Evidence

- `server/nextest`
- `bench/server-load`
