import { defineConfig } from '@playwright/test'

// The in-browser model runtime (ADR-0057), served from the harness build
// (`vite build --mode harness`, cross-origin isolated by `vite preview`).
//
// Project `bonsai`: e2e/bonsai.spec.ts, e2e/bonsai-equivalence.spec.ts and the
// qualification run of e2e/bonsai-bench.spec.ts on the real engine and the real
// 27B model. Gated by BONSAI_E2E=1: the first run downloads about 6 GB of
// weights, and it needs a real GPU, so it runs headed in installed Chrome with
// a persistent profile (the weights stay cached between runs in
// apps/game/.bonsai-profile/).
//
//   pnpm --filter @swarm-press/game bonsai:runtime      # once: fetch the pinned engine
//   BONSAI_E2E=1 pnpm --filter @swarm-press/game exec playwright test -c playwright.bonsai.config.ts --project=bonsai
//
// Project `scripted`: the same qualification harness (bench.html) on the
// scripted backend in headless Chromium. No GPU, no network, no model; it runs
// without the gate and checks that the reports come out with stable counts.
//
//   CI=1 pnpm --filter @swarm-press/game exec playwright test -c playwright.bonsai.config.ts --project=scripted
//
// Project `bricks`: the brick office spike's frame times and counts (FEAT-081),
// docs/qualification/brick-office-spike.md.
//
//   CI=1 pnpm --filter @swarm-press/game exec playwright test -c playwright.bonsai.config.ts --project=bricks
//
// The qualification runbook is docs/runbooks/model-qualification.md.
// BENCH_REPORT_ONLY=1 rebuilds the qualification report from the raw results
// without a browser, so nothing is built or served then.
const port = Number(process.env.SWARMPRESS_BONSAI_PORT ?? 4178)
const executablePath = process.env.CHROMIUM_PATH || undefined
const serve = !process.env.BENCH_REPORT_ONLY

export default defineConfig({
  testDir: 'e2e',
  testMatch: ['bonsai.spec.ts', 'bonsai-equivalence.spec.ts', 'bonsai-bench.spec.ts', 'bricks-bench.spec.ts'],
  // Cold: a 6 GB download plus kernel compilation. The qualification run sets its own, longer timeout.
  timeout: 90 * 60_000,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: process.env.PW_JSON ?? 'reports/playwright-bonsai.json' }]],
  use: { baseURL: `http://localhost:${port}` },
  projects: [
    // Real GPU, real model; every test skips itself without BONSAI_E2E=1.
    { name: 'bonsai', testIgnore: 'bricks-bench.spec.ts', grepInvert: /@scripted/ },
    { name: 'scripted', testMatch: 'bonsai-bench.spec.ts', grep: /@scripted/, use: { launchOptions: { executablePath }, viewport: { width: 1280, height: 800 } } },
    // The brick office spike's measurements (FEAT-081, e2e/bricks-bench.spec.ts): box office vs brick office per tier.
    { name: 'bricks', testMatch: 'bricks-bench.spec.ts', use: { launchOptions: { executablePath }, viewport: { width: 1280, height: 800 } } },
  ],
  webServer: serve
    ? {
        command: `pnpm exec vite build --mode harness && pnpm exec vite preview --mode harness --port ${port} --strictPort`,
        url: `http://localhost:${port}/bench.html`,
        timeout: 300_000,
        reuseExistingServer: false,
      }
    : undefined,
})
