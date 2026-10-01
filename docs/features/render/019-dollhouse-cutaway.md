---
id: FEAT-019
title: "Dollhouse cutaway"
status: in-progress
importance: high
paths:
  - apps/game/src/render/cutaway.ts
  - apps/game/src/render/cutaway.test.ts
adrs:
  - ADR-0005
---

# Dollhouse cutaway

Walls whose outward normal faces the camera are hidden (faded on high quality); interior walls per
face; floor cut-away for multi-storey buildings.

Decisions: [ADR-0005](../../adr/0005-orthographic-iso-dollhouse-camera-and-cutaway.md).

## Acceptance criteria

- [ ] For each of the four camera angles exactly the two camera-facing exterior sides are cut away (vitest).
- [ ] Floor cut-away hides upper floors and their lights.
- [ ] Visual baselines per angle.

## Evidence

- `game/vitest` (`cutaway.test.ts`)
- `game/playwright-visual`
