---
id: FEAT-003
title: "Building, rooms and devices"
status: planned
importance: critical
paths:
  - crates/sim-core/src/building.rs
  - crates/sim-core/src/rooms.rs
  - crates/sim-core/src/devices.rs
  - crates/sim-core/src/placement.rs
  - "crates/sim-core/tests/building*.rs"
  - config/rooms.ron
adrs:
  - ADR-0003
  - ADR-0006
---

# Building, rooms and devices

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
