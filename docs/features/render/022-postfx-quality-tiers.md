---
id: FEAT-022
title: "Post-processing and quality tiers"
status: in-progress
importance: normal
paths:
  - apps/game/src/render/postfx.ts
adrs:
  - ADR-0006
  - ADR-0027
---

# Post-processing and quality tiers

ACES tone mapping, subtle bloom, SSAO2 and MSAA/FXAA per quality tier (low/medium/high), auto-
detected and lowered by the GPU scheduler while the local LLM generates.

Decisions: [ADR-0006](../../adr/0006-baked-gi-dynamic-lights-day-night.md), [ADR-0027](../../adr/0027-gpu-sharing-renderer-and-local-llm.md).

## Acceptance criteria

- [ ] Tier table matches `docs/architecture/lighting-and-rendering.md`.
- [ ] Auto-detection picks a tier from adapter limits and a frame-time probe.
- [ ] Frame-time benchmark per tier (`cockpit.benchmark.v1`, environment-sensitive).

## Evidence

- `game/vitest`
- `bench/frame-time`
