# ADR-0027 — GPU sharing between renderer and local LLM

**Status:** Accepted; amended by ADR-0048
**Date:** 2026-10-01

## Context

The Babylon renderer ([ADR-0004](0004-babylonjs-webgpu-webgl2-fallback.md)) and the local LLM
([ADR-0024](0024-hybrid-inference-browser-llms-and-claude.md)) compete for the same GPU:
- LLM token generation saturates compute and memory bandwidth, which makes frames stutter.
- Shadow maps, SSAO and MSAA take VRAM the model needs.

Browsers give no priority control between WebGPU devices.

## Decision

- **A separate device.** The LLM runs in a **module Web Worker** that owns its own WebGPU device.
  The renderer keeps its own device on the main thread. No GPU resources are shared.
- **A GPU scheduler** on the main thread (`apps/game/src/llm/scheduler.ts`):
  - It watches frame time with a rolling p95.
  - While the LLM is generating, the renderer **drops one quality tier**
    (high→medium→low: SSAO off, then shadows off, then MSAA off) and **caps FPS at 30**.
  - It restores the tier when the LLM is idle for 2 s.
  - If frame-time p95 still exceeds 50 ms, it asks the worker to throttle by inserting yields
    between decode steps.
- **Hidden tabs.** LLM jobs pause while the tab is hidden **if the player opts in**. The default
  is to keep working, because the player is the company's worker.
- **The VRAM budget** comes from the registry's `approx_vram_bytes` plus the renderer's
  quality-tier estimate. A model is not loaded if the sum exceeds the detected budget, and the
  next smaller model is chosen instead.
- **Quality tiers** (`QUALITY` in `apps/game/src/render/postfx.ts`):

  | Tier | Shadows | Shadow map | SSAO | Bloom | MSAA |
  |---|---|---|---|---|---|
  | low | off | 1024 | off | off | 1 (FXAA) |
  | medium | on | 2048 | off | on | 2 |
  | high | on | 4096 | on | on | 4 |

Alternatives considered:

- **One shared device for render and LLM.** Rejected. A long compute submission would block
  frames, and the coupling is too tight.
- **No coordination** (let the OS arbitrate). Rejected. Measured stutter while generating.
- **Pausing rendering while generating.** Rejected. The point of the game is watching staff work.

## Consequences

- Positive: the game stays smooth (30 fps or better) while staff "think", and the visual drop is
  subtle.
- Positive: the scheduler is a pure state machine, unit-tested with vitest over synthetic
  frame-time series.
- Negative: two devices double the driver overhead and some allocations. Low-tier devices may run
  chatter-only models.
- Negative: frame-time budgets are environment-sensitive benchmarks, informational in Cockpit
  rather than gating.
