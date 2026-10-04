---
id: FEAT-003
title: "Building, rooms and devices"
status: in-progress
importance: critical
paths:
  - crates/sim-core/src/building.rs
  - crates/sim-core/src/equipment.rs
  - crates/sim-core/src/geom.rs
adrs:
  - ADR-0003
  - ADR-0006
---

# Building, rooms and devices

> **Status note (2026-10-04):** Built and tested. The lot, rooms, walls, doors, windows, light and
> capacity are in `crates/sim-core/src/building.rs`, devices in `equipment.rs`, the tile grid in
> `geom.rs`; their unit tests live in those modules. Placement validation is in `validate.rs`; its
> building and equipment tests are mapped in `docs/test-map.yaml`. One floor only (M1 limit),
> room kinds are code, not a `config/rooms.ron` file.

Lot, floors, walls, doors and windows on a 1 m grid. Rooms (Newsroom, EditorOffice, MeetingRoom,
Archive, PhotoStudio, SeoLab, TranslationDesk, DesignStudio, CeoOffice, Kitchen, ServerRoom) with
level, rect, doors, capacity and derived light (Off/Dim/On). Devices/equipment (Desk, Monitor tier,
DeskLamp, CeilingLight, Whiteboard, ArchiveShelf, CameraRig, ColorMonitor, MoodBoardWall,
CoffeeMachine, Plant) with Off/On/InUse state, screen mode and upkeep.

Decisions: [ADR-0003](../../adr/0003-deterministic-lockstep-server-authority.md), [ADR-0006](../../adr/0006-baked-gi-dynamic-lights-day-night.md).

## Acceptance criteria

- [ ] Placement commands validate footprint, overlap, door clearance and room kind rules; invalid placements reject with a reason.
- [ ] Room light derives from occupancy, phase and daylight deterministically.
- [ ] Room capacity (seats) and missing-room rules disable or degrade pipeline stages.
- [ ] Room kinds unlock per company level (see game design).

## Evidence

- `swarmpress/nextest`
- `swarmpress/wasm-bindgen-test`
