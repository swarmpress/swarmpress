---
id: FEAT-017
title: "WebGPU engine (WebGPU only)"
status: stable
importance: critical
paths:
  - apps/game/src/render/engine.ts
  - apps/game/src/render/engine.test.ts
  - apps/game/src/render/no-webgpu.ts
  - apps/game/src/main.ts
  - apps/game/e2e/webgpu.ts
  - apps/game/e2e/helpers.ts
  - apps/game/e2e/smoke.spec.ts
  - apps/game/e2e/no-webgpu.spec.ts
  - apps/game/playwright.config.ts
adrs:
  - ADR-0004
  - ADR-0064
---

# WebGPU engine (WebGPU only)

The renderer is WebGPU only ([ADR-0064](../../adr/0064-webgpu-only.md)). `createEngine(canvas)`
creates a Babylon `WebGPUEngine` and nothing else; the WebGL2 `Engine`, `?renderer=webgl` and the
reload-on-WebGL2 watchdog are gone.

- **No WebGPU, no game.** No `navigator.gpu`, no adapter, or a device that does not start is a
  `NoWebGpuError`; the page shows the no-WebGPU screen (`render/no-webgpu.ts`): what is missing,
  the browsers that work, and a link to the requirements. Nothing is drawn on another renderer.
- **Device loss.** Babylon's in-place restore is off (it rebuilds resources before the new device
  exists, so they stay tied to the dead one). On a loss `main.ts` holds the clock, disposes the
  engine, and builds a new WebGPU engine on a new canvas and the scene again from the sim, keeping
  the camera angle and the GPU scheduler's quality. After three losses it shows the no-WebGPU
  screen. `__swarmpress.loseDevice()` destroys the device for the test.
- **Tests on WebGPU.** Every Playwright suite launches Chromium with `e2e/webgpu.ts`'s flags
  (SwiftShader WebGPU; on Linux the compositor must run SwiftShader Vulkan under Skia Graphite, or
  the canvas' swap chain cannot be created and the device is lost on the first frame). Project
  `webgpu` runs every browser test; project `no-webgpu` (no flags, so no adapter) checks the
  no-WebGPU screen. Visual baselines are taken on SwiftShader WebGPU in the Linux Playwright image.
  Investigation: [webgpu-headless.md](../../qualification/webgpu-headless.md).

Decisions: [ADR-0004](../../adr/0004-babylonjs-webgpu-webgl2-fallback.md) (Babylon; its WebGL2
fallback superseded), [ADR-0064](../../adr/0064-webgpu-only.md).

> **ADR-0064 follow-up note (2026-10-04).** Decision 3's main risk ("CI depends on SwiftShader's
> WebGPU") is resolved: headless Chromium 141 (Playwright 1.56.1) runs the game on SwiftShader
> WebGPU on Linux x86_64 and on macOS with the flags above; the earlier device loss was the
> missing canvas shared-image backing, not WebGPU itself. No test-only WebGL2 renderer is needed.

## Acceptance criteria

- [ ] Boots on WebGPU in the `webgpu` project with no page, shader or WebGPU validation errors and no device loss (except the allow-listed SwiftShader `copyExternalImageToTexture`).
- [ ] Without a WebGPU adapter (project `no-webgpu`) or without `navigator.gpu`, the page shows the no-WebGPU screen with the reason, the supported browsers and the requirements link.
- [ ] A lost device is recovered on a new WebGPU engine; the clock holds while it is rebuilt and the sim runs on after.
- [ ] The wasm sim is ticking (`__swarmpress.sim.step() > 5`).

## Evidence

- `game/playwright-e2e` (`e2e/smoke.spec.ts`, `e2e/no-webgpu.spec.ts`)
- `game/vitest` (`src/render/engine.test.ts`)
