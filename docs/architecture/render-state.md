# Render-state contract

The renderer draws exactly what the sim says and decides nothing
([ADR-0007](../adr/0007-sim-renderer-render-state-contract.md)). This document is the contract
between `sim-core::render_state()` (Rust), `client-wasm` (transport) and
`apps/game/src/state/render-state.ts` (the TS mirror). Features: FEAT-023 (the contract),
FEAT-024 (people), FEAT-020 (the office).

## Transport (built)

- `Sim.layout_json()`: the building, once per page (`crates/client-wasm/src/json.rs`
  `layout()`): lot origin and size, wall height, floors, the street `entrance` (door centre and
  `spawn` point), and per room its rect, kind, label, level, capacity, `windows`, `doors`,
  `desks` (with their `seat`), `ceilingLights` and `props` (equipment that is not a desk or a
  ceiling light, with `attachedTo` for desk-top items).
- `Sim.render_state_json()`: the state, parsed once per sim step (10 Hz at speed 1; once per
  100 ms slice at higher speeds). Units are metres and radians; ids are strings (`staff-3`).
- Planned, not built: a postcard `render_state_bytes()` and a flat staff buffer read every frame
  without copying. The JSON is small enough today (about 13 KB for 13 people).

`render-state.ts` declares every field both views write. `render-state-shape.ts` lists the same
keys and enum values as data; each list is checked against its type at compile time (leaving a
key out does not compile), and `checkLayout` / `checkRenderState` check JSON against the lists
at run time. `render-state.wasm.test.ts` runs the real wasm sim through a day, a meeting turn and
a job and fails on any unknown or missing field or unknown value. The committed fixtures in
`apps/game/src/state/fixtures/` (written from `Sim.demo(42)`) feed the renderer's NullEngine
tests and are checked by the same functions.

## Shape

| Group | Field | Type | Notes |
|---|---|---|---|
| Clock | `step`, `day`, `minute`, `weekday`, `phase`, `daylight` | | `minute` 0..1440; phase night, arrival, standup, work, lunch, evening |
| | sun position, sky tint, weather | | not in the sim: the TS `daylight(minute)` derives sun and sky from `minute` |
| Money | `cashCents` | i64 | |
| Rooms | `rooms[]`: `id`, `kind`, `light`, `occupancy`, `capacity` | | `light` off, dim (people passing), on; `roomLights` is the same as a room id → not-off map |
| Devices | `devices[]`: `id`, `room`, `kind`, `state`, `user`, `attachedTo` | | `state` off, on, in-use (`user` is then the staff id); `monitors` and `deskLamps` are desk id → on maps |
| Staff | `id`, `persona`, `name`, `color`, `role`, `department` | | people on site only |
| | `x`, `z` | metres | the sim's position at `step` (on `path` while walking) |
| | `path` | `{ waypoints, startStep, speed }` or null | see [Interpolation](#interpolation) |
| | `pose` | walk, sit, type, talk, listen, idle | `type` is seated at the desk with a `workItem`; `talk` is the meeting's speaker |
| | `activity` | arriving, working, walking-to-meeting, in-meeting, walking-to-lunch, lunch, returning-to-desk, leaving | |
| | `seatedAt`, `meeting`, `workItem` | ids or null | the desk sat at; the meeting with a seat for them; the work item whose active phase they work on (`World::busy_with`) |
| | `fatigue`, `morale` | permille | |
| Meetings | `meetings[]`: `id`, `kind`, `project`, `room`, `day`, `start`, `end`, `active`, `attendees`, `speaker`, `job` | | |
| Bubbles | `bubbles[]`: `meeting`, `seq`, `speaker`, `startedStep`, `untilStep`, `chars` | | one per meeting with a turn in progress; text is fetched by reference |
| Planned | screen content, poses beyond the six, props' content (moodboard, whiteboard), HUD levels | | need a contract change before the renderer may show them |

## Bubbles and who works on what (built, FEAT-079)

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

Staff positions between steps come only from the sim path (`apps/game/src/render/characters/motion.ts`):

```
distance = clamp((display_step − path.startStep) × path.speed, 0, length)   // metres, fractional
pos      = point_at(path.waypoints, min(distance, sim_distance))             // axis-aligned segments
```

- `point_at` is sim-core's `Path::sample` evaluated for a fractional step (a vitest checks they
  agree at every integer step of the fixtures' walks).
- `display_step` trails the sim: when a step arrives it runs from where it is to that step over
  1.25 slices (125 ms), then waits. It never passes the sim's step, so a held or paused clock
  holds everyone still; a jump of more than 60 steps (night skip, reload, frozen time) is shown
  at once.
- `sim_distance` is where the sim's own `x`, `z` lie on the path: the drawn person is never past
  the sim's position and never on a different segment.
- A walk the sim has finished (or replaced by the next one from the same point) is drawn to its
  end before the next one starts, because the display trails by about a step.
- Facing is the direction of travel, eased over 0.3 m after a corner; seated or standing still,
  people turn to their desk (`seatedAt`) or to the middle of the table room (meeting seats and
  kitchen seats are around the room's centre, sim-core `table_seat`).
- Pose motion (typing, the speaker's bob) is a function of the display step and a per-person
  phase from `hash(staff_id)`; a walker's bob is a function of the distance walked. Two clients
  draw the same frame for the same display step.

The renderer never pathfinds and never moves a character by itself.

## Applying state

- `applyRenderState(scene, office, lighting, state, center)` (`apps/game/src/render/lighting.ts`):
  sun and sky from `minute`; each room's ceiling lights and panels from its `light` (dim at 40 %);
  monitors and desk lamps from the desk maps; the coffee machine's lamp and whiteboards from
  `devices[].state`.
- The staff layer (`apps/game/src/render/characters/staff.ts`): `sync(state)` once per step
  (rigs created lazily and disabled when absent, walks and poses updated, labels re-texted);
  `frame(now)` every frame (interpolate, pose motion, light scoping by the drawn room, labels
  placed).
- Labels and picking get their words from lookups the scene is given (`setLookups`), and report
  clicks through `onPick`; `render/` reads no store and imports no UI module.

M1 replaces the per-step JSON parse with a diffing apply, so unchanged rooms and devices are not
touched each tick.

## Fixtures

`demoRenderState(minute, day)` (`render-state.ts`) is a hand-written fixture for renderer unit
tests (the office fills between 08:00 and 09:15, most staff leave around 18:00, the deadline crew
keeps editorial lit late). The game page always runs the wasm sim. The recorded fixtures from the
real sim (`state/fixtures/demo-*.json`) cover walks, a meeting with a speaker, a typist with a
work item and kitchen seats.
