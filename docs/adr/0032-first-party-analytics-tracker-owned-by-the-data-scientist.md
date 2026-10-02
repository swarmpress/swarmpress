# ADR-0032 — First-party analytics tracker, owned by the data scientist

**Status:** Accepted; amended by ADR-0044
**Date:** 2026-10-01

## Context

The game's real output is live websites, so success should be measured on them (readers,
engagement, which pages work) rather than asserted by the sim. ADR-0021 already ties the economy
to real site signals and allows real analytics to count for at most 30%. The product owner asked
for a data scientist who reports KPIs to the CEO, from our own tracker rather than Google
Analytics.

Third-party analytics would need per-site credentials and consent banners, and it puts readers'
data with a third party. Every player site would also need manual setup.

## Decision

- **Our own tracker**, built into the platform:
  - A tiny script (≤ 1.5 KB gzip, no dependencies) shipped by `@swarm-press/site-kit` in every
    theme layout. Themes can't remove it; `kit check` enforces it.
  - It sends events with `navigator.sendBeacon` to the central server:
    `POST https://<platform>/t/e`. The payload has the project key, page path, language,
    referrer domain, UTM tags, viewport class and an event type: `pageview`, `engagement`
    (visible time on `visibilitychange`/`pagehide`), `scroll` (25/50/75/100), `outbound`.
  - Opt-out via a `?notrack` query flag, and it honours Do-Not-Track and Global Privacy Control
    signals.
- **Privacy by construction:**
  - No cookies, no localStorage, no fingerprinting, no user ids, no IP addresses stored.
  - Unique-visitor counting uses a daily rotating salt: `hash(salt_day, ip, user_agent, project)`
    is kept in memory and in a 24 h table only, then the salt is destroyed.
  - Only aggregates persist.
- **Collector on the Rust server:**
  - Validates `Origin`/`Referer` against the project's registered domains.
  - Rate-limits per IP and filters bots by user-agent list and behaviour (no engagement, burst
    rates).
  - Writes raw events to a short-retention table (7 days), and runs an hourly rollup into
    `analytics_daily` (project × day × page × language × source).
  - Raw events are deleted after rollup and retention.
- **Into the game:** a nightly deterministic job injects
  `Cmd::AnalyticsSignals { project, day, sessions, visitors, pageviews, engagement_pm, top_pages_digest }`
  (integers), so every lockstep replica sees identical numbers. These signals feed:
  - Goals;
  - the audience blend (≤ 30%, ADR-0021);
  - per-project revenue attribution in the CFO's ledgers;
  - plan follow-ups.
- **The Data Scientist** (Strategy department) turns the data into decisions: `KpiReport`
  (weekly, to the CEO), `ContentPerformance` (follow-ups in work item threads) and
  `ExperimentReadout` (before/after). Their output may only use numbers present in the
  aggregates. Raw events never go to an LLM.
- An external source (GA4 or similar) may be added later as an optional import adapter. The
  tracker is the source of truth.

## Consequences

- No per-site setup: every project is measured from its first deploy. This includes
  cinqueterre.travel once its theme carries the snippet (cutover step 4, or a one-line addition
  to the legacy theme layout earlier).
- The platform operates a public ingestion endpoint and must handle abuse:
  - origin checks and rate limits;
  - a size cap per event;
  - shedding under load (drop events rather than slow the game server); a separate collector
    process is possible later.
- The privacy design aims at not processing personal data beyond transient, salted
  counting. The operator remains responsible for the site's privacy notice, which the starter
  theme includes.
- Bot filtering is heuristic, so the numbers are "good enough for the game and for editorial
  decisions", not ad-billing grade.
