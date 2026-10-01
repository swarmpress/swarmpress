---
id: FEAT-024
title: "Characters and animation"
status: planned
importance: high
paths:
  - "apps/game/src/render/characters/**"
  - "assets/blender/characters/**"
adrs:
  - ADR-0017
  - ADR-0007
---

# Characters and animation

Skinned glTF characters (Mixamo-compatible rigs) with an animation state machine mapped from sim
poses; walking interpolates along the sim path.

Decisions: [ADR-0017](../../adr/0017-asset-pipeline-cc0-blender-gltf.md), [ADR-0007](../../adr/0007-sim-renderer-render-state-contract.md).

## Acceptance criteria

- [ ] Every sim pose maps to a clip; unknown pose fails loudly in dev.
- [ ] Path interpolation is deterministic for a given fractional step (vitest).

## Evidence

- `game/vitest`
- `game/playwright-visual`
