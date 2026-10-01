# ADR-0021 — Economy tied to real site signals

**Status:** Accepted
**Date:** 2026-10-01

## Context

The game's score should reward running a good real website, not gaming the sim. The output of the
staff is real: pages, languages, links, media, Lighthouse scores. Real traffic analytics, though,
are noisy, slow, privacy-sensitive and unavailable for new sites.

The economy must stay integer-only and deterministic ([ADR-0003](0003-deterministic-lockstep-server-authority.md)),
while the facts it rewards come from outside.

## Decision

- **A nightly `SiteAudit` job** runs deterministically over the site at the deployed SHA and
  measures:
  - live pages per language;
  - broken internal and external links;
  - media coverage;
  - schema validity;
  - Lighthouse scores for a page sample.

  It enters the sim as `Cmd::SiteSignals{…}` with integer fields.
- **Settlement at 00:00, all integer cents and permille:**
  - Revenue = Σ over live pages of page value × quality multiplier × freshness decay × language
    multiplier × reputation factor, plus audience × CPM.
  - Audience grows logistically toward a target derived from quality pages, link health and
    reputation.
  - Optional real analytics may contribute **at most 30%** of the audience target.
  - Costs are salaries, rent per tile, equipment upkeep and overtime (1.5× pay).
- **Reputation** moves with editor scores, QA escapes, critic events, Lighthouse and a11y (as
  permanent factors), rollbacks and deploy outages.
- **The leaderboard counts only SiteAudit-verified facts:**
  > verified quality pages × language multiplier + reputation + log(audience) − QA escapes

  A modified client therefore can't inflate scores
  ([ADR-0025](0025-browser-job-worker-protocol.md)).

Alternatives considered:

- **A purely simulated economy.** Rejected. It disconnects the score from real output, and
  players would optimise the sim instead of the site.
- **Revenue from real analytics only.** Rejected. Noisy, gameable through bots, absent for new
  sites, and it needs analytics credentials.
- **Floating-point economics.** Rejected. Not deterministic across platforms.

## Consequences

- Positive: the incentive is aligned, since a better real site means a better score.
- Positive: SiteAudit doubles as operational monitoring (broken links, outages).
- Negative: feedback is daily rather than immediate. In-game previews show the estimated impact.
- Negative: a SiteAudit outage freezes the score. Missing signals carry the last value forward
  and open an ops alert, never a penalty.
