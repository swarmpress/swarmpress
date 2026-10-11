---
id: FEAT-026
title: "Build mode, the town designer and the design editor"
status: in-progress
importance: high
paths:
  - "apps/game/src/ui/build/**"
  - "apps/game/src/render/build-mode/**"
  - apps/game/src/build-bridge.ts
  - crates/sim-core/src/town.rs
  - crates/sim-core/tests/building.rs
  - "apps/game/e2e/build*.spec.ts"
adrs:
  - ADR-0087
  - ADR-0003
  - ADR-0065
  - ADR-0005
---

# Build mode and placement

> **ADR-0065:** build mode is the construction kit for players (after the MVP): place, move, turn and
> configure designs on the stud grid; edit designs brick by brick in a design editor (one command
> per committed design); rooms from templates; a sandbox or an economic mode per company. Design:
> [`docs/design/construction-kit.md`](../../design/construction-kit.md) section 6.

Picking on the grid, ghost previews, placement validated in wasm with `validate_command`, confirmed
by the server command.

Decisions: [ADR-0003](../../adr/0003-deterministic-lockstep-server-authority.md), [ADR-0005](../../adr/0005-orthographic-iso-dollhouse-camera-and-cutaway.md).

## Acceptance criteria

- [ ] Placement round-trip in Playwright: place, confirm, reload, still there.
- [ ] Invalid placements show the sim's rejection reason.

## Evidence

- `game/playwright-e2e`

## Built (2026-10-11, ADR-0087)

- **Sim** (`crates/sim-core`): `MoveEquipment` (keeps the id and the desk's assignment, attachments
  move with the desk, refused while in use); the company's `BuildMode` (Sandbox: every building
  command free; Economic: priced, moves at 10% of the item); the town as sim state (`town.rs`:
  houses, trees, lamps, benches seeded at founding with the generic arrangement; `PlaceTownItem`,
  `MoveTownItem`, `RemoveTownItem`; houses move but stay; spots outside the lot, inside the town plot,
  off the street, not overlapping); land purchases move the town out with the edge; `layoutRev` in the
  render state; `layout_json` writes `town` and `buildMode`; `price_command_json` and
  `Sim.demo_with(seed, mode)` in client-wasm. Goldens moved once (`WORLD_FORMAT` 8).
- **Renderer** (`render/build-mode/`, `build-bridge.ts`): the town drawn from the layout; a scene
  rebuild on a new `layoutRev` (about 350 ms, nothing leaked, the camera kept); the build bridge:
  stud-snapped picking of the floor, equipment, town items and rooms; green/red ghosts of any
  equipment or town design and of a new room's rectangle; highlights; drag capture; framing.
- **Build section** (`ui/build/`): Rooms (templates, two corners on the floor or typed, doors, a live
  slab; demolish), Furniture (the kit's catalogue as 2 × 2 bricks with the sim's prices; place, move,
  turn, remove; monitors and lamps onto desks), Town (move houses; place, move, remove trees, lamps,
  benches), Designs (the design editor), the mode badge; every action validated and priced by the
  sim, refusals with the sim's own reason.
- **Design editor** (`ui/build/DesignEditor.tsx`, `design-*.ts`): a shipped design opened as a copy
  or an empty one, edited layer by layer on the stud grid (place, remove, paint, box fill, copy and
  stamp, turn, mirror, undo and redo), compiled live by the kit (issues, parts, cost, hash, what it
  provides), kept in a library in this browser. Placing a design of one's own waits for the sim's
  `PlaceObject` (ADR-0065 §4, K-4).

