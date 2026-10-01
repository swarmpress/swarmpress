# ADR-0016 — Site-kit distribution via npm; remove MONOREPO_PAT

**Status:** Accepted
**Date:** 2026-10-01

## Context

Today, cinqueterre.travel's `deploy.yml` builds the site like this:
1. It checks out `swarmpress/swarmpress` with a `MONOREPO_PAT` secret.
2. It runs `pnpm install` at the monorepo root.
3. It builds `packages/site-builder/src/themes/cinque-terre` against the site's content.

This couples every site deploy to whatever is on the monorepo's `main`. A refactor of the
platform can break a live site, and that is exactly the risk the fresh tree creates. It also
needs a PAT secret in every site repo and installs the whole platform's dependencies for every
deploy.

## Decision

- Publish **`@swarm-press/site-kit`** (the Astro integration from
  [ADR-0015](0015-agent-authored-themes-on-site-kit.md)) to the **public npm registry**, with
  semver.
  - Breaking changes to the `defineTheme` contract, core block schemas or the manifest format
    bump the major version.
  - `kit migrate` ships codemods for each major.
- **Site repos depend on a version range** in their own `package.json`, with their own lockfile.
  They build in place, without checking out the monorepo. `MONOREPO_PAT` and the monorepo
  checkout step are removed (cutover steps 1 and 4).
- The platform-owned workflows (`site-ci.yml`, `deploy.yml`) are versioned with the kit. The
  orchestrator updates them in site repos through ordinary PRs.
- Upgrades to site repos are PRs ("kit bump"), gated by the same site CI.

Alternatives considered:

- **Keep the monorepo checkout, pinned to a tag.** Accepted only as the temporary cutover step 0
  (`ref: legacy-final`). It's not a long-term model, because there is no semver, the install is
  heavy, and a PAT is still needed.
- **A git submodule of the kit in each site.** Rejected. Submodule friction, and the legacy
  `COLLECTIONS_DIR` / empty-gitlink bug came from exactly this pattern.
- **GitHub Packages registry.** Rejected. Consumers need auth even for public packages, which
  brings secrets back.
- **Vendoring the kit into each repo.** Rejected. Fixes would never propagate.

## Consequences

- Positive: a site deploy depends only on its own repo and npm. The monorepo can change freely.
- Positive: semver makes breaking changes explicit, and migrations become codemods.
- Negative: we need an npm scope token (a pending input) and a release process (changesets, a
  release workflow).
- Negative: there is a window in which sites run older kit versions. Kit-bump PRs and a
  supported-versions policy (current major and the one before) manage it.
