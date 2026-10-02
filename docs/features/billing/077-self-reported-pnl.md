---
id: FEAT-077
title: "Self-reported real P&L"
status: planned
importance: normal
paths:
  - "apps/game/src/ui/pnl/**"
  - apps/game/src/store/schema.ts
adrs:
  - ADR-0052
  - ADR-0033
---

# Self-reported real P&L

Increment C3. The player may enter or import (CSV) their own affiliate and sponsorship figures.
They are labelled self-reported, kept in the browser store, and shown beside real platform costs
in the Real money tab (FEAT-072).

Boundary: swarm.press never receives, holds, routes, splits or pays out third-party revenue, and
never nets revenue against the balance. Revenue and costs in different currencies are shown
separately or converted by deterministic code; the CFO model never converts.

Depends on: FEAT-072.

## Acceptance criteria

- [ ] Entered figures do not change the world hash, in-game cash, reputation or score.
- [ ] A CSV import with a malformed row reports the row and imports nothing.
- [ ] Figures are absent from central sync unless text packs are enabled for that table.

## Evidence

- `game/vitest`
