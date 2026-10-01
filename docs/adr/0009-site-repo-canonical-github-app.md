# ADR-0009 — Site repo canonical; one repo per company in the platform org via a GitHub App

**Status:** Accepted
**Date:** 2026-10-01

## Context

The legacy platform learned the hard way that content must have exactly one home. Dual writes
between `content_items.body` and the site repo caused drift, and the editor once reviewed a null
body from the database while the real draft sat in the repo.

Every player gets one real website. Players should be able to see, fork and audit their site, and
publishing must be an ordinary GitHub deploy.

## Decision

- **The site repository is the canonical store** for pages, collections, site config, the
  manifest and the theme. Postgres holds only operational metadata.
- **One repository per company**, created from the starter template (`themes/starter`) in a
  platform GitHub org (`repo-from-template`). Each repo owns its `.github/workflows/` (the
  platform-owned `site-ci.yml` and `deploy.yml`) and deploys to GitHub Pages.
- **Access goes through a GitHub App** installed on the org.
  - The server mints short-lived installation tokens (`crates/github`).
  - Browsers never hold GitHub credentials
    ([ADR-0025](0025-browser-job-worker-protocol.md)).
- **One PR per piece of work:**
  - content: branch `drafts/<project>`;
  - theme: branch `design/<project>`.

  **The orchestrator merges**, never an LLM tool.
- **Webhooks** (`pull_request`, `check_suite`/`check_run`, `deployment_status`, `push`) are
  HMAC-verified, deduplicated by delivery id, and turned into `ServerCommand`s.
- cinqueterre.travel stays a **linked external repo** in its current org, so the Pages domain
  doesn't break ([ADR-0023](0023-cinqueterre-migration-and-cutover.md)).

Alternatives considered:

- **Content in Postgres, exported to the repo for builds.** Rejected. That is the legacy dual
  write.
- **A monorepo of all player sites.** Rejected. One bad build blocks everyone, permissions can't
  be scoped per player, and Pages supports one site per repo.
- **OAuth user tokens for repo writes.** Rejected. They're tied to a human, too broad in scope,
  and break when the user leaves.

## Consequences

- Positive: git history is the content version log, and diffs, blame and revert come for free.
  Players can inspect their site like any repo.
- Positive: deploys are isolated per company.
- Negative: GitHub API rate limits (5,000 requests per hour per installation) bound throughput. The
  github crate batches commits with the Git Data API (one tree, one commit per PR update).
- Negative: we depend on GitHub availability. Deploy outages surface as in-game events, not
  silent failures.
- Negative: the platform org must be provisioned before onboarding works (a pending input).
