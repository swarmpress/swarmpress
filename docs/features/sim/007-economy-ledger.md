---
id: FEAT-007
title: "Economy and ledger"
status: planned
importance: high
paths:
  - crates/sim-core/src/economy.rs
  - crates/sim-core/src/ledger.rs
  - config/economy.toml
adrs:
  - ADR-0021
  - ADR-0055
---

# Economy and ledger

Integer economy settled at 00:00: revenue from live pages (value × quality × freshness × language ×
reputation) plus audience CPM; logistic audience growth; costs from salaries, rent per tile, upkeep
and overtime; a double-entry `Ledger`. Real site facts enter via `Cmd::SiteSignals`.

Decisions: [ADR-0021](../../adr/0021-economy-tied-to-real-site-signals.md).

In-game cash has its own currency symbol (ADR-0055); € is reserved for real money. Real spend
never enters this ledger (FEAT-071). The UI side is FEAT-072.

## Acceptance criteria

- [ ] Settlement is integer-only and conserves cash (proptest).
- [ ] Real analytics contribute at most 30% of the audience target.
- [ ] Golden settlement fixtures for a reference company.

## Evidence

- `swarmpress/nextest`
