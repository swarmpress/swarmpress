# Design: the brick office and live information surfaces

> **Status:** design, 2026-10-03. Decisions: [ADR-0063](../adr/0063-brick-office-and-live-information-surfaces.md)
> and [ADR-0064](../adr/0064-webgpu-only.md). Concept: [`docs/reference/brick-office.md`](../reference/brick-office.md).
> Features: FEAT-081 (brick office renderer, starting with the spike), FEAT-082 (information
> surfaces), FEAT-017 (WebGPU only). Nothing here is built yet. Numbers marked *target* are
> proposals until the spike measures them.

## 1. What changes and what stays

| | Stays | Changes |
|---|---|---|
| Sim | The deterministic sim, its layout (rooms, doors, desks, props, devices), staff, paths, poses, lighting state | Nothing in the spike. Later, the sim may learn object-level building and tags (section 9). |
| Render contract | The renderer draws exactly `render_state()` and decides nothing (rule 8); text never enters the sim (rule 2) | A surface registry names each information surface and its owner; surface *content* comes from the browser store through the data source, like the panels' text |
| Camera | Orthographic isometric, four snapped angles, zoom, cutaway (ADR-0005) | Zoom also drives the surfaces' level of detail; double-click flies to a surface |
| Office geometry | Built from `layout_json()` | Built as bricks (voxel grid → brick splitter → thin instances per colour) instead of boxes; props become brick prefabs |
| People | Motion, poses, labels, picking from FEAT-024 | Restyled in bricks with their own design (not a minifigure) |
| Lighting | Lighting is sim state; `daylight(minute)`; the light budget | No baked lightmaps (ADR-0006, ADR-0017): bricks are procedural, so indirect light is SSAO plus a fill, per quality tier |
| UI | Panels for decisions (Inbox approval, Plan, Finance) | Surfaces become the way in: zooming to the proof wall opens the approval; the whiteboard opens the Plan |
| Engine | Babylon.js 9 | WebGPU only (ADR-0064); the WebGL2 fallback is removed in its own increment |

## 2. Scale and coordinates

- The sim's units are metres; the lot is 24 × 16 m with eleven rooms on one floor.
- One stud is 6.25 cm and one plate 2.5 cm of the room, as in the prototype. So 1 m = 16 studs, the
  lot is 384 × 256 studs, and a 2.95 m wall is 118 plates.
- The prototype's single room (128 × 96 studs, about 8 × 6 m) holds about 11,400 parts. Eleven
  rooms at that density would be over 100,000; level of detail (section 4) is mandatory.
- Brick placement is deterministic: every random choice (book colours, plant leaves) comes from a
  PRNG seeded by the room id, as the prototype already does with a seeded generator. Visual
  baselines stay stable, and two players with the same layout see the same office.

## 3. Brickification

Input: `layout_json()` (rooms with rect, kind, windows, doors, desks with seats, ceiling lights,
props, entrance) and, per frame, `render_state()` (device states, room light, staff).

1. **Shell per room chunk.** Floor baseplates and a plank or tile floor by room kind; walls with
   window and door openings from the layout (the doors are the sim's, as in FEAT-020); skirting,
   window frames, radiators.
2. **Props from a prefab library.** Each layout prop kind (desk, chair, monitor, desk lamp, shelf,
   whiteboard, coffee machine, plant, meeting table, stool, sofa, server rack, camera rig, printer)
   maps to a brick prefab ported from the prototype's builders (`desk`, `chair`, `shelfRow`,
   `bigPlant`, `carton`, `decorItem` …). A prefab is a function that writes voxels and detail parts
   into the chunk at the prop's position and quarter turn, under a named object id (`staff-3 ›
   desk › monitor`).
3. **Brick splitter.** The prototype's voxel → brick split with overlapping rows; studs only on
   faces that are visible from above.
4. **Instancing.** One thin-instanced mesh per colour per chunk (the prototype uses one per colour
   for the whole room). Per-chunk buffers let the cutaway and level of detail switch a room cheaply.
5. **Named objects.** A table from object id to its brick ranges and its surfaces, used by picking
   (click a desk → that person's profile) and by the surface registry.

*Target:* building one room's chunk under 200 ms on the M3 Max, off the main thread if needed (the
generator is pure TypeScript and can run in a worker, returning instance buffers).

## 4. Level of detail and culling on WebGPU

| Level | When | Content |
|---|---|---|
| L0 near | The focused room, and rooms whose screen size is above a threshold | All bricks, studs, detail parts, surfaces at full level |
| L1 mid | Other visible rooms | Bricks without studs; small detail parts dropped; surfaces at mid level |
| L2 far | Rooms behind the cutaway plane or below a size threshold | The room's shell merged into a few meshes per colour; surfaces as glow only |

- Cut-away walls (ADR-0005) and floors above the camera are not drawn at all.
- Chunk bounding boxes drive frustum culling; studs are a separate instanced mesh per chunk so they
  can be dropped wholesale.
- WebGPU only (ADR-0064) allows GPU-side culling and render bundles later; the spike first measures
  what plain thin instances cost.

*Targets* (concept and MVP): 60 fps for about 50,000 visible bricks and 40 active surfaces with the
model idle; p95 frame time ≤ 33 ms at the scheduler's tier while the model generates.

## 5. Sharing the GPU with the resident model

The scene and the model run on two WebGPU devices (main thread and the model's worker) on one GPU
(ADR-0057). While the model generates, `GpuScheduler` (FEAT-040) lowers the scene's tier through its
renderer hooks:

- SSAO and shadows off; bloom kept only on surfaces that glow;
- every room except the focused one drops to L1 or L2;
- surface redraws throttled to one per frame;
- no rebuilds of brick chunks (they wait until generation ends).

The qualification harness (`apps/game/bench.html`, FEAT-037) measures frame times per tier, idle and
while generating; the spike reuses it with the brick office as the scene.

## 6. Information surfaces

A surface is a named rectangle on a brick face with a source, a view and three levels.

| Surface | Owner (from the layout) | Source | Close view | Click |
|---|---|---|---|---|
| Desk monitor | `staff-n › desk › monitor` | The person's current job and stage (activity rows, FEAT-078/P5) and the text it is producing | Name, job, stage ("section 3 of 5"), the last paragraph written | The work item thread |
| Whiteboard | Editor's office or newsroom | The Plan: work items by phase | Kanban: brief, draft, review, approval, published | The Plan panel |
| Proof wall | Editor-in-chief's office | Items awaiting the CEO's approval | The article's title, dek and hero, the editor's score | The approval ticket and article preview (FEAT-027 U1) |
| Deploy display | Server room | The deploy of the last merge (deploy poller, FEAT-047) | Commit, state, time | The pull request |
| Wall clock | Any room | Game time from render state | Hands | — |
| Brief stack | Newsroom | Briefs waiting | Count as stack height; top brief's title | The brief |
| Library shelves | Newsroom or lounge | The site's pages (knowledge pack, FEAT-043) | Titles as spines | The page's route |
| Door sign | Each room | Room name, who is inside, current meeting | Text | — |

Rules:

- **Rule 2:** surface text comes from the browser store through the data source (as the panels do),
  never from the sim. The far level's glow state comes from render state (device `state`, the
  person's pose and `workItem`), so the renderer still decides nothing (rule 8).
- **Drawing:** a close view is drawn on a 2D canvas from a view template (kanban, page, ticker,
  label) at 256 to 2048 px to match its screen size, and uploaded as raw pixels with
  `writeTexture`, never `copyExternalImageToTexture` (SwiftShader lacks it; the label layer of
  FEAT-024 already works this way).
- **Budget:** only visible surfaces above a size threshold update, round-robin, about four per
  frame; a surface redraws when its data changes or its level changes.
- **Mid level:** a brick mosaic of the data (one tile per data pixel, instanced), in brick colours.
- **Untrusted text:** article text on a monitor is model output; it is drawn as text only, never
  parsed as markup.

## 7. Testing

- **Generator:** NullEngine unit tests for counts per room, determinism (same layout and seed →
  identical instance buffers), studs only on visible faces, prefab placement at the layout's
  positions and turns, named-object coverage.
- **Surfaces:** pure tests for view templates (text layout, truncation, escaping) and the update
  budget.
- **Visual baselines:** regenerated on Linux in the Playwright Docker image (as FEAT-024 did), on
  SwiftShader WebGPU once ADR-0064's increment lands.
- **Performance:** `cockpit.benchmark.v1` frame-time documents per tier and per scene (capsule office
  vs brick office), idle and with the scripted generation load, from the qualification harness.

## 8. The spike (FEAT-081, first increment)

Goal: decide whether the brick office can be the MVP's office without starving the model.

1. Port the prototype's voxel grid, brick splitter, instancing and five prefabs (desk with monitor,
   chair, shelf, plant, whiteboard) into `apps/game/src/render/bricks/`, as TypeScript modules with
   NullEngine tests.
2. Build the newsroom and the editor's office from `layout_json()` behind `?office=bricks`; other
   rooms stay as today.
3. Two live surfaces: each writer's monitor (far glow from render state, close view with name, job
   and stage) and the whiteboard (the Plan's items by phase).
4. Measure on the M3 Max in Chrome, WebGPU, at each tier: brick count, draw calls, chunk build time,
   frame p50/p95 idle, frame p95 with the scripted generation load running in the harness, GPU
   memory where the browser reports it. Record a `cockpit.benchmark.v1` document and a short report
   in `docs/qualification/`.
5. Go if: two brick rooms plus the rest of the office hold the targets of section 4 with idle model,
   and p95 ≤ 50 ms while generating at the scheduler's lowest tier; chunk build < 200 ms. No-go:
   keep the box office and adopt only brick-styled props and the surfaces.

## 9. After the spike

In order, if the spike says go:

1. All rooms brickified, with L0/L1/L2 and the cutaway; the box office removed.
2. Surfaces: monitors, whiteboard, proof wall, deploy display, clock, door signs.
3. Brick-styled people (own design) on the FEAT-024 rig.
4. Build mode at object level (FEAT-026): place and move whole prefabs on the stud grid, validated
   by the sim as today's equipment commands are.
5. Later, not in the MVP: brick-by-brick editing with auto-merge, behaviour tags and workstation
   detection in the sim, doorways and new rooms and floors, `.room` sharing.

## 10. Open questions

- **MVP or after:** the owner decides after the spike.
- **Camera:** the concept orbits freely; swarm.press uses four snapped isometric angles. The spike
  keeps the isometric camera; a free orbit would amend ADR-0005.
- **How much the building affects work:** light, distance and noise as sim rules would be new
  deterministic systems with golden changes; not in the MVP.
- **Brand:** the product must not use the LEGO name, must keep its people clearly its own design,
  and should avoid copying BrickLink colour names in player-facing text (internal ids may keep
  them). Not legal advice.
