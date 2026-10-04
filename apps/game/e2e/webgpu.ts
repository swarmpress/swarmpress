/**
 * Chromium flags for software WebGPU in headless Chromium (ADR-0064, FEAT-017),
 * shared by every Playwright config. Investigation: docs/qualification/webgpu-headless.md.
 *
 * On Linux the WebGPU canvas needs a shared-image backing that only exists when
 * Chromium's own compositor runs Vulkan (SwiftShader's, shipped with Chromium) under
 * Skia Graphite; without it the swap chain's shared image cannot be created and the
 * device is lost on the first present ("A valid external Instance reference no longer
 * exists"). All four of the last flags are needed; macOS works with or without them.
 */
export const WEBGPU_ARGS = [
  '--enable-unsafe-webgpu',
  '--use-angle=swiftshader',
  '--use-vulkan=swiftshader',
  '--enable-features=Vulkan,SkiaGraphite',
]

/** `CHROMIUM_PATH` overrides the bundled Chromium (as before). */
export const executablePath = process.env.CHROMIUM_PATH || undefined

export const webgpuLaunch = { executablePath, args: WEBGPU_ARGS }
