# Design: the construction kit

> **Status:** design, 2026-10-03. Decision: [ADR-0065](../adr/0065-the-construction-kit.md), which
> amends [ADR-0063](../adr/0063-brick-office-and-live-information-surfaces.md). Visual concept:
> [`docs/reference/brick-office.md`](../reference/brick-office.md); rendering:
> [`docs/design/brick-office.md`](brick-office.md). Features: FEAT-083 (kit core), FEAT-081 (brick
> office renderer), FEAT-026 (player building), FEAT-084 (staff building with the browser model).
> Nothing here is built yet. Numbers marked *target* are proposals.

The brick office is not only a look. It is a construction kit: the same parts, designs and rooms are
used to draw the office, by players to build and rebuild it, and by the company's own staff, steered
by the browser model, to plan and construct rooms. This document defines the kit so that all three
uses stand on one foundation.

## 1. Owner decisions (2026-10-03)

| Question | Decision |
|---|---|
| Where bricks live | In content-addressed **designs**; the sim holds only each object's capabilities and its design hash |
| MVP scope | **Kit core and renderer**: the office is built from designs. Player editing and staff building come after the first live articles |
| Who builds for the company | A new **office designer** role |
| Cost and approval | **Both, as modes**, chosen per company: a free sandbox, and an economic mode where builds cost money and game time, with the CEO's approval above a threshold |

## 2. Four layers

| Layer | What it is | Example |
|---|---|---|
| Part | A standard piece from a fixed catalogue: size in studs and plates, connection points (studs on top, anti-studs below), allowed colours, tags | `brick-2x4`, `plate-1x6`, `tile-2x2`, `tile-2x2-screen`, `window-1x4x6`, `door-1x4x6`, `lamp-head` |
| Design | A named build made of parts and other designs, with ports (attach points), tags and parameters; stored as data | `desk(width, colour)`, `chair`, `shelf(rows)`, `plant(size)`, `whiteboard` |
| Room | A shell (walls, windows, doors on the room's rect), placed designs, lights, information surfaces, and the room's requirements | a meeting room needs a table, at least four seats and a door |
| Building | Floors, rooms and hallways on the lot | the company's office |

The prototype's builder functions (`desk`, `chair`, `shelfRow`, `bigPlant`, `carton`, `decorItem` in
`docs/reference/brick-office/prototype.html`) become the first designs. Its voxel grid and brick
splitter become the compiler's last step.

### 2.1 Parts

- Units: 1 stud = 6.25 cm, 1 plate = 2.5 cm, 3 plates = 1 brick height; 1 m = 16 studs.
- A part's id, size, geometry template (box with studs, tile without, slope, round, special mesh),
  connection points, colour set and tags (`screen`, `transparent`, `light-emitter`, `door`,
  `window`) are data in `kit/parts/*.json`, validated by a schema and versioned with the kit.
- The colour palette is a fixed list of brick colours with internal ids. Player-facing names are the
  product's own (ADR-0063 decision 8).

### 2.2 Designs

```json
{
  "format": "swarmpress.design.v1",
  "id": "desk-double",
  "name": "Double desk",
  "params": { "width": { "type": "int", "min": 24, "max": 48, "default": 32 }, "top": { "type": "colour", "default": "tan" } },
  "ops": [
    { "op": "box",  "at": [0, 0, 0], "size": ["$width", 16, 1], "part": "plate", "colour": "$top", "level": 18 },
    { "op": "use",  "design": "desk-leg", "at": [1, 1, 0] },
    { "op": "use",  "design": "desk-leg", "at": ["$width - 3", 1, 0] },
    { "op": "part", "part": "tile-2x2-screen", "at": [8, 12, 19], "turn": 0, "surface": "monitor" }
  ],
  "ports": [ { "id": "seat-front", "at": [8, -4, 0], "accepts": ["seat"] }, { "id": "screen", "at": [8, 12, 19], "accepts": ["screen"] } ],
  "tags": ["workstation"],
  "provenance": { "kind": "kit" }
}
```

- `ops` is a small, closed **brick script**: `box` and `fill` (in stud and plate units, with a part
  kind and a colour), `part` (one catalogue part), `use` (another design, by id and version),
  `mirror` and `repeat`. Parameters are integers, enums or colours; expressions are limited to `+ - *`
  on integers. No loops beyond `repeat`, no conditionals: a design is bounded and terminates.
- A design is **content**: its canonical JSON is hashed (SHA-256 with a domain prefix,
  `swarmpress:design:v1`, as ADR-0056 does for records). A placed object refers to `{id, hash,
  params}`; editing a design produces a new hash.
- **Provenance:** `kit` (shipped), `player`, `staff` (with job, staff member and model, as in
  ADR-0056), or `pack` (an SDK extension, ADR-0043).

### 2.3 Rooms and buildings

- A room's shell is generated from the sim's room (rect, doors, windows, floor) and a shell style
  (floor kind, wall colour, skirting). Doors and windows stay sim facts.
- A room's contents are placements: `{design ref, position in studs, turn, ports filled}`.
- Requirements per room kind (seats, workstations, light, storage, a door) are kit data; a room is
  *active* when the summaries of its placements meet them.
- A `.room` file is a shell style, placements, the designs they reference (inline or by hash) and
  surface bindings; a `.building` file is rooms plus the lot. Both can be shared and imported.

## 3. The compiler (`crates/kit`)

A deterministic Rust crate, compiled natively and to wasm, used by the browser, the headless runner
and the central server alike.

```
design + params ─► expand ops ─► voxel grid (colour, part kind, object id)
                                     ├─► brick splitter ─► geometry: instances per colour (+ studs)
                                     └─► summary: footprint, height, tags, seats, workstation,
                                                  light, storage, screens, surfaces, part count, cost
```

- **Expansion** resolves `use` recursively with a depth and part budget; cycles are errors.
- **Validation:** parts exist and colours are allowed; every part is connected to the ground or to
  another part (no floating bricks); the build fits its declared footprint; budgets (parts, height)
  hold; ports lie on the build.
- **Brick splitter:** the prototype's split into standard sizes with overlapping rows; studs only on
  visible top faces; deterministic order (also the order construction animates in).
- **Summary:** derived only from the expanded design and its tags, never from free text. Examples:
  a `seat` tag on a part at seat height inside the footprint counts as a seat; a design is a
  workstation if it has a work surface at desk height, a `screen` or `paper` part, and a seat port.
- **Output to the renderer:** instance buffers per colour and per level of detail, cached by design
  hash, so a design used twelve times is compiled once.
- *Target:* compiling a desk-sized design under 5 ms in wasm; a whole room under 200 ms; a local
  re-split after a brick edit under 4 ms (the concept's figure).

## 4. The sim boundary

Bricks never enter the sim; a design's **summary** and **hash** do, the same rule as article text
(rule 2). The renderer draws the bricks; the sim reasons about capabilities.

- **MVP (no sim change):** the sim keeps `EquipmentKind`. The renderer maps each equipment kind and
  room kind to a shipped kit design and builds the office from them. The compiler's summaries are
  computed and tested against the sim's own figures (a shipped desk design must summarise as a
  workstation with a screen and a lamp slot), but the sim does not read them yet.
- **After the MVP (sim change, goldens move once):**
  - `PlaceObject{design: {id, hash}, params, room, at, turn, summary}` and
    `RemoveObject{object}`, `ReplaceDesign{object, design, summary}`;
  - the sim's equipment list becomes capability tags (`seat`, `workstation`, `light`, `storage`,
    `screen`, `door`) with amounts; staff look for "a free workstation", not "a Desk";
  - the sim validates a placement against its room (inside the rect, no overlap with other
    footprints, walkable paths kept, doors kept clear) the way it validates equipment today;
  - replay applies the summary; it never re-runs the compiler, so replay stays fast and
    deterministic even if the compiler changes;
  - designs travel with the work records (ADR-0056) and the state-repo mirror as readable files, so
    a central audit can recompute every summary from its design and refuse a forged one (leagues,
    ADR-0055).

## 5. Modes: sandbox and economic

Chosen per company at founding and shown in the HUD.

| | Sandbox | Economic |
|---|---|---|
| Cost | None | Parts and labour in in-game money (from the summary's part count and kind) |
| Time | Instant | A construction job with a game-time cost by build size (ADR-0060's rule: cost by action type, applied when it commits) |
| Approval | None | The CEO approves builds above a threshold (a Build Approval ticket with preview, cost and time; default Defer, as the publish gate) |
| Effect on work | Same capabilities | Same capabilities |
| Leagues | Unranked | Ranked as today (ADR-0055) |

Sandbox companies are unranked because free building changes what a company can achieve.

## 6. Building as a player (after the MVP, FEAT-026)

- **Place, move, turn, remove** designs on the stud grid; ghost preview; the sim validates.
- **Configure** a placed design's parameters (width, colours, rows).
- **Edit a design brick by brick** in a design editor: place, remove, paint, turn, copy and stamp,
  box fill, mirror, undo and redo, with auto-merge into larger bricks. Undo is local to the editor;
  only the finished design is committed, as one command.
- **Rooms from templates** (archive, print shop, meeting room, sales office, reading café, mail
  room, director's office) or empty; doorways and new rooms map to the sim's `PlaceRoom` and doors.
- **Information surfaces** are parts with a source and a view (ADR-0063), placed like any other part.

## 7. Building with the browser model (after the MVP, FEAT-084)

The office designer is a staff member with a persona and prompt, in a design department of the
office. The browser model (ADR-0057) steers the kit through a tool surface built for a small, greedy
model with an 8–16K context and no vision.

### 7.1 What makes it usable by a small model

1. **Relations, not coordinates.** The model places by anchor and relation: `{design: "desk-double",
   anchor: "wall:north", from: "window:north-1", gap: 8, facing: "room-centre"}`. Anchors (walls,
   windows, doors, other placements, ports) come from the room. A deterministic **layout solver**
   turns relations into stud positions and turns, or returns why it cannot.
2. **A slice of the catalogue.** Each call sees only the designs relevant to the room kind and the
   brief (by tag), with docs generated from the kit's definitions, never hand-written (rule 12's
   pattern). This keeps every prompt inside the context.
3. **Text feedback from deterministic checks.** Collisions, walkability (the sim's pathfinding),
   door clearance, light at each workstation, requirements met, cost and part count come back as
   issues with ids; the repair loop fixes only the named items (ADR-0058's pattern).
4. **Closed vocabulary.** Design ids, colour ids and relation kinds are enums in the schemas, so an
   unknown id is a validation error returned to the model (rule 5's closed world).

### 7.2 The build job, in stages

| Stage | Model call | Output |
|---|---|---|
| `brief#0` | none or one | Requirements from the CEO's request or a need the sim detects (three writers, two workstations) |
| `layout#0` | structured | Placements by relation from the catalogue slice |
| `solve` | none | Positions; issues |
| `fix#i` | structured | Changes to the named placements only |
| `decor#0` | structured | Colours and shell style from the palette, within budget |
| `design#0` (rare) | structured | A new design in the brick script, within a part budget, compiled and validated |
| `preview` | none | Ghost bricks in the room, cost, time, the requirement check |

The plan is an artifact; the orchestrator decides (rule 3). In economic mode the Build Approval
ticket follows; on approval a construction job places the objects, and the renderer animates bricks
appearing in build order over the job's game time, with the builders at work. The same stage store,
repair limits, progress events and activity rows as articles (ADR-0058) apply.

### 7.3 Evaluation

As for articles (FEAT-036): a set of build briefs per room kind, measured for schema-valid first
try, repairs per stage, requirements met, solver failures, part counts and cost; plus the owner's
judgement of a sample. New-design generation is evaluated separately and enabled only if it passes.

## 8. Extensions (SDK)

ADR-0043's `prop-pack` becomes a **design pack**: designs (and parts, if the pack's part catalogue
extension validates) in the brick script, with provenance. An extension may also ship a design
generator that runs in the QuickJS sandbox (ADR-0042) and returns brick script; the compiler
validates its output like any other design.

## 9. Rendering

- Geometry is built per design hash and per level of detail, then instanced per placement; room
  chunks merge static placements per colour (ADR-0063 decisions 1 and 5).
- An edit re-splits the changed region plus a one-cell border and rewrites the affected colour's
  buffer for that chunk.
- Construction animation is interpolation of the job's progress over the design's brick order; the
  renderer decides nothing (rule 8).

## 10. Increments

| # | Increment | Phase |
|---|---|---|
| K-1 | `crates/kit`: part catalogue and schema, design format and hash, brick script expansion, validation, brick splitter, summary; wasm build; property and golden tests | MVP (FEAT-083) |
| K-2 | Shipped designs: the prototype's builders ported to brick script, one design per `EquipmentKind`, room shells per `RoomKind`; summaries checked against the sim's equipment | MVP (FEAT-083) |
| K-3 | Brick office renderer from kit output: the spike (two rooms, two surfaces, measurements), then all rooms with levels of detail | MVP (FEAT-081) |
| K-4 | Sim capabilities: `PlaceObject` with summaries, equipment kinds to tags, staff use tags; goldens move once | after MVP |
| K-5 | Player building: placement, configuration, design editor, templates, modes | after MVP (FEAT-026) |
| K-6 | Office designer and the build job: layout solver, catalogue slices, staged job, Build Approval, construction animation, eval | after MVP (FEAT-084) |
| K-7 | Design packs and `.room` / `.building` sharing | after MVP |

## 11. Risks and open points

- How well a 27B ternary model places furniture by relation is unknown until evaluated; new-design
  generation is the hardest task and may stay off.
- The change from `EquipmentKind` to tags touches staff behaviour, the economy and the goldens.
- A design's summary rules (what counts as a seat or a workstation) are game design; they need
  owner review before K-4.
- Compiler performance targets are unmeasured.
- Part geometry for special parts (screen tiles, windows, lamp heads, plants) needs an authoring
  path; the prototype builds them procedurally, which is the starting point.
