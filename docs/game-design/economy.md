# Economy

All economy maths is integer: money in cents, factors in permille. Everything settles at 00:00
game time ([ADR-0021](../adr/0021-economy-tied-to-real-site-signals.md)). Defaults live in
`config/economy.toml`.

## Revenue

```
revenue_day = Σ_live_pages  page_value(type)
                          × quality(score)
                          × freshness(age_days)
                          × language(lang)
                          × reputation_factor
            + audience × CPM / 1000
```

| Factor | Values |
|---|---|
| `page_value` | blog-article €6.00, village / region €10.00, collection index €8.00, collection item €2.00, other €3.00 per day |
| `quality(score)` | editor score 7 → 1000 ‰, 8 → 1150 ‰, 9 → 1300 ‰, 10 → 1450 ‰; pages without a score on record (imported) → 900 ‰ |
| `freshness(age)` | 1000 ‰ for 0–90 days, then −5 ‰ per day, floor 400 ‰; a PageRefresh resets it |
| `language` | first language 1000 ‰, each translation 600 ‰ of the base value |
| `reputation_factor` | `500 + reputation / 2` ‰ (reputation 0–1000) |
| `CPM` | €4.00 per 1 000 audience per day |

Only pages that the latest **SiteAudit** found live, valid and linked count.

## Audience

Audience grows logistically toward a target:

```
target   = quality_pages × 120 × link_health × reputation_factor
         (+ min(real_analytics, 30% of target) if connected)
audience_{d+1} = audience_d + r × audience_d × (1 − audience_d / target)    r = 80 ‰ / day
```

- `link_health` = 1000 ‰ − 50 ‰ per broken internal link (floor 500 ‰).
- A **redesign** gives a novelty bump of +5% for 7 days.
- A **viral post** event adds a one-off spike that decays over 5 days.
- Real analytics are optional. They count for **at most 30%** of the target, so a brand-new site
  without traffic still plays.

## Costs

| Cost | Default |
|---|---|
| Salaries | per seniority ([staff.md](staff.md)), paid daily |
| Overtime | 1.5× hourly salary for hours worked after 18:00 |
| Rent | €1.50 per floor tile per day |
| Equipment upkeep | per item ([rooms-and-progression.md](rooms-and-progression.md)) |
| Agency jobs | in-game invoice: €40 per escalated job (+ €20 per research or design job) |
| Loan interest | 8% over the loan term, daily |

Real Claude spend is recorded in `llm_calls` for operations. The in-game Agency price is a game
balance number, not the real API cost. Real spend is capped: every paid job is bounded by a
credit hold (ADR-0033) and by the company's spend policy (ADR-0052).

## Reputation (0–1000)

| Event | Change |
|---|---|
| Article published with editor score ≥ 8 | +3 |
| QA escape found by SiteAudit | −8 |
| Critic review | −30 to +30 (LLM job reading the real site, mapped to an integer band) |
| Fact-check scandal | −60 |
| Rollback after a bad theme deploy | −25 |
| Lighthouse a11y ≥ 95 and SEO ≥ 95 (permanent factor, daily) | +1 / day |
| Deploy outage (per day) | −20 |
| Broken links > 10 (per day) | −2 |

## Real site signals

The nightly **SiteAudit** is deterministic for a given deployed SHA. It produces
`Cmd::SiteSignals`:

| Signal | Measured |
|---|---|
| `live_pages[lang]` | pages returning 200 with valid JSON-LD and matching the page registry |
| `quality_pages` | live ∧ valid ∧ score ≥ 7 on record ∧ no open QA defect |
| `broken_links_internal`, `broken_links_external` | crawl over the sitemap |
| `media_coverage` | ‰ of pages whose required media resolve |
| `lighthouse_{perf,a11y,seo}` | median over the manifest's `screenshotPages` |
| `deployed_sha` | from the last `deployment_status` |

If the audit fails to run, the last signals carry forward and an ops alert fires. The company is
never penalised for platform outages.

## Settlement order (00:00)

1. Apply `SiteSignals` (if new).
2. Book revenue (pages and audience).
3. Book salaries, overtime, rent, upkeep, Agency invoices and loan interest.
4. Update audience (the logistic step) and reputation (the daily factors).
5. Check failure states (negative cash, negative-day streak, reputation).
6. Write the daily snapshot.

The ledger is double-entry, and the property test asserts Σ debits = Σ credits after every
settlement.
