---
id: FEAT-024
title: "Characters and animation"
status: in-progress
importance: high
paths:
  - "apps/game/src/render/characters/**"
  - "assets/blender/characters/**"
  - apps/game/src/state/render-state.ts
  - apps/game/src/state/render-state-shape.ts
  - apps/game/src/state/render-state-shape.test.ts
  - apps/game/src/state/render-state.wasm.test.ts
  - "apps/game/src/state/fixtures/**"
  - apps/game/src/render/scene.ts
  - apps/game/src/render/scene.test.ts
  - apps/game/src/render/lighting.ts
  - apps/game/e2e/smoke.spec.ts
  - apps/game/e2e/visual.spec.ts
adrs:
  - ADR-0017
  - ADR-0007
---

# Characters and animation

Skinned glTF characters (Mixamo-compatible rigs) with an animation state machine mapped from sim
poses; walking interpolates along the sim path.

Decisions: [ADR-0017](../../adr/0017-asset-pipeline-cc0-blender-gltf.md), [ADR-0007](../../adr/0007-sim-renderer-render-state-contract.md).

## MVP: staff visibly moving, without glTF (increment U3)

Design: [`docs/design/mvp-gap-analysis.md`](../../design/mvp-gap-analysis.md) section C;
contract: [`docs/architecture/render-state.md`](../../architecture/render-state.md).

Built (`apps/game/src/render/characters/`):
- the full TS `RenderState` and `BuildingLayout`, with a drift test against the wasm sim's JSON;
- per-frame interpolation along the sim `path` (`motion.ts`): a display step that trails the
  sim's step and stops at it, the distance clamped to the sim's own position, facing along the
  path and towards the desk or table at rest;
- poses in simple geometry (`pose.ts`, `rig.ts`): walk (bob with the distance walked), sit at a
  desk, a meeting seat or a kitchen seat, type (forearms on the keyboard, moving), talk (the
  meeting's speaker: a ring on the floor and a bob), listen (head turned to the speaker), idle;
- name labels with what the person works on (`labels.ts`, `label-layout.ts`): a text atlas on
  billboards in a utility layer drawn after post-processing, stacked so they never overlap,
  faded by zoom, hidden under the HUD and panels; words from lookups the scene is given;
- picking: a person or their name opens their profile, a busy person or their work line opens
  the work item (`scene.ts` `onPick`, wired in `main.ts`).

Skinned glTF characters and clips stay later work.

## Acceptance criteria

- [ ] Every sim pose maps to a clip; unknown pose fails loudly in dev.
- [ ] Path interpolation is deterministic for a given fractional step (vitest).
- [ ] On the live page a walker's position changes on every frame between sim steps (Playwright).

## Evidence

- `game/vitest` (`characters/motion.test.ts`, `characters/pose.test.ts`,
  `characters/label-layout.test.ts`, `scene.test.ts`, `state/render-state.wasm.test.ts`)
- `game/playwright-e2e` (`smoke.spec.ts`: smooth movement, click to open a profile)
- `game/playwright-visual`
