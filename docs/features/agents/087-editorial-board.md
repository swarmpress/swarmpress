---
id: FEAT-087
title: "Weekly editorial board"
status: in-progress
importance: high
paths:
  - crates/sim-core/tests/editorial_board.rs
  - crates/orchestrator/src/board.rs
  - crates/orchestrator/tests/board.rs
  - apps/game/src/ui/plan-wire.ts
  - apps/game/src/ui/plan-wire.test.ts
  - apps/game/src/orchestration/speech.test.ts
adrs:
  - ADR-0031
  - ADR-0059
  - ADR-0062
  - ADR-0068
  - ADR-0069
---

# Weekly editorial board

Every Monday at 10:00 (and at a project's first 10:00) the strategists, the editors, SEO and
marketing and the CFO plan the week ([ADR-0069](../../adr/0069-the-weekly-editorial-board-plans-the-week.md),
the Monday board of [`publishing-plan.md`](../../game-design/publishing-plan.md) §4). The outcome
is a set of planned work items with start, due and publish days, workstreams and dependencies;
the sim starts them when they come due, with free writers, within the work-in-progress limit. The
CEO does not approve the plan; the publish gate still guards what goes live.

## Built

- **Sim** (`crates/sim-core`): the `EditorialBoard` policy (off by default), the Monday and
  first-board schedule, `JobKind::Board`, `MeetingKind::EditorialBoard`,
  `ServerCommand::BoardOutcome` with its checks, unstarted items outside `WIP_LIMIT`,
  `start_due_planned` at each standup and after the board, `BoardFailed` on a failure or a
  timeout, world format 3. Tests: `crates/sim-core/tests/editorial_board.rs`; the golden script
  answers a board (`tests/golden.rs`).
- **Orchestrator** (`crates/orchestrator/src/board.rs`): `frame#0` (the cap from the room under
  `MAX_PLANNED` and the measured throughput, the reviewing editors, the standup's context pack and
  the season's calendar topics by alias), `plan#0` (the strategist's plan, one repair turn for an
  unknown topic, a taken or repeated title, a forward dependency), `check#i` web checks
  (ADR-0068), then briefs without a writer, plan text under `brief:<ref>` and
  `workstream:<ref>`, minutes, and `BoardOutcome`. Start days are two days before the planned
  publish day; editors take turns. A board brief's first draft keeps the writer the sim staffed
  (`ArtifactRecord.writer`). Tests: `crates/orchestrator/tests/board.rs`; through the JSON
  boundary: `client-wasm`'s `the_editorial_board_through_json`.

- **Host** (`apps/game`): the session turns the policy on once as a logged command; the loop
  gives a board its context (`boardContext` in `orchestration/speech.ts`: items in flight and
  planned, named by their briefs, the room under `MAX_PLANNED`) and reports a failed board as
  `JobFailed`; `?restore=rebase` rebuilds a company from its command log alone and seals a fresh
  snapshot (a world format change, ADR-0069 decision 8); the Plan panel names planned items,
  workstreams and the goal from the board's plan text (`withBoardText` in `ui/plan-wire.ts`), and
  its Calendar, Timeline and Workload views fill after the first board. The browser's fake model
  answers the board (`llm/mvp-script.ts`, the twin of `fake_writer`). Tests:
  `ui/plan-wire.test.ts`, `orchestration/speech.test.ts`, `ui/wasm-live.test.tsx`,
  `crates/orchestrator-wasm/tests/loop.test.ts` (the twin under Bun).

## Not built yet

- The editor-in-chief's own scheduling call (`PlanSchedule`), moving or cancelling a planned item,
  big bets as tickets, the next season's topics within their lead time.
- Another device that takes a company over has its command log but not the store's text: a board
  brief (like a standup brief) is unknown there until work records sync (ADR-0056).

## Acceptance criteria

- [ ] A fresh company holds its first board at the next 10:00 and one every Monday.
- [ ] Planned items start on their day with a free writer and never break the WIP limit.
- [ ] A dependent item starts only after its dependency is published.
- [ ] A failed or silent board raises a `BoardFailed` ticket; `Retry` holds it again.
- [ ] The Plan panel's Calendar, Timeline and Workload views show the board's items.
