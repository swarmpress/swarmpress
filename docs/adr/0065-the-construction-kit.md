# ADR-0065 — The construction kit

**Status:** Accepted (amends ADR-0063; amends ADR-0043 for prop packs)
**Date:** 2026-10-03

## Context

ADR-0063 decided that the office is drawn in bricks generated from the sim's layout, with the sim
unchanged and building kept at today's object level. The owner then set the goal higher: the bricks
are a **construction kit** that players use to build new rooms and objects, and that the company's
staff, steered by the browser model (ADR-0057), can use fully as well.

That changes what the bricks are. If a desk only counts as a workstation once it has a seat and a
screen, built objects affect gameplay, and gameplay state must be deterministic, replayable and
synced. But thousands of bricks per room cannot be sim state or command-log entries without making
snapshots and replay heavy, and a small, greedy model without vision cannot place things by raw
coordinates reliably.

Detail: [`docs/design/construction-kit.md`](../design/construction-kit.md).

## Decision

1. **Four layers:** parts (a fixed catalogue), designs (named builds of parts and other designs, with
   ports, tags and parameters), rooms (a shell from the sim's room, placements, surfaces, and
   requirements) and buildings.
2. **Designs are content.** A design is data in a closed brick script, identified by a
   domain-separated SHA-256 hash of its canonical form, stored in the browser store, backed up with
   the work records (ADR-0056) and mirrored to the state repository. It carries provenance (kit,
   player, staff, pack).
3. **One deterministic compiler,** `crates/kit` (native and wasm), turns a design into bricks for the
   renderer and into a **summary** of capabilities (footprint, tags, seats, workstation, light,
   storage, screens, surfaces, part count, cost).
4. **The sim holds capabilities, never bricks.** After the MVP, objects are placed with
   `PlaceObject{design ref, params, position, turn, summary}`; the sim's equipment kinds become
   capability tags; replay applies summaries and never re-runs the compiler. A central audit can
   recompute summaries from synced designs. In the MVP the sim is unchanged: the renderer maps each
   equipment kind and room kind to a shipped design.
5. **Two modes per company:** a free, instant sandbox (unranked), and an economic mode in which
   builds cost money and game time and need the CEO's approval above a threshold (a Build Approval
   ticket with a preview, default Defer, like the publish gate of ADR-0059).
6. **Players** build at every layer after the MVP: place and configure designs, edit designs brick
   by brick (undo local to the editor; one command per committed design), and create rooms from
   templates.
7. **Staff build with the browser model** after the MVP, through an **office designer** role. The
   model places by relation to anchors and a deterministic layout solver computes positions; each
   call sees only the relevant slice of the catalogue, with docs generated from the kit; deterministic
   checks return issues for a repair loop; the plan is an artifact and the orchestrator decides
   (rule 3). Building is a staged job with the same stage store and activity as articles
   (ADR-0058), and construction is a job staff carry out visibly.
8. **Extensions:** ADR-0043's prop packs become design packs in the brick script; an extension may
   ship a design generator that runs in the sandbox, and its output is validated like any design.
9. **MVP scope:** the kit core (parts, design format, compiler, shipped designs) and the brick
   office renderer built from it (FEAT-083, FEAT-081). Player building (FEAT-026) and staff building
   (FEAT-084) come after the first live articles.

## Consequences

- One foundation serves the renderer, players, staff and extensions; the spike ports the prototype
  into the kit instead of a one-off generator.
- Saves, sync and replay stay small and fast: a design is committed once, a placement is one command.
- Built work is attributable and shareable (`.room`, `.building`, design packs).
- **Negative:**
  - A new crate with its own schema, script and versioning to maintain; compiler output must stay
    deterministic across hosts.
  - The post-MVP change from equipment kinds to tags touches staff behaviour, the economy and the
    goldens.
  - What counts as a seat or a workstation becomes game design encoded in summary rules.
  - Model-driven building is unproven on a 27B ternary model; new-design generation may stay off.
  - Two modes double some testing, and sandbox companies need to be excluded from leagues.
- **Alternatives rejected:**
  - *Bricks in the sim* (every brick deterministic state, every edit a command): heavy snapshots and
    logs, slow replay.
  - *Bricks only as visuals* (ADR-0063 as first written): players and staff could not build anything
    that matters.
  - *The model writes coordinates and raw voxels:* unreliable for a small model without vision;
    relations, a solver and a closed script are the usable surface.
  - *Builds by the design department* (FEAT-035): it is already responsible for the site's theme and
    would compete for the same people and model time.
