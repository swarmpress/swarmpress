---
id: FEAT-020
title: "Office scene construction"
status: in-progress
importance: high
paths:
  - apps/game/src/render/office.ts
  - apps/game/src/render/walls.ts
  - apps/game/src/render/walls.test.ts
  - apps/game/src/render/room-names.ts
  - apps/game/src/render/scene.ts
  - apps/game/src/render/scene.test.ts
adrs:
  - ADR-0004
  - ADR-0006
  - ADR-0017
---

# Office scene construction

Builds the building from the sim's layout (`Sim.layout_json()`): room floors, the hallway floor
between the rooms (the lot minus the rooms) and the street at the entrance; exterior walls with
the layout's windows and the entrance; interior partitions on the room sides, open exactly at the
layout's doors (`walls.ts`); desks with monitors, lamps and chairs; a round table with stools in
the rooms where the sim seats people around the centre (meeting room, strategy room, kitchen);
the layout's props (whiteboards, archive shelves, the coffee machine on its counter, plants, the
camera rig, the mood-board wall); ceiling light panels and per-room scoped lights; each room's
name painted on its floor along the side away from the camera (`room-names.ts`). Today the
geometry is procedural (placeholder); M9 swaps in baked glTF room modules from the asset
pipeline. Tested headless with Babylon `NullEngine`, on the hand-written demo building and on the
real layout recorded from the wasm sim.

Decisions: [ADR-0004](../../adr/0004-babylonjs-webgpu-webgl2-fallback.md), [ADR-0006](../../adr/0006-baked-gi-dynamic-lights-day-night.md), [ADR-0017](../../adr/0017-asset-pipeline-cc0-blender-gltf.md).

## Acceptance criteria

- [ ] NullEngine test builds the demo building with the expected rooms, desks and lights.
- [ ] Every room light uses `includedOnlyMeshes` scoped to its room; per-room light budget asserted.
- [ ] Door gaps are where the layout's doors are, and nowhere else (vitest on the real layout).
- [ ] Swapping procedural for glTF modules keeps the same handle API (`OfficeHandles`).

## Evidence

- `game/vitest` (`scene.test.ts`, `walls.test.ts`)
- `game/playwright-visual`
