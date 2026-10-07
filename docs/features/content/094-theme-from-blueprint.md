---
id: FEAT-094
title: "Theme generation from the blueprint"
status: in-progress
importance: normal
paths:
  - "crates/blueprint/src/theme.rs"
  - "crates/agents/src/theme.rs"
  - "crates/server/src/site_theme.rs"
  - "crates/server/tests/site_theme.rs"
  - "crates/orchestrator/src/structure.rs"
  - "crates/orchestrator/tests/structure.rs"
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

## As built (2026-10-07)

- **The check** (`blueprint::theme`): a component is a block renderer (`theme/blocks/<type>.astro`
  or `theme/blocks/<name>/Component.astro`) that imports nothing outside the site kit, reads its
  block through `Astro.props`, and has no `<script>` or `set:html`. `flatten_tokens` gives the Web
  Developer the theme's tokens (at most `MAX_TOKENS`).
- **The job** (`ThemeCode`, `crates/orchestrator/src/structure.rs`):
  - A site that still builds the frozen theme (no `theme/theme.config.ts`, so `kit_theme` is false
    in the site models) fails loudly with `Infrastructure`. cinqueterre.travel stays untouched
    until the cutover.
  - Otherwise the job takes the blueprint's blocks that have no renderer, at most 4 per job. Each
    one is a single Web Developer call that gets the block's generated doc and the tokens. The
    answer is checked, and a failing answer gets one repair turn.
  - The components are written through `PUT /api/site/theme` as the design actor on
    `design/<item>`, which runs the theme gate on that pull request.
  - With nothing missing, the proposal has no pull request.
- **The gate:** the item waits at the CEO's `StructureApproval`. Its Publish merges the pull
  request (`POST /api/site/theme/merge`, checked against the head it was approved at), and the
  browser then reloads the site models.

## Acceptance criteria

- [ ] Every page type in the blueprint has a layout, and every slot's block has a renderer, or the job
      fails loudly.
- [ ] The job writes only under `theme/`; `kit check --strict` and the screenshot gate pass.

## Evidence

- `agents/nextest`
- `site-kit/vitest`
