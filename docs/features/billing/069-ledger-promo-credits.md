---
id: FEAT-069
title: "Ledger and wallet with promotional credits"
status: planned
importance: critical
paths:
  - crates/server/src/wallet.rs
  - crates/server/src/db/ledger.rs
  - crates/server/tests/ledger.rs
adrs:
  - ADR-0051
  - ADR-0039
---

# Ledger and wallet with promotional credits

Increment B3. A double-entry ledger in central SQLite: `price_versions`, `ledger_accounts`,
`ledger_transactions` (unique idempotency key), `ledger_entries`, `wallet_balances`, `holds`.
Amounts are integer micro-euros. Σ entries = 0 is enforced in Rust inside `BEGIN IMMEDIATE`.

- Two buckets per player: `promo` and `paid`. Spend order is promo first, soonest-expiring
  first, then paid. Promo expires, is non-refundable and cannot fund recurring charges.
- A hold records its per-bucket split so a release returns to the right bucket.
- Grants are small and conditional on a verified first publish. Only promotional credits exist
  until FEAT-074.
- `GET /api/wallet` returns balance, held amount and recent entries.

Depends on: FEAT-068.

## Acceptance criteria

- [ ] Property tests: Σ entries = 0 per transaction; no balance or hold goes negative.
- [ ] A retried request with the same idempotency key applies once.
- [ ] An expired hold is released to the buckets it came from.
- [ ] Promo is spent before paid, soonest-expiring first; expired promo cannot be spent.

## Evidence

- `server/nextest`
