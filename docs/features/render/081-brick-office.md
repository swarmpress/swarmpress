---
id: FEAT-081
title: "Brick office renderer (spike first)"
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
  - apps/game/e2e/visual.spec.ts
  - "docs/qualification/*brick*"
adrs:
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

1. **Spike** (decides the rollout), on the kit core (FEAT-083, ADR-0065): the renderer instances
   the compiler's output for shipped designs; build the newsroom and the editor's office behind
   `?office=bricks`; measure frame times per tier, idle and with the scripted generation load, and
   write a report in `docs/qualification/`.
2. All rooms brickified with L0/L1/L2; the box office removed.
3. Brick-styled people on the existing rig.
4. Object-level placement on the stud grid (with FEAT-026).

## Acceptance criteria

- [ ] Spike: two brick rooms plus the rest of the office hold p95 ≤ 33 ms idle and ≤ 50 ms while
      generating at the lowest tier on the qualification machine; a room chunk builds in < 200 ms.
- [ ] Same layout and seed give identical instance buffers (NullEngine test).
- [ ] Every layout prop kind has a shipped kit design; the office matches the sim's doors and desks.
- [ ] Visual baselines regenerated on Linux on SwiftShader WebGPU.

## Spike status (2026-10-04)

Built behind `?office=bricks` in `apps/game/src/render/bricks/` (kit-wasm loaded as a lazy chunk):
the newsroom and the editor's office from the kit's room shells and shipped designs, one
thin-instanced mesh per region, colour and shape per room, studs separate; the cutaway hides brick
walls by the box office's rule. Tests: `src/render/bricks/*.test.ts` (NullEngine, the real kit),
`e2e/bricks.spec.ts`; measurements: `e2e/bricks-bench.spec.ts` (project `bricks` of
`playwright.bonsai.config.ts`), report in
[`docs/qualification/brick-office-spike.md`](../../qualification/brick-office-spike.md). The go/no-go
run on the M3 Max in Chrome with WebGPU is still to be made.

## Evidence

- `game/vitest`
- `game/playwright-e2e`
- `game/playwright-visual`
- `bench/frame-time`
