---
id: FEAT-070
title: "Spend requests, policy and the hard gate"
status: planned
importance: critical
paths:
  - "crates/server/src/billing/**"
  - crates/server/tests/spend.rs
  - crates/server/src/web.rs
  - crates/server/tests/web.rs
adrs:
  - ADR-0052
  - ADR-0051
  - ADR-0040
---

# Spend requests, policy and the hard gate

Increment B4. Every paid operation is a `spend_request` (company, department, category, work
item, extension, estimate, maximum) evaluated centrally, because the browser sim is forgeable.

Flow: quote → policy → hold at a true maximum → execute → settle the actual cost.

- **Policy** (`spend_policies`, `dept_budgets`): monthly and daily caps, per-job maximum,
  auto-approve threshold, allowed categories. The outcome is auto-approved, pending approval or
  rejected. No model takes part in it.
- **Gate:** no hold, no execution. A request with a stale lease epoch is refused.
- **Firecrawl** is the first paid service: `/web/firecrawl/*` stops returning 501 and runs
  through the gate.
- A pending request has a wall-clock expiry; central wins any disagreement with the sim's ticket.

Depends on: FEAT-068, FEAT-069, FEAT-013.

## Acceptance criteria

- [ ] Each cap (monthly, daily, per job, category, balance) refuses with its own reason.
- [ ] A request at or under the auto-approve threshold proceeds; above it waits; an expired one
      is rejected and its hold released.
- [ ] Against a fake Firecrawl, the settled amount is the actual cost and never above the hold.
- [ ] A provider failure releases the hold in full.

## Evidence

- `server/nextest`
