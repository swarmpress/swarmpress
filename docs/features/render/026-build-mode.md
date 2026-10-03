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
  - ADR-0005
---

# Build mode and placement

> **ADR-0063:** placement happens on the brick office's stud grid at object level (whole prefabs); brick-by-brick editing is deferred.

Picking on the grid, ghost previews, placement validated in wasm with `validate_command`, confirmed
by the server command.

Decisions: [ADR-0003](../../adr/0003-deterministic-lockstep-server-authority.md), [ADR-0005](../../adr/0005-orthographic-iso-dollhouse-camera-and-cutaway.md).

## Acceptance criteria

- [ ] Placement round-trip in Playwright: place, confirm, reload, still there.
- [ ] Invalid placements show the sim's rejection reason.

## Evidence

- `game/playwright-e2e`
