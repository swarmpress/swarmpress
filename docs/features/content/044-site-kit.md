---
id: FEAT-044
title: "Site kit (@swarm-press/site-kit)"
status: in-progress
importance: high
paths:
  - "packages/site-kit/**"
adrs:
  - ADR-0015
  - ADR-0016
---

# Site kit (@swarm-press/site-kit)

Astro 5 integration: manifest routing, content loading with validation, i18n (`t()`, `localize()`),
SEO/hreflang/JSON-LD/sitemap, block registry, closed-world resolution, dev block gallery and the
`kit` CLI (`check | migrate | screenshots | blocks-doc`). Published to npm with semver.

Decisions: [ADR-0015](../../adr/0015-agent-authored-themes-on-site-kit.md), [ADR-0016](../../adr/0016-site-kit-distribution-via-npm.md).

## Acceptance criteria

- [ ] Fixture site builds; block coverage and schema conformance pass.
- [ ] cinqueterre parity test: identical page list and HTML structure vs the legacy build.
- [ ] `kit check --strict` enforces theme lint and the `theme/**` path guard.

## Evidence

- `site-kit/vitest`
- `site-kit/playwright`
