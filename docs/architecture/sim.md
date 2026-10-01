# Simulation (`crates/sim-core`)

`sim-core` is the whole game in one pure Rust library. It runs authoritatively on the server and
as a replica in the browser (wasm), and both must produce the same `World::hash` from the same
command log ([ADR-0002](../adr/0002-rust-server-and-sim-core-wasm-client.md),
[ADR-0003](../adr/0003-deterministic-lockstep-server-authority.md)).

Features: FEAT-001 to FEAT-010 in `docs/features/sim/`.

## Determinism rules

| Rule | Why | Enforcement |
|---|---|---|
| Integer and fixed-point math only. Money in cents (`i64`), stats in permille (`u16`, 0–1000), positions in millimetres or grid cells | Floats differ across CPUs, compilers and wasm | `clippy::float_arithmetic = "warn"` at workspace level (CI denies warnings), plus review |
| Ordered collections only (`Vec`, `BTreeMap`, `BTreeSet`) | `HashMap` iteration order is randomised | Review, plus a `disallowed-types` clippy config |
| IDs are `u32` newtypes (`StaffId(u32)`, `RoomId(u32)`…), allocated by a counter in `World` | Stable across replicas | Types |
| All randomness from `World.rng` (`rand_pcg::Pcg32`, seeded) | Same seed, same rolls | No other RNG in the dependency tree of `sim-core` |
| No I/O, no `std::time`, no threads, no `async` | Replay must not depend on the environment | Crate has no such dependencies |
| Text never enters the world | LLM output differs per device and per run | Commands carry digests (`chars`, `words`, `score`, `artifact_sha`) |
| `World::hash` = xxh3-64 over the postcard encoding of `World` | A cheap, total fingerprint for lockstep checks | Golden tests |

## Time

- One **step** is 100 ms (`STEPS_PER_SECOND = 10`).
- `SimConfig.day_real_minutes` sets the length of a game day. Live servers use 60; the default
  in code is 20, for sandboxes.
- `steps_per_day = day_real_minutes × 60 × 10`. The clock is
  `minute = start_minute + step × 1440 / steps_per_day`, with `day = minute / 1440`. This is
  implemented today as `World::clock()`.
- **Day phases:**

  | Phase | Window |
  |---|---|
  | Night | 22:00–06:00 |
  | Arrival | 06:00–09:00 |
  | Standup | 09:00–09:30 |
  | Work | 09:30–12:30 |
  | Lunch | 12:30–13:30 |
  | Work | 13:30–18:00 |
  | Evening / overtime | 18:00–22:00 |

- Settlement runs at 00:00 (the economy), and the daily snapshot is written then.

## Entities

```
World
├─ step, seed, config, rng, next_id
├─ Company { cash_cents, reputation, audience, level, unlocks, policies{overtime, autonomy, quality_bar} }
├─ Building { lot, floors[], walls[], doors[], windows[] }
├─ rooms:     BTreeMap<RoomId, Room { kind, floor, rect, level, doors, capacity, light: Off|Dim|On, alerts }>
├─ devices:   BTreeMap<DeviceId, Device { kind, room, cell, rot, state: Off|On|InUse, screen, upkeep_cents }>
├─ staff:     BTreeMap<StaffId, Staff { persona, role, seniority, traits, skills, morale, fatigue,
│                                       salary_cents, home_desk, assignment, activity, pos, path, pose }>
├─ projects:  BTreeMap<ProjectId, Project { kind, stage, owner, revisions, deadline_step, … }>
├─ jobs:      BTreeMap<JobId, Job { kind, project, executor, state, requested_step }>
├─ meetings:  BTreeMap<MeetingId, Meeting { kind, room, attendees, agenda, seq, speaker }>
├─ inbox:     BTreeMap<TicketId, Ticket { kind, options, default_option, deadline_step, state }>
├─ events:    EventDeck { scheduled, cooldowns }
└─ ledger:    Ledger { entries (double-entry, cents) }
```

The room kinds, equipment, staff traits and project kinds are described in the game design docs
([rooms](../game-design/rooms-and-progression.md), [staff](../game-design/staff.md)).

## Systems (per tick, fixed order)

1. **Apply commands** scheduled for this step, in `(step, seq)` order.
2. **Clock and phase**: phase transitions trigger arrivals, the standup and departures.
3. **Staff FSM**: choose an activity from phase, assignment, fatigue and the overtime policy;
   request a path.
4. **Pathfinding**: integer A* on the floor grid, with doors as edges. Paths are stored on the
   staff member with `start_step` and speed.
5. **Movement**: advance along the path by speed.
6. **Projects**: advance stages whose minimum sim time has passed and whose job is done. A
   transition emits effects.
7. **Meetings**: bubble timers from `Utterance.chars`, and attendee poses.
8. **Devices and lighting**: room light from occupancy, phase and daylight; device states from
   activity.
9. **Morale and fatigue**: integer permille updates.
10. **Inbox**: deadlines apply default options.
11. **Events**: seeded rolls and earned triggers.
12. **Settlement**: at 00:00 only.

## Commands and effects

- **`ClientCommand`** (player): `PlaceDevice`, `RemoveDevice`, `BuildRoom`, `Hire`, `Fire`,
  `SetPolicy`, `AnswerTicket{ticket, option}`, `AssignStaff`, `PraiseStaff`, `SendToAgency`.
  - Each is validated by `validate_command(&World, &cmd) -> Result<(), Reject>`, which is shared
    by the client (to give instant feedback) and the server (authoritatively).
- **`ServerCommand`** (facts from outside):
  - `JobCompleted{job_id, digest{ok, score, words, qa_defects, artifact_sha}}`
  - `JobFailed{job_id, reason}`
  - `Utterance{meeting, seq, speaker, chars}`
  - `DeployLanded{project, sha}`
  - `SiteSignals{…}`
  - `AgencyVisit{…}`
- **`Effect`** (outputs, executed by the server *after* the transition commits):
  - `RequestJob{job_id, kind, executor, inputs}`
  - `OpenTicket{…}`
  - `RequestMerge{project}`
  - `StartMeeting{…}`

  Effects are idempotent, keyed by `job_id` or `project`.

## Pipeline stages

| Stage | Who | Where | Min sim time | Exit |
|---|---|---|---|---|
| Pitch | staff in the standup | MeetingRoom | the meeting | Outcome accepted. A risky pitch becomes a CEO ticket |
| Brief | Editor-in-Chief | EditorOffice | 30 min | Brief artifact valid |
| Draft | Writer | desk in the Newsroom | 2 h | Page JSON valid; PR open on `drafts/<project>` |
| Media | MediaEditor in the PhotoStudio (otherwise the writer, from the closed media index) | PhotoStudio | 30 min | Media refs resolve |
| Edit | Editor | EditorOffice | 1 h | Score ≥ 7 approves. Below 7 → Draft, at most 3 times, then a ticket |
| QA | QA | SeoLab, or a desk | 30 min | Deterministic checks pass and the LLM coherence review is ok, with a fix loop |
| Publish | orchestrator | ServerRoom | — | Merge → `DeployLanded` |

- A stage ends at `max(min sim time, job done)`.
- A job finishing after office close becomes **overtime** if the policy allows it: lights and lamp
  on, fatigue ×2, pay ×1.5. Otherwise the work resumes at 09:00.
- A failure or refusal blocks the stage and opens a ticket.
- **Capacity:**
  - one stage per staff member;
  - seats per room;
  - a missing room disables or degrades its stages;
  - the ServerRoom level caps deploys per day.

## Render state

`render_state()` returns everything the renderer draws. See [render-state.md](render-state.md).

## Testing

- Unit tests per system.
- `proptest` invariants:
  - cash is conserved across settlement (ledger balanced);
  - no staff member stands inside a wall;
  - every command either validates or rejects;
  - no panics.
- **Golden determinism:** a scripted 50 000-step command log must hash identically natively
  (nextest) and in wasm (`wasm-bindgen-test` under node and headless Chromium).
- `criterion` benchmarks for the step and pathfinding, with budgets.
- `cargo-fuzz` on command decoding, nightly.
