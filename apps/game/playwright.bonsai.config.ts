import { defineConfig } from '@playwright/test'

// e2e/bonsai.spec.ts and e2e/bonsai-equivalence.spec.ts: the in-browser WebGPU
// model runtime on the real engine and the real 27B model (ADR-0057). Gated by
// BONSAI_E2E=1: the first run downloads about 6 GB of weights, and it needs a
// real GPU, so it runs headed in installed Chrome with a persistent profile
// (the weights stay cached between runs in apps/game/.bonsai-profile/).
//
//   pnpm --filter @swarm-press/game bonsai:runtime      # once: fetch the pinned engine
//   BONSAI_E2E=1 pnpm --filter @swarm-press/game exec playwright test -c playwright.bonsai.config.ts
//
// The page is bonsai.html of the harness build (`vite build --mode harness`),
// served cross-origin isolated by `vite preview` like the other harness page.
const port = Number(process.env.SWARMPRESS_BONSAI_PORT ?? 4178)

export default defineConfig({
  testDir: 'e2e',
  testMatch: ['bonsai.spec.ts', 'bonsai-equivalence.spec.ts'],
  // Cold: a 6 GB download plus kernel compilation.
  timeout: 90 * 60_000,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: process.env.PW_JSON ?? 'reports/playwright-bonsai.json' }]],
  use: { baseURL: `http://localhost:${port}` },
  // Without the gate nothing runs, so nothing needs to be built or served.
  webServer: process.env.BONSAI_E2E
    ? {
        command: `pnpm exec vite build --mode harness && pnpm exec vite preview --mode harness --port ${port} --strictPort`,
        url: `http://localhost:${port}/bonsai.html`,
        timeout: 300_000,
        reuseExistingServer: false,
      }
    : undefined,
})
