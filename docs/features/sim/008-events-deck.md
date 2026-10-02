---
id: FEAT-008
title: "Events deck"
status: planned
importance: normal
paths:
  - crates/sim-core/src/events.rs
  - config/events.ron
adrs:
  - ADR-0021
---

# Events deck

Data-driven events with seeded rolls and earned triggers: viral post, critic review (an LLM job
reading the real site), burnout, poaching, fact-check scandal, tourist season (from `content-
calendar.json`), deploy outage.

Decisions: [ADR-0021](../../adr/0021-economy-tied-to-real-site-signals.md).

## Acceptance criteria

- [ ] Event rolls use only the world RNG; same seed gives same events.
- [ ] Each event has a ticket or a direct effect documented in `docs/game-design/events-and-inbox.md`.

## Evidence

- `swarmpress/nextest`
