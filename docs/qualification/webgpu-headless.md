# WebGPU in headless Chromium (FEAT-017)

> **Date:** 2026-10-04 · **Decisions:** ADR-0064 · **Feature:** FEAT-017 ·
> **Result:** WebGPU runs reliably in headless Chromium on Linux x86_64 and on macOS, so the WebGL2
> fallback is removed and every browser test runs on SwiftShader's WebGPU.

## 1. The problem

Under headless Chromium on Linux (CI), Babylon's WebGPU device was lost on the first frames with
`A valid external Instance reference no longer exists`, and `main.ts`' watchdog reloaded the page on
WebGL2. Every browser test and every visual baseline therefore ran on WebGL2, and ADR-0064 could not
land until WebGPU ran headless.

## 2. Setup

- Playwright 1.56.1 with its Chromium 141.0.7390.37 (build 1194): the headless shell (the default)
  and the full Chromium in new headless mode (`channel: 'chromium'`).
- Linux: `mcr.microsoft.com/playwright:v1.56.1-noble`, `--platform linux/amd64` (as CI and the
  baselines), Docker Desktop on an Apple-silicon Mac. macOS: the same Playwright, on the host.
- Three pages, from small to whole:
  1. *plain*: `requestAdapter`, `requestDevice`, configure a canvas context, clear it every frame
     for 3 s, then copy a texture to a buffer and map it; `gc()` and wait. With `nocanvas=1` the frames
     go to an offscreen texture instead of the canvas.
  2. *babylon*: a `WebGPUEngine` with a lit box and a `RawTexture`, 4 s of frames, then `readPixels`.
  3. *game*: the built client (`vite build`), `?quality=…`, `?ui=mock`, `?t=13:00`, `?office=bricks`.
- GPU process logs from `DEBUG=pw:browser`.

## 3. What was tried

| # | Platform, browser | Page | Flags (besides Playwright's) | Result |
|---|---|---|---|---|
| 1 | macOS, headless shell | plain | none | no adapter ("No available adapters") |
| 2 | macOS, headless shell | plain | `--enable-unsafe-webgpu` | SwiftShader adapter, 182 frames, read-back right, no loss |
| 3 | macOS, headless shell | plain | CI's old set (`--enable-unsafe-webgpu --use-angle=swiftshader --enable-features=Vulkan`); `--use-webgpu-adapter=swiftshader`; `+ --use-vulkan=swiftshader` | all fine |
| 4 | macOS, new headless | plain | `--enable-unsafe-webgpu` | Apple `metal-3` adapter (the real GPU), fine |
| 5 | macOS, both | babylon, game | CI's old set | WebGPU, no loss, every page variant |
| 6 | Linux x86_64, headless shell | plain | none | no adapter ("Failed to create WebGPU Context Provider") |
| 7 | Linux x86_64, headless shell | plain | `--enable-unsafe-webgpu`; CI's old set; `--use-webgpu-adapter=swiftshader`; `--enable-features=Vulkan --use-vulkan=swiftshader`; the same `+ --disable-vulkan-surface`; `--use-gl=angle --use-angle=swiftshader`; `--use-angle=vulkan --enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan`; `--enable-features=Vulkan,WebGPUService`; `--disable-gpu-compositing`; `--ignore-gpu-blocklist --disable-vulkan-fallback-to-gl-for-testing`; `--enable-features=SkiaGraphite` alone | **device lost after 2 or 3 frames**: `A valid external Instance reference no longer exists`; the GPU process logs `Could not find SharedImageBackingFactory with params: usage: …WebgpuSwapChainTexture… format: BGRA_8888` (and with `Vulkan` but without `--use-vulkan=swiftshader`, `vkCreateInstance() failed: -9`) |
| 8 | Linux x86_64, headless shell | plain, `nocanvas=1` | CI's old set | **fine**: 182 frames, read-back right, `gc()` survived. WebGPU itself works; the canvas does not |
| 9 | Linux x86_64, new headless | plain | the variants of row 7 | the same loss |
| 10 | Linux x86_64, both | plain | `--enable-unsafe-webgpu --use-angle=swiftshader --use-vulkan=swiftshader --enable-features=Vulkan,SkiaGraphite` | **fine**, 180 frames, read-back right |
| 11 | Linux x86_64, headless shell | plain | row 10 without any one of `--use-angle=swiftshader`, `--use-vulkan=swiftshader`, `Vulkan`, `SkiaGraphite` | the loss again: all four are needed |
| 12 | Linux x86_64, headless shell | game | CI's old set | reproduces CI: lost, reloaded on WebGL2 (`fallback=webgpu-device-lost`) |
| 13 | Linux x86_64, both | game | row 10's set | WebGPU, no loss, at every quality tier, `ui=mock`, `t=13:00` and `office=bricks` |
| 14 | macOS, both | game | row 10's set | WebGPU, no loss (the set is harmless where it is not needed) |

**Cause.** A WebGPU canvas presents through a shared image the compositor can read. On Linux the
headless GPU process has no backing for `WebgpuSwapChainTexture` unless the compositor itself runs
on Vulkan (SwiftShader's, shipped with Chromium as `libvk_swiftshader.so`) under Skia Graphite. The
shared image is not created, the swap chain fails, and Dawn drops the instance: the device is lost
on the first present. macOS has an IOSurface backing, so it never happened there.

**Hypotheses ruled out** (none of them was it): the adapter being garbage-collected (row 8 survives
a forced `gc()`), `requestAdapter` called twice (the plain page calls it once and is still lost),
the canvas context configured before the device was ready (the plain page configures after
`requestDevice`). Babylon's engine options (`enableAllFeatures`, `setMaximumLimits`, a
`deviceDescriptor`, `antialias`, the shader-compiler options) were not tried: the plain page,
without Babylon, is lost the same way, so they cannot be the cause. Not needed and not tried either:
lavapipe (`mesa-vulkan-drivers`), Chrome for Testing, a GPU runner.

## 4. Babylon's own restore does not work

With the device destroyed at frame 86 (*babylon* page, row 10's flags), Babylon's built-in
context-loss handling reports "context successfully restored", but every frame after it raises
WebGPU validation errors (`[Invalid ShaderModule] is associated with [Device "BabylonWebGPUDevice0"],
and cannot be used with [Device "BabylonWebGPUDevice1"]`) and the canvas stays black.
`_restoreEngineAfterContextLost` calls the asynchronous `initAsync()` without awaiting it and rebuilds
buffers, textures and pipelines at once, on the old device. So `createEngine` turns Babylon's
handling off (`doNotHandleContextLost`) and `main.ts` recovers with a new engine on a new canvas and
the scene rebuilt from the sim (`watchDeviceLoss`, FEAT-017).

## 5. Two pages in one browser

With the game drawing continuously on SwiftShader WebGPU in one page, a second page of the same
browser (another context) never gets an adapter: `navigator.gpu.requestAdapter()` stays pending
(more than 10 s here, more than 120 s in the MVP suite), on macOS and with either flag set. It
resolves at once when the first page stops drawing (`?t=` freezes it), draws every third frame, or
draws from a 50 ms timer instead of `requestAnimationFrame`; a small Babylon scene drawing
continuously does not block it. The first page's software frames keep the shared GPU process busy.
Real GPUs are not affected. The MVP and takeover suites, whose second device is a second page,
therefore open that device in a second browser (its own GPU process), which is also closer to
what a second device is.

## 6. Reliability

- **Linux x86_64, CI image:** `smoke.spec.ts` × 20 (`--repeat-each=20`, 2 workers): 80 tests, every
  boot on WebGPU with no device loss and no WebGPU validation error (20 of 20), the recovery test 20
  of 20, the HUD test 20 of 20. The smooth-movement test failed once (a walker seen in 12 frames, the
  threshold is more than 12): its 36-frame sample could start at the end of every walk in progress;
  it samples 72 frames now. That is a sampling window, not the renderer.
- The visual baselines were re-taken on SwiftShader WebGPU in the same image and compared again from
  a fresh copy.

## 7. Consequences

- The flags live in one place, `apps/game/e2e/webgpu.ts`, used by `playwright.config.ts`,
  `playwright.mvp.config.ts` and `playwright.bonsai.config.ts` (scripted and bricks projects).
- No WebGL2 renderer is kept, not even for tests: ADR-0064 stands as decided.
- A future Chromium may need other flags (Graphite and Vulkan defaults on Linux are moving). The
  smoke test fails on any device loss or validation error, and the no-WebGPU check in `boot()` stops a
  run at once if the page finds no adapter.
