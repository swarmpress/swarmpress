---
id: FEAT-024
title: "Characters and animation"
status: planned
importance: high
paths:
  - "apps/game/src/render/characters/**"
  - "assets/blender/characters/**"
  - apps/game/src/state/render-state.ts
  - apps/game/src/render/office.ts
  - apps/game/src/render/lighting.ts
adrs:
  - ADR-0017
  - ADR-0007
---

# Characters and animation

Skinned glTF characters (Mixamo-compatible rigs) with an animation state machine mapped from sim
poses; walking interpolates along the sim path.

Decisions: [ADR-0017](../../adr/0017-asset-pipeline-cc0-blender-gltf.md), [ADR-0007](../../adr/0007-sim-renderer-render-state-contract.md).

## MVP: staff visibly moving, without glTF (increment U3)

Design: [`docs/design/mvp-gap-analysis.md`](../../design/mvp-gap-analysis.md) section C.

The sim already emits poses, paths with `start_step` and speed, and meeting seats; the renderer
draws capsules and teleports them at 10 Hz. The MVP keeps the capsules and adds: the full TS
`RenderState` type, per-frame interpolation along `path`, facing, a seated pose at meeting and
kitchen seats, name labels, a label of what each person is working on, the corridor floor, doors
from the layout, and click-to-open. Skinned glTF characters stay later work.

## Acceptance criteria

- [ ] Every sim pose maps to a clip; unknown pose fails loudly in dev.
- [ ] Path interpolation is deterministic for a given fractional step (vitest).

## Evidence

- `game/vitest`
- `game/playwright-visual`
