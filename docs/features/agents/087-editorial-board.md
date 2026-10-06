---
id: FEAT-087
title: "Weekly editorial board"
status: in-progress
importance: high
paths:
  - crates/sim-core/tests/editorial_board.rs
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

## Not built yet

- The orchestrator's board job: frame, the week's proposals from the content calendar, web checks,
  brief and workstream records.
- The host: the board's context, the one-time rebase of the owner's company, plan views with
  planned days, workstreams and goals.

## Acceptance criteria

- [ ] A fresh company holds its first board at the next 10:00 and one every Monday.
- [ ] Planned items start on their day with a free writer and never break the WIP limit.
- [ ] A dependent item starts only after its dependency is published.
- [ ] A failed or silent board raises a `BoardFailed` ticket; `Retry` holds it again.
- [ ] The Plan panel's Calendar, Timeline and Workload views show the board's items.
