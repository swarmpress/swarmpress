---
id: FEAT-006
title: "Projects and pipeline stages"
status: in-progress
importance: critical
paths:
  - crates/sim-core/src/projects.rs
  - "crates/sim-core/src/projects/**"
  - crates/sim-core/src/plan.rs
  - crates/sim-core/src/jobs.rs
  - "crates/sim-core/tests/pipeline*.rs"
  - crates/sim-core/tests/job_contract.rs
adrs:
  - ADR-0011
  - ADR-0020
  - ADR-0031
  - ADR-0038
---

# Projects and pipeline stages

Projects (Article, PageRefresh, CollectionResearch, Translation, Redesign, SiteAudit, LinkPass) move
through stages (Pitch → Brief → Draft → Media → Edit → QA → Publish) as a sim state machine. A
transition emits `Effect::RequestJob` in the same transaction as the command-log entry;
`Cmd::JobCompleted{job_id, digest}` returns; a stage ends at `max(min sim time, job done)`; late
jobs become overtime per policy; failures block the stage and open a ticket.

**Implemented (MVP job contract, [docs/mvp.md](../../mvp.md)):** work items with Draft → Review →
Publish phases in `crates/sim-core/src/plan.rs`; `Effect::RequestJob{job_id, kind, project,
work_item, brief_ref, revision, staff}` drained via `World::drain_effects()`; the 09:00 standup
requests one Standup job per active project per day; `ServerCommand::{MeetingOutcome,
JobCompleted, DeployLanded}` drive every transition; score ≥ the quality bar publishes, lower
revises (at most 3 revisions), then the item is blocked with an escalation ticket; a failed job
blocks at once. See [sim.md "Job contract"](../../architecture/sim.md#job-contract-mvp). The
Pitch/Brief/Media/QA stages, capacity limits and overtime for late jobs are still planned.

Decisions: [ADR-0011](../../adr/0011-orchestrator-owns-state-transitions.md), [ADR-0020](../../adr/0020-real-time-ticks-offline-catch-up.md).

## Acceptance criteria

- [ ] Every stage transition is driven by a command; no LLM output can skip Edit or QA.
- [ ] Editor score ≥ 7 approves; below loops back at most 3 times, then an escalation ticket
      (`job_contract::revision_cap_blocks_with_a_ticket`).
- [ ] The 09:00 standup requests one Standup job per active project per day
      (`job_contract::one_standup_per_day_per_project`).
- [ ] The full article loop runs through the job contract (`job_contract::the_whole_article_loop`).
- [ ] One stage per staff member; seats per room; ServerRoom level caps deploys per day.
- [ ] Stub executors fail loudly (blocked stage + ticket).

## Evidence

- `simpress/nextest` (`crates/sim-core/tests/job_contract.rs`, `plan::tests`, the plan
  invariants in `crates/sim-core/tests/invariants.rs`)
- `server/nextest` (full pipeline test with fakes)
