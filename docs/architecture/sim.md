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
├─ plan:      Plan { items: BTreeMap<WorkItemId, WorkItem>, jobs: BTreeMap<u64, PendingJob>,
│                     jobs_requested, standup_days, feed }        (crates/sim-core/src/plan.rs)
├─ effects:   Vec<Effect>  (outbox; #[serde(skip)], outside the hash and snapshots)
├─ meetings:  BTreeMap<MeetingId, Meeting { kind, room, attendees, job, next_seq, speaker,
│                                           speak_from, speak_until, speak_chars }>
├─ inbox:     BTreeMap<TicketId, Ticket { kind, options, default_option, deadline_step, state,
│                                         work_item, failure }>
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

- **`Command`** (player): building (`BuyFloorSpace`, `PlaceRoom`, `PlaceEquipment`, `Demolish`),
  people (`Hire`, `Fire`, `Promote`, `SetSalary`, `Praise`), projects (`AssignToProject`,
  `RemoveFromProject`, `SetProjectLead`, `CreateProject`, `SetProjectStatus`,
  `SetProjectBudget`), `SetPolicy`, the Inbox (`AnswerTicket{ticket, option}`, `Delegate`,
  `SetDelegation`).
- **`ServerCommand`** (facts from outside the sim; in the local-first build, ADR-0038, they are
  produced by the browser's orchestrator and applied as local commands):
  - `MeetingOutcome{job_id, briefs: Vec<BriefStub{kind, writer, editor, brief_ref}>}`
  - `JobCompleted{job_id: u64, digest: JobDigest{ok, score, words, qa_defects, artifact_sha: [u8; 16]}}`
  - `JobFailed{job_id: u64, reason: JobFailure}` with `JobFailure = Model | InvalidOutput |
    NeedsMedia | NeedsPage | Timeout | Cancelled | Infrastructure` (an enum: the executor's error
    text stays outside the sim)
  - `DeployLanded{work_item}`, `DeployFailed{work_item}`
  - `Utterance{meeting, seq, speaker, chars}`
  - `SiteSignals{…}`, `AnalyticsSignals{…}`
- Both are validated by the shared `validate_input(&World, &Input) -> Result<(), Reject>`
  (`validate` for player commands, `validate_server` for server commands); `World::apply_input`
  runs it first, so a rejected input never changes the world.
- **`Effect`** (outputs, drained with `World::drain_effects()` after stepping):
  - `RequestJob{job_id: u64, kind: JobKind, project, work_item: Option<WorkItemId>,
    brief_ref: Option<u64>, revision: u8, meeting: Option<MeetingId>, staff: Vec<StaffId>}`
    with `JobKind = Standup | Brief | Draft | Review | Publish` (`Brief` is reserved).

  Effects are an outbox, not state: they are `#[serde(skip)]`, so draining (or not) never
  moves the hash. Job ids are sequential per world (`plan.jobs_requested`), hence
  deterministic and idempotency keys for the executor.

## Snapshots

`crates/sim-core/src/snapshot.rs` (FEAT-060, ADR-0046). A snapshot is the whole world as bytes,
so a restore costs the commands logged after it instead of a replay from the seed.

```text
0   magic            4  "SPWS"
4   snapshot format  2  SNAPSHOT_FORMAT (1)
6   world format     4  WORLD_FORMAT    (the sim build that wrote the body)
10  day_real_minutes 8  SimConfig
18  start_minute     8  SimConfig
26  step             8
34  hash             8  World::hash
42  body                postcard(World): the bytes World::hash is taken over
```

All integers are little endian. The 13-person cinqueterre company is about 2 KB.

- **`World::snapshot()`** writes it. **`World::from_snapshot(bytes, expect_config)`** refuses
  anything it cannot vouch for: short input, a wrong magic, another snapshot or world format, an
  unexpected config, a body that does not hash to the header's hash or does not decode exactly,
  a header whose step or config is not the world's, and a world that does not hash back. Nothing
  is restored on an error and there is no fallback inside the sim.
- **`WORLD_FORMAT`** names the world's encoding and step rules. postcard is not self-describing,
  so a snapshot is only safe to load into the build that wrote it. Bump the constant by one
  whenever the golden hash changes; `tests/snapshot.rs` (`world_format_names_the_current_world`)
  fails until that is done and lists what else to update. `PROTO_VERSION` is the wire protocol
  and is a separate number.
- **Effects are not in a snapshot** (they are an outbox, `#[serde(skip)]`). A restored world has
  none. **`World::reissue_pending_jobs()`** emits the request of every job in `plan.jobs` again,
  in job-id order, with the original job ids. Nothing extra is stored for this: the brief and
  the revision are on the work item, the assignee on the phase that holds the job, the team on
  the standup's meeting. It skips jobs whose effect is still waiting to be drained and never
  changes the hash.
- **Boundary.** `client-wasm` exposes `Sim.snapshot()`, `Sim.from_snapshot(bytes)`,
  `Sim.reissue_pending_jobs()` and `Sim.seed()`. The browser wraps the bytes in a
  `swarmpress.snapshot.v1` record with the step, hash, seed and log position
  (`apps/game/src/sync/segments.ts`) and restores with `restoreSim`
  (`apps/game/src/catchup/replay.ts`): snapshot, check against the record, re-issue, then replay
  only the commands after `lastSeq`. Replay from the seed remains for records without a world,
  for new companies and as the audit path (`?restore=replay`).
- **Evidence.** `crates/sim-core/tests/snapshot.rs` (the golden script rebuilt from a snapshot
  six times, re-issue for every job kind, refusals), `crates/client-wasm/tests/snapshot_wasm.rs`
  (the same natively and under wasm32), `packages/runner/test/snapshot.test.ts` (Bun),
  `apps/game/src/catchup/replay.test.ts` (`restoreSim` over the real sim), and
  `crates/sim-core/benches/restore.rs` (snapshot restore against replay from the seed).

## Job contract (MVP)

The article loop of [docs/mvp.md](../mvp.md). The sim owns every transition (ADR-0011); the
orchestrator (`crates/orchestrator`) runs exactly the job it is given and reports a typed outcome.
Text never enters the sim: a brief is an opaque `brief_ref`, a result a `JobDigest`.

```text
09:00 standup ─► RequestJob(Standup, team) ─► MeetingOutcome{briefs}
   (JobFailed, or no outcome within 60 game minutes: the standup ends, the job is
    dropped, and a StandupFailed ticket is raised)
   └─► per brief: WorkItem(article) in Draft ─► RequestJob(Draft, writer, revision 0)
Draft   ─► JobCompleted{ok}               ─► RequestJob(Review, editor, same revision)
Review  ─► JobCompleted{score ≥ bar (7)}  ─► the publish gate (below)
        ─► JobCompleted{score < bar}      ─► revision + 1 ─► RequestJob(Draft, writer, revision n)
           after 3 revisions               ─► Blocked + Escalation ticket
gate    ─► ApproveAll (default)           ─► Approved, Publish stays Pending, PublishApproval ticket
        ─► ApproveMajor                   ─► Publish when score ≥ 9 and revision 0, else the ticket
        ─► Autonomous                     ─► Publish
ticket  ─► Publish                        ─► RequestJob(Publish, IT engineer|DevOps|web dev|editor)
        ─► SendBack                       ─► revision + 1 ─► RequestJob(Draft, writer, revision n)
        ─► Kill                           ─► Cancelled
        ─► Defer (default, and on expiry) ─► still parked; a fresh ticket at the next 08:30
Publish ─► JobCompleted{ok}               ─► Scheduled (merged, awaiting the deploy)
DeployLanded{work_item}                   ─► Published, project live_pages + 1, feed entry
DeployFailed{work_item}                   ─► Blocked + DeployFailed ticket
JobCompleted{ok: false} │ JobFailed       ─► Blocked + Escalation, NeedsMedia or NeedsPage ticket
```

- **Standups.** One `RequestJob(Standup)` per active project with a non-empty team per game day
  (`plan.standup_days` guards against a second one when the meeting ends early). `staff` is the
  team plus the strategists. The meeting stays open until the outcome arrives, at most an hour.
  A standup that fails (`JobFailed`) or is not answered within the hour ends with a
  `StandupFailed` ticket (rule 11): `Retry` opens a standup now, for an hour, with a new job;
  `Skip`, the default, lets the day pass.
- **Briefs.** `MeetingOutcome` is valid only for a pending standup job, with at most 8 briefs;
  the writer must be a writer, editor, editor-in-chief or translator on the project's team, the
  editor an editor or editor-in-chief on the team, and nobody reviews their own draft.
- **Work in progress.** Two invariants are enforced where work items are created
  (`check_meeting_outcome`), so nothing has to be undone later:
  - a project never has more than `WIP_LIMIT` (3) open items. Open is everything not Published
    or Cancelled: parked, blocked and merged-but-not-deployed items count;
  - a writer has at most one item in the writing loop, hence at most one active draft. An item
    keeps its writer from its first draft until it is past the gate, because a failed review or
    a `SendBack` restarts Draft.

  A `MeetingOutcome` that breaks either is refused as a whole and the standup stays pending. An
  absent CEO therefore stops new commissions and loses nothing.
- **Phases.** A work item has phases Draft → Review → Publish. A phase ends at
  `max(min time, job result)`: Draft 2 h, Review 1 h, Publish 15 min (game time), so the office
  shows the work even when an executor answers at once.
- **Results.** `JobCompleted` is valid only for a pending, non-standup job, once (the job leaves
  `plan.jobs`), with `score ≤ 10`. `JobFailed` is valid for any pending job, once. `DeployLanded`
  and `DeployFailed` are valid only for a `Scheduled` item.
- **The publish gate** (ADR-0059). `company.policies.autonomy` (`SetPolicy(Autonomy(…))`,
  default `ApproveAll`) decides what a passing review leads to. Under `ApproveAll` the item
  becomes `Approved`, its Publish phase stays `Pending`, no job is requested, and a
  `PublishApproval` ticket is raised. The ticket is High and CEO-only (`TicketKind::ceo_only`),
  so the Secretary never answers it under any delegation policy; its default is `Defer`, so
  neither expiry nor the default ever publishes. `raise_morning_approvals` raises a fresh ticket
  for every parked item without an open one when the clock crosses 08:30 (after that step's
  expiries, so an unanswered morning ticket is replaced the next morning without a gap).
  `SendBack` is refused once the item has used its 3 revisions. An item already parked stays
  parked when the policy changes.
- **Failures.** A work-item job that fails blocks the item and raises the ticket its reason
  calls for: `NeedsMedia` and `NeedsPage` for those two reasons (rule 5), `Escalation`
  otherwise; the ticket carries the reason (`Ticket.failure`). A failed deploy blocks the merged
  item with a `DeployFailed` ticket: `Retry` requests the Publish job again (the executor's
  merge is idempotent), `Acknowledge` puts the item back to `Scheduled`, to land with the next
  deploy that carries it.
- **Escalation.** `TicketKind::Escalation` is High, with options `Retry | Kill`. `Retry`
  restarts the blocked phase with a new job; `Kill` cancels the item and drops its pending jobs.
  An item's first escalation defaults to `Retry` (a transient failure is the common case with a
  local model), any later one to `Kill` (`WorkItem.escalations` counts them).
- **Statuses** (publishing-plan.md §1): `Planned`, `InProgress` (draft), `InReview`, `Approved`
  (parked at the gate, or publishing), `Scheduled`, `Published`, `Blocked`, `Cancelled`.
- **Views for the host.** `World::job_due_step` and `World::next_due_step` give the step at
  which a pending job is due: a work-item job at its phase's minimum-done step, a standup 30
  game minutes after its request (ADR-0060). They are derived, never stored, and the sim does
  not wait on them. `World::busy_with` says which item a person works on.
- **Boundary.** `client-wasm` exposes `drain_effects_json()` (the orchestrator's `JobRequest`
  field names), `apply_command_json()` for player and server commands (the orchestrator's
  `Outcome` JSON as is), `plan_json()` and `Sim.scenario("cinqueterre", seed)`; see
  `crates/client-wasm/README.md`.
- **Evidence.** `crates/sim-core/tests/job_contract.rs` walks the whole loop (standup → outcome →
  draft → review 6 → revision → review 8 → publish → `DeployLanded` → Published), the revision
  cap, failed jobs and retries; the proptests check the plan invariants; the golden script runs
  the contract too.

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
