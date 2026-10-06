---
id: FEAT-094
title: "Theme generation from the blueprint"
status: planned
importance: normal
paths:
  - "crates/orchestrator/src/theme.rs"
  - "crates/agents/src/jobs/theme_code.rs"
adrs:
  - ADR-0072
  - ADR-0015
---

# Theme generation from the blueprint

After the MVP and after the site-kit cutover (increment X-2). The Web Developer's `ThemeCode` job
implements the blueprint's page types and slots as layouts and block renderers under `theme/**`,
following the Art Director's typed mood board. The theme PR gate checks the result (FEAT-045). The
implementation can be regenerated, while the blueprint stays stable.

Design: [`docs/design/construction-kits.md`](../../design/construction-kits.md) §9.

Depends on: FEAT-089, FEAT-090, FEAT-045, the cinqueterre cutover.

## Acceptance criteria

- [ ] Every page type in the blueprint has a layout, and every slot's block has a renderer, or the job
      fails loudly.
- [ ] The job writes only under `theme/`; `kit check --strict` and the screenshot gate pass.

## Evidence

- `agents/nextest`
- `site-kit/vitest`
