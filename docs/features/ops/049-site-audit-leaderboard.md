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
---

# SiteAudit and leaderboard

Nightly deterministic SiteAudit (live pages per language, broken links, media, Lighthouse) →
`Cmd::SiteSignals`; weekly and seasonal leaderboards from verified facts only.

Decisions: [ADR-0021](../../adr/0021-economy-tied-to-real-site-signals.md).

## Acceptance criteria

- [ ] SiteAudit over a fixture site gives a golden signal set.
- [ ] Leaderboard ignores anything not verified by SiteAudit.

## Evidence

- `server/nextest`
