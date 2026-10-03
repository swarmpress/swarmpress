---
id: FEAT-026
title: "Build mode and placement"
status: planned
importance: high
paths:
  - "apps/game/src/build/**"
  - "apps/game/e2e/build*.spec.ts"
adrs:
  - ADR-0003
  - ADR-0065
  - ADR-0005
---

# Build mode and placement

> **ADR-0065:** build mode is the construction kit for players (after the MVP): place, move, turn and
> configure designs on the stud grid; edit designs brick by brick in a design editor (one command
> per committed design); rooms from templates; a sandbox or an economic mode per company. Design:
> [`docs/design/construction-kit.md`](../../design/construction-kit.md) section 6.

Picking on the grid, ghost previews, placement validated in wasm with `validate_command`, confirmed
by the server command.

Decisions: [ADR-0003](../../adr/0003-deterministic-lockstep-server-authority.md), [ADR-0005](../../adr/0005-orthographic-iso-dollhouse-camera-and-cutaway.md).

## Acceptance criteria

- [ ] Placement round-trip in Playwright: place, confirm, reload, still there.
- [ ] Invalid placements show the sim's rejection reason.

## Evidence

- `game/playwright-e2e`
