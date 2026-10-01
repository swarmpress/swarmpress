---
id: FEAT-020
title: "Office scene construction"
status: in-progress
importance: high
paths:
  - apps/game/src/render/office.ts
  - apps/game/src/render/scene.ts
  - apps/game/src/render/scene.test.ts
adrs:
  - ADR-0004
  - ADR-0006
  - ADR-0017
---

# Office scene construction

Builds the building from a layout: floors, walls with window openings, desks with monitors and
lamps, ceiling light panels and per-room scoped lights. Today the geometry is procedural
(placeholder); M9 swaps in baked glTF room modules from the asset pipeline. Tested headless with
Babylon `NullEngine`.

Decisions: [ADR-0004](../../adr/0004-babylonjs-webgpu-webgl2-fallback.md), [ADR-0006](../../adr/0006-baked-gi-dynamic-lights-day-night.md), [ADR-0017](../../adr/0017-asset-pipeline-cc0-blender-gltf.md).

## Acceptance criteria

- [ ] NullEngine test builds the demo building with the expected rooms, desks and lights.
- [ ] Every room light uses `includedOnlyMeshes` scoped to its room; per-room light budget asserted.
- [ ] Swapping procedural for glTF modules keeps the same handle API (`OfficeHandles`).

## Evidence

- `game/vitest` (`scene.test.ts`)
