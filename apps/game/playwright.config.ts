import { defineConfig } from '@playwright/test'

const executablePath = process.env.CHROMIUM_PATH || undefined

export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  // JSON report path is per run so smoke and visual evidence stay separate for Cockpit.
  reporter: [['list'], ['json', { outputFile: process.env.PW_JSON ?? 'reports/playwright.json' }]],
  expect: { timeout: 60_000, toHaveScreenshot: { animations: 'disabled' } },
  use: { baseURL: 'http://localhost:4173', viewport: { width: 1280, height: 800 } },
  webServer: {
    command: 'pnpm exec vite preview --port 4173 --strictPort',
    port: 4173,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      // Headless Chromium without flags exposes no WebGPU adapter, so this
      // exercises the automatic WebGL2 fallback in createEngine().
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
