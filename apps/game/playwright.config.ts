import { defineConfig } from '@playwright/test'

const executablePath = process.env.CHROMIUM_PATH || undefined

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  webServer: {
    command: 'pnpm exec vite preview --port 4173 --strictPort',
    port: 4173,
    reuseExistingServer: !process.env.CI,
  },
  use: { baseURL: 'http://localhost:4173' },
  projects: [
    {
      // Headless Chromium without flags exposes no WebGPU adapter, so this
      // exercises Pixi's automatic WebGL fallback.
      name: 'fallback',
      use: { launchOptions: { executablePath } },
    },
    {
      // Software WebGPU via SwiftShader/Vulkan.
      name: 'webgpu',
      use: {
        launchOptions: {
          executablePath,
          args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--enable-features=Vulkan'],
        },
      },
    },
  ],
})
