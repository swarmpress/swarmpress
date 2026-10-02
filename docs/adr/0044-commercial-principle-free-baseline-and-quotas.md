# ADR-0044 — Commercial principle: local is free, coordination has quotas, managed resources are billed

**Status:** Accepted (amends ADR-0033, ADR-0024, ADR-0032)
**Date:** 2026-10-02

## Context

swarm.press is local-first (ADR-0038). The sim, the browser staff, the extensions and the
drafting all run on the player's machine. The commercial briefing proposed one rule: "If it runs
on the player's machine, it is free. If swarm.press must store, execute, serve, process or
operate something on the player's behalf, that managed resource is billable."

The rule is not literally true. A player who uses only local staff still causes central costs:

| Central cost | Limit in code today | Risk if left unbounded |
|---|---|---|
| Web fetch proxy (ADR-0040) | 30 requests/min per user, 2 MiB each, no daily cap | about 86 GB/day per user: a free scraping proxy |
| Sync storage (ADR-0041) | 64 MiB per upload, no per-company total found | unbounded disk |
| Gateway calls to GitHub | none | shared installation rate limit; Actions minutes |
| Tracker ingestion (ADR-0032) | 120/min, 7-day raw retention | scales with site traffic, not with gameplay |
| Nightly SiteAudit (ADR-0021) | none | headless Chrome per company per night |
| Auth, lease, events, webhooks | none | negligible |
| Support and abuse handling | one company per user | content farms on the free tier |

A free tier that publishes real websites with local models is also attractive to content farms.

ADR-0033 said "Browser-run staff are free, so a player with zero credits can play the whole
game", and ADR-0024 made Claude escalation a visible, costly choice. Neither defines where free
ends for the central service itself.

## Decision

1. **Three categories, not two.**
   - **Local is free.** Anything that uses only the player's machine: sim, local database, local
     LLMs, local extensions, local orchestration, previews, drafting, publishing source to the
     player's own GitHub repo, and self-hosted infrastructure. swarm.press does not disable a
     local capability to create a paid one.
   - **Coordination is free within published fair-use quotas.** Auth, the company lease, the
     publishing gateway, sync, the events inbox, the web fetch proxy, the tracker and site
     audits. The quotas are public and configurable.
   - **Managed third-party resources are billed.** Cloud LLM calls, managed web research
     (Firecrawl), managed runners, managed storage and delivery above the allowance, media
     processing, and any external paid API called on the player's behalf.
2. **Fixed platform costs are funded from the uplift** on billed resources (ADR-0051). The docs
   say so. There is no subscription and no feature gate.
3. **Starting free quotas.** All are config values and will be tuned from measurements:

   | Resource | Free quota |
   |---|---|
   | Web fetch proxy | 500 requests and 200 MB per day per player |
   | Sync storage | 500 MB per company; older segments compact behind the latest snapshot |
   | Gateway | 60 writes per hour and 20 merges per day per company |
   | Tracker | 100,000 events per month per project, then deterministic 1-in-N sampling with integer scaling |
   | SiteAudit | cached by deployed SHA; Lighthouse reruns only on a new deploy, and only for companies active in the last 7 days |
   | Managed storage | 1 GB per company (ADR-0050) |

   - Reaching a quota returns a typed error the client shows; it never fails silently.
   - The tracker samples instead of cutting off, so analytics signals stay usable.
   - Usage is counted centrally (`usage_counters`, ADR-0052).
4. **Abuse controls.**
   - A GitHub account-age check at sign-up.
   - The merge quota above.
   - A platform kill switch per company.
   - An abuse report link on every site that swarm.press hosts media for.
5. **Price is list cost times uplift.** The billed price of a managed resource is the
   **published list unit cost** of the provider, times a configurable uplift, per price version
   (ADR-0051). It is not the invoice cost, which is not well defined for subscriptions
   (Firecrawl), free tiers (R2) or cache hits.
6. **No silent move from free to billed.** A job that would use a billed resource needs an
   approved spend request (ADR-0052). Without one it stays on the free path or waits.

Alternatives considered:
- **The two-category rule as written.** Rejected. It leaves the central service unfunded and
  unbounded, and it is not honest about what a free player costs.
- **A subscription for the central service.** Rejected. It gates the game, which contradicts
  local-first, and it charges players who use almost nothing.
- **Feature-based tiers.** Rejected. The model is infrastructure-based: nothing local is
  withheld.
- **Billing every central call.** Rejected. Metering auth and lease calls costs more than they
  do, and a free player could not publish at all.

## Consequences

- Positive: the principle can be stated to players without a hidden exception.
- Positive: each central cost has a bound, so a free player cannot become an open proxy or an
  unbounded disk.
- Positive: ADR-0033's promise stands. A player with a zero balance can play the whole game and
  publish a real site.
- Negative: quotas are new product surface: counters, typed errors, UI and support questions.
- Negative: the starting values are guesses. The cost of an active free player is estimated at
  €0.05 to €0.20 per month and has not been measured.
- Negative: sampling makes high-traffic sites' analytics approximate (already "good enough for
  the game", ADR-0032).
- Negative: the abuse controls are a first line only. A determined content farm needs manual
  action through the kill switch.
- Not built: none of the quotas, counters or abuse controls exist in `crates/server` yet. The
  existing limits are the ones in the Context table.
- Amends ADR-0033 ("a player with zero credits can play the whole game" now means: within the
  free quotas), ADR-0024 (escalation is gated by a spend request) and ADR-0032 (tracker quota
  and sampling).
