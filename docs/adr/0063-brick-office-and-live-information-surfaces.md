# ADR-0063 — The brick office and live information surfaces

**Status:** Accepted (amends ADR-0006, ADR-0007 and ADR-0018; supersedes in part ADR-0017); rollout gated by the spike in FEAT-081
**Date:** 2026-10-03

## Context

The office today is built from boxes and capsules (FEAT-020, FEAT-024). It is readable but not
something a player wants to look at, and it shows almost nothing of the work: the real state lives
in overlay panels.

The owner supplied a concept and a working Babylon.js prototype: a publishing house built entirely
from toy bricks, generated procedurally from a voxel grid, rendered as one thin-instanced mesh per
colour (about 11,400 parts in one room), with named objects such as `desk_3 › monitor`. Its core idea
is that every screen, board and stack is an information surface that shows real data, with more
detail the closer the camera gets. The concept is kept in
[`docs/reference/brick-office.md`](../reference/brick-office.md), with the prototype source.

swarm.press already has what the concept needs underneath: autonomous staff with paths and poses,
a CEO who steers through tickets and policies rather than avatars, and real data to show: the
article a writer is producing, the Plan, the approval queue, pull requests and deploys.

Three things pull against it. A brick world is heavy, and the GPU is shared with a 27B model
(ADR-0057). The concept wants no panels, but the CEO's approval needs a sharp, readable view
(ADR-0059). And the concept's brick-level building with behaviour tags would move building into the
deterministic sim.

Detail: [`docs/design/brick-office.md`](../design/brick-office.md).

## Decision

1. **The office is drawn in bricks.** Geometry is generated from the sim's layout: a voxel grid per
   room chunk, split into standard bricks with overlapping rows, studs only where visible, one
   thin-instanced mesh per colour per chunk. Props are brick prefabs keyed by the layout's prop
   kinds. All random choices are seeded by room id, so the office is deterministic.
2. **The sim stays as it is.** The renderer draws `render_state()` and decides nothing (ADR-0007).
   Bricks are a rendering of the sim's rooms, doors, desks and devices; the sim does not hold
   voxels. Building stays at object level (FEAT-026) until a later ADR moves it.
3. **Information surfaces show real data.** A surface is a named rectangle on a brick face with a
   source, a view and three levels (far: glow; mid: brick mosaic; close: full content). The glow
   state comes from render state; the content comes from the browser store through the data source,
   never from the sim (rule 2). Close views are drawn on a canvas and uploaded as raw pixels.
4. **Panels stay for decisions.** Surfaces are the way in: the proof wall opens the approval ticket
   and article preview, the whiteboard opens the Plan, a monitor opens the person's work item.
   Panels are not removed in the MVP. (Amends ADR-0018.)
5. **Level of detail is mandatory.** Three levels per room chunk, the cutaway and frustum culling;
   while the model generates, the GPU scheduler lowers the scene (ADR-0027, FEAT-040).
6. **No baked lighting for bricks.** Bricks are procedural, so ADR-0006's baked lightmaps and
   ADR-0017's Blender kits no longer apply to rooms and props. Lighting stays sim state; indirect
   light is SSAO and a fill per quality tier.
7. **Gated rollout.** A spike (FEAT-081) builds two rooms and two live surfaces behind a flag and
   measures frame times idle and while generating. The full rollout, and whether it is part of the
   MVP, is decided on its numbers.
8. **People are the product's own design** in bricks, on the existing motion and pose rig; never a
   copy of a toy maker's figure, and never the LEGO name.

## Consequences

- The office becomes something to watch, and the work becomes visible in it: a monitor shows the
  section being written, the proof wall the article waiting for the CEO.
- Visual baselines, the office tests and the scene's performance budget all change; the box office is
  removed once the brick office covers every room.
- The asset pipeline of ADR-0017 is reduced to whatever is not bricks (if anything); the CC0 kit
  sourcing and Blender bake are no longer on the critical path.
- **Negative:**
  - GPU and memory load rise sharply; the targets are unmeasured until the spike, and a no-go keeps
    the box office.
  - A second representation of every prop (the brick prefab) has to track the sim's prop kinds.
  - Surfaces add a rendering path (canvas, upload, budget) and a binding table to maintain.
  - Brand risk from the toy-brick look; mitigated by naming and character design, not eliminated.
  - The concept's brick-level building, behaviour tags and room templates are deferred, so the
    "everything is bricks you can rebuild" pillar is only partly delivered in the MVP.
- **Alternatives rejected:**
  - *Keep the box office and add surfaces only.* Delivers the information idea without the look;
    remains the fallback if the spike fails.
  - *Authored glTF rooms (ADR-0017).* No art team; bricks are procedural and need no assets.
  - *Replace the panels with surfaces now.* The CEO's approval needs a sharp, reliable view.
  - *Voxels in the sim.* Large determinism and golden cost for a visual concern; deferred.
