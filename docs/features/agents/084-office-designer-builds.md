---
id: FEAT-084
title: "The office designer: staff build with the construction kit"
status: in-progress
importance: normal
paths:
  - "crates/office-designer/**"
  - "crates/kit/src/solver/**"
  - "crates/agents/src/build/**"
  - "crates/agents/prompts/office_designer.md"
  - "crates/orchestrator/src/build.rs"
  - "crates/orchestrator/tests/build.rs"
  - "crates/sim-core/src/interior.rs"
  - "crates/sim-core/tests/interior.rs"
  - "crates/agents/personas/ottavia.toml"
  - "apps/game/src/blueprint/interior.ts"
  - "apps/game/src/blueprint/interior.test.ts"
  - "apps/game/e2e/luna-interior.eval.mts"
adrs:
  - ADR-0065
  - ADR-0087
  - ADR-0088
  - ADR-0057
  - ADR-0058
  - ADR-0059
---

# The office designer: staff build with the construction kit

After the MVP. An office designer on the staff plans and builds rooms with the browser model: the
model places designs by relation to anchors (walls, windows, doors, other placements) and a
deterministic layout solver computes positions; each call sees only the slice of the catalogue that
fits the room and brief, with generated docs; deterministic checks (collisions, walkability, door
clearance, light at workstations, requirements, cost) return issues for a repair loop. The build is a
staged job (brief, layout, solve, fix, decor, rarely a new design, preview); in economic mode a Build
Approval ticket follows, and a construction job places the objects while the renderer animates the
bricks in build order.

Design: [`docs/design/construction-kit.md`](../../design/construction-kit.md) section 7 (increment K-6).

Depends on: FEAT-083 (kit core), the sim capability change (K-4), FEAT-032 (staged jobs), FEAT-079
(approval tickets).

## Built (2026-10-11): the deterministic core, `crates/office-designer`

ADR-0087 decision 6. MIT, wasm-compatible, integers only (mm, studs, cents), no I/O; depends on
`crates/kit` for the shipped designs' compiled summaries; `sim-core` is a dev-dependency only.

- **Relation schema** (`plan.rs`): a plan is `{"placements": [...]}` of `{design, anchor, from,
  side, gap, offset, facing, count, spacing}`; designs are the sim's equipment kinds (a closed
  enum), anchors `wall:north|east|south|west`, `window:N`, `door:N`, `placement:N` (earlier only),
  `equipment:ID`, `room-centre`; distances in studs. The parser reports every bad placement with
  its index; `plan_schema` / `fix_schema` generate the JSON Schema, closed to a catalogue slice
  and to one room's windows, doors and equipment ids.
- **Layout solver** (`solve.rs`): relations → `SolvedItem { design, Floor { x_mm, z_mm, rot } |
  OnDesk(Planned { placement, copy } | Existing { id }) }` in build order (the sim's
  `PlaceEquipment`), on the 2-stud grid, or an issue per placement (`unknown-anchor`,
  `forward-reference`, `bad-relation`, `depends-on-failed`, `not-a-desk`, `slot-taken`,
  `wrong-room`, `does-not-fit`).
- **Checks** (`check.rs`): walls (kit footprint and chair inside the walls; the sim's 0.3 m and
  0.2 m clearances), collisions (the sim's spacing rule and the kit footprints and chairs; ceiling
  lights 0.5 m apart), the table and its seats in meeting rooms, strategy rooms and kitchens, 1 m
  clear in front of every door, walkability (125 mm grid, 0.25 m half-person, BFS from door 0 in
  the sim's fixed N, E, S, W order: new chairs, other doors, table seats and existing chairs),
  light (a ceiling light within 2.5 m or a window within 3 m of every new desk), 64 items per
  room, the brief (workstations = desks with a screen, meeting seats from the room's size,
  storage, writing surfaces, coffee, plants), cost against the budget (the sim's prices) and part
  count (kit summaries). Issues have ids, a closed code, the placement and a plain message; what
  the room already had wrong is a warning.
- **Catalogue slices and docs** (`catalogue.rs`): the designs for a room kind and brief, one line
  each generated from the kit's summary and the sim's rules; the room by its anchors; the relation
  vocabulary; `layout_context` joins them for `layout#0`.
- **Repair driver** (`repair.rs`): `next_step` → `Done`, `Repair { fix: [placement], issues }` or
  `GiveUp` (the limit, or a room too small for the brief); `PlanFix { replace, remove, add }`
  applied only to the named placements, removals renumbering references.
- **Tests**: `crates/office-designer/tests/` with fixtures per room kind (a meeting room for
  eight, a newsroom for three writers, an archive, the kitchen, a dark office) whose good plans
  solve with no errors and whose bad plans give exactly the expected errors; same bytes for the
  same input; the schema and the parser agree; every mirrored rule equals sim-core's; the
  fixture rooms are the sim's rooms; every solved fixture placement is applied to a sim world
  command by command and accepted; and a generated property test: whatever the designer
  accepts, the sim accepts.

## Built (2026-10-12): the staff job, the gate and the construction

- **The role and a person:** `OfficeDesigner` (`office-designer`, Web Development department) in
  the sim and in `agents`, with Ottavia Rinaldi (`ottavia`, id 118) in both catalogues; the CEO
  hires her like anyone (she is in the daily pool, and `ArrangeHiring` for the role finds her).
  The `designer` scenario is the demo company with her on the staff. Her company prompt is
  `prompts/office_designer.md`, her job kind `office-layout`.
- **The command** (`crates/sim-core/src/interior.rs`): `CommissionInterior{room, brief_ref}`; the
  host first stores `{words, brief}` under `brief_ref` (`apps/game/src/blueprint/interior.ts`,
  `orchestrator::interior_brief`). An `Interior` work item (Draft, Publish) outside the WIP limit;
  no designer: it waits with a `MissingRole` ticket and starts once one is hired.
- **The Draft** (`crates/orchestrator/src/build.rs`, job `interior-design`): the room comes from
  the host (`Sim.interior_context_json`, the sim's `World::designer_room`), the brief from the
  store; `layout_context` + `plan_schema(slice, room)` → one structured `office layout` call →
  `evaluate` → `next_step`, at most `MAX_REPAIR_ROUNDS` `office layout fix` calls (`fix_schema`,
  `apply_fix`), each cached as a stage. Done: the item's artifact is a `RoomPlan` (items in build
  order, `on_desk` `{planned: i}` or `{existing: id}`, cost, parts, summary, warnings), an
  `artifact` post, then `InteriorPlan{job_id, items}` (numbers only) and `JobCompleted{ok, score:
  min(items, 10), qa_defects: repair rounds}`. GiveUp or a model failure: a status post and
  `JobFailed` (rule 11).
- **The gate:** economic companies park the item at `BuildApproval` (CEO-only; `Build`, `Defer`
  (default, also on expiry), `Decline`; amount: the plan's price); sandbox companies build at once.
- **The construction:** the Publish phase requests `construct` (the job posts the build's start)
  and the sim places one item every 5 game minutes as a `PlaceEquipment`, validated and charged at
  its own price; a refused item stops the build with an escalation naming the item (`refused`),
  `Retry` resumes. The last item placed: Published.
- **The fake designer** (`agents::build::fake`, its twin in `apps/game/src/llm/mvp-script.ts`):
  a plan from the brief and the room doc, and a fix that moves each named placement to the next
  wall.
- **Tests:** `crates/sim-core/tests/interior.rs` (the item, the gate per mode, the ticket, the
  construction and a refusal, the waiting item, validation, determinism),
  `crates/orchestrator/tests/build.rs` (the Draft with the fake, a repair round, the failure
  paths, the construction job, and commission → draft → Build → construction end to end on the
  sim, twice, the same hash), `apps/game/src/blueprint/interior.test.ts` (the host side, the fake's
  twin, the real sim's view). The golden script commissions a room with no designer (world
  format 9).

## Built (2026-10-12): the designer sees the players' own designs (ADR-0087 decision 7, ADR-0088)

- **The room context:** `World::designer_room` lists the room's placed objects
  (`DesignerRoom.objects`, serde default for older JSON): `{id, x_mm, z_mm, rot, footprint_mm
  (studs × 62.5 rounded up, unturned), workstation, seat_at_mm (unturned), on_desk {desk, slot},
  seats, lights, storage, screens}`; numbers only, in id order. `office_designer::Room.objects`
  (`ExistingObject`) reads it.
- **Checks, mirroring the sim** (`objects::equipment_hits_object`, `desk_slot_taken`,
  `items_in_room`): a planned floor item whose spacing square, desk chair square, kit footprint or
  chair overlaps an object's turned footprint or a workstation object's 0.5 m seat square is a
  `collision` naming `equipment:object-N (the CEO's own design)`; a slot a desk-top design holds is
  `slot-taken`; objects count towards the 64 items; floor objects are walking obstacles and a
  workstation object's seat must stay reachable; workstation objects count as workstations, a
  screen design on a desk makes it one, shelf designs count as storage, and a floor design with a
  light lights desks within 2.5 m. Object seats do not count as meeting seats (ADR-0088 decision 4).
- **The prompt:** the room doc lists each object as `- equipment:object-N: the CEO's own design,
  W × D at …; a workstation, its seat at … (keep 0.5 m around the seat free); it has storage. Keep
  off it.` or `… on equip-N's lamp slot (that slot is taken).`; floor objects are anchors
  (`equipment:object-N`, in the closed schema); desk-top ones are not. The fakes (Rust and the
  browser twin) count the CEO's workstation and storage designs.
- **Tests:** the `studio` fixture (a built-in desk with a desk-top design, a workstation design and
  a shelf design; good and bad plans), `sim_contract.rs` (the fixture rooms equal the sim's
  `designer_room` JSON; the property test furnishes every other case with random objects and
  desks, `PROPTEST_CASES` cases per room), `sim-core/tests/interior.rs`
  (`the_designer_room_lists_the_players_objects`), `orchestrator/tests/build.rs` (a fake row on
  the CEO's desk never reaches the sim; a lamp on a slot a design holds is refused; commission →
  Build → construction end to end with the CEO's desk in the room, no escalation).

## Evaluation on GPT-6-Luna (2026-10-12)

The driver `apps/game/e2e/luna-interior.eval.mts` (run with `bun`, not a Playwright test) founds a
fresh company through the dev login on the central server, buys land and adds the fixture world's
empty archive and newsroom, hires the office designer through the `MissingRole` ticket, commissions
five rooms one after the other through the overlay store's `commissionInterior`, waits for each plan
or failure, builds the first plan (economic `Build`) and declines the others. Only the designer's
calls (and the model's warm-up and qualification turns) reach the model; every other staff call is
answered by the driver with an empty text, so the rest of the company fails its jobs at no cost.
Results: `artifacts/bench/office-designer-luna.json` (`bench/office-designer`).

Two companies, five briefs each, 26 hosted calls in all (20 by the designer, 6 startup turns, two
of them in a session aborted for the hiring defect below):

| Brief (room) | Plans | Repairs (run 1, 2) | Items | Cost | Brief met | Designer calls | Wall time |
|---|---|---|---|---|---|---|---|
| Newsroom, 3 workstations, 1 plant (new 6×6 m) | 2 of 2 | 1, 1 | 10: 3 desks, 3 monitors, 3 ceiling lights, 1 plant | €2,510 | yes, yes | 2, 2 | 56 s, 62 s |
| Meeting room, 8 seats, 2 writing surfaces, 2 plants (demo, has a whiteboard) | 2 of 2 | 1, 0 | 3: whiteboard, 2 plants | €300 | yes, yes | 2, 1 | 26 s, 34 s |
| Kitchen, 6 seats, coffee, 2 plants (demo, has the coffee machine) | 2 of 2 | 0, 0 | 2 plants | €100 | yes, yes | 1, 1 | 30 s, 22 s |
| Archive, 5 storage, 1 plant (new 4×6 m) | 2 of 2 | 0, 1 | 6: 5 shelves, 1 plant | €1,800 | yes, yes | 1, 2 | 14 s, 30 s |
| SEO lab, 3 workstations (has 1), 1 plant, budget €1,500 | 2 of 2 | 1, 2 | 5: 2 desks, 2 monitors, 1 plant | €1,450 | yes, yes | 3, 5 | 90 s, 118 s |

- **10 of 10 plans, 10 of 10 briefs met by count, both budgets kept, no GiveUp, no warnings** in
  any stored plan; 7 repair rounds in all (at most 2 per brief, the limit is 3).
- **What the repairs fixed** (the issues each fix call was given, recorded in run 2): `no-light`
  (a newsroom desk with no ceiling light within 2.5 m and no window within 3 m: the fix added
  ceiling lights), `does-not-fit` (a row of 5 shelves needing 6.13 m on a 5.87 m wall; a row of 2
  desks needing 5 m on a 3.87 m wall, then 4.5 m on 4.31 m) with its `depends-on-failed` and
  `requirement-missing` consequences.
- **The construction:** the newsroom's Build in both companies placed 10 of 10 items, the item was
  Published, and the company paid exactly the plan's €2,510.
- **Calls and tokens** (20 designer calls): 55,252 input tokens (20,507 cached), 18,311 output of
  which 17,230 reasoning; $0.0096 by the server's ledger. A layout call took 12 to 78 s, a fix 2 to
  19 s; a brief 14 to 118 s (mean 48 s), almost all of it the model.
- **Failure mode: the reasoning eats the answer.** The bridge sends `max_output_tokens` = the answer
  budget plus a 512-token reasoning allowance (2,112 for a layout, 1,712 for a fix) at effort
  `medium`; Luna spent 375 to 2,112 reasoning tokens per layout. 3 of 20 designer calls ended with
  `length` and no answer, all three on the tight-budget brief (its layout in both runs, a fix in
  run 2). The structured repair turn recovered each one (answered with no reasoning, 65 to 79
  tokens), at the price of an extra call. The cap is set in the orchestrator's shared `propose`
  (`reasoning_tokens: Some(512)`) and `agents::build::{LAYOUT_ANSWER, FIX_ANSWER}`. Since the
  evaluation the designer's layouts and fixes have their own allowance,
  `agents::build::LAYOUT_REASONING` = 2,048 (still within a local model's window; test
  `the_checkers_issues_are_repaired`). Re-run once after both fixes (one company, the same five
  briefs): 5 of 5 plans, every brief met, the tight budget kept (€1,450 of €1,500), 8 designer
  calls (5 layouts, 3 fixes; repairs 0, 0, 0, 1, 2), **no call ended with `length`** (the newsroom
  layout reasoned 1,915 tokens), the office designer shortlisted once, and the newsroom's Build
  placed 7 of 7 items for exactly the plan's €2,150.
- **Defect, fixed:** a plan that places nothing (the room already has what the brief asks for)
  completed the job with an empty `InteriorPlan`, which the sim refuses ("a room plan places at
  least one item"), leaving the item Blocked behind a generic escalation and an artifact post
  "€0.00, 0 parts". Seen in the driver's dry run on the scripted model (a room asked for again after
  it was built, and a brief the editor's office already met), not in the Luna runs. The job now
  fails with the reason in the thread (`build.rs`; test `a_plan_that_places_nothing_fails_with_the_reason`).
- **Defect, fixed (world format 12):** `ArrangeHiring` for the office designer adds a candidate with
  persona 0 when Ottavia, the catalogue's only office designer, is already on today's list
  (`World::add_candidate_for_role` falls back to `PersonaId(0)`). In one company today's list held
  `candidate-4 ottavia` and the ticket added `candidate-7 office-designer persona-0`; hiring the
  latter makes every `interior-design` job fail before any call ("prompt: unknown persona
  persona-0") and the session retries it without end. The shortlist now adds no candidate while
  one for the role is listed, nor one without a persona (test
  `hiring_twice_never_makes_a_nameless_designer`). The driver still picks the candidate by trying
  each hire on a snapshot copy of the world.
- Not measured: the owner's judgement of the layouts; the browser model; sandbox mode; the
  `brief#0`, `decor#0` and `design#0` stages (not built).

## Not built yet

- The other model stages of construction-kit.md §7 (`brief#0` from words alone, `decor#0`,
  `design#0`, `preview`); the brief comes from the CEO's form.
- The renderer animating the bricks in build order (the sim places the items one by one; the
  renderer follows `layoutRev`).
- Placing the players' own designs from a plan (the designer sees them, but plans only the
  sim's equipment kinds); removing or moving existing equipment or objects in a plan.

## Acceptance criteria

- [ ] A meeting-room brief yields a valid layout meeting the room's requirements within the repair
      limits, on the fake model and in the eval on the real model.
- [ ] Unknown design or colour ids come back to the model as validation errors.
- [ ] In economic mode nothing is placed before the CEO approves; in sandbox mode it is immediate.
- [ ] Construction animates over the job's game time and ends with the sim's objects in place.

## Evidence

- `swarmpress/nextest` (the `office-designer`, `sim-core` and `orchestrator` crates' cases, until a split routes them)
- `agents/nextest`
- `game/vitest`
- `bench/office-designer` (`artifacts/bench/office-designer-luna.json`, the GPT-6-Luna eval above; run by hand)
