# ADR-0071 — The analytics loop

**Status:** Accepted (completes ADR-0032's signals into the sim; builds on ADR-0021, ADR-0070)
**Date:** 2026-10-06

## Context

The first-party tracker (ADR-0032) collects page views on the live site, rolls them up nightly
per project, day, path, language and source, and turns each day into an `AnalyticsSignal` row.
The sim can apply `ServerCommand::AnalyticsSignals` (audience blend, goal progress, revenue
estimate), but nothing delivers them: the server's only sink is a stub that logs "not
implemented" and leaves every row pending, and the server cannot write a company's command log
(ADR-0038). The organization design gives the data scientist two jobs that read the numbers, a
weekly `KpiReport` at the Monday KPI review and a `ContentPerformance` follow-up in each published
article's thread after 14 days, and says underperforming items become update work. None of it
runs. The owner ordered the analytics loop after site integrity (2026-10-06).

## Decision

1. **The host delivers the signals.** `GET /api/analytics/signals` (lease) answers the company's
   pending signal rows; at each new game day the browser logs one `AnalyticsSignals` per row,
   oldest first, each on a game day counted back from today (the sim keeps per-day windows), and
   acknowledges them with `POST /api/analytics/signals/ack`. A row is delivered once.
2. **A page's numbers on request.** `GET /api/analytics/page?path=…&from=YYYY-MM-DD` (lease)
   answers one page's page views, sessions, average engaged time and scroll depth since a date,
   next to the project's per-page median over the same days.
3. **The follow-up is a sim job.** Fourteen game days after an article (or a refresh) is
   published, when the company has a data scientist, the sim requests `JobKind::Performance` for
   that item, once. Its outcome is a digest whose score (0 to 10) the orchestrator computes from
   the page's numbers against the median, without a model; the data scientist's model only writes
   the follow-up post, and every number in it must be one it was given. The sim keeps the score on
   the item (`WorkItem.performance`).
4. **The KPI review gets its report.** The Monday 09:30 KPI review (already a meeting) requests
   `JobKind::KpiReport` for the data scientist; the host passes the week's analytics (totals, top
   pages, languages, sources, and the last week's for comparison); the report (headline numbers,
   top and bottom pages, three recommendations) is posted as the meeting's minutes. Numbers are
   checked the same way.
5. **Effects on play.** The board's frame gains the latest report's recommendations and the
   articles whose follow-up scored 3 or less, as refresh candidates (ADR-0070 site health).
6. **World format 4.** `WorkItem.performance` and `followed_up` change the world's encoding; the
   goldens are re-baselined, and old companies are rebuilt once (`?restore=rebase`, ADR-0069).

## Consequences

- Real readers move the company's goals and revenue estimate, and the board plans with them.
- A follow-up costs one short model turn per article; the KPI report one per week.
- **Negative:**
  - A game day is about 20 real minutes, a tracker day 24 hours: several game days pass between
    two real signal days, so the per-day windows of the sim are game days with real data on some
    of them. The blend stays capped at 30% real (ADR-0021).
  - Without a data scientist there is neither report nor follow-up; the signals still arrive.
  - A page's numbers depend on its URL path; an article moved to another path loses its history.
- **Alternatives rejected:**
  - *The server pushing signals.* It cannot write the company's log (ADR-0038).
  - *The model scoring performance.* A number from numbers is arithmetic; the model writes words.
  - *Follow-ups decided by the host.* Who works on what is the sim's (rule 4); a follow-up is
    visible work in the office.
