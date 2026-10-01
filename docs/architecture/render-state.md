# Render-state contract

The renderer draws exactly what the sim says and decides nothing
([ADR-0007](../adr/0007-sim-renderer-render-state-contract.md)). This document is the contract
between `sim-core::render_state()` (Rust), `client-wasm` (transport) and
`apps/game/src/state/render-state.ts` (the TS mirror). Feature: FEAT-023.

## Transport

- `Sim::render_state_bytes() -> Vec<u8>`: the postcard-encoded `RenderState`, without staff
  positions. Decoded in TS once per sim tick (10 Hz).
- `Sim::staff_buffer() -> Float32Array` view over wasm memory: a flat buffer of `[id, x, z,
  facing, path_start_step, speed, pose, …]` per staff member, read every frame without copying.
- `Sim::path(staff_id) -> Int32Array`: the current path's waypoints (grid cells), fetched only
  when `path_version` changes.

## Shape

| Group | Field | Type | Notes |
|---|---|---|---|
| Clock | `step`, `day`, `minute` | u64, u32, u16 | `minute` 0..1440 |
| | `phase` | enum | Night, Arrival, Standup, Work, Lunch, Evening |
| | `sun_elevation_mdeg`, `sun_azimuth_mdeg` | i32 | millidegrees. The TS `daylight()` derives the same from `minute` until the sim provides it |
| | `sky_tint` | u32 RGB | |
| | `weather` | enum | Clear, Cloudy, Rain (later from real weather for the site's region) |
| Rooms | `id`, `kind`, `floor`, `rect` | | layout (also in the snapshot) |
| | `light` | Off, Dim, On | |
| | `occupancy` | u8 | |
| | `alerts` | bitset | Crunch, Blocked, Understaffed, Upkeep |
| Devices | `id`, `kind`, `room`, `cell`, `rot` | | |
| | `state` | Off, On, InUse | |
| | `screen` | Idle, Typing, Review, Code, Screenshot, Error | drives the monitor texture |
| Staff | `id`, `persona`, `role` | | |
| | position and path | see the buffer | |
| | `pose` | Walk, Sit, Type, Talk, Listen, Think, Present, Sleep, Celebrate, Frustrated | |
| | `activity` | label id | localised in the client |
| | `fatigue_band`, `morale_band` | 0..4 | |
| Bubbles | `meeting`, `seq`, `speaker`, `started_step`, `chars` | | text is fetched by reference |
| Props | `moodboard`, `whiteboard`, `pinned_screenshots` | content ids | textures resolved by the client |
| HUD | `cash_cents`, `reputation`, `audience`, `inbox_open`, `level` | | |

## Interpolation

Staff positions between ticks come only from the sim path:

```
s = (render_time_step − path_start_step) × speed      // distance along the path, fractional
pos = point_at(path, s)
```

The renderer never pathfinds and never moves a character by itself. Animation phase offsets are
derived from `hash(staff_id, step)`, so two clients animate identically.

## Applying state

`applyRenderState(scene, office, lighting, state, center)`
(`apps/game/src/render/lighting.ts`) maps:
- room `light` to the intensity of that room's scoped lights and the emissive ceiling panels;
- devices to monitor emissives and desk lamps;
- staff to meshes, created lazily and disabled when absent.

M1 replaces this with a diffing apply, so unchanged rooms and devices are not touched each tick.

## Today's stand-in

Until sim-core's systems land (M1), `demoRenderState(minute, day)` hand-writes the same story:
- the office fills between 08:00 and 09:15;
- desk lamps come on after 17:00;
- most staff leave around 18:00;
- the deadline crew keeps editorial lit late.

Its vitest test is FEAT-023's evidence today. Once `render_state()` exists, shared fixtures
assert that the Rust encoder and the TS decoder agree.
