# ADR-0087 — Building in the game: build mode, the town designer and the office designer

**Status:** Accepted (implements ADR-0065 §5–7 increments K-5 and K-6; amends ADR-0086 decision 4)
**Date:** 2026-10-11

## Context

ADR-0065 decided the construction kit, two company modes (sandbox and economic), player building
(FEAT-026) and an office designer on the staff (FEAT-084), all "after the MVP". The office, its
rooms and the town of sections (ADR-0086) are now drawn in bricks, and the owner asked on
2026-10-11 to build the designers now: the room and office designer for the player, the office
designer as a staff member, and a town designer. ADR-0086 made the town generic: the same for every
company, never themed after its content.

The sim already validates and prices `PlaceRoom`, `PlaceEquipment` and `Demolish` (funds, overlaps,
wall and seat clearance, required room kinds, people in the way, the structure check), but no UI
sends them, nothing moves a placed item, the renderer reads the layout once at boot, and the town is
computed in the renderer.

## Decision

1. **Build mode** (FEAT-026, K-5): a *Build* section of the shell. The player picks a room, places
   equipment from the kit's catalogue (2 × 2 brick icons, prices), moves and turns it with a ghost
   preview on the stud grid, removes it, and builds rooms from templates (`PlaceRoom` presets) or
   demolishes them. Every action is a sim command, validated by the sim before it is sent
   (`validate_command_json`); the sim stays the only judge (rule 3).
2. **`MoveEquipment { equipment, placement }`**: a placed item keeps its id (desk assignments, the
   items on a desk move with it); validated like `PlaceEquipment` against everything but itself;
   refused while someone sits at it.
3. **Modes** (ADR-0065 §5): `BuildMode { Sandbox, Economic }` on the company, chosen at founding,
   shown in the HUD. Sandbox builds cost nothing; economic builds cost their price. Construction
   time and the Build Approval ticket come with the office designer (decision 6).
4. **The town designer; the town becomes company state** (amends ADR-0086 decision 4): the town's
   houses, trees, lamps and benches are sim state (`Building.town`), seeded deterministically with
   today's generic arrangement from the lot and its entrance. The player moves them and places or
   removes trees, lamps and benches (`PlaceTownItem`, `MoveTownItem`, `RemoveTownItem`); the
   sections' houses can move but not be removed. The town stays **generic** in what it is made of:
   the same kit pieces for every company, never themed after the company's site; only their
   arrangement is the player's.
5. **The renderer follows the layout**: the render state carries `layoutRev`, raised by every
   building change; the renderer then reads `layout_json` again (including the town) and rebuilds.
   The render-state contract changes accordingly (rule 8).
6. **The office designer** (FEAT-084, K-6): a deterministic layout solver turns placements by
   relation (`{design, anchor, from, gap, facing}`) into positions or issues; checks (collisions,
   walkability, door clearance, light at workstations, requirements, cost) return issues by id;
   catalogue slices and their docs are generated from the kit. The build job is staged like an
   article (brief, layout, solve, fix, decor, preview); the plan is an artifact (rule 3); in
   economic mode a Build Approval ticket (default Defer) precedes a construction job, whose
   placements the renderer animates in build order. Designs and text never enter the sim (rule 2):
   placements enter as commands.
7. **The design editor** (K-5): edit a design brick by brick (place, remove, paint, turn, box fill,
   mirror, local undo), compiled live by the kit; finished designs are kept in the company's design
   library. Placing a custom design needs the sim's `PlaceObject` with a design summary (ADR-0065 §4,
   K-4); until then custom designs are previewed and kept, not placed.

## Consequences

- The office and the town become the player's; the town is no longer identical across companies,
  though built from the same generic pieces.
- New commands and render-state fields move the sim's goldens once.
- The renderer rebuilds on layout changes (a cost of about a second on the owner's machine; per-room
  rebuilds can follow).
- **Negative:**
  - A large surface: commands, validation, renderer picking and ghosts, a new section, a solver, a
    staged job, a ticket kind, an animation; the tests grow with it.
  - Custom designs cannot be placed until K-4 lands, so the editor's output is first a library.
  - Sandbox companies build for free; ADR-0065 keeps them unranked.
- **Alternatives rejected:**
  - *Keep the town in the renderer, only the office editable.* The owner asked for a town designer;
    a town only the renderer knows cannot be saved, synced or replayed.
  - *Move as demolish plus place.* It loses the item's id and the desk's assignment and charges twice.
