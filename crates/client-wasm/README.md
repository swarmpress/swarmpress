# client-wasm

wasm-bindgen facade over `sim-core` and `protocol` for the browser client
(`apps/game`). Build it into `crates/client-wasm/pkg` with:

```sh
cargo xtask wasm            # debug
cargo xtask wasm --release  # wasm-release profile (opt-level z, ~0.5 MB)
```

The build needs `wasm-bindgen-cli` **0.2.100** (it must match the
`wasm-bindgen = "=0.2.100"` pin):
`cargo install wasm-bindgen-cli --version 0.2.100`.

## API (TypeScript view)

```ts
export function version(): string
export class Sim {
  constructor(seed: bigint)              // empty company on the default lot
  static demo(seed: bigint): Sim         // the cinqueterre.travel starting company (13 staff)
  static scenario(name: string, seed: bigint): Sim  // "cinqueterre" (= demo) | "empty"; throws otherwise
  static from_snapshot(bytes: Uint8Array): Sim      // a world from snapshot(); throws unless it is this build's and intact
  snapshot(): Uint8Array                 // the whole world (42-byte header + postcard World), without pending effects
  reissue_pending_jobs(): number         // re-emit the requests of jobs still pending (after from_snapshot)
  seed(): bigint
  tick(): void                           // one 100 ms step
  advance(steps: number): void
  step(): bigint
  hash(): bigint                         // lockstep desync check
  day(): number
  minute_of_day(): number
  steps_per_day(): bigint
  cash_cents(): bigint
  apply_command(bytes: Uint8Array): void            // postcard Command; throws the reason
  apply_server_command(bytes: Uint8Array): void     // postcard ServerCommand (offline sandbox)
  validate_command(bytes: Uint8Array): string | undefined  // undefined = would apply
  apply_command_json(json: string): void            // JSON Command or ServerCommand (below); throws the reason
  validate_command_json(json: string): string | undefined  // same, without applying
  apply_server_command_json(json: string): void     // JSON ServerCommand only
  drain_effects_json(): string           // JSON RequestJob[] since the last drain (job contract)
  pending_effects(): number              // effects waiting to be drained
  plan_json(project?: string): string    // publishing plan skeleton (publishing-plan.md §7)
  next_due_step(): bigint | undefined    // earliest due step of a pending job (ADR-0060); a view, not state
  render_state(): Uint8Array             // postcard sim_core::RenderState (mm)
  render_state_json(): string            // JSON, metres, TS RenderState shape
  layout_json(): string                  // JSON, metres, TS BuildingLayout shape
  org_json(): string                     // org chart, people, projects (organization.md §9)
  finance_json(): string                 // cash, runway, books, CFO alerts (organization.md §9)
  inbox_json(): string                   // tickets, Secretary queue (organization.md §9)
}
```

`render_state_json()` carries the M0 contract fields (`minute`, `day`,
`roomLights`, `monitors`, `deskLamps` keyed by desk id, `staff[]` with
`id/persona/name/color/role/department/x/z/seatedAt`) plus `phase`, `weekday`,
`daylight`, `rooms[]` (light `off|dim|on`, occupancy), `devices[]`,
`meetings[]` (`id, kind: standup|kpi-review|finance-review|scheduled,
project, room, day, start, end, active, attendees[], speaker, job` (the
standup's job id while its outcome is awaited)), `bubbles[]` (one per meeting
with a turn in progress: `meeting, seq, speaker, startedStep, untilStep,
chars`; the text is not in the sim, fetch it by meeting/job and `seq`) and
per-person `pose`, `activity`, `workItem` (the item whose active phase the
person works on; at a desk that is the `type` pose, otherwise `sit`),
`path {waypoints, startStep, speed}` (metres per step) for interpolation.

`layout_json()` gives `width`, `depth`, `originX`, `originZ`, `wallHeight`,
`entrance` and `rooms[]` with `windows`, `doors`, `desks` (with `rot` in
radians and `seat`), `ceilingLights` and other `props`. Room `kind` values are
the sim's kebab-case kinds (`newsroom`, `editor-office`, `meeting-room`,
`ceo-office`, `finance-office`, `strategy-room`, `photo-studio`,
`design-studio`, `seo-lab`, `server-room`, `kitchen`, …); ids are strings like
`room-1`, `equip-7`, `staff-3`.

### Organization views

`org_json()`, `finance_json()` and `inbox_json()` follow
`docs/game-design/organization.md` §9 exactly (camelCase fields, ids as
strings, euros as numbers, morale/fatigue 0..1). Extra fields beyond the
contract: staff `name`; project `repo`, `kpis {livePages, audience,
goalMonthlyReaders, goalProgress}` and `analytics {connected, sessions7d,
visitors7d, pageviews7d, engagementRate}` (`connected: false` = "tracker: no
data yet"); finance `dayOfMonth`, `overhead`, `booksUnkept`,
`revenueStubbed`, `loan`, `lastClose` (the latest month-close P&L) and per
project `revenueEstimateEurMonth`, `month` (breakdown); tickets `role`,
`amountEur`, `workItem`, `failure` (why the job behind the ticket failed:
`model|invalid-output|needs-media|needs-page|timeout|cancelled|
infrastructure`, else `null`), `proposedOption`, `replyDrafted`, `answer`,
`resolvedBy` (`ceo|secretary|default`), `createdMinute`, `deadlineStep`;
queue entries `dueMinute`; org `policies {autonomy:
approve-all|approve-major|autonomous, qualityBar}`.

Ticket kinds and their options (the default is applied at the deadline):

| `kind` | `options` | default | days |
|---|---|---|---|
| `budget-overrun` | `approve-overrun`, `cut-scope` | `cut-scope` | 1 |
| `runway-low`, `payroll-spike`, `hire-affordability` | `acknowledge`, `cut-costs` | `acknowledge` | 1 |
| `loan-offer` | `take-loan`, `cut-costs` | `cut-costs` | 1 |
| `missing-role` | `arrange-hiring`, `ignore` | `arrange-hiring` | 2 |
| `project-proposal` | `approve`, `reject` | `reject` | 2 |
| `escalation` | `retry`, `kill` | `retry` for an item's first, `kill` after | 1 |
| `publish-approval` | `publish`, `send-back`, `kill`, `defer` | `defer` | 1 |
| `standup-failed` | `retry`, `skip` | `skip` | 1 |
| `deploy-failed` | `retry`, `acknowledge` | `acknowledge` | 1 |
| `needs-media`, `needs-page` | `retry`, `kill` | `kill` | 2 |

`publish-approval`, `standup-failed`, `deploy-failed`, `needs-media`,
`needs-page` and `escalation` are `high` priority: the Secretary never answers
them. A deferred or expired `publish-approval` leaves the item parked; a fresh
ticket is raised when the clock next passes 08:30. `deadlineMinute` / `createdMinute` / `dueMinute` are absolute
game minutes since day 0, 00:00. `persona` is the catalog slug; unknown
persona ids render as `persona-<n>`.

### Job contract (docs/mvp.md, docs/architecture/sim.md)

`drain_effects_json()` returns the effects emitted since the last drain, in
the orchestrator's `JobRequest` field names (snake_case; add `company_id` and
pass it to `Orchestrator::run`, which ignores `effect` and `meeting`):

```jsonc
[{"effect":"request-job","job_id":1,"kind":"standup","project":"project-1",
  "work_item":null,"brief_ref":null,"revision":0,"meeting":"meeting-1",
  "staff":[{"id":"staff-1","persona":"giulia","role":"writer"}, …]}
,{"effect":"request-job","job_id":2,"kind":"draft","project":"project-1",
  "work_item":"work-item-1","brief_ref":42,"revision":0,"meeting":null,
  "staff":[{"id":"staff-1","persona":"giulia","role":"writer"}]}]
```

`kind` is `standup | draft | review | publish` (`brief` is reserved).
Effects are not world state: draining (or not) never moves the hash. Every
replica must drain after stepping, or the queue grows.

Because effects are not state they are not in a snapshot either. A sim from
`Sim.from_snapshot(bytes)` has none; `reissue_pending_jobs()` rebuilds the
requests of the jobs the sim still waits for (same job ids, same fields), and
the next `drain_effects_json()` returns them. `from_snapshot` checks the
snapshot format, the sim build (`sim_core::snapshot::WORLD_FORMAT`) and the
hash, and throws `bad snapshot: …` on any mismatch; nothing is restored then.

The results go back through `apply_command_json` as server commands, in the
orchestrator's `Outcome` JSON (see "Server commands" below). Then:

- `MeetingOutcome` creates one work item per brief in its Draft phase and
  requests a Draft job for the writer (`kind` defaults to `article`). It is
  refused when the project would have more than 3 open items (`limit reached:
  work in progress …`; parked and blocked items count) or when a writer
  already has an item that is not past the publish gate (`occupied: the
  writer already has an item in the writing loop`);
- `JobCompleted` on a Draft (`ok`) → Review job for the editor once the
  draft's minimum time (2 game hours) has passed; on a Review, score ≥ the
  quality bar (7) → **the publish gate** (below); lower → a new Draft with
  `revision + 1`, at most 3 revisions, then the item is `blocked` with an
  `escalation` ticket; `ok: false` on any job → `blocked` plus the ticket.
  A finished Publish leaves the item `scheduled` (merged, awaiting the deploy);
- `JobFailed{job_id, reason}`: a standup ends and a `standup-failed` ticket is
  raised (the same ticket the sim raises itself when a standup's outcome has
  not arrived after 60 game minutes); a work-item job blocks the item with a
  `needs-media`, `needs-page` or `escalation` ticket carrying the `failure`;
- `BoardOutcome{job_id, workstreams, items}` (ADR-0069, the weekly editorial
  board's `board` job, Monday 10:00 and a project's first 10:00 once
  `SetPolicy{EditorialBoard: true}`): one `planned` item per entry, not started
  (`unstarted: true`, no writer, outside the WIP limit), with `startDay`,
  `dueDay`, `publishDay` (planned), `workstream` and `dependsOn`; the sim
  starts due items itself, with the lowest-id free drafter, at each standup and
  right after the board. A failed or silent board raises `board-failed`
  (`retry` holds it again, `skip`, the default, waits for Monday);
- `DeployLanded` → `published`; `DeployFailed` (also only for a `scheduled`
  item) → `blocked` with a `deploy-failed` ticket: `retry` requests the
  Publish job again, `acknowledge` puts the item back to `scheduled`.

**The publish gate** (ADR-0059). What happens after a passing review depends
on `policies.autonomy`:

- `approve-all` (the default): the item is `approved`, its Publish phase
  stays `pending` (`awaitingApproval: true`), **no Publish job is requested**
  and a `publish-approval` ticket is raised. `AnswerTicket` with `publish`
  starts the Publish phase (the job is in the next `drain_effects_json()`),
  `send-back` restarts Draft with `revision + 1` (refused at revision 3),
  `kill` cancels, `defer` (the default) changes nothing;
- `approve-major`: a first draft (revision 0) with a score of 9 or 10 is
  published without asking, anything else gets the ticket;
- `autonomous`: the Publish job is requested at once.

`plan_json(project?)` follows publishing-plan.md §7 (`goals`: one per open
project, `monthly-readers` against its target; `workstreams[]`: `id, project,
status, textRef`, the plan text's key `workstream:<textRef>`) and adds per item
`briefRef` and `briefRefText` (the same u64 as text: the board's plan text key
`brief:<briefRefText>`), `startDay`, `dueDay`, `publishDay` (live, else
planned), `plannedPublishDay`, `unstarted`, `revision`, `lastScore`, `currentPhase`, `awaitingApproval`,
`escalations`, `createdDay`, `meeting`, per phase `job` and `score` (reviews),
plus `jobs[]` (pending: `id, kind, project, workItem, meeting,
requestedMinute, requestedStep, dueStep`), `nextDueStep` (the earliest
`dueStep`, `null` with no pending job; the same as `next_due_step()`),
`wip[]` (per open project: `project, limit, open, room, awaitingApproval,
blocked, inWritingLoop, freeWriters[], unstarted, plannedRoom, editorialBoard`:
what a standup may still commission, and what a board may still plan)
and `feed[]` (`kind: published|blocked, project, workItem, minute`).
`dueStep` is the step at which the job's phase minimum has elapsed (for a
standup: its request + 30 game minutes). It is a view for the host's clock
(ADR-0060): the sim never waits on it and it is not part of the hash. Items: `id: "work-item-1"`,
`status` (`planned|in-progress|in-review|approved|scheduled|published|
blocked|cancelled`), phases `draft|review|publish` with `state
pending|working|done|blocked` and `progress` 0..1.

## JSON commands

`apply_command_json` / `validate_command_json` take a `sim_core::Command` in
serde's default **externally tagged** form: `{"Variant": {fields}}`, unit
variants as a bare string. Conventions:

- ids are strings as in the JSON views (`"staff-6"`, `"project-1"`,
  `"ticket-3"`, `"candidate-4"`, `"equip-12"`, `"room-3"`); bare numbers work too;
- enum values may be the Rust variant name (`"Photographer"`) **or** the
  kebab-case slug the views use (`"photographer"`, `"cut-scope"`,
  `"low-and-medium"`, `"active"`) for `Role`, `Department`, `ProjectStatus`,
  `TicketOption`, `TicketKind`, `Priority`, `DelegationPolicy`,
  `FollowUpTopic`; other enums (`Side`, `RoomKind`, `EquipmentKind`,
  `OvertimePolicy`, `SecretaryTaskKind` variants) use the variant name;
- money is integer **cents** (`cents_per_day`, `monthly_cents`), positions are
  integer millimetres, rectangles integer tiles;
- field names are the Rust snake_case names.

Every command, with an example:

```jsonc
// building
{"BuyFloorSpace":{"side":"East","tiles":4}}
{"PlaceRoom":{"kind":"Archive","rect":{"x":24,"z":4,"w":4,"d":4},"floor":0,
              "doors":[{"side":"West","at":2}],"windows":[{"side":"East","at_mm":1000,"width_mm":2000}]}}
{"Demolish":{"Room":"room-12"}}            // or {"Demolish":{"Equipment":"equip-75"}}
{"PlaceEquipment":{"kind":"Plant","placement":{"Floor":{"pos":{"x":12600,"z":15400},"rot":0}}}}
{"PlaceEquipment":{"kind":"Monitor","placement":{"OnDesk":"equip-56"}}}
// people
{"Hire":{"candidate":"candidate-6"}}
{"Fire":{"staff":"staff-6"}}
{"Promote":{"staff":"staff-12"}}           // one seniority step, +15% salary; star needs level 5
{"SetSalary":{"staff":"staff-8","cents_per_day":12000}}
{"Praise":{"staff":"staff-1"}}             // 3 a day
// projects
{"AssignToProject":{"staff":"staff-2","project":"project-1","allocation_pct":60}}  // Σ ≤ 100%
{"RemoveFromProject":{"staff":"staff-2","project":"project-2"}}
{"SetProjectLead":{"project":"project-1","staff":"staff-4"}}   // must be on the team
{"CreateProject":{"slug":"amalfi-dispatch","name":"Amalfi Dispatch","domain":"amalfi.travel"}}
{"SetProjectStatus":{"project":"project-2","status":"active"}} // proposed→active, active⇄paused, →archived
{"SetProjectBudget":{"project":"project-1","monthly_cents":8000000}}
// policies
{"SetPolicy":{"Overtime":"Crunch"}}        // Never | Allow | Crunch
{"SetPolicy":{"Autonomy":"ApproveMajor"}}  // ApproveAll | ApproveMajor | Autonomous (or approve-all | approve-major | autonomous)
{"SetPolicy":{"QualityBar":8}}             // 5..=10
{"SetPolicy":{"EditorialBoard":true}}       // the weekly editorial board (ADR-0069), off by default
{"UpdateWorkItem":{"item":"work-item-4","update":{"Priority":"Urgent"}}}   // Urgent | High | Normal | Low
{"UpdateWorkItem":{"item":"work-item-4","update":{"Owner":"staff-5"}}}     // the editor, before the item starts
{"UpdateWorkItem":{"item":"work-item-4","update":{"DueDay":6}}}            // today..today+13; publishes the day after
{"UpdateWorkItem":{"item":"work-item-4","update":{"Status":"Cancelled"}}}  // only Cancelled; not with an open ticket
// inbox and delegation
{"AnswerTicket":{"ticket":"ticket-3","option":"arrange-hiring"}}
{"AnswerTicket":{"ticket":"ticket-4","option":"publish"}}   // the publish gate: publish | send-back | kill | defer
{"SetDelegation":{"policy":"low"}}         // off | low | low-and-medium
{"Delegate":{"task":"TriageInbox"}}
{"Delegate":{"task":{"ScheduleMeeting":{"attendees":["staff-1","staff-2"],"project":"project-1"}}}}
{"Delegate":{"task":{"PrepareBriefing":{"project":null}}}}
{"Delegate":{"task":{"DraftReply":{"ticket":"ticket-3"}}}}
{"Delegate":{"task":{"ArrangeHiring":{"role":"photographer","project":"project-1"}}}}
{"Delegate":{"task":{"FollowUp":{"staff":"staff-3","topic":"morale"}}}}  // morale|workload|performance|salary
```

Server commands (`apply_command_json` tells them apart by the variant name;
`apply_server_command_json` accepts only these). The job results are exactly
the orchestrator's `Outcome` JSON: a brief's `kind` may be omitted, and a
digest's `artifact_sha` may be a hex string (its first 16 bytes are kept),
`null`, or a 16-byte array:

```jsonc
{"MeetingOutcome":{"job_id":1,"briefs":[{"brief_ref":42,"writer":"staff-1","editor":"staff-5"}]}}
{"BoardOutcome":{"job_id":5,"workstreams":[901],"items":[{"brief_ref":601,"editor":"staff-5","priority":"High",
                 "workstream":0,"start_offset":0,"publish_offset":3},
                {"brief_ref":602,"editor":"staff-5","priority":"Normal","start_offset":1,"publish_offset":5,"depends_on":[0]}]}}
{"JobCompleted":{"job_id":2,"digest":{"ok":true,"score":0,"words":930,"qa_defects":0,
                 "artifact_sha":"0123456789abcdef0123456789abcdef01234567"}}}
{"JobCompleted":{"job_id":3,"digest":{"ok":true,"score":8,"words":0,"qa_defects":1,"artifact_sha":null}}}
{"JobFailed":{"job_id":4,"reason":"timeout"}}  // model | invalid-output | needs-media | needs-page | timeout | cancelled | infrastructure
{"DeployLanded":{"work_item":"work-item-1"}}
{"DeployFailed":{"work_item":"work-item-1"}}
{"SiteSignals":{"live_pages":61,"languages":4,"broken_links":3,"media_count":338,
                "lighthouse_performance":91,"lighthouse_accessibility":96,"lighthouse_seo":100}}
{"AnalyticsSignals":{"project":"project-1","day":1,"sessions":1840,"visitors":1420,
                     "pageviews":4610,"engagement_pm":640,"top_pages_digest":1592642302}}
{"Utterance":{"meeting":"meeting-4","seq":0,"speaker":"staff-4","chars":140}}
{"BlueprintChanged":{"hash":[1,35,69,103,137,171,205,239,1,35,69,103,137,171,205,239],
                     "page_types":6,"slots":14,"issues":0}}       // ADR-0072: the blueprint's digest
{"ToolsChanged":{"tools":[{"tool_ref":177789920126454,"schedule_days":1,"role":null}]}}
```

A rejected command throws (or, for `validate_command_json`, returns) the
player-facing reason, e.g. `staff-1 would be allocated 120% (max 100%)`,
`company level 3 allows 2 project(s)`, `there is no Executive Secretary to
delegate to`, `limit reached: praise (3 a day)`; a malformed one starts with
`bad command:`.

## Tests

Natively (unit tests + the golden test as a plain `#[test]`):

```sh
cargo test -p client-wasm
```

Under wasm32 in Node, with the test runner from `wasm-bindgen-cli` 0.2.100
(paired with the `wasm-bindgen-test = "=0.3.50"` dev-dependency):

```sh
CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUNNER=wasm-bindgen-test-runner \
  cargo test -p client-wasm --target wasm32-unknown-unknown
```

`tests/golden_wasm.rs` runs the scripted 50,000-step demo company and asserts
the same `GOLDEN_HASH` as `crates/sim-core/tests/golden.rs`, proving the wasm
replica and a native server stay in lockstep. Only `client-wasm` can be tested
on wasm32: `sim-core`'s dev-dependencies (proptest, criterion) do not build
there.
