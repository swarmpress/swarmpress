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
  apply_command_json(json: string): void            // JSON Command (below); throws the reason
  validate_command_json(json: string): string | undefined
  apply_server_command_json(json: string): void     // JSON ServerCommand (offline sandbox)
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
project, room, day, start, end, active, attendees[], speaker`) and per-person
`pose`, `activity`, `path {waypoints, startStep, speed}` (metres per step) for
interpolation.

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
`amountEur`, `proposedOption`, `replyDrafted`, `answer`, `resolvedBy`
(`ceo|secretary|default`), `createdMinute`, `deadlineStep`; queue entries
`dueMinute`. `deadlineMinute` / `createdMinute` / `dueMinute` are absolute
game minutes since day 0, 00:00. `persona` is the catalog slug; unknown
persona ids render as `persona-<n>`.

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
{"SetPolicy":{"Autonomy":"ApproveMajor"}}  // ApproveAll | ApproveMajor | Autonomous
{"SetPolicy":{"QualityBar":8}}             // 5..=10
// inbox and delegation
{"AnswerTicket":{"ticket":"ticket-3","option":"arrange-hiring"}}
{"SetDelegation":{"policy":"low"}}         // off | low | low-and-medium
{"Delegate":{"task":"TriageInbox"}}
{"Delegate":{"task":{"ScheduleMeeting":{"attendees":["staff-1","staff-2"],"project":"project-1"}}}}
{"Delegate":{"task":{"PrepareBriefing":{"project":null}}}}
{"Delegate":{"task":{"DraftReply":{"ticket":"ticket-3"}}}}
{"Delegate":{"task":{"ArrangeHiring":{"role":"photographer","project":"project-1"}}}}
{"Delegate":{"task":{"FollowUp":{"staff":"staff-3","topic":"morale"}}}}  // morale|workload|performance|salary
```

Server commands for the offline sandbox (`apply_server_command_json`):

```jsonc
{"SiteSignals":{"live_pages":61,"languages":4,"broken_links":3,"media_count":338,
                "lighthouse_performance":91,"lighthouse_accessibility":96,"lighthouse_seo":100}}
{"AnalyticsSignals":{"project":"project-1","day":1,"sessions":1840,"visitors":1420,
                     "pageviews":4610,"engagement_pm":640,"top_pages_digest":1592642302}}
{"Utterance":{"meeting":"meeting-4","seq":0,"speaker":"staff-4","chars":140}}
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
