import { defineConfig } from '@playwright/test'

// A company's WordPress in the game (FEAT-105, FEAT-107; e2e/wordpress.spec.ts): wordpress.html
// from the harness build, the sandbox origin on :5181 (vite.config.ts, from vendor/wp-sandbox/),
// headless Chromium. No GPU and no network: the sandbox release is fetched beforehand.
//
//   cargo xtask sandbox-fetch && cargo xtask wasm
//   pnpm --filter @swarm-press/game exec playwright test -c playwright.wordpress.config.ts
const port = Number(process.env.SWARMPRESS_WP_PORT ?? 4181)
const executablePath = process.env.CHROMIUM_PATH || undefined

export default defineConfig({
  testDir: 'e2e',
  testMatch: ['wordpress.spec.ts'],
  timeout: 10 * 60_000,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: process.env.PW_JSON ?? 'reports/playwright-wordpress.json' }]],
  use: { baseURL: `http://localhost:${port}`, launchOptions: { executablePath } },
  webServer: {
    command: `pnpm exec vite build --mode harness && pnpm exec vite preview --mode harness --port ${port} --strictPort`,
    url: `http://localhost:${port}/wordpress.html`,
    timeout: 300_000,
    reuseExistingServer: false,
  },
})
