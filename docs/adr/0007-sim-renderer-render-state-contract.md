# ADR-0007 — Sim→renderer render-state contract

**Status:** Accepted
**Date:** 2026-10-01

## Context

The renderer runs at display rate (60 to 144 Hz) in TypeScript. The sim runs at 10 Hz in wasm.
Without a clear boundary, gameplay logic leaks into the renderer, and then it can't be tested
deterministically, can't be replayed, and drifts between clients. For example: "turn the lamp on
after 17:00", "walk to the desk", "choose who talks".

Crossing the wasm boundary is also expensive if it is done per entity and per frame.

## Decision

- `sim-core` exposes `render_state()`. `client-wasm` serialises it as **postcard bytes plus a flat
  `Float32Array`/`Int32Array` position buffer** for staff, which avoids per-entity calls.
- The contract contains only what the renderer must draw:
  - **Clock:** step, day, minute, phase, sun elevation and azimuth, sky tint, weather.
  - **Rooms:** light (Off/Dim/On), occupancy, alerts (Crunch, Blocked).
  - **Devices:** state (Off/On/InUse) and screen mode (Idle/Typing/Review/Code/Screenshot/Error).
  - **Staff:**
    - position, plus path with start step and speed;
    - facing;
    - pose: Walk, Sit, Type, Talk, Listen, Think, Present, Sleep, Celebrate or Frustrated;
    - activity label;
    - fatigue and morale bands.
  - **Bubbles:** by reference (meeting id and seq), never the text itself.
  - **Props:** mood-board texture ids, whiteboard content ids, pinned screenshots.
  - **HUD:** cash, reputation, audience, inbox count.
- **Paths are computed in the sim** (A* on the room grid). The renderer only interpolates along
  the path between ticks, using `start_step`, `speed` and the current fractional step.
- The renderer is a pure function `apply(scene, prev, next, alpha)`, plus diffing, so unchanged
  rooms are not touched.
- Until the M1 sim systems land, `apps/game/src/state/render-state.ts` provides a typed TS mirror
  and a `demoRenderState(minute, day)` stand-in.

Alternatives considered:

- **The renderer queries the sim per entity through wasm-bindgen getters.** Rejected. Thousands of
  boundary crossings per frame.
- **JSON over the boundary.** Rejected. Slow to parse every tick, and it allocates.
- **Shared memory with direct struct views.** Deferred. It is fastest, but couples TS to Rust
  memory layout. The flat position buffer already covers the hot path.

## Consequences

- Positive: the renderer is testable from a render-state fixture alone, using NullEngine and
  vitest, and visual baselines can be produced at any frozen sim time.
- Positive: two clients render identically, because they draw the same state.
- Negative: every new visual fact needs a contract change in Rust, the TS mirror and the decoder.
  The contract is versioned with `protocol::PROTO_VERSION`.
- Negative: animation nuance (gesture timing) has to be derived from coarse sim poses on the
  client side, deterministically, from the step number.
