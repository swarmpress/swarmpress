---
id: FEAT-050
title: "cinqueterre.travel cutover"
status: planned
importance: critical
paths:
  - "packages/site-builder/src/themes/cinque-terre/**"
  - docs/runbooks/cinqueterre-cutover.md
adrs:
  - ADR-0023
  - ADR-0016
---

# cinqueterre.travel cutover

Steps 0–7 of the cutover runbook: pin `legacy-final`, vendor the theme, fix content roots, manifest,
site-kit, schema v2, import into the game, shadow mode. Until step 0/1 lands, the frozen theme path
in this repo must keep building.

Decisions: [ADR-0023](../../adr/0023-cinqueterre-migration-and-cutover.md), [ADR-0016](../../adr/0016-site-kit-distribution-via-npm.md).

## Acceptance criteria

- [ ] Step 0 patch applied and the live deploy is green against `legacy-final`.
- [ ] Each step's gate (crawl parity, visual ≤ 0.5%, Lighthouse) is recorded as evidence.
- [ ] Import reproduces entity, media and sitemap indexes from the repo at a SHA.

## Evidence

- frozen-theme build job in CI
- cutover parity crawl (site repo)
