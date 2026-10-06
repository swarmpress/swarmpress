---
id: FEAT-089
title: "The analytics loop"
status: in-progress
importance: high
paths:
  - crates/server/src/analytics_loop.rs
  - crates/server/tests/tracker.rs
  - crates/sim-core/tests/analytics_loop.rs
  - crates/orchestrator/src/analysis.rs
  - crates/orchestrator/tests/analysis.rs
  - crates/agents/src/analysis.rs
adrs:
  - ADR-0071
  - ADR-0032
  - ADR-0021
  - ADR-0070
---

# The analytics loop

Real readers reach the game ([ADR-0071](../../adr/0071-the-analytics-loop.md)): the host delivers
the tracker's daily signals into the sim; the data scientist follows up each published article
after 14 game days and writes the weekly KPI report at the Monday review; the board plans with the
report's recommendations and refreshes articles that underperform.

## Built

- **Server**: `GET /api/analytics/signals`, `POST /api/analytics/signals/ack`,
  `GET /api/analytics/page` (lease). Test: `crates/server/tests/tracker.rs`.
- **Sim**: `Policy::Analytics` (off by default; the session turns it on once), `JobKind::Performance`
  (14 game days after publication, once, by the data scientist; the score stays on the item) and
  `JobKind::KpiReport` (at the Monday KPI review); world format 4. Test:
  `crates/sim-core/tests/analytics_loop.rs`.
- **Orchestrator** (`crates/orchestrator/src/analysis.rs`): the follow-up's score from page views
  against the per-page median (no model), its post within the numbers it was given; the KPI report
  as the review's minutes, its headline spoken; without data, said, not invented. The board's frame
  carries the latest report's recommendations and underperforming articles (score 3 or less) as
  refresh candidates. Tests: `crates/orchestrator/tests/analysis.rs`, `crates/orchestrator/tests/maintain.rs`.
- **Host**: daily delivery of pending signals (each logged once, oldest first) and the ack; the
  follow-up's page numbers and the report's two weeks as job context; the follow-up score on the
  work item and the KPI headline in the Plan panel's "This week" card.

## Not built yet

- `ExperimentReadout`, top-page digests beyond the hash, and the leaderboard's verified audience.

## Acceptance criteria

- [ ] A day of real traffic moves the project's audience and goal progress once, and only once.
- [ ] A published article gets one follow-up after 14 game days with numbers from the tracker.
- [ ] The Monday report's recommendations reach the board.
