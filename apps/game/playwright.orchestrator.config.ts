import { defineConfig } from '@playwright/test'

// e2e/orchestrator.spec.ts: the browser runtime against the real central
// server. Two web servers: simpress-server (built by e2e/central-server.mjs)
// and the Vite preview of the harness build (`vite build --mode harness`,
// dist-harness/, proxying /auth /api /ws /web to the server). One project per
// store engine.
const executablePath = process.env.CHROMIUM_PATH || undefined
const central = process.env.SIMPRESS_E2E_BIND ?? '127.0.0.1:18080'
const port = Number(process.env.SIMPRESS_E2E_PORT ?? 4175)

export default defineConfig({
  testDir: 'e2e',
  testMatch: 'orchestrator.spec.ts',
  timeout: 180_000,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: process.env.PW_JSON ?? 'reports/playwright-orchestrator.json' }]],
  use: { baseURL: `http://localhost:${port}`, launchOptions: { executablePath } },
  webServer: [
    {
      command: 'node e2e/central-server.mjs',
      url: `http://${central}/healthz`,
      timeout: 900_000,
      reuseExistingServer: false,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: `pnpm exec vite build --mode harness && pnpm exec vite preview --mode harness --port ${port} --strictPort`,
      url: `http://localhost:${port}/orchestrator.html`,
      timeout: 300_000,
      reuseExistingServer: false,
      env: { SIMPRESS_CENTRAL_URL: `http://${central}` },
    },
  ],
  projects: [
    // The project name is the `?store=` engine.
    { name: 'turso' },
    { name: 'sqlite' },
  ],
})
