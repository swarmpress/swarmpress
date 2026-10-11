---
id: FEAT-081
title: "Brick office renderer (every room, the floors and the people in bricks)"
status: in-progress
importance: high
paths:
  - "apps/game/src/render/bricks/**"
  - apps/game/e2e/bricks.spec.ts
  - apps/game/e2e/bricks-bench.spec.ts
  - apps/game/src/llm/bench/bricks-report.ts
  - apps/game/src/llm/bench/bricks-report.test.ts
  - apps/game/src/render/office.ts
  - apps/game/src/render/scene.ts
  - apps/game/src/render/characters/rig.ts
  - apps/game/e2e/visual.spec.ts
  - "docs/qualification/*brick*"
adrs:
  - ADR-0085
  - ADR-0063
  - ADR-0065
  - ADR-0064
  - ADR-0005
  - ADR-0007
  - ADR-0027
---

# Brick office renderer

The office drawn in bricks, generated from the sim's layout: a voxel grid per room chunk, the
prototype's brick splitter (overlapping rows, studs only where visible), one thin-instanced mesh per
colour per chunk, brick prefabs for the layout's props, deterministic by room id. Three levels of
detail per chunk, the cutaway and culling; the GPU scheduler lowers the scene while the model
generates. People keep the FEAT-024 rig, restyled in bricks with their own design.

Design: [`docs/design/brick-office.md`](../../design/brick-office.md). Concept and prototype:
[`docs/reference/brick-office.md`](../../reference/brick-office.md),
`docs/reference/brick-office/prototype.html`.

## Increments

1. **Spike** (2026-10-04), on the kit core (FEAT-083, ADR-0065): the newsroom and the editor's
   office from the compiler's output for shipped designs, measured by `e2e/bricks-bench.spec.ts`;
   report in [`docs/qualification/brick-office-spike.md`](../../qualification/brick-office-spike.md).
2. **Bricks everywhere** (2026-10-11, ADR-0085, the owner's decision without the spike's go/no-go
   run): every room by default (`ALL_ROOMS`; `rooms` narrows it for the bench), the hallway and the
   street as the kit's ground shells (`groundRects`, `kit::ground_shell`), the box office's geometry
   switched off, the `?office=bricks` flag removed.
3. **Brick people** (2026-10-11): the FEAT-024 rig rebuilt as the product's own brick figure (block
   legs, a torso brick with shoulder studs, a square head with a studded hair plate and eyes, side
   arms that become forearms when typing; skin and hair tones from the id).
4. **Level of detail, first steps** (2026-10-11): every floor layer (rooms, hallway, street) painted
   from the kit's tiles into one textured plane per room (`floor.ts`; 18,000 boxes fewer); at the
   low tier the shells' touching bricks merged per colour (`mergeBoxes`, walls without seams).
   Software WebGPU (CI's SwiftShader) went from 1.8 to about 5 fps on the demo office; per-chunk
   L0/L1/L2 by distance is still to do.
4b. **The toy look** (2026-10-11): every solid brick shows its seams (`seams.ts`, a material plugin
   darkening each face towards its edges from the instance's own scale), solid plastic is glossy
   ABS with a clear coat, the plastic reflects a generated studio (`environment.ts`, half floats,
   prefiltered once; its strength follows the sky, so night stays dark), and the office stands on a
   green studded baseplate (`floor.ts` `baseplateMesh`). About 96 fps on the owner's machine at
   the high tier.
5. The box office reduced to the scene's skeleton (lights, labels, picking), its builders removed.
6. Object-level placement on the stud grid (with FEAT-026).

## Acceptance criteria

- [x] Every room, the hallway and the street hold p95 ≤ 33 ms idle and ≤ 50 ms while generating
      (the scripted load) at the lowest tier on the qualification machine; a room chunk builds in
      < 200 ms: 16.8 and 18.7 ms, 47 ms at most (2026-10-11, the report's section 6). With the real
      model generating: still to measure.
- [x] Same layout and seed give identical instance buffers (NullEngine test).
- [x] Every layout prop kind has a shipped kit design; the office matches the sim's doors and desks.
- [ ] Visual baselines regenerated on Linux on SwiftShader WebGPU.

## Status (2026-10-11)

In `apps/game/src/render/bricks/` (kit-wasm loaded as a lazy chunk) and
`apps/game/src/render/characters/rig.ts`: the demo office's eleven rooms, about 43,000 parts and 630
draw calls before the floors were baked, 100 to 120 fps on the owner's machine (Chrome, WebGPU).
Tests: `src/render/bricks/*.test.ts` (NullEngine, the real kit: every room, the grounds in whole
studs, the floors as planes, the low tier's merged walls, the box office off, surfaces per desk and
whiteboard), `src/render/bricks/floor.test.ts`, `e2e/bricks.spec.ts`; the kit's ground shells in
`crates/kit/src/shell.rs`.

## Evidence

- `game/vitest`
- `game/playwright-e2e`
- `game/playwright-visual`
- `bench/frame-time`
