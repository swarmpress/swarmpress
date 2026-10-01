# ADR-0015 — Agent-authored themes on a platform site kit with a PR and visual-review gate

**Status:** Accepted
**Date:** 2026-10-01

## Context

A fixed decision of the product is that **agents author themes**. The design department (Art
Director and Front-end Dev) designs and evolves each site's look.

Letting LLMs write a whole Astro site is dangerous:
- they break routing, SEO, i18n or the content-loading contract;
- they ship remote scripts;
- they produce ugly or inaccessible output.

The legacy cinque-terre theme also shows the cost of mixing data concerns into presentation:
languages and villages are hardcoded.

## Decision

- **Split data from presentation.**
  - **`@swarm-press/site-kit`** is a platform-owned Astro 5 integration that does everything except
    presentation:
    - injected routes from `site.manifest.json`;
    - SEO, hreflang and JSON-LD;
    - sitemap;
    - content loading with validation;
    - `t()` / `localize()`;
    - the block registry;
    - closed-world link and media resolution;
    - a dev block gallery;
    - the `kit` CLI.
  - **`theme/`** in each site repo is agent-authored under the `defineTheme` contract:
    - design tokens (W3C format) → Tailwind 4;
    - layouts;
    - chrome;
    - core block renderers;
    - custom blocks;
    - React islands.
- **Theme lint:**
  - no fs or node imports;
  - an allowlisted dependency list;
  - no remote scripts or fonts;
  - no hardcoded locales or regions;
  - writes limited to `theme/**`, enforced by the repo tool and by a path guard in CI.
- **Every theme change is a PR** on `design/<project>`. The platform-owned `site-ci.yml` runs:
  - `kit check --strict`;
  - a build with URL-set parity against `main`;
  - a link check;
  - Playwright screenshots of `screenshotPages` at 375, 768, 1280 and 1440 px in en and de;
  - a pixel diff against the `main` baselines;
  - axe (zero serious violations);
  - Lighthouse budgets: performance ≥ 85, a11y ≥ 95, SEO ≥ 95, CLS ≤ 0.1, JS ≤ 150 KB.

  It emits `cockpit.visual.v1` and `cockpit.benchmark.v1`.
- **Review and merge.**
  - A QA designer agent reviews the before and after screenshots with vision. Below 7 means a fix
    loop, at most 3 times, then a ticket.
  - A redesign, or a diff above 15%, needs a **CEO ticket** with the mood board, the before and
    after shots, and a preview link. Smaller changes auto-merge per policy. The orchestrator
    merges.
  - After deploy, a smoke screenshot and a link check run. On failure, a revert PR opens
    automatically and a Rollback event fires.

Alternatives considered:

- **Agents only pick from preset themes or tokens.** Rejected. It contradicts the product decision
  and makes the design department cosmetic.
- **Agents edit the whole site repo.** Rejected. It breaks the data layer and SEO, and is unsafe.
- **Human-only review.** Rejected as the default, because it doesn't scale. The CEO approves the
  big changes.

## Consequences

- Positive: a broken theme can't break routing, content or SEO. The worst case is an ugly PR that
  doesn't merge.
- Positive: the evidence humans see (screenshots, diffs, Lighthouse) is the same evidence the
  agent reviews.
- Negative: CI per theme PR is heavy (a build, 16 screenshots, Lighthouse), which costs Actions
  minutes.
- Negative: the `defineTheme` contract and the core block set become a public API with semver
  obligations ([ADR-0016](0016-site-kit-distribution-via-npm.md)).
