---
id: FEAT-028
title: "Visual regression baselines"
status: in-progress
importance: high
paths:
  - "apps/game/e2e/visual*.spec.ts"
  - "apps/game/e2e/visual.spec.ts-snapshots/**"
adrs:
  - ADR-0022
  - ADR-0006
---

# Visual regression baselines

Deterministic render mode (fixed seed, frozen sim time, no animation jitter) with baselines at
08:00, 13:00, 19:30 and 23:00 × four camera angles on SwiftShader's WebGPU (ADR-0064; the WebGL2
baselines are gone); perceptual diff tolerance.

Decisions: [ADR-0022](../../adr/0022-testing-strategy-cockpit-evidence-gate.md), [ADR-0006](../../adr/0006-baked-gi-dynamic-lights-day-night.md).

> **Status note (2026-10-04):** The baselines exist (`apps/game/e2e/visual.spec.ts`, seven
> screenshots in `visual.spec.ts-snapshots/`) and pass in CI, but the status stays `planned`:
> Cockpit counts a screenshot test only as a visual check, and a check exists only when the run
> attaches an expected/actual/diff triple, which Playwright does only on a mismatch. A passing run
> therefore gives this high feature no test evidence, and `in-progress` would fail
> `cockpit validate --strict` (EV004). It moves once the spec attaches its images on every run
> (or a unit test covers the deterministic render mode).

## Acceptance criteria

- [ ] Playwright attaches expected/actual/diff triples that Cockpit imports as visual tests.
- [ ] Flake rate below 1% over 20 runs.

## Evidence

- `game/playwright-visual`
