---
id: FEAT-040
title: "GPU scheduler"
status: planned
importance: high
paths:
  - apps/game/src/llm/scheduler.ts
adrs:
  - ADR-0027
---

# GPU scheduler

Watches frame time; drops one quality tier and caps FPS at 30 while the LLM generates; restores when
idle; optional pause on hidden tabs; enforces the VRAM budget.

Decisions: [ADR-0027](../../adr/0027-gpu-sharing-renderer-and-local-llm.md).

## Acceptance criteria

- [ ] Pure scheduler state machine tested over synthetic frame-time series (vitest).
- [ ] Frame time stays ≤ 33 ms p95 during generation on the reference machine (informational benchmark).

## Evidence

- `game/vitest`
- `bench/frame-time`
