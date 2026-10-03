# Design: the construction kit

> **Status:** design, 2026-10-03. Decision: [ADR-0065](../adr/0065-the-construction-kit.md), which
> amends [ADR-0063](../adr/0063-brick-office-and-live-information-surfaces.md). Visual concept:
> [`docs/reference/brick-office.md`](../reference/brick-office.md); rendering:
> [`docs/design/brick-office.md`](brick-office.md). Features: FEAT-083 (kit core), FEAT-081 (brick
> office renderer), FEAT-026 (player building), FEAT-084 (staff building with the browser model).
> K-1 and K-2 are built (`crates/kit`, `kit/`; section 12); the rest is not. Numbers marked
> *target* are proposals.

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
  "footprint": ["$width", 16],
  "height": 40,
  "params": { "width": { "type": "int", "min": 24, "max": 48, "default": 32 }, "top": { "type": "colour", "default": "sand" } },
  "ops": [
    { "op": "box",  "at": [0, 0, 18], "size": ["$width", 16, 1], "part": "plate", "colour": "$top" },
    { "op": "use",  "design": "desk-leg", "at": [1, 1, 0] },
    { "op": "use",  "design": "desk-leg", "at": ["$width - 3", 1, 0] },
    { "op": "part", "part": "screen-2x2", "at": [8, 12, 19], "turn": 0, "surface": "monitor" }
  ],
  "ports": [ { "id": "seat-front", "at": [8, 20, 0], "accepts": ["seat"] }, { "id": "screen", "at": [8, 12, 19], "accepts": ["screen"] } ],
  "tags": ["workstation"],
  "provenance": { "kind": "kit" }
}
```

- Coordinates are `[x, z, y]`: `x` east and `z` south in studs, `y` up in plates (the first draft's
  separate `level` is the third coordinate). `footprint` (`[w, d]`, studs) and `height` (plates)
  declare the bounds the build must fit; `mount` (`floor`, `surface`, `ceiling`; default `floor`)
  says which face is the ground for the no-floating-bricks rule. Section 12 has the details as
  built.

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
- Compiler performance is measured natively (section 12.6); the wasm figures come with K-3.
- Part geometry for special parts (screen tiles, windows, lamp heads, plants) needs an authoring
  path; the prototype builds them procedurally, which is the starting point.

## 12. Shipped designs (K-1 and K-2 as built, 2026-10-03)

`crates/kit` (FEAT-083) and its data in `kit/`. The sim is unchanged; `crates/kit-wasm` is the
renderer's facade (`compile`, `compileShipped`, `roomShell`, `roomShells`, `hashDesign`, the
catalogue, designs and mapping as JSON; its API is in the crate's docs).

### 12.1 What the first draft did not say

- **Coordinates and bounds.** Every position is `[x, z, y]` (studs east, studs south, plates up).
  A design declares `footprint: [w, d]` and `height`; everything must fit, and a `use`d design
  must fit its parent. `mount` (`floor`, `surface`, `ceiling`) picks the ground for the
  no-floating-bricks rule (the bottom layer, or the top layer for a ceiling light).
- **Turns** follow the sim's `rot`: quarter turns clockwise seen from above; at turn 0 a part's
  front faces south (`+z`), so a desk at rot 0 has its chair south of it and its screen facing it.
- **`box` and `fill`.** Both fill a region with a material the splitter uses: `brick` (bricks and
  plates, studs where visible), `plate` (plates only) or `tile` (smooth). `box` overwrites;
  `box` with `empty` clears (openings, notches); `fill` only fills empty cells, so it goes around
  parts. `shape: disc` fills the upright cylinder inscribed in the region (pots, stools, tables).
- **`mirror`** runs its ops, then runs them again mirrored across the design's footprint centre;
  **`repeat`** runs its ops `count` times, moved by `k × step`. String fields (`colour`, `part`,
  `design`) may name an enum or colour parameter as `$name`. `use` passes parameters (integers may
  be expressions in the parent's parameters), may pin `hash`, and names the object (`name`).
- **Ports** are grid points where the attached design's footprint centre stands. A port that
  accepts a `seat` stands on the floor within 16 studs (1 m) of the footprint; any other port must
  stand on the build (a cell below it is occupied).
- **Connected** means face contact with the ground or with something that touches it. The
  catalogue's connection data (studs on top, anti-studs below) decides where studs are drawn; it
  is not a physics check, so a whiteboard may hang on its posts.
- **Canonical form and hash.** Sorted keys, no whitespace, defaults omitted, tags sorted,
  expressions in canonical text with constants folded (`"-3"`, `-3` and `"1 - 4"` are one form).
  `hash = sha256("swarmpress:design:v1" ‖ canonical JSON)`, lower-case hex. The catalogue has its
  own digest (`swarmpress:kit-catalogue:v1`), carried by every compiled output.
- **Issues** carry a closed code (`bad-format`, `bad-param`, `bad-expression`, `bad-op`,
  `unknown-part`, `unknown-colour`, `colour-not-allowed`, `unknown-design`, `cyclic-use`,
  `depth-exceeded`, `hash-mismatch`, `outside-footprint`, `overlap`, `floating`, `over-budget`,
  `bad-port`, `bad-surface`, `tag-not-met`, `bad-catalogue`), the design and the op path from the
  compiled design's ops (`[3, 1]` is the second op inside whatever the fourth op expands to).
- **Budgets** (defaults): `use` depth 8, 60,000 parts (a design may declare a lower `budget`),
  4,000,000 grid cells, 200,000 writes after expansion, `repeat` count 1,024, 64 m a side, 12 m
  high.
- **Part ids** for special parts are `screen-WxH` (W studs wide, H studs tall), `board-WxH`,
  `paper-WxD`, `window-4x1x18`, `door-16x1x84`, `lamp-head-NxN`, `seat-NxN`, `shelf-WxD`; the draft's
  `tile-2x2-screen` is `screen-2x2`.

### 12.2 Catalogue

68 parts: the 37 standard parts the splitter emits (bricks 1×1 to 2×8, eleven sizes; plates 1×1 to
8×8, seventeen; tiles 1×1 to 2×4, nine) and 31 special parts: baseplates 16×16 and 32×32; round
bricks, plates and tiles 1×1 and 2×2; screens 2×2, 4×2, 6×4, 8×4, 10×6, 12×6 (`screen`, front
surface, glowing colours only); boards 8×8 to 32×16 (front surface); paper 1×2, 2×3, 3×5, 4×6
(`paper`, top surface); the window module (`window`, `transparent`); the door leaf (`door`);
lamp heads 2×2 and 4×4 (`light-emitter`); seat cushions 4×4 and 6×6 (`seat`); shelf boards 4×8 and
6×8 (`shelf`, added for storage). Prices are cents of in-game money, by volume for standard parts.

The palette has 28 colours with neutral ids and the product's own names: white (White),
grey-light (Pebble), grey-dark (Slate), black, red, red-dark (Wine), blue, navy, sand, cork,
honey, caramel, chocolate, green, forest, leaf, sage, denim, olive, plum, orange, yellow,
terracotta, brass (metal), glass (Clear, transparent), screen-blue, screen-white and bulb (Warm
light; glowing).

### 12.3 Designs

Scale: 16 studs = 1 m, 40 plates = 1 m; desk tops at 30 plates (75 cm), seats at 18 (45 cm),
walls 118 plates (2.95 m).

| Design | Draws | Footprint (studs) | Parts |
|---|---|---|---|
| `desk` | `Desk` (params `half` 10–16, `top`, `frame`); uses `desk-pedestal`, `paper-stack`, `mug` | 24 × 12 | 204 |
| `monitor` | `Monitor`, on the desk's `screen` port (`screen-10x6`, surface `monitor`) | 10 × 4 | 15 |
| `color-monitor` | `ColorMonitor`, on the `screen` port (`screen-12x6`, surface `monitor`) | 12 × 4 | 15 |
| `desk-lamp` | `DeskLamp`, on the desk's `lamp` port | 2 × 4 | 8 |
| `ceiling-light` | `CeilingLight`, hung from the ceiling | 4 × 4 | 8 |
| `whiteboard` | `Whiteboard` on a stand (surface `whiteboard`) | 20 × 8 | 66 |
| `archive-shelf` | `ArchiveShelf`: five shelves of books and box files; uses `book-row` | 18 × 7 | 697 |
| `coffee-machine` | `CoffeeMachine` on a counter | 16 × 8 | 251 |
| `plant` | `Plant` (param `size` 40–72 plates) | 8 × 8 | 152 |
| `camera-rig` | `CameraRig` on a tripod | 16 × 16 | 57 |
| `mood-board-wall` | `MoodBoardWall`, a free-standing board (surface `mood-board`) | 34 × 8 | 82 |
| `chair` | the chair at each desk's seat | 8 × 8 | 44 |
| `stool` | the seats at tables | 6 × 6 | 9 |
| `meeting-table` | the round table of meeting rooms, strategy rooms and kitchens (param `r`, eight seat ports at the sim's `ROUND_TABLE_SEATS`) | 24 × 24 | 157 |
| `desk-pedestal`, `paper-stack`, `mug`, `book-row` | parts of the above | — | 99, 4, 3, 66 |

Room shells: one generator for every `RoomKind` with a style per kind in `kit/rooms.json` (floor:
planks, checker, carpet or plain; wall, wainscot, rail, cap, skirting, frame, window and door
colours). A shell has baseplates, a floor layer, one-stud walls inside the room's rect with the
banded finish, skirting, window openings filled with 4 × 18-plate window modules from 90 cm, door
openings (16 studs, 2.1 m) with a frame and a threshold, a door leaf in the room that declares the
door and a doorway in the room it opens into (`room_specs` finds them in the layout). Rooms over
8 m a side are cut into chunks of at most 8 × 8 m; a window module across a chunk edge is left
out. The demo office's eleven shells have 2,365 to 4,443 parts.

### 12.4 Summary rules (for owner review before K-4)

Derived only from geometry and part tags:

| Capability | Rule |
|---|---|
| seat | a `seat` part whose top is 16–28 plates high (40–70 cm); `seats` counts them |
| work surface | the largest flat area at 28–32 plates (70–80 cm) with nothing but parts on it, stud² |
| workstation | a work surface of at least 64 stud² (0.25 m²), a `screen` or `paper` part, and a port accepting `seat` |
| light | `light-emitter` parts (`lights` counts them) |
| storage | top area of `shelf` parts, stud² |
| screen, door, window | parts with that tag |
| surfaces, parts, cost | named surfaces; every part; the sum of catalogue prices |

A design may declare a capability tag only if its geometry backs it (`tag-not-met` otherwise).

### 12.5 Summary contract

`crates/kit/tests/contract.rs` holds this table and checks it against sim-core's
`EquipmentKind` (every kind mapped, attachments on the matching desk port, the desk's seat port
750 mm in front of its centre, as `SEAT_OFFSET_MM`).

| Sim kind | Design | Mount | Must summarise as | Measured | Footprint (cm) | Sim footprint (cm) |
|---|---|---|---|---|---|---|
| `desk` | `desk` | floor | workstation; ports `screen` (screen), `lamp` (light), `seat` (seat) | work surface 288 stud², paper, 3 ports | 150 × 75 | 120 × 120 |
| `monitor` | `monitor` | surface | screen; surface `monitor` | 1 screen | 62 × 25 | on a desk |
| `color-monitor` | `color-monitor` | surface | screen; surface `monitor` | 1 screen | 75 × 25 | on a desk |
| `desk-lamp` | `desk-lamp` | surface | light | 1 light | 12 × 25 | on a desk |
| `ceiling-light` | `ceiling-light` | ceiling | light | 1 light | 25 × 25 | ceiling |
| `whiteboard` | `whiteboard` | floor | surface `whiteboard` | — | 125 × 50 | 100 × 100 |
| `archive-shelf` | `archive-shelf` | floor | storage | 480 stud² | 112 × 43 | 100 × 100 |
| `coffee-machine` | `coffee-machine` | floor | no seat, not a workstation | — | 100 × 50 | 80 × 80 |
| `plant` | `plant` | floor | no seat, not a workstation | — | 50 × 50 | 60 × 60 |
| `camera-rig` | `camera-rig` | floor | no seat, not a workstation | 1 screen (its back display) | 100 × 100 | 100 × 100 |
| `mood-board-wall` | `mood-board-wall` | floor | surface `mood-board` | — | 212 × 50 | 100 × 100 |
| desk seat | `chair` | floor | 1 seat | seat top 45 cm | 50 × 50 | — |
| table seat | `stool` | floor | 1 seat | seat top 45 cm | 37 × 37 | — |
| table | `meeting-table` | floor | seat ports; not a workstation | 8 seat ports, work surface 448 stud² | 150 × 150 | — |

Every design that is not a seat seats nobody, and only the desk is a workstation.

### 12.6 Measurements

Native, release build with LTO (`cargo bench -p kit --bench compile`, Apple M3 Max, shared
machine), median of Criterion's estimate:

| Case | Time | Target |
|---|---|---|
| `desk` (204 parts) | 0.118 ms | < 5 ms in wasm |
| `desk` with instance buffers | 0.129 ms | |
| `chair` (44 parts) | 0.040 ms | |
| `archive-shelf` (697 parts) | 0.231 ms | |
| newsroom shell (8 × 6 m, 4,443 parts) | 4.24 ms | |
| newsroom: shell and its 26 placements, each design compiled once, with buffers (6,085 parts) | 4.58 ms | < 200 ms a room |
| newsroom, every placement compiled | 5.73 ms | < 200 ms a room |
| the whole demo office: 11 shells and every placement | 33.2 ms | |

The wasm module (`cargo xtask wasm --release`) is 213,527 bytes gzip (1,202,214 raw, half of it the
name section); CI's budget is 266,909 bytes. Wasm compile times are measured with the renderer in
K-3.

### 12.7 Open points

- **Footprints against the sim.** The sim's equipment footprints are spacing radii (a desk keeps
  ±0.6 m), while the shipped desk is 1.5 m wide (the renderer has drawn 1.4 m since FEAT-020), the
  whiteboard 1.25 m, the archive shelf 1.13 m, the coffee counter 1 m and the mood board 2.1 m.
  Desks may be placed 1.2 m apart by the sim. The desk's `half` parameter goes down to 10 (1.25 m);
  K-4 should take footprints from summaries.
- **Hallways** have no shell: the corridor's outer walls and the street entrance are the
  renderer's (or a later hallway generator's) job.
- The camera rig's back display counts as a `screen`; the camera rig has no light.
- Parameters cannot be divided (no `/`), so designs that must be symmetric take a half-size
  parameter (`desk.half`, `meeting-table.r`).
