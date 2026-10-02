---
id: FEAT-049
title: "SiteAudit and leaderboard"
status: planned
importance: high
paths:
  - "crates/server/src/audit/**"
  - "crates/server/src/leaderboard/**"
adrs:
  - ADR-0021
  - ADR-0055
  - ADR-0044
---

# SiteAudit and leaderboard

Nightly deterministic SiteAudit (live pages per language, broken links, media, Lighthouse) →
`Cmd::SiteSignals`; weekly and seasonal leaderboards from verified facts only.

Decisions: [ADR-0021](../../adr/0021-economy-tied-to-real-site-signals.md).

Leagues (ADR-0055): the leaderboard is split by facts the server holds. A company is in the
**own-machine** league while every sealed segment was written by executor kind `browser` and it
has no managed spend; any continuity run (`self` or `cloud`) or managed spend puts it in the
**continuity** league. A player's own API key in their own browser is not detectable and counts
as own-machine. Credits never convert to in-game cash, reputation or score.

SiteAudit is cached by deployed SHA and runs only for companies active in the last 7 days
(FEAT-067).

## Acceptance criteria

- [ ] SiteAudit over a fixture site gives a golden signal set.
- [ ] Leaderboard ignores anything not verified by SiteAudit.
- [ ] A company with one `self` or `cloud` segment, or any managed spend, is listed in the
      continuity league only.

## Evidence

- `server/nextest`
