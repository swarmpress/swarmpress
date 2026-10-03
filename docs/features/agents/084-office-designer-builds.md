---
id: FEAT-084
title: "The office designer: staff build with the construction kit"
status: planned
importance: normal
paths:
  - "crates/kit/src/solver/**"
  - "crates/agents/src/build/**"
  - "crates/agents/prompts/office_designer.md"
  - "crates/orchestrator/src/build.rs"
adrs:
  - ADR-0065
  - ADR-0057
  - ADR-0058
  - ADR-0059
---

# The office designer: staff build with the construction kit

After the MVP. An office designer on the staff plans and builds rooms with the browser model: the
model places designs by relation to anchors (walls, windows, doors, other placements) and a
deterministic layout solver computes positions; each call sees only the slice of the catalogue that
fits the room and brief, with generated docs; deterministic checks (collisions, walkability, door
clearance, light at workstations, requirements, cost) return issues for a repair loop. The build is a
staged job (brief, layout, solve, fix, decor, rarely a new design, preview); in economic mode a Build
Approval ticket follows, and a construction job places the objects while the renderer animates the
bricks in build order.

Design: [`docs/design/construction-kit.md`](../../design/construction-kit.md) section 7 (increment K-6).

Depends on: FEAT-083 (kit core), the sim capability change (K-4), FEAT-032 (staged jobs), FEAT-079
(approval tickets).

## Acceptance criteria

- [ ] A meeting-room brief yields a valid layout meeting the room's requirements within the repair
      limits, on the fake model and in the eval on the real model.
- [ ] Unknown design or colour ids come back to the model as validation errors.
- [ ] In economic mode nothing is placed before the CEO approves; in sandbox mode it is immediate.
- [ ] Construction animates over the job's game time and ends with the sim's objects in place.

## Evidence

- `agents/nextest`
- `game/vitest`
