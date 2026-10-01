---
id: FEAT-028
title: "Visual regression baselines"
status: planned
importance: high
paths:
  - "apps/game/e2e/visual*.spec.ts"
  - "apps/game/e2e/__screenshots__/**"
adrs:
  - ADR-0022
  - ADR-0006
---

# Visual regression baselines

Deterministic render mode (fixed seed, frozen sim time, no animation jitter) with baselines at
08:00, 13:00, 19:30 and 23:00 × four camera angles × {webgpu, webgl2}; perceptual diff tolerance.

Decisions: [ADR-0022](../../adr/0022-testing-strategy-cockpit-evidence-gate.md), [ADR-0006](../../adr/0006-baked-gi-dynamic-lights-day-night.md).

## Acceptance criteria

- [ ] Playwright attaches expected/actual/diff triples that Cockpit imports as visual tests.
- [ ] Flake rate below 1% over 20 runs.

## Evidence

- `game/playwright-visual`
