---
id: FEAT-072
title: "Finance panel: real money and the in-game currency symbol"
status: planned
importance: high
paths:
  - apps/game/src/ui/format.ts
  - apps/game/src/ui/components/Finance.tsx
  - apps/game/src/ui/components/Wallet.tsx
  - apps/game/src/ui/panels.test.tsx
  - apps/game/e2e/ui.spec.ts
adrs:
  - ADR-0055
  - ADR-0052
---

# Finance panel: real money and the in-game currency symbol

Increment B7. In-game cash gets its own symbol (ADR-0055); € means real money only.

- The Finance panel has two tabs: **Company (game)**, unchanged apart from the symbol, and
  **Real money**, which reads `/api/wallet` live.
- The real tab shows credits with the euro value beside them, the month's spend by category and
  department, budgets, holds and pending approvals.
- The two currencies never share a table or a sum.

Depends on: FEAT-069, FEAT-071. See FEAT-007 for the symbol in the sim's docs and prompts.

## Acceptance criteria

- [ ] No € appears in the Company tab or in any in-game amount formatted by `format.ts`.
- [ ] The Real money tab shows balance, held amount and spend from a fixture wallet.
- [ ] Without a wallet (signed out or offline) the tab says so and shows no stale numbers.
- [ ] The panel passes the existing accessibility checks.

## Evidence

- `game/vitest`
- `game/playwright-e2e`
