---
id: FEAT-009
title: "Inbox and tickets"
status: planned
importance: high
paths:
  - crates/sim-core/src/inbox.rs
  - crates/sim-core/src/tickets.rs
  - "apps/game/src/ui/inbox/**"
adrs:
  - ADR-0011
  - ADR-0020
---

# Inbox and tickets

QuestionTickets are the only channel to the CEO. Kinds: pitch, hire (3 candidate cards),
salary/promotion, resignation, redesign approval, escalation (NEEDS_PAGE / NEEDS_MEDIA / editor
deadlock), event response, loan. Each has options, a `default_option` and a `deadline_step` so
offline companies never stall.

Decisions: [ADR-0011](../../adr/0011-orchestrator-owns-state-transitions.md), [ADR-0020](../../adr/0020-real-time-ticks-offline-catch-up.md).

## Acceptance criteria

- [ ] Ticket state machine (open → answered/defaulted → closed) is enforced in the sim.
- [ ] A ticket past its deadline applies its default option exactly once.
- [ ] Autonomy policy (ApproveAll/ApproveMajor/Autonomous) decides which pitches become tickets.

## Evidence

- `swarmpress/nextest`
- `game/vitest` (inbox components)
- `game/playwright-e2e` (inbox flow)
