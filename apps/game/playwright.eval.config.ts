import { defineConfig } from '@playwright/test'

// The eval harness that qualifies the article pipeline (FEAT-036; eval.html,
// docs/runbooks/eval.md), served from the harness build (`vite build --mode
// harness`, cross-origin isolated by `vite preview`).
//
// Project `fake`: the whole eval on the scripted model (`?llm=fake`) against
// the committed cinqueterre-mini pack, three briefs, in headless Chromium. No
// GPU, no network. It checks the Cockpit document's shape and stable counts
// and that the seeded-bad drafts are rejected; it writes
// artifacts/bench/agent-pipeline-eval-fake.json (evidence `bench/agent-pipeline`).
//
//   pnpm --filter @swarm-press/game exec playwright test -c playwright.eval.config.ts --project=fake
//
// Project `real`: the owner's run on a real local model in installed Chrome,
// headed, with the Bonsai profile (weights cached), against the real site pack
// (EVAL_PACK). Gated by BONSAI_E2E=1. It writes the raw results, the Cockpit
// document and the record under docs/qualification/ whatever the verdict.
//
//   BONSAI_E2E=1 EVAL_PACK=/path/to/cinqueterre.eval.json pnpm --filter @swarm-press/game exec playwright test -c playwright.eval.config.ts --project=real
//
// EVAL_REPORT_ONLY=1 EVAL_RESULTS=<exported json> rebuilds the document and
// the record from results exported by eval.html (with the owner's marks)
// without a browser; nothing is built or served then.
const port = Number(process.env.SWARMPRESS_EVAL_PORT ?? 4179)
const executablePath = process.env.CHROMIUM_PATH || undefined
const serve = !process.env.EVAL_REPORT_ONLY

export default defineConfig({
  testDir: 'e2e',
  testMatch: ['eval.spec.ts'],
  // A real run is hours (20 briefs, tens of seconds to minutes per call); it sets its own limit.
  timeout: 5 * 60_000,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: process.env.PW_JSON ?? 'reports/playwright-eval.json' }]],
  use: { baseURL: `http://localhost:${port}` },
  projects: [
    { name: 'fake', grep: /@fake/, use: { launchOptions: { executablePath }, viewport: { width: 1280, height: 900 } } },
    // Real model; every test skips itself without BONSAI_E2E=1.
    { name: 'real', grepInvert: /@fake/ },
  ],
  webServer: serve
    ? {
        command: `pnpm exec vite build --mode harness && pnpm exec vite preview --mode harness --port ${port} --strictPort`,
        url: `http://localhost:${port}/eval.html`,
        timeout: 300_000,
        reuseExistingServer: false,
      }
    : undefined,
})
