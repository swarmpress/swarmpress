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
| | `pose` | Walk, Sit, Type, Talk, Listen, Think, Present, Sleep, Celebrate, Frustrated | built today: Walk, Sit, Type, Talk, Listen, Idle. `Type` means a job: at the desk with `work_item` set; a seated person without one is `Sit` |
| | `activity` | label id | localised in the client |
| | `work_item` | `Option<WorkItemId>` | the item whose active phase the person works on (`World::busy_with`); built |
| | `fatigue_band`, `morale_band` | 0..4 | |
| Bubbles | `meeting`, `seq`, `speaker`, `started_step`, `until_step`, `chars` | | built. One per meeting with a turn in progress. Text is fetched by reference |
| Props | `moodboard`, `whiteboard`, `pinned_screenshots` | content ids | textures resolved by the client |
| HUD | `cash_cents`, `reputation`, `audience`, `inbox_open`, `level` | | |

## Bubbles and who works on what (built, FEAT-079)

`RenderState.bubbles: Vec<BubbleRender>` and `StaffRender.work_item` exist in
`crates/sim-core/src/render_state.rs`, and in `render_state_json()` as `bubbles[]` (`meeting`,
`seq`, `speaker`, `startedStep`, `untilStep`, `chars`) and `staff[].workItem`.

- A bubble exists while a meeting's turn is in progress. A `ServerCommand::Utterance{meeting,
  seq, speaker, chars}` starts it at the current step and sets how long it stays up
  (`10 + chars × 2 / 3` steps, about 15 characters per real second); the meeting keeps
  `speak_from`, `speak_until` and `speak_chars`. The next utterance replaces it; at `until_step`
  it is gone.
- **Text never enters the sim** (rule 2). A bubble carries who speaks, which turn (`seq`), when
  and for how many characters. The client fetches the words from the store's transcript by the
  meeting's job (`meetings[].job` while the standup's outcome is awaited, or the `meeting` of the
  job request) and `seq`. The typewriter effect is the client's.
- `work_item` is the item whose active (`Working`) phase is assigned to the person: the writer
  while a draft runs, the editor during a review, the publisher during a publish. Nobody has one
  while an item is parked at the publish gate or blocked. The pose follows it: seated at the desk
  with a work item is `Type`, without one `Sit`.

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
