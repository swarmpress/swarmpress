---
id: FEAT-100
title: "The Brick Studio and the Building workbench"
status: in-progress
importance: high
paths:
  - apps/game/src/ui/components/Blueprint.tsx
  - apps/game/src/ui/studio/bricks.tsx
  - apps/game/src/ui/studio/snap.ts
  - apps/game/src/ui/studio/history.ts
  - apps/game/src/ui/studio/Building.tsx
  - apps/game/src/ui/studio/studio.test.tsx
  - apps/game/src/ui/blueprint/blueprint.test.tsx
  - apps/game/e2e/studio.spec.ts
adrs:
  - ADR-0077
  - ADR-0072
---

# The Brick Studio and the Building workbench

The game-like, flat builder ([ADR-0077](../../adr/0077-the-brick-studio.md);
[design](../../design/brick-studio.md)). Key B opens the Studio over the whole screen, with the
workbenches Town (the site), Building (one page type from the front: the page builder) and
Factory (the tools). One grammar everywhere: pick a part from the tray, see where it fits (green
studs from the site's own checker, a red seam with its reason), snap it in, bulldoze, undo and
redo.

## Built

- The Studio: a full-screen panel with workbenches; the draft and its undo history are shared
  by the Town and the Building and survive a look at the Factory.
- The Building workbench: the street of buildings, the elevation (storeys of brick blocks, glass
  for optional, pillars for repeating, roof and foundation globals), the tray with categories and
  search, click-to-pick and drag, drop on a storey or in a gap (a new storey), removal, the
  inspector, and the 🔒 on the platform's page types.
- The snap engine judges every target with blueprint-wasm. A drop is allowed when it adds no
  issue the draft did not have.
- Settle animation, an optional click sound, reduced motion.
- Tests: `apps/game/src/ui/studio/studio.test.tsx` (snap engine, undo and redo, the workbench
  on the real checker, axe); `apps/game/e2e/studio.spec.ts` (in the real game page).

## Not built

- Town info views and zoning (FEAT-102).
- Binding a tool by tube, and a page preview beside the elevation.
- Saving the layout to `blueprint/layout.json`.
