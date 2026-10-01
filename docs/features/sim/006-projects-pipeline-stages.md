---
id: FEAT-006
title: "Projects and pipeline stages"
status: planned
importance: critical
paths:
  - crates/sim-core/src/projects.rs
  - "crates/sim-core/src/projects/**"
  - crates/sim-core/src/jobs.rs
  - "crates/sim-core/tests/pipeline*.rs"
adrs:
  - ADR-0011
  - ADR-0020
---

# Projects and pipeline stages

Projects (Article, PageRefresh, CollectionResearch, Translation, Redesign, SiteAudit, LinkPass) move
through stages (Pitch → Brief → Draft → Media → Edit → QA → Publish) as a sim state machine. A
transition emits `Effect::RequestJob` in the same transaction as the command-log entry;
`Cmd::JobCompleted{job_id, digest}` returns; a stage ends at `max(min sim time, job done)`; late
jobs become overtime per policy; failures block the stage and open a ticket.

Decisions: [ADR-0011](../../adr/0011-orchestrator-owns-state-transitions.md), [ADR-0020](../../adr/0020-real-time-ticks-offline-catch-up.md).

## Acceptance criteria

- [ ] Every stage transition is driven by a command; no LLM output can skip Edit or QA.
- [ ] Editor score ≥ 7 approves; below loops back at most 3 times, then an escalation ticket.
- [ ] One stage per staff member; seats per room; ServerRoom level caps deploys per day.
- [ ] Stub executors fail loudly (blocked stage + ticket).

## Evidence

- `simpress/nextest`
- `server/nextest` (full pipeline test with fakes)
