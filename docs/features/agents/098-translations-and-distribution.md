---
id: FEAT-098
title: "Translations and distribution"
status: in-progress
importance: medium
paths:
  - crates/sim-core/tests/distribution.rs
  - crates/orchestrator/tests/maintain.rs
adrs:
  - ADR-0073
  - ADR-0070
  - ADR-0069
---

# Translations and distribution

The site's other languages and the company's reach ([ADR-0073](../../adr/0073-translations-and-distribution.md)):
the audit lists articles missing site languages; the weekly board plans translations, one
language per item, which a translator does as an update of the live page; when a page goes live
the social media or marketing manager writes promotion copy for the CEO, which the game never sends.

## Built

- **Audit**: `untranslated` (articles whose title lacks a site language) in the knowledge audit and
  `GET /api/site/audit`.
- **Sim**: `WorkItemKind::Translation` (a free translator first), `JobKind::Promotion` on
  `DeployLanded` of an article or a refresh with `Policy::Distribution`; world format 5. Test:
  `crates/sim-core/tests/distribution.rs`.
- **Orchestrator**: the board's site-health section lists untranslated articles; a translation
  proposal names its language (checked against the missing ones); the translation job fills every
  `LocalizedString` field of the page with the language in batches (slugs left alone) and commits
  an update; the review is told the language; the promotion job posts a newsletter blurb and
  posts for Instagram, X and Facebook with the article's URL as a `distribution` post. Tests:
  `crates/orchestrator/tests/maintain.rs`.
- **Host**: the session turns the policy on once (not with `?board=off`), and passes the audit's
  untranslated list to the board.

## Not built yet

- Body text of blog articles: the frozen theme renders block text as it is, so plain-string fields
  stay English until the cutover's theme reads localized block text (ADR-0073).
- Sending or posting anything: needs an integration and a decision of its own.

## Acceptance criteria

- [ ] An untranslated article is planned, translated into one language, reviewed and merged in place.
- [ ] A page that goes live gets promotion copy in its thread, once.
