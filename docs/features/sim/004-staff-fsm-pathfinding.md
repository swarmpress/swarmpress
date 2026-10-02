---
id: FEAT-004
title: "Staff FSM and pathfinding"
status: planned
importance: critical
paths:
  - crates/sim-core/src/staff.rs
  - "crates/sim-core/src/staff/**"
  - crates/sim-core/src/pathfinding.rs
  - "crates/sim-core/benches/pathfinding*.rs"
  - "crates/sim-core/tests/staff*.rs"
adrs:
  - ADR-0003
  - ADR-0007
---

# Staff FSM and pathfinding

> **Status note (2026-10-02):** The code exists (`crates/sim-core/src/staff.rs`, `pathfinding.rs`, movement in `world.rs`) and the render state carries poses and paths; the status lags because no test file is linked to this feature yet.

Staff with persona, role, seniority, traits (rigor, speed, creativity, sociability, resilience,
ambition), skills, morale, fatigue, salary, home desk, assignment, activity, position and path. A
behaviour FSM driven by day phase and assignment (arrive, sit, work, meet, lunch, overtime, leave)
and integer A* on the room grid with doors. The renderer only interpolates the sim path.

Decisions: [ADR-0003](../../adr/0003-deterministic-lockstep-server-authority.md), [ADR-0007](../../adr/0007-sim-renderer-render-state-contract.md).

## Acceptance criteria

- [ ] A* returns the same path for the same grid on every platform and never passes through walls (proptest).
- [ ] Staff FSM follows the documented phase schedule; overtime only under the company's overtime policy.
- [ ] Poses (Walk, Sit, Type, Talk, Listen, Think, Present, Sleep, Celebrate, Frustrated) are emitted into render state.
- [ ] criterion pathfinding benchmark under budget for a 2-floor building.

## Evidence

- `swarmpress/nextest`
- `swarmpress/criterion`
