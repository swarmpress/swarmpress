import { defineConfig } from "@playwright/test";

// Chromium comes from PLAYWRIGHT_BROWSERS_PATH (here: /opt/pw-browsers/chromium-1194); CHROMIUM_PATH overrides it.
const executablePath = process.env.CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  // Builds e2e/.fixture with Bun (the example bundles, the sandbox page bundle, the QuickJS wasm).
  globalSetup: "./e2e/global-setup.ts",
  reporter: [["list"], ["json", { outputFile: process.env.PW_JSON ?? "reports/playwright.json" }]],
  use: { launchOptions: { executablePath } },
  projects: [{ name: "chromium" }],
});
