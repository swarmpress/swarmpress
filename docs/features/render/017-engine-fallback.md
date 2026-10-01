---
id: FEAT-017
title: "WebGPU engine and WebGL2 fallback"
status: in-progress
importance: critical
paths:
  - apps/game/src/render/engine.ts
  - apps/game/src/main.ts
  - apps/game/e2e/smoke.spec.ts
  - apps/game/playwright.config.ts
adrs:
  - ADR-0004
---

# WebGPU engine and WebGL2 fallback

`createEngine()` tries `WebGPUEngine` and falls back to WebGL2; `?renderer=webgl` forces the
fallback. Playwright boots the client in a `webgpu` project (SwiftShader/Vulkan) and a `fallback`
project and fails on page errors.

Decisions: [ADR-0004](../../adr/0004-babylonjs-webgpu-webgl2-fallback.md).

## Acceptance criteria

- [ ] Boots on WebGPU in the `webgpu` project with no page errors (except the allow-listed SwiftShader text upload).
- [ ] Boots on WebGL2 in the `fallback` project and with `?renderer=webgl`.
- [ ] The wasm sim is ticking (`__simpress.sim.step() > 5`).

## Evidence

- `game/playwright-e2e` (`e2e/smoke.spec.ts`)
