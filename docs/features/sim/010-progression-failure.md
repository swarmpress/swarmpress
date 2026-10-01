---
id: FEAT-010
title: "Progression, unlocks and failure states"
status: planned
importance: normal
paths:
  - crates/sim-core/src/progression.rs
adrs:
  - ADR-0021
---

# Progression, unlocks and failure states

Company levels L1–L5 unlock rooms and the Star hiring pool; failure states: cash below 0 → loan
ticket, 7 negative days → receivership (hiring frozen, automatic layoffs, the site is never
deleted), reputation below 100 → credibility crisis (approval bar 8 for 14 days).

Decisions: [ADR-0021](../../adr/0021-economy-tied-to-real-site-signals.md).

## Acceptance criteria

- [ ] Unlock table matches `docs/game-design/rooms-and-progression.md`.
- [ ] Receivership never touches the site repo.

## Evidence

- `simpress/nextest`
