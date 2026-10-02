# Credits: the platform currency

> Status: design contract (2026-10-01). Decision: [ADR-0033](../adr/0033-credits-a-closed-loop-platform-currency-separate-from-in-game-cash.md).

swarm.press has **two currencies**, and they never mix:

| | **Cash (€)** | **Credits (◆)** |
|---|---|---|
| What it models | The simulated company's economy | Things that cost the platform real money, or are worth real money |
| Lives in | sim-core (deterministic, per company) | Server ledger (Postgres, per player account) |
| Earned by | Site revenue, audience, events (economy.md) | Starter grant, weekly allowance, achievements, purchases (later) |
| Spent on | Salaries, rent, rooms, equipment, overtime | Agency work (commercial LLMs on the server), marketplace themes, templates and packs, premium services |
| Can be bought with real money | Never | Later (closed-loop, see §6) |
| Can be cashed out | No | No |

So in-game success can never fund real API bills, and buying credits can
never buy in-game cash or a better leaderboard position. Credits buy
**capability and content**, not score.

## 1. What costs credits

| Item | Price model | Notes |
|---|---|---|
| **Agency jobs** (Claude on the server: research with web search, theme and design work, escalations, business cases) | Metered: actual tokens × model rate × platform margin, converted to ◆ | A quote before the run, then a hold, then settlement at actual cost (§3) |
| **Marketplace: themes** | Fixed price per theme license (per project) | Platform and community creators |
| **Marketplace: templates and block packs** | Fixed price | Page templates, custom-block packs, workstream templates ("Seasonal guide in 4 languages") |
| **Marketplace: persona packs** | Fixed price | Curated candidates (for example "Star investigative journalist") added to the hiring pool |
| **Asset packs** (3D office decor, room skins) | Fixed price | Cosmetic only |
| **Extra project slot** beyond the level cap | Fixed price | Optional; the base progression unlocks enough |
| **Premium services** | Fixed or metered | Custom domain setup, extended analytics retention, priority Agency queue |

Free: everything that runs **in the player's browser** (local LLM staff,
ADR-0024), the sim, the tracker, standard deploys and the starter theme. A
player with zero credits can play the whole game with browser-run staff.
Credits buy speed, quality and polish.

## 2. Earning credits

| Source | Amount (initial tuning) |
|---|---|
| Starter grant on founding a company | ◆ 500 |
| Weekly allowance (active player, real-world week) | ◆ 100, capped at ◆ 300 banked from allowances |
| Achievements: first article published, first redesign merged, 10k verified readers, 30 days without broken links, … | ◆ 25–250 each, once |
| Marketplace creator sales (later) | Revenue share of sales, credited to the creator's wallet |
| Purchases (later, §6) | Packages |
| Operator grants | Admin tool; for example the platform owner's own company or test accounts |

## 3. Agency pricing: quote, hold, settle

Agency jobs bill actual LLM usage, so they're priced in three steps:

1. **Quote.** Before a job is queued, the server estimates its cost from the
   job kind, input size, model and effort (rolling averages from
   `llm_calls`). The UI shows "≈ ◆ 18 (max ◆ 30)". The CEO, or a delegation
   policy (`auto-approve Agency jobs under ◆ N`), accepts it.
2. **Hold.** The max is reserved in the wallet as a hold entry. If the
   balance minus existing holds can't cover it, the job isn't queued; the
   UI offers the browser-staff route or a top-up.
3. **Settle.** On completion, the actual cost is computed from the API's
   reported `usage`, including cache reads, which are cheaper. It is charged
   up to the hold; the remainder is released.
   - Failures caused by the platform (5xx, timeouts) are released in full.
   - A refusal charges only what was consumed, and only if the model
     produced output.

**Price formula:**
`◆ = ceil((input_tokens·rate_in + cache_write·rate_cw + cache_read·rate_cr + output_tokens·rate_out) / CREDIT_VALUE_USD × (1 + margin))`

- Rates come from `config/pricing.toml`, one entry per model id.
- `CREDIT_VALUE_USD` defaults to $0.01 per ◆.
- Changing prices is a config change, with an effective date recorded on
  every ledger entry.

**In-game representation:** Agency work is done by **external contractors**
who visit the office (ADR-0024). Their invoice appears in two places:
- the CFO's books, as an in-game € "agency fee" line (sim flavour);
- the wallet, as real ◆.

The CFO's finance report mentions both.

## 4. Marketplace

- **Listings:**
  - themes (site-kit themes, ADR-0015/0016);
  - page templates and workstream templates;
  - custom-block packs;
  - persona packs;
  - office cosmetics.

  Each listing has a version, screenshots and a price, and is reviewed
  before it's listed.
- **Purchasing** creates an **entitlement**: `{account, item, version, scope: account | company | project}`.
  Themes are licensed per project. Applying a purchased theme opens a theme
  PR on the project's site repo, which goes through the normal design gate
  (screenshots, review, CEO approval).
- **Creators** (later): players or studios publish items, the platform keeps
  a commission, and the creator's wallet gets the rest. Payouts in real money
  need KYC and a payment provider, and are out of scope until §6 is decided.

## 5. Ledger (server, authoritative)

Credits are **not** in the deterministic sim: they're tied to real money and
real costs, and the lockstep replicas don't need them. The server ledger is a
**double-entry** journal:

```
accounts      (id, kind: wallet | platform_revenue | grants | purchases | creator_payable | holds, owner)
transactions  (id, kind, idempotency_key UNIQUE, created_at, actor, memo, price_version)
entries       (transaction_id, account_id, amount_credits BIGINT)   -- Σ amounts per transaction = 0
holds         (id, wallet, amount, reason: agency_job, ref: job_id, status: open | settled | released, expires_at)
entitlements  (id, account, item_id, version, scope, scope_ref, granted_by_tx, created_at)
```

- Balances are derived (Σ entries). They're cached in `wallet_balances` and
  updated in the same transaction.
- A wallet can't go negative, enforced in SQL with a check plus row locking.
- Every mutation is idempotent (`idempotency_key`), so job retries and
  webhook replays can't double-charge.
- Holds expire, and the expiry releases them automatically.
- The audit trail is append-only. Corrections are reversing transactions,
  never edits.

## 6. Real money (later, decision deferred)

- Credits may become purchasable in packages through a payment provider.
  They are a **closed-loop** currency: no cash-out, no transfers between
  players except marketplace purchases, and no exchange into in-game cash.
- Before enabling purchases, decide and document:
  - jurisdictions and consumer law (refunds, unused-credit rules, expiry);
  - taxes (VAT on digital services);
  - age gating;
  - receipts;
  - chargeback handling;
  - and, for creator payouts, KYC and the payout provider.
- Until then, credits come only from grants, allowances and achievements.

## 7. UI

- **Wallet chip in the HUD:** balance, with open holds shown dimmed.
- **Wallet panel:** history of grants, Agency charges with a link to the
  plan item, purchases and refunds; open holds.
- **Agency quote dialog:** shown when a job would go to the Agency. It
  includes the auto-approve threshold setting.
- **Marketplace panel:** browse, preview (screenshots, live preview for
  themes), buy, apply.
- **CFO:** shows Agency spend in ◆ alongside the € agency-fee line.

## 8. API sketch

```
GET  /api/wallet                        → { balance, holds[], allowance: { nextAt, amount } }
GET  /api/wallet/transactions?before=   → paged history
POST /api/agency/quote   { jobKind, itemId, inputs } → { estimate, max, model, quoteId, expiresAt }
POST /api/agency/accept  { quoteId }    → { holdId, jobId }          (idempotent per quoteId)
GET  /api/market/items?type=            → listings
POST /api/market/purchase { itemId, version, scope, scopeRef, idempotencyKey } → { entitlementId, balance }
POST /api/admin/grants   { account, amount, memo } (operator only)
```
