---
id: FEAT-017
title: "WebGPU engine (WebGPU only)"
status: in-progress
importance: critical
paths:
  - apps/game/src/render/engine.ts
  - apps/game/src/main.ts
  - apps/game/e2e/smoke.spec.ts
  - apps/game/playwright.config.ts
adrs:
  - ADR-0004
  - ADR-0064
---

# WebGPU engine (WebGPU only)

> **Next:** ADR-0064 makes the renderer WebGPU only. The increment removes the WebGL2 `Engine`,
> `?renderer=webgl` and the Playwright `fallback` project, adds a "this needs WebGPU" screen, runs
> every browser test and visual baseline on SwiftShader WebGPU, and re-baselines the visuals once.
> Until it lands, the fallback described below is still in the code.

`createEngine()` tries `WebGPUEngine` and falls back to WebGL2; `?renderer=webgl` forces the
fallback. Playwright boots the client in a `webgpu` project (SwiftShader/Vulkan) and a `fallback`
project and fails on page errors.

Decisions: [ADR-0004](../../adr/0004-babylonjs-webgpu-webgl2-fallback.md).

## Acceptance criteria

- [ ] Boots on WebGPU in the `webgpu` project with no page errors (except the allow-listed SwiftShader text upload).
- [ ] Boots on WebGL2 in the `fallback` project and with `?renderer=webgl`.
- [ ] The wasm sim is ticking (`__swarmpress.sim.step() > 5`).

## Evidence

- `game/playwright-e2e` (`e2e/smoke.spec.ts`)
