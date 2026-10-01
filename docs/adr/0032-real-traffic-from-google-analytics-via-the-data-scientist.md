# ADR-0032 — Real traffic from Google Analytics, owned by the data scientist

**Status:** Accepted
**Date:** 2026-10-01

## Context

The game's real output is live websites. Success should be measured on those sites: readers,
engagement, which pages work. The sim shouldn't simply assert it. ADR-0021 already ties the
economy to real site signals (SiteAudit) and allows real analytics to count for at most 30%. The
product owner asked for a data scientist persona who brings in Google Analytics data and reports
KPIs and success to the CEO.

## Decision

- Each project may have a **GA4 property** (`projects.ga4_property_id`). The platform reads it
  with a **Google service account** granted Viewer on the property, through the **GA4 Data API**
  (`runReport`).
- A nightly, deterministic **`AnalyticsSync`** server job (no LLM) stores `analytics_daily` rows
  (per project × day × page × language). It then injects a compact integer
  `Cmd::AnalyticsSignals` into the company's sim, so every lockstep replica sees identical
  numbers.
- The **Data Scientist** role (Strategy department) turns data into decisions with LLM jobs:
  - `KpiReport`: weekly, to the CEO, before the editorial board;
  - `ContentPerformance`: a follow-up post into each published work item's thread;
  - `ExperimentReadout`: before/after for redesigns and SEO changes.

  Their output may only use numbers present in the data, enforced by the same validator as the
  CFO's reports.
- Analytics affect:
  - Goals progress;
  - the audience model (blend capped at 30%);
  - per-project revenue attribution in the CFO's books;
  - follow-up `update` items in the plan.
- **Degrade, don't fail.** With no GA property, no credentials, or no Data Scientist, the game
  runs on SiteAudit facts and the sim estimate, and the UI says "analytics not connected" or "not
  measured".

## Consequences

- Needs operator inputs: a Google Cloud service account (JSON key in the server's secrets) and
  per-project property ids. cinqueterre.travel needs GA4 installed if it isn't already.
- Analytics data is real user data in aggregate. The platform stores aggregates only (no
  user-level data), sets retention, and never sends raw analytics to LLMs, only aggregated
  tables.
- GA4 Data API quotas apply per property. One nightly sync plus on-demand readouts stays well
  within them.
- The leaderboard may show verified audience for projects with analytics connected, marked as
  such.
