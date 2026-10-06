---
id: FEAT-088
title: "Site integrity and page refresh"
status: in-progress
importance: high
paths:
  - crates/server/src/site_audit.rs
  - crates/server/tests/site_audit.rs
  - crates/knowledge/src/kb.rs
  - crates/knowledge/tests/cinqueterre_mini.rs
  - crates/orchestrator/src/maintain.rs
  - crates/orchestrator/tests/maintain.rs
adrs:
  - ADR-0070
  - ADR-0061
  - ADR-0021
  - ADR-0069
---

# Site integrity and page refresh

The company sees its site's health and maintains it ([ADR-0070](../../adr/0070-site-integrity-and-page-refresh.md)):
the server audits the site at the base head (broken internal links per page, orphan pages, stale
articles, linking-policy findings); the host brings the signals into the sim once a game day; the
weekly board plans refresh and fix items for stale articles and pages with broken links; a refresh
updates an existing article (research, the outdated parts revised), a fix removes broken links;
both pass the editor and the CEO's publish gate. Article updates name the blob they replace.

## Built

- **Audit** (`knowledge::KnowledgeBase::audit`): links and media as before, plus inbound links
  (page bodies and the navigation), orphan pages, article dates (`updated_at`, else the blog
  index) and linking-policy findings.
- **Server**: `GET /api/site/audit` (lease; cached per commit; the ETag carries the commit and the
  day; stale = more than 90 days old by the server's clock), `GET /api/gateway/file` (a
  `content/pages/` file with its blob sha), and the draft's `update` field: an update names the
  blob it replaces; everything else stays create-only. Tests: `crates/server/tests/site_audit.rs`,
  `crates/knowledge/tests/cinqueterre_mini.rs`.

- **Sim**: `WorkItemKind::Refresh` and `Fix` (the article's phases; publishing one makes no new
  live page). Test: `crates/sim-core/tests/editorial_board.rs`.
- **Orchestrator** (`crates/orchestrator/src/maintain.rs`): the gateway reads a page with its
  blob sha and drafts an update naming it (`Gateway::read_page`, `open_update_as`; the fake, the
  GitHub and the browser's JS gateway). A fix removes the page's broken internal links without a
  model; a refresh researches, then rewrites only the outdated prose passages against the evidence
  (a changed localized field keeps English only); nothing to change ends not-ok; a page gone is
  `NeedsPage`. The review (`update review`) sees the changes. The board's frame gets a site-health
  section (stale articles, pages with broken links, `S1`…) from the host's `site` context; a
  proposal may be a refresh or a fix of an alias (checked), without a web check. Tests:
  `crates/orchestrator/tests/maintain.rs`.
- **Host**: the session fetches the audit at boot and at each new game day, logs `SiteSignals`
  when they changed, writes the summary as plan text (`site:audit`) and gives the board the
  findings; the Plan panel's "Site health" card shows them.

## Not built yet

- Linking-policy findings and orphans are reported, not planned as work.
- Lighthouse scores are not measured (the `SiteSignals` fields stay 0).

## Acceptance criteria

- [ ] A stale article is planned by the board as a refresh, updated, approved and merged in place.
- [ ] A page with a broken internal link is fixed without a model call and passes review.
- [ ] `SiteSignals` reaches the sim once a game day from the audit of the base head.
