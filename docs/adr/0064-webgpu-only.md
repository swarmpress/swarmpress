# ADR-0064 — WebGPU only

**Status:** Accepted (supersedes in part ADR-0004; amends ADR-0006)
**Date:** 2026-10-03

## Context

ADR-0004 chose Babylon.js with WebGPU and a WebGL2 fallback, and tests both: a `webgpu` Playwright
project (SwiftShader) and a `fallback` project. Most browser tests and every visual baseline run on
the WebGL2 software path today, and several are skipped on the `webgpu` project.

Since then the product has become WebGPU-dependent anyway. All inference runs on WebGPU in the
browser with one resident model (ADR-0057): a browser without WebGPU cannot run the company. The
brick office (ADR-0063) needs WebGPU's headroom (instancing at scale, render bundles, compute for
culling later) to share the GPU with that model. The owner has decided the renderer is WebGPU only.

## Decision

1. **The renderer is WebGPU only.** `createEngine()` creates a `WebGPUEngine` and nothing else. The
   WebGL2 `Engine`, the `?renderer=webgl` override and the fallback code path are removed.
2. **No WebGPU, no game.** A browser without a usable WebGPU adapter gets a clear screen that says
   so, names supported browsers, and links to the requirements; it does not degrade silently.
3. **Tests run on WebGPU.** The Playwright `fallback` project is removed. Every browser test and every
   visual baseline runs on headless Chromium's software WebGPU (SwiftShader/Vulkan flags), in CI and
   in the Linux Playwright image locally. The known SwiftShader limitation
   (`copyExternalImageToTexture`) stays allow-listed, and the renderer never depends on it (textures
   are uploaded as raw pixels).
4. **WebGPU features may be used directly.** Compute shaders, render bundles and storage buffers no
   longer need a WebGL2 equivalent. Optional features (`shader-f16`, subgroups, timestamp queries)
   are still capability-checked, because adapters differ.
5. **Babylon.js stays** (the rest of ADR-0004). `NullEngine` remains for headless unit tests.
6. **Order of work.** The removal is one increment (FEAT-017): engine, the no-WebGPU screen, the
   Playwright projects, re-baselined visuals, and the docs. Until it lands, the fallback stays in the
   code and new rendering work targets WebGPU first.

## Consequences

- One rendering backend to test and to tune; the brick office and the model's runtime share the same
  API family.
- Visual baselines are re-generated once on SwiftShader WebGPU; WebGL2 baselines are deleted.
- ADR-0006's statement that real-time GI is out of reach "especially on WebGL2" no longer applies;
  its other reasons (shared GPU, light limits) still do.
- **Negative:**
  - Browsers without WebGPU (older versions, some Linux and enterprise setups) cannot play. This
    already holds for inference, so the product's reach does not shrink further.
  - CI depends on SwiftShader's WebGPU being deterministic enough for pixel comparison; this is
    unverified and is the main risk of the increment. If it is not, visual tests compare with a
    tolerance or run on a self-hosted GPU runner.
  - Some browser tests that ran fast on the WebGL2 software path will be slower on software WebGPU.
- **Alternatives rejected:**
  - *Keep the fallback for the office only.* Two backends to test, for players who cannot run the
    company anyway.
  - *WebGPU only in production, WebGL2 in CI.* Tests would no longer test what players run.
