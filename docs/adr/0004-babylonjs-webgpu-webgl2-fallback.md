# ADR-0004 — Babylon.js with WebGPU, WebGL2 fallback

**Status:** Accepted; superseded in part by ADR-0064 (WebGPU only)
**Date:** 2026-10-01

## Context

The building must look like a detailed digital dollhouse:
- PBR materials and baked lightmaps;
- dynamic interior lights that switch with the sim;
- sun and moon shadows;
- SSAO and tone mapping;
- skinned characters.

The browser is the only platform. WebGPU is the future-proof API, but its availability varies:
Firefox and Safari have limits, enterprise GPUs differ, and headless CI has none by default.

The local LLM runtime ([ADR-0024](0024-hybrid-inference-browser-llms-and-claude.md)) also needs
WebGPU, so the renderer has to coexist with it
([ADR-0027](0027-gpu-sharing-renderer-and-local-llm.md)).

## Decision

- Use **Babylon.js 9** (`@babylonjs/core`, `@babylonjs/loaders`) as the renderer.
- `createEngine()` (`apps/game/src/render/engine.ts`) tries `WebGPUEngine` first. It falls back to
  the WebGL2 `Engine` if WebGPU is unsupported or initialisation throws. `?renderer=webgl` forces
  the fallback, for tests and for users with broken drivers.
- Playwright tests both paths:
  - a `webgpu` project with SwiftShader/Vulkan flags;
  - a `fallback` project without WebGPU.

  Any shader or pipeline error fails the test. There is one exception: SwiftShader's known
  `copyExternalImageToTexture` text-upload limitation, allow-listed by regex in the `webgpu`
  project only.
- Scene code must use engine-agnostic Babylon APIs. WebGPU-only features (compute) are optional
  enhancements behind capability checks.

Alternatives considered:

- **three.js.** It has a strong ecosystem, but its WebGPU renderer and node materials were less
  mature for our needs. Babylon ships all of the following:
  - PBR;
  - SSAO2;
  - the default rendering pipeline;
  - GUI;
  - `NullEngine` for headless tests;
  - a WebGPU engine behind one API.
- **PlayCanvas.** Its workflow centres on the editor, and the editor's licensing doesn't fit a
  code-first, test-first pipeline.
- **Raw WebGPU.** Too much renderer to build ourselves, and no free WebGL2 fallback.
- **Pixi.js (the M0 prototype).** 2D only, so it couldn't deliver the dollhouse look.

## Consequences

- Positive: one scene graph serves both APIs. Babylon's `NullEngine` lets vitest test scene
  construction, light budgets and material setup without a GPU.
- Positive: the WebGPU path shares its device-capability probe with the LLM tiers.
- Negative: Babylon is a large dependency. The client bundle budget is tracked as a
  `cockpit.benchmark.v1` metric.
- Negative: WebGPU and WebGL2 render slightly differently, so each backend needs its own visual
  baselines.
- Negative: we depend on Babylon's WebGPU stability. The Playwright boot tests and pinned versions
  catch regressions.
