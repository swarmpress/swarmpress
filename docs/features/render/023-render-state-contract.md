---
id: FEAT-023
title: "Render-state contract"
status: in-progress
importance: critical
paths:
  - apps/game/src/state/render-state.ts
  - apps/game/src/state/render-state.test.ts
  - crates/sim-core/src/render_state.rs
  - crates/client-wasm/src/render.rs
adrs:
  - ADR-0007
---

# Render-state contract

The sim → renderer contract: clock, rooms, devices, staff (position, path, pose, activity, bands),
bubbles by reference, props and HUD. postcard bytes plus a flat position buffer from wasm. Exists
today: the typed TS mirror and the `demoRenderState` stand-in with tests.

Decisions: [ADR-0007](../../adr/0007-sim-renderer-render-state-contract.md).

## Acceptance criteria

- [ ] Demo stand-in fills the office in the morning, empties at 18:00, keeps editorial lit late (vitest).
- [ ] Rust `render_state()` and the TS decoder agree on shared fixtures.
- [ ] Staff positions come only from sim paths; the renderer only interpolates.

## Evidence

- `game/vitest` (`render-state.test.ts`)
- `simpress/nextest`
