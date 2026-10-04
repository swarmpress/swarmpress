---
id: FEAT-009
title: "Inbox and tickets"
status: in-progress
importance: high
paths:
  - crates/sim-core/src/inbox.rs
  - crates/sim-core/tests/publish_gate.rs
  - apps/game/src/ui/components/Inbox.tsx
adrs:
  - ADR-0011
  - ADR-0020
  - ADR-0059
---

# Inbox and tickets

> **Status note (2026-10-02):** Tickets, options, defaults, deadlines and delegation exist in `crates/sim-core/src/inbox.rs`; the Inbox panel (`apps/game/src/ui/components/Inbox.tsx`) reads them. Since increment S (FEAT-079, ADR-0059) the feature has linked tests: `inbox::tests` (the rules of every kind, mapped in `docs/test-map.yaml`) and `crates/sim-core/tests/publish_gate.rs` (tickets answered, expired with their default exactly once, never answered by the Secretary when High; the autonomy policy deciding whether an approved article becomes a ticket). That increment added the `PublishApproval`, `StandupFailed`, `DeployFailed`, `NeedsMedia` and `NeedsPage` kinds, and an answer's effect now depends on the ticket's kind. The kinds listed below that the sim does not have yet (pitch, hire cards, salary, resignation, redesign, event response) are still planned.

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

- `swarmpress/nextest` (`inbox::tests`, `crates/sim-core/tests/publish_gate.rs`)
- `game/vitest` (inbox components)
- `game/playwright-e2e` (inbox flow)
