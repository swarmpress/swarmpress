# ADR-0023 — cinqueterre migration and cutover

**Status:** Accepted
**Date:** 2026-10-01

## Context

cinqueterre.travel is live, earns its domain reputation, and is the user's company in the game.

Its `deploy.yml` checks out `swarmpress/swarmpress` (default branch, with `MONOREPO_PAT`), runs
`pnpm install` at the root, and builds `packages/site-builder/src/themes/cinque-terre` with
`CONTENT_DIR` pointing at the site's `content/pages`. Replacing the monorepo's `main` would break
the next deploy.

Findings still to verify:
- `COLLECTIONS_DIR` and `BLOG_DIR` may resolve to an empty gitlink in CI, so collections and
  `content/blog` may not render live today.
- `content/blog` (18 files) duplicates `content/pages/blog` (19, canonical, 2 differ).
- Languages and villages are hardcoded in the theme.

## Decision

Migrate in **eight gated steps**. Each step is one PR on the site repo, gated against a
**baseline crawl of production**: the URL set, plus HTML and screenshots of about 40 URLs.

| Step | Change | Gate |
|---|---|---|
| 0 | Tag `legacy-final` and `legacy-ts`; pin `deploy.yml`'s monorepo checkout to `ref: legacy-final` (one line); capture the baseline | Deploy green, crawl identical |
| 1 | Vendor the theme into `theme-legacy/`; build in place; drop the monorepo checkout and `MONOREPO_PAT` | Identical URL set and HTML |
| 2 | Real `CONTENT_ROOT` (collections render); dedupe the blog | Human review of new URLs |
| 3 | `site.manifest.json`; homepage blocks read JSON | Visual diff ≤ 0.5% |
| 4 | Extract and publish `packages/site-kit`; restructure into `theme/`; add `site-ci.yml` | Parity, visual ≤ 0.5%, Lighthouse no worse |
| 5 | Schema v2 (localized fields, a real `blog-article` block, `MediaRef`), `kit migrate`, ratcheting baseline | `kit check --baseline` green |
| 6 | Import into the game (the `ImportSite` job, derived indexes only, SHA-stamped) | The import reproduces the indexes |
| 7 | Shadow mode: `ApproveAll` for 2 weeks; ThemeTweak only until 3 clean cycles; then `ApproveMajor` | Zero unreviewed merges |

- The repo is **not** transferred into the platform org yet, because that would break the Pages
  domain. It is a linked external repo.
- The frozen theme path stays in the fresh tree until step 0 or 1 lands. It is deleted in M5,
  after step 1.
- Other repos that check out swarmpress are found before `main` is replaced, and `main` is
  replaced by a normal commit, never a force-push.

The full procedure, the exact patch and the rollbacks are in
[docs/runbooks/cinqueterre-cutover.md](../runbooks/cinqueterre-cutover.md).

Alternatives considered:

- **Big-bang switch to site-kit.** Rejected. There is no way to attribute a regression to a cause,
  and the live site could break.
- **Rebuild the site from scratch in the starter theme.** Rejected. It would lose the theme, the
  URLs and the SEO equity.
- **Keep building from the monorepo forever.** Rejected. It couples the live site to platform
  churn ([ADR-0016](0016-site-kit-distribution-via-npm.md)).

## Consequences

- Positive: the live site never breaks, and each step is reversible with one revert.
- Positive: step 2 may *fix* live bugs (collections rendering), which is why it needs human
  review instead of strict parity.
- Negative: slow. Seven PRs and two weeks of shadow mode before full autonomy.
- Negative: step 0 needs push access to the site repo or a human applying the patch (a pending
  input).
