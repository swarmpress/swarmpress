# ADR-0033 — Credits: a closed-loop platform currency, separate from in-game cash

**Status:** Accepted (amends the plan's "no API cost limits")
**Date:** 2026-10-01

## Context

Some things in swarm.press cost the platform real money or are worth real money:
- Agency work on commercial LLMs (Claude on the server);
- theme and template purchases;
- asset packs, premium services, and later creator sales.

The sim already has an in-game cash economy (€) that pays salaries and rent. Paying API bills
with in-game cash would let simulated success fund real costs. Selling in-game cash for real
money would make the leaderboard pay-to-win.

## Decision

- Introduce **Credits (◆)**, a platform currency **separate from in-game cash**. Neither can be
  exchanged for the other.
- Credits live in a **server-side double-entry ledger** (Postgres) per player account, not in the
  deterministic sim:
  - holds for metered jobs;
  - idempotency keys on every mutation;
  - no negative balances;
  - append-only, corrected only by reversing transactions;
  - entitlements for purchases.
- **Spending:**
  - Agency jobs are metered from the API's reported usage via `config/pricing.toml`, with a
    platform margin, using a quote → hold → settle flow. Platform failures are released.
  - Marketplace items have fixed prices (themes licensed per project; templates, block packs,
    persona packs, cosmetics).
- **Earning:** a starter grant, a weekly allowance with a cap, one-time achievements, operator
  grants, and later purchases and creator revenue share.
- **Credits buy capability and content, never score.** Browser-run staff (ADR-0024) are free, so
  a player with zero credits can play the whole game.
- **Real-money purchases are deferred.** Credits are designed as closed-loop (no cash-out, no
  peer transfer outside the marketplace). Enabling purchases requires a separate decision on
  consumer law, VAT, refunds and expiry, age gating and, for creators, KYC and payouts.

## Consequences

- The plan's "no API cost limits" now holds only for operator-granted accounts, such as the owner's
  own company with an unlimited or large grant. Everyone else's Agency use is bounded by credits.
- The server gains a financial subsystem. It needs property tests (Σ entries = 0, no negative
  balances, idempotent retries) and an audit export.
- Agency jobs gain UX: quotes, holds, an auto-approve threshold, and a browser fallback when the
  balance is short.
- `llm_calls` must record exact usage per job (input, cache write, cache read, output tokens,
  model) to settle charges.
- A marketplace needs review and moderation for listed themes and templates (security: themes
  run through the site-kit theme lint and the PR gate before they touch a site).
