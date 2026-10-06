# ADR-0069 — The weekly editorial board plans the week

**Status:** Accepted (implements ADR-0031 §4's Monday board; amends ADR-0059's work-in-progress count)
**Date:** 2026-10-06

## Context

The publishing plan of ADR-0031 (`docs/game-design/publishing-plan.md`) was designed from the
owner's editorial planning concept (`docs/reference/legacy/agentic_editorial_planning_spec.md`):
workstreams, work items with start, due and publish days, dependencies, goals, and a weekly
editorial board where the strategist proposes the week from the content calendar and the
editor-in-chief schedules it. Only the daily loop runs: the 09:00 standup commissions at most
what the work-in-progress limit allows (ADR-0059, `WIP_LIMIT` 3), and every item starts the
moment it is commissioned. The Plan panel's Calendar, Timeline and Workload views stay empty
because no item has a planned day, and `WeeklyPlan` and `PlanSchedule` are typed in
`crates/agents` but never dispatched.

The owner decided on 2026-10-06 (the legacy fit in `docs/reference/legacy/README.md`): build the
weekly editorial board next; the CEO does **not** approve the weekly plan (the publish gate of
ADR-0059 still guards what goes live); a company holds its first board at the next 10:00, then
every Monday; the existing company is rebased once onto the new state format.

## Decision

1. **A weekly meeting with a job.** When the company's `editorial_board` policy is on, every
   active project holds an editorial board on Monday at 10:00, and its first one at the next
   10:00 whatever the weekday (`MeetingKind::EditorialBoard`, `JobKind::Board`). Attendees: the
   strategists, the editors-in-chief, the project's editors and its SEO and marketing staff, and
   the CFO. A project without an editor holds none. The policy is off by default, so old command
   logs replay without boards; the game turns it on once with `SetPolicy(EditorialBoard(true))`.
2. **The outcome is a plan, not text.** The board ends with
   `ServerCommand::BoardOutcome{job_id, workstreams, items}`. Each `PlannedStub` carries an opaque
   brief ref, the editor who reviews and owns it, a priority, a workstream index, a start and a
   publish offset in days from the board's day (at most 13), and indices of earlier items it
   waits for (at most 2). Workstreams are opaque text refs, reused per project. The sim checks
   it: a pending Board job, at most 7 items, at most 10 unstarted items per project, an active
   reviewer on the project's team, start not after publish, known workstream indices, backward
   dependencies only, each brief planned once.
3. **Planned items wait unstarted.** They are `Planned`, with the Draft phase pending and
   unassigned, a `start_day`, a `due_day` (the day before the publish day) and a `publish_day`.
   **Unstarted items do not count against `WIP_LIMIT`** (the amendment to ADR-0059): the limit
   bounds work in the writing loop and at the gate, not the plan.
4. **The sim starts due items, deterministically.** At each standup (before its job is
   requested) and right after a board's outcome, the project's unstarted items whose start day
   has come and whose dependencies are published start their Draft, by priority, then planned
   publish day, then id, each with the lowest-id free drafter on the team who is not its editor,
   while the project stays within `WIP_LIMIT`. No model decides who writes. The standup then
   pitches only into what is left: planned work comes first.
5. **Failures are loud** (rule 11). A board whose job fails, or that has no outcome within two
   game hours (its job is due after 90 minutes, ADR-0060), ends with a `BoardFailed` ticket:
   `Retry` holds it again now, `Skip` (the default, a day later) waits for next Monday.
6. **The orchestrator runs the board** like the standup (ADR-0062): a frame from the host's
   context, one structured call for the week's proposals against the content calendar (closed
   world: calendar topic ids or null), a web check of each proposal (ADR-0068), then records: one
   brief per item (with no writer), the workstream titles, minutes. It schedules start days and
   spreads items across editors itself; the editor-in-chief's own `PlanSchedule` call is a later
   increment. Plan text stays in the store (rule 2).
7. **No CEO approval of the plan.** Big bets are named in the minutes; nothing waits for the CEO
   until an article reaches the publish gate.
8. **World format 3.** The new fields change the world's encoding: `WORLD_FORMAT` goes from 2 to
   3 and the goldens are re-baselined. A format-2 checkpoint is refused as before; the owner's
   company is rebuilt once by replaying its command log from the seed (`?restore=rebase`).

**Build status (2026-10-06):** decisions 1 to 5 and 8 (the sim) are built and tested
(`crates/sim-core/tests/editorial_board.rs`, the golden script answers a board). The
orchestrator's board job (6), the host's context, the rebase path and the Plan views follow.

## Consequences

- The Calendar, Timeline and Workload views get real data; the whiteboard's Brief column shows
  the week ahead.
- A week can hold more than three articles in the plan while the writing loop stays bounded.
- **Negative:**
  - No command moves or cancels a planned item yet. An item that cannot start in time shows as
    overdue, and the next board sees it; `UpdateWorkItem` and `CancelWorkItem` come later.
  - Offsets count sim days while seasons follow the calendar date; at fast game speed boards
    can propose the same season repeatedly. The orchestrator dedupes against published,
    in-flight and planned titles.
  - A board costs one model call plus one web check per proposal every week.
  - The format bump invalidates every format-2 snapshot; companies replay from their log once.
- **Alternatives rejected:**
  - *The CEO approves the weekly plan.* The owner chose not to: the CEO steers through the
    publish gate and the Inbox, not through planning chores.
  - *Unstarted items count against the WIP limit.* The board could then plan only three items,
    and the standup nothing.
  - *The model assigns writers.* Staffing is a deterministic sim rule, like everything that
    decides who works on what in the office.
  - *The plan as `editorial-plan.yaml` in the site repository* (the legacy concept). Decided
    differently by rule 6 and ADR-0056: the plan's state is the sim's, its text the store's.
