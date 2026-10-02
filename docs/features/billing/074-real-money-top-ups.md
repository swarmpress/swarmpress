---
id: FEAT-074
title: "Real-money top-ups"
status: planned
importance: high
paths:
  - "crates/server/src/payments/**"
  - crates/server/tests/payments.rs
adrs:
  - ADR-0051
---

# Real-money top-ups

Increment B10. Not started before legal and tax sign-off (ADR-0051 lists the open questions).

- A top-up of at least €10 through a payment provider credits the `paid` bucket.
- The pack price includes VAT; the credits granted equal the net-of-VAT value, so the count
  varies by the customer's country.
- Strong customer authentication and velocity limits apply to new accounts.
- Provider webhooks are idempotent. A refund or chargeback posts reversing entries; it never
  edits history.
- The balance is closed-loop: no cash-out, no transfer, no exchange with in-game cash.

Depends on: FEAT-069, FEAT-070, and the sign-off.

## Acceptance criteria

- [ ] Replaying a provider webhook credits once.
- [ ] Credits granted match the net amount for each VAT rate in the fixture table.
- [ ] A chargeback on spent credits leaves a consistent ledger and blocks further paid spend.
- [ ] With payments disabled, every purchase route fails loudly (rule 11).

## Evidence

- `server/nextest`
