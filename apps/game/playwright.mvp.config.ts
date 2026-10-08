import { defineConfig } from '@playwright/test'
import { webgpuLaunch } from './e2e/webgpu'

// e2e/mvp.spec.ts: the MVP acceptance test (docs/mvp.md), on the REAL game
// page (`/?central=1`, the production build in dist/) against the real central
// server. Two web servers: swarmpress-server (built by e2e/central-server.mjs,
// dev auth + fake GitHub + simulated deploys) and the Vite preview of the
// production build, proxying /auth /api /ws /web to it. One project per store
// engine. Ports differ from the default and orchestrator configs so the suites
// can run side by side.
const central = process.env.SWARMPRESS_MVP_BIND ?? '127.0.0.1:18081'
const port = Number(process.env.SWARMPRESS_MVP_PORT ?? 4176)

export default defineConfig({
  testDir: 'e2e',
  // takeover.spec.ts (the executor lease, ADR-0045) needs the same two servers, and so does
  // mvp-bonsai.spec.ts (the game page on the real model; gated by BONSAI_E2E=1, project `bonsai`).
  testMatch: ['mvp.spec.ts', 'takeover.spec.ts', 'mvp-bonsai.spec.ts', 'story.spec.ts', 'studio.spec.ts'],
  timeout: 300_000,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: process.env.PW_JSON ?? 'reports/playwright-mvp.json' }]],
  expect: { timeout: 30_000 },
  use: {
    baseURL: `http://localhost:${port}`,
    viewport: { width: 1280, height: 800 },
    // The game page draws on software WebGPU (ADR-0064, e2e/webgpu.ts).
    launchOptions: webgpuLaunch,
  },
  webServer: [
    {
      command: 'node e2e/central-server.mjs',
      url: `http://${central}/healthz`,
      timeout: 900_000,
      reuseExistingServer: false,
      stdout: 'ignore',
      stderr: 'pipe',
      env: { SWARMPRESS_E2E_BIND: central },
    },
    {
      command: `pnpm exec vite build && pnpm exec vite preview --port ${port} --strictPort`,
      url: `http://localhost:${port}/`,
      timeout: 300_000,
      reuseExistingServer: false,
      env: { SWARMPRESS_CENTRAL_URL: `http://${central}` },
    },
  ],
  projects: [
    // The project name is the `?store=` engine.
    { name: 'turso', testIgnore: 'mvp-bonsai.spec.ts' },
    { name: 'sqlite', testIgnore: 'mvp-bonsai.spec.ts' },
    // The real local model (ADR-0057, R8): installed Chrome, headed, persistent profile. Skipped without BONSAI_E2E=1.
    { name: 'bonsai', testMatch: 'mvp-bonsai.spec.ts' },
  ],
})
