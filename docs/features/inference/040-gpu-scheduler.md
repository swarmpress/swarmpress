---
id: FEAT-040
title: "GPU scheduler"
status: in-progress
importance: high
paths:
  - apps/game/src/llm/gpu-scheduler.ts
  - apps/game/src/llm/gpu-scheduler.test.ts
  - apps/game/src/render/postfx.ts
  - apps/game/src/render/quality.ts
  - apps/game/src/render/quality.test.ts
  - apps/game/src/main.ts
adrs:
  - ADR-0027
  - ADR-0057
  - ADR-0060
---

# GPU scheduler

Watches frame time; drops one quality tier and caps FPS at 30 while the LLM generates; restores when
idle; optional pause on hidden tabs; enforces the VRAM budget.

Decisions: [ADR-0027](../../adr/0027-gpu-sharing-renderer-and-local-llm.md).

## MVP: renderer hooks (ADR-0057, ADR-0060)

Design: [`docs/design/mvp-runtime.md`](../../design/mvp-runtime.md) ("Coexistence with Babylon").

R8 adds the real `RendererHooks` (`apps/game/src/render/quality.ts`): `GameScene.setQuality`
switches shadows, bloom, MSAA and SSAO while the page runs; a quality drop lowers the tier and
pauses SSAO and bloom; the frame cap is applied in `main.ts`'s render loop (the clock keeps
ticking, only drawing waits). The session's model runtime drives the scheduler around every call
of the game (it never pauses calls on a hidden tab: work in flight must finish, ADR-0060). Frame
times with the real model are not measured yet (R7). Two WebGPU devices share one GPU (Babylon on
the main thread, the engine in the Worker); the lever against contention is the engine's decode
pipeline depth. Phase A only measures frame times at fixed `?quality=` tiers. The scheduler and
the quality hooks are built with unit tests (`gpu-scheduler.test.ts`, `quality.test.ts`), so the
feature is `in-progress`; it is not `stable` until the frame-time evidence of a real run lands.

## Acceptance criteria

- [ ] Pure scheduler state machine tested over synthetic frame-time series (vitest).
- [ ] Frame time stays ≤ 33 ms p95 during generation on the reference machine (informational benchmark).

## Evidence

- `game/vitest`
- `bench/frame-time`
