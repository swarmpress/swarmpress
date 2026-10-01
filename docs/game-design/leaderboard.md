# Leaderboard

The leaderboard ranks publishing houses by **what their real websites demonstrably are**, not by
anything a client could claim ([ADR-0021](../adr/0021-economy-tied-to-real-site-signals.md),
[ADR-0025](../adr/0025-browser-job-worker-protocol.md)).

## Score

```
score = Σ_lang verified_quality_pages[lang] × language_multiplier[lang]
      + reputation
      + 100 × log10(1 + audience)
      − 15 × qa_escapes_in_window
```

| Term | Source | Notes |
|---|---|---|
| `verified_quality_pages` | latest SiteAudit | live ∧ schema-valid ∧ editor score ≥ 7 on record ∧ no open QA defect |
| `language_multiplier` | manifest languages | first 1.0, second 0.7, third and later 0.5 each |
| `reputation` | sim | 0–1000 |
| `audience` | sim (≤ 30% from real analytics) | logarithmic, so traffic alone can't dominate |
| `qa_escapes_in_window` | SiteAudit | defects found on live pages during the ladder window |

All terms are integers in the sim (the log uses a fixed-point table).

## Ladders

| Ladder | Window | Reset | Reward |
|---|---|---|---|
| Weekly | Monday 00:00 to Sunday 24:00 UTC (real time) | weekly | badge in the lobby; small reputation bonus (+10) for the top 10 |
| Seasonal | 12 real weeks | per season | trophy item for the CeoOffice; season archive |
| All-time | — | never | reference only |

Weekly and seasonal ladders rank the **delta** of the score over the window, so new houses can
compete with old ones.

## Why it can't be gamed

- Every term comes from **SiteAudit-verified facts** (a deterministic crawl of the deployed SHA)
  or from server-authoritative sim state. Client-reported numbers are never used.
- Browser-written content is validated server-side and goes through the same editor and QA gates
  as Claude-written content.
- Pages that don't resolve, don't validate, or lack an editor score on record don't count.
- QA escapes subtract, so publishing junk fast is a losing strategy.
- Leaderboard entries link to the public site, so anyone can check them.
