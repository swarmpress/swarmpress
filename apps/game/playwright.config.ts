import { defineConfig } from '@playwright/test'
import { executablePath, webgpuLaunch } from './e2e/webgpu'

// Preview port: 4173 by default; SWARMPRESS_PREVIEW_PORT moves it (a shared machine).
const port = Number(process.env.SWARMPRESS_PREVIEW_PORT ?? 4173)

export default defineConfig({
  testDir: 'e2e',
  // Need the central server: playwright.orchestrator.config.ts, playwright.mvp.config.ts.
  // Need a GPU and the real model (gated): playwright.bonsai.config.ts.
  testIgnore: ['orchestrator.spec.ts', 'mvp.spec.ts', 'takeover.spec.ts', 'mvp-bonsai.spec.ts', 'bonsai.spec.ts', 'bonsai-equivalence.spec.ts'],
  timeout: 180_000,
  // JSON report path is per run so smoke and visual evidence stay separate for Cockpit.
  reporter: [['list'], ['json', { outputFile: process.env.PW_JSON ?? 'reports/playwright.json' }]],
  expect: { timeout: 60_000, toHaveScreenshot: { animations: 'disabled' } },
  use: { baseURL: `http://localhost:${port}`, viewport: { width: 1280, height: 800 } },
  webServer: {
    command: `pnpm exec vite preview --port ${port} --strictPort`,
    port,
    reuseExistingServer: !process.env.CI,
  },
  // The renderer is WebGPU only (ADR-0064): every test runs on software WebGPU
  // (SwiftShader, e2e/webgpu.ts) except the no-WebGPU screen's own.
  projects: [
    {
      name: 'webgpu',
      testIgnore: 'no-webgpu.spec.ts',
      use: { launchOptions: webgpuLaunch },
    },
    {
      // Headless Chromium without the flags offers no WebGPU adapter: the page must say so.
      name: 'no-webgpu',
      testMatch: 'no-webgpu.spec.ts',
      use: { launchOptions: { executablePath } },
    },
  ],
})
