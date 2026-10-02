---
id: FEAT-071
title: "Real spend mirrored in the sim"
status: planned
importance: high
paths:
  - crates/sim-core/src/commands.rs
  - crates/sim-core/src/inbox.rs
  - crates/sim-core/src/world.rs
  - crates/sim-core/tests/spend_mirror.rs
  - "crates/protocol/**"
  - "packages/runner/test/fixtures/**"
adrs:
  - ADR-0052
  - ADR-0033
---

# Real spend mirrored in the sim

Increment B6. Real money enters the sim only as integer digests, for display and for the CEO's
decisions. Balances never enter the sim, and real amounts never touch the in-game `Ledger`,
reputation or score.

- `ServerCommand::{SpendApprovalRequested, SpendResolved, RealSpendDay, SpendPolicySet}`.
- `TicketKind::SpendApproval`: options Approve and Reject, default Reject, deadline one game
  day, priority High so the Secretary never answers it. It has its own `real_micros` field;
  `amount_cents` and the in-game delegation threshold do not apply.
- Answering the ticket makes the host call the central approve endpoint. The sim mirrors; it does
  not enforce.

Depends on: FEAT-070.

## Acceptance criteria

- [ ] An unanswered spend ticket resolves to Reject at its deadline.
- [ ] A spend ticket is never delegated, whatever the delegation policy.
- [ ] Replaying a log with spend commands gives the same hash natively, in wasm and under Bun;
      the goldens are regenerated with the new commands.
- [ ] `RealSpendDay` changes no in-game cash, reputation or score.

## Evidence

- `swarmpress/nextest`
- `runner/bun-test`
