# ADR-0051 — Ledger unit, pricing, credit buckets and top-ups

**Status:** Accepted (amends ADR-0033, ADR-0040)
**Date:** 2026-10-02

## Context

ADR-0033 defined Credits (◆): 1 ◆ = $0.01, a 20% margin, and a `ceil` to whole ◆ per job, with
free grants (500 starter, 100 weekly) and real-money purchases deferred. Nothing of the ledger
is built; `config/pricing.toml` exists and no code loads it.

The commercial briefing proposed: price = attributable provider cost × a configurable uplift
(30% to start), a prepaid euro balance, integer micros internally, and rounding each logical job
up to a €0.01 billing quantum.

Working the arithmetic shows two problems.

**Rounding.** Eight representative jobs, provider cost converted at an illustrative 0.92 €/$:

| Job | Cost € | €0.01 round-up, 30% | ◆ ceil, 20% (ADR-0033) | Exact, 30% |
|---|---|---|---|---|
| Review, Haiku cached (2.5k cached + 500 in, 400 out) | 0.00253 | €0.01 = 3.95x | 1 ◆ = 3.64x | €0.003289 = 1.30x |
| Draft, Sonnet (6k in, 2.5k out) | 0.03404 | €0.05 = 1.47x | 5 ◆ = 1.35x | €0.04425 |
| Research, Sonnet (40k in, 4k out, 5 searches) | 0.1564 | €0.21 = 1.34x | 21 ◆ = 1.24x | €0.2033 |
| Theme, Opus (60k in, 12k out) | 0.4416 | €0.58 = 1.31x | 58 ◆ = 1.21x | €0.5741 |
| Firecrawl scrape | 0.000764 | €0.01 = 13.1x | 1 ◆ = 12.0x | €0.000993 |
| Storage, 2 GB for one day | 0.00092 | €0.01 = 10.9x | 1 ◆ = 10x | €0.001196 |
| Image transform | 0.00046 | €0.01 = 21.7x | 1 ◆ = 20x | €0.000598 |
| Runner, 40 min | 0.0662 | €0.09 = 1.36x | 9 ◆ = 1.25x | €0.0861 |

A realistic article (1 research, 2 drafts, 2 reviews, 5 scrapes) costs €0.2334. The cent
round-up charges €0.38 (1.63x); exact settlement charges €0.3034. Under the cent round-up, 2 GB
of storage costs the player about €0.30 a month against €0.028 of provider cost. Both rounding
schemes are regressive on small jobs and make "price = cost + uplift" untrue.

**What 30% nets.** A €10 top-up, with the uplift applied to provider cost:

| Case | Net of VAT | Fees | Cash | Provider cost when spent | Contribution |
|---|---|---|---|---|---|
| €10 buys €10 of balance, DE 19%, card processor | 8.403 | 0.45 | 7.953 | 7.692 | +€0.26 |
| Same, HU 27% | 7.874 | 0.45 | 7.424 | 7.692 | −€0.27 |
| Same, DE, merchant of record | 8.403 | 0.96 | 7.443 | 7.692 | −€0.25 |
| €5, DE, card processor | 4.202 | 0.35 | 3.852 | 3.846 | +€0.006 |
| €10 buys the net value in credits (8,403), DE | 8.403 | 0.45 | 7.953 | 6.464 | +€1.49 |
| Same, HU (7,874 credits) | 7.874 | 0.45 | 7.424 | 6.057 | +€1.37 |
| Same, €5, DE (4,202 credits) | 4.202 | 0.35 | 3.852 | 3.232 | +€0.62 |

A 30% uplift on a VAT-inclusive balance does not cover costs. It would need roughly 55% (DE) to
69% (HU) to leave €1.50 per €10.

**Price assumptions.** All provider prices above are assumptions, not verified quotes:

| Item | Assumed price | Source and date |
|---|---|---|
| Claude Haiku 4.5 / Sonnet 5.5 / Opus 5.5 | $1/$5, $2/$10, $4/$20 per MTok; cache read $0.10/$0.20/$0.20 | `config/pricing.toml`, price version 2026-10-01 |
| Claude `web_search` | $10 per 1,000 searches | from memory, 2026-10-02 |
| Cloudflare R2 | $0.015/GB-month; Class A $4.50/M; Class B $0.36/M; egress free | from memory, 2026-10-02 |
| Cloudflare Images transforms | $0.50 per 1,000 unique per month | from memory, 2026-10-02 |
| Cloudflare Containers | about $0.108/h for 1 vCPU + 4 GiB | from memory, least certain |
| Firecrawl | about $0.00083 per page on a 100k-credit plan | from memory, 2026-10-02 |
| Card processing, EEA cards | 1.5% + €0.25; dispute fee about €20 | from memory, 2026-10-02 |
| Merchant of record | 5% + $0.50 | from memory, 2026-10-02 |
| FX | 0.92 €/$ | illustrative only |

## Decision

1. **Ledger unit: the micro-euro.** All real-money amounts are `i64` millionths of a euro (µ€).
   No floating point anywhere in money.
2. **Display unit: the credit.** 1 credit = €0.001 = 1,000 µ€, so 1,000 credits = €1.00. The UI
   shows credits with the euro value beside them. This replaces ◆ = $0.01.
3. **Exact settlement.** Every charge settles at list cost × uplift, with a single ceiling to
   1 µ€. There is no per-job quantum. The €0.01 step applies only where money moves: top-ups and
   refunds.
4. **Arithmetic** lives in a pure crate, `crates/billing`, which also compiles to wasm so the
   browser shows estimates with the same code.
   - Accumulate Σ units × rate as an integer numerator. Do not round per token (Haiku cache read
     is 0.1 µ$ per token).
   - Apply FX and uplift in one `i128` division with a ceiling, then store `i64`.
5. **`pricing.toml` v2.**
   - Publishes EUR unit prices derived from USD list prices at a recorded `fx_ppm`. There is no
     live FX.
   - `uplift_bp` is configurable globally and per service. The starting value is 3,000 (30%).
   - A price change is a reviewed config change with an effective date.
   - Every ledger entry stores the provider cost in µ$, `fx_ppm`, `uplift_bp` and
     `price_version`.
6. **Two buckets per player.**
   - `promo`: granted, non-refundable, expires (for example after 90 days), spent first with the
     soonest-expiring first, and not usable for recurring charges, so storage never depends on
     it.
   - `paid`: bought.
   - A hold records its per-bucket split, so a release returns to the right bucket.
7. **Grants are re-pegged.** ADR-0033's 500 ◆ starter grant is about $4.17 of provider cost per
   signup and the weekly 100 ◆ about $43 a year per active player. The new grant is roughly 300
   to 1,000 credits, given on a verified first publish, with no unconditional weekly allowance.
   Exact amounts are config.
8. **Top-ups.**
   - The uplift stays at 30%.
   - The pack price is what the customer pays, VAT included. The credits granted equal the
     **net-of-VAT** amount, so the credit count varies by VAT country.
   - Minimum top-up €10. A €5 pack is offered only with a visible processing fee, if at all.
   - New accounts need strong customer authentication and velocity limits: one disputed €10
     top-up that was already spent loses about €26, which is about 18 good top-ups.
9. **Real-money purchase stays disabled** until tax and legal sign-off. Until then the ledger
   runs on promo credits only. The open questions, for a lawyer and a tax adviser:
   - Is the balance a prepayment for own services, a limited-network instrument, or e-money?
     Does a creator marketplace change the answer?
   - Is VAT due at top-up or at consumption, and is OSS registration needed?
   - Must an unused balance be refunded, and who bears the fees?
   - Are expiry clauses allowed, and for which bucket?
   - How does the 14-day withdrawal right apply, and can it be waived on immediate performance?
   - What is required for minors and age gating?
   - Does "credits granted net of VAT" satisfy price-indication rules?
10. **Kept from ADR-0033:** closed loop, no cash-out, no exchange with in-game cash, double
    entry, holds, idempotency keys, no negative balance, quote → hold → settle. The tables and
    the flow are in ADR-0052.
11. **Firecrawl (ADR-0040)** is priced by this ADR and gated by ADR-0052. ADR-0040's separate
    "monthly web budget" becomes a category in the spend policy.

Alternatives considered:
- **Round each job up to €0.01** (the briefing). Rejected: 4x to 22x on small jobs, 1.63x on a
  typical article.
- **Keep ◆ = $0.01 with `ceil`** (ADR-0033). Rejected: the same regressive rounding, and a
  balance pegged to the dollar for euro customers.
- **A higher uplift (55% to 70%) on a VAT-inclusive balance.** Rejected: no longer near-cost.
- **Live FX per charge.** Rejected: non-reproducible prices and a moving quote. A recorded
  `fx_ppm` per price version is auditable.
- **Invoice-cost pricing.** Rejected in ADR-0044: undefined for subscriptions and free tiers.

## Consequences

- Positive: "price = list cost + 30%" is true for every job, small or large.
- Positive: one unit and one crate for all money arithmetic, in the browser and on the server.
- Positive: every entry can be re-derived from stored cost, FX, uplift and price version.
- Positive: the whole design can be exercised with promo credits before any payment exists.
- Negative: credits granted vary by country, which needs clear wording at checkout and a legal
  check.
- Negative: about €1.40 to €1.50 per €10 must still cover chargebacks, promo grants and the
  free-tier costs of ADR-0044. It may not.
- Negative: FX risk between price versions sits with swarm.press.
- Negative: balances have three decimal places of a euro in the UI; some players will find
  credits less intuitive than cents.
- Negative: ADR-0033, `docs/game-design/credits.md` and `config/pricing.toml` are now stale on
  the unit, peg, margin, `ceil`, `amount_credits BIGINT` and grant amounts.
- Not built: `crates/billing`, `pricing.toml` v2, the ledger, the wallet and any payment
  integration.
- Not verified: every price in the assumptions table.
