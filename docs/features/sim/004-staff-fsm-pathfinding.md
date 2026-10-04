---
id: FEAT-004
title: "Staff FSM and pathfinding"
status: in-progress
importance: critical
paths:
  - crates/sim-core/src/staff.rs
  - crates/sim-core/src/pathfinding.rs
  - "crates/sim-core/benches/pathfinding*.rs"
  - crates/sim-core/tests/invariants.rs
adrs:
  - ADR-0003
  - ADR-0007
---

# Staff FSM and pathfinding

> **Status note (2026-10-04):** Built and tested. The FSM and schedules are in
> `crates/sim-core/src/staff.rs`, A* in `pathfinding.rs` (unit tests in both), the decision and
> movement in `world.rs`. The property tests (`tests/invariants.rs`: nobody inside a wall, nobody
> without a path) and `office_runs_a_normal_day` (mapped in `docs/test-map.yaml`) cover the
> feature. There is no pathfinding benchmark yet (`benches/pathfinding*.rs` is still to come; the
> step benchmark includes walking).

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
