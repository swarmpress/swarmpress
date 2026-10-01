---
id: FEAT-021
title: "Lighting, shadows and render-state lighting"
status: in-progress
importance: high
paths:
  - apps/game/src/render/lighting.ts
  - apps/game/src/render/daylight.ts
  - apps/game/src/render/scene.test.ts
  - apps/game/src/render/daylight.test.ts
adrs:
  - ADR-0006
  - ADR-0007
---

# Lighting, shadows and render-state lighting

Sun/moon `DirectionalLight` with PCF `ShadowGenerator`, hemispheric sky fill, ceiling lights, desk
lamps and monitor emissives all driven by render state (`applyRenderState`). Baked lightmaps (UV2)
and AO from room modules are planned.

Decisions: [ADR-0006](../../adr/0006-baked-gi-dynamic-lights-day-night.md), [ADR-0007](../../adr/0007-sim-renderer-render-state-contract.md).

## Acceptance criteria

- [ ] Room lights, monitors and lamps match the render state exactly (NullEngine test).
- [ ] ≤ 16 dynamic lights visible; lights outside view or in cut-away floors disabled.
- [ ] Visual regression at 08:00, 13:00, 19:30 and 23:00 for all four camera angles.

## Evidence

- `game/vitest` (`scene.test.ts`, `daylight.test.ts`)
- `game/playwright-visual`
