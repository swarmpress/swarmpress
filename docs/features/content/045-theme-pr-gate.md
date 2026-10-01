---
id: FEAT-045
title: "Agent-authored theme PR gate (site CI)"
status: planned
importance: high
paths:
  - "themes/starter/**"
  - "packages/site-kit/ci/**"
adrs:
  - ADR-0015
---

# Agent-authored theme PR gate (site CI)

Platform-owned `site-ci.yml`: kit check, build + URL parity, link check, Playwright screenshots
(375/768/1280/1440 × en/de), pixel diff, axe, Lighthouse budgets, artifacts emitting
`cockpit.visual.v1` and benchmark documents; preview links.

Decisions: [ADR-0015](../../adr/0015-agent-authored-themes-on-site-kit.md).

## Acceptance criteria

- [ ] A deliberately broken theme fails `kit check --strict`.
- [ ] Lighthouse budgets: performance ≥ 85, a11y ≥ 95, SEO ≥ 95, CLS ≤ 0.1, JS ≤ 150 KB.
- [ ] Visual diff above 15% marks the PR for CEO approval.

## Evidence

- site repo `site-ci` evidence (visual + Lighthouse benchmark)
