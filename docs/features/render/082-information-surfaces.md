---
id: FEAT-082
title: "Live information surfaces"
status: in-progress
importance: high
paths:
  - "apps/game/src/render/surfaces/**"
  - apps/game/src/render/bricks/surfaces.ts
  - apps/game/src/render/bricks/surfaces.test.ts
  - apps/game/src/render/bricks/office.ts
  - apps/game/src/render/bricks/index.ts
  - apps/game/e2e/bricks.spec.ts
  - "apps/game/src/ui/surfaces/**"
  - apps/game/src/state/render-state.ts
  - docs/architecture/render-state.md
adrs:
  - ADR-0063
  - ADR-0007
  - ADR-0018
---

# Live information surfaces

Monitors, the whiteboard, the proof wall, the deploy display, clocks and door signs show real data,
with three levels by camera distance: far (glow, from render state), mid (a brick mosaic) and close
(full content drawn on a canvas and uploaded as raw pixels). Content comes from the browser store
through the data source, never from the sim (rule 2). Clicking a surface opens the matching panel:
the proof wall opens the approval ticket, the whiteboard the Plan, a monitor the person's work item.

Design: [`docs/design/brick-office.md`](../../design/brick-office.md) section 6.

Depends on: FEAT-081 (surfaces sit on brick faces; the spike builds the first two), FEAT-078 (a
monitor's job and stage), FEAT-027 (the panels they open).

## Acceptance criteria

- [ ] A writer's monitor shows their job and stage while the job runs, and goes dark when idle.
- [ ] The whiteboard lists the Plan's items by phase and updates when an item moves.
- [ ] Only visible surfaces above the size threshold redraw, at most four per frame.
- [ ] Model text on a monitor is drawn as text only (escaping test).
- [ ] Clicking each surface opens its panel.

## Spike status (2026-10-04)

The spike's two surfaces (FEAT-081) are in `apps/game/src/render/bricks/surfaces.ts`: each desk
monitor of the brick rooms (far: a glow from the render state; close: name, job and stage from the
store) and the newsroom whiteboard (the Plan's items by phase). Text is drawn with `fillText` only,
uploaded as raw pixels; at most four redraws a frame, round-robin. The demo layout has no whiteboard
in the newsroom, so the spike stands one against its north wall (marked `standIn`, not a sim fact).
Not yet: the mid level (brick mosaic), clicking a surface, the other surfaces.

## Evidence

- `game/vitest`
- `game/playwright-e2e`
