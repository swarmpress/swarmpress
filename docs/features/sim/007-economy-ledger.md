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

> **Status note (2026-10-02):** The ledger and books exist (`crates/sim-core/src/economy.rs`, `finance.rs`); revenue is a stub returning 0. The status lags because no test file is linked to this feature yet. ADR-0059 and the MVP need no economy change for a week of play (computed runway is about 59 game days).

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
