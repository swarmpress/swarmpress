# ADR-0070 — Site integrity and page refresh

**Status:** Accepted (amends ADR-0061 decision 5, create-only article paths; builds on ADR-0021, ADR-0069)
**Date:** 2026-10-06

## Context

Articles age, links break and pages drift from the site's linking policy, but nothing in the
company sees it. `knowledge::KnowledgeBase::audit` can check every internal link and media
reference of a site, yet only an example binary calls it. The sim's `SiteSignals` command exists
and is stored, but nothing produces it. The economy design ties revenue to freshness
(`docs/game-design/economy.md`: full value for 90 days, then decaying, reset by a page refresh),
and the publishing plan names page refreshes and site-health fix items as work, but there is no
work item kind for either. ADR-0061 decision 5 made article paths create-only, so an agent cannot
overwrite an article by accident; it also means no agent can update one on purpose.

The owner ordered this as the increment after the weekly editorial board (2026-10-06), whose
plan is where such work belongs (ADR-0069).

## Decision

1. **The server audits the site.** `GET /api/site/audit` (session and lease, like the gateway)
   answers the audit of the site at the head of the company's base branch, cached per commit:
   live pages, languages, media, internal links checked and broken (per page), **orphan pages**
   (routed pages no other page links to), **stale articles** (articles whose last date, the
   page's `updated_at` or else its blog-index date, is more than 90 days old), and **linking-policy
   findings** (blocks with fewer or more internal links than `linking-policy.json` allows).
   Deterministic for a commit; no model.
2. **The host brings it into the sim, once a game day.** At the day's first boundary the browser
   fetches the audit and logs `ServerCommand::SiteSignals` (the existing command: live pages,
   languages, broken links, media). The findings themselves are text-side records the board reads
   (rule 2): titles and paths never enter the sim.
3. **Two new work item kinds:** `Refresh` brings an existing article up to date; `Fix` repairs its
   broken internal links. Both have the article's phases (Draft, Review, Publish), pass the
   editor and wait at the CEO's publish gate like any article. Their brief names the target page
   by path (text-side); the sim knows only the kind.
4. **The board plans them.** The board's frame gains a site-health section: stale articles and
   pages with broken links, each by an alias (`S1`…), from the latest audit. A proposal may be a
   refresh or a fix of an alias (closed world: an unknown alias is a repair turn). They count
   against the board's cap like articles.
5. **Refresh is review-then-revise on the live page.** The Draft job reads the page through the
   gateway, researches what may have changed (ADR-0068), has the writer name the outdated parts
   against that evidence, revises only those parts, and commits an update. **Fix is mechanical:**
   the Draft job removes the broken internal links of the page, keeping their anchor text, with
   no model call; the editor still reviews it.
6. **Updates are explicit (amends ADR-0061 decision 5).** A draft that names the blob it replaces
   (`update: <blob sha>`) may target an existing article path, only if that file is still that blob
   on the base branch and no other open pull request targets the path. Every other draft stays
   create-only. The finalise step of an update sets `updated_at` and leaves the blog index's entry
   in place.
7. `GET /api/gateway/file?path=…` reads one `content/pages/**` file at the base head with its blob
   sha, for the refresh and fix jobs.

## Consequences

- Stale articles and broken links become visible work the board plans and the CEO approves, and
  `SiteSignals` finally reaches the sim.
- A refresh costs a research turn, a reading turn and the revisions of the parts it names, about
  as much as one revision of an article.
- **Negative:**
  - An update can still be wrong about what changed in the world; the editor and the CEO's gate
    remain the check, as for new articles (ADR-0068's negatives apply).
  - The audit reads the whole `content/` snapshot once per base commit: a real site of a few
    hundred pages costs one snapshot per merge (already done for the knowledge pack).
  - Linking-policy findings are reported, not yet planned as work: a fix item repairs broken links
    only.
- **Alternatives rejected:**
  - *A nightly server task pushing signals into the sim.* The browser is authoritative for its
    company (ADR-0038); the server cannot write its log. The host pulls and logs, like outcomes.
  - *Letting any draft overwrite any path.* Keeps the accident ADR-0061 closed; updates name the
    blob they replace instead.
  - *Fixing links with a model.* Removing a dead link is a deterministic edit; a model would cost
    money and could change text it was not asked to.
