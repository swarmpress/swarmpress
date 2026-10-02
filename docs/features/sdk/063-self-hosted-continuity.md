---
id: FEAT-063
title: "Self-hosted continuity runner (swarmpress continue)"
status: planned
importance: high
paths:
  - packages/runner/src/continue.ts
  - packages/runner/src/fs-sync.ts
  - packages/runner/src/wasm.ts
  - packages/runner/src/cli.ts
  - packages/runner/test/continue.test.ts
  - packages/runner/test/cross-host.test.ts
  - crates/server/src/auth.rs
  - crates/server/tests/runner_tokens.rs
  - apps/game/e2e/handover.spec.ts
adrs:
  - ADR-0048
  - ADR-0045
  - ADR-0042
  - ADR-0054
---

# Self-hosted continuity runner

Increment A6. `swarmpress continue` turns the headless runner into an executor: it takes the
company lease as executor kind `self`, restores from sync, works one bounded **shift** (advance
to the first effect, hold the clock while a job runs, stop at 22:00), seals, snapshots and
releases.

- `wasm.ts` exposes the scenario, command and effect exports of `client-wasm`, and the runner
  loads `orchestrator-wasm`.
- The store is in-memory for stateless runs; `FsSyncClient` keeps the backup tree in a directory
  the player can push to their own git remote.
- Auth is a bearer **runner token** (`runner_tokens`, hash stored; the `CurrentUser` extractor
  accepts `Authorization: Bearer`).
- The LLM is the player's own key in their own environment (ADR-0054). No billing is involved.
- A run is capped by wall time, job count and steps.

It ships before managed runs (FEAT-065) because it exercises the whole protocol without billing
or scheduling. A company that used it is in the continuity league (FEAT-049).

Depends on: FEAT-013, FEAT-012, FEAT-060, FEAT-061, FEAT-062.

## Acceptance criteria

- [ ] Cross-host golden: a browser log, then a runner shift, then a browser restore that verifies
      the hash.
- [ ] Handover e2e both ways: the browser requests the lease during a run and the runner seals
      and releases; the runner never forces a live browser lease.
- [ ] A revoked or wrong-company runner token is rejected.
- [ ] Extensions run only in the sandbox during a shift (rule 14).

## Evidence

- `runner/bun-test`
- `server/nextest`
- `game/playwright-mvp`
