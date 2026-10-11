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
adrs:
  - ADR-0065
  - ADR-0087
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

## Not built yet

- The other model stages of construction-kit.md §7 (`brief#0` from words alone, `decor#0`,
  `design#0`, `preview`); the brief comes from the CEO's form.
- The renderer animating the bricks in build order (the sim places the items one by one; the
  renderer follows `layoutRev`).
- Custom designs (needs the sim's `PlaceObject`, K-4); removing or moving existing equipment in a
  plan.

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
