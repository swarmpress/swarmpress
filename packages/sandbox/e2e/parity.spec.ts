import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, ".fixture");
const ORIGIN = "http://sandbox.simpress.test";
const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm" };

test("the example bundles give the same result in Chromium as under Bun", async ({ page }) => {
  // Serve e2e/.fixture from a fake origin: no server process needed.
  await page.route(`${ORIGIN}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/+/, "") || "index.html";
    const ext = path.slice(path.lastIndexOf("."));
    try {
      await route.fulfill({ status: 200, contentType: TYPES[ext] ?? "application/octet-stream", body: readFileSync(join(FIXTURE, path)) });
    } catch {
      await route.fulfill({ status: 404, body: "not found" });
    }
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${ORIGIN}/index.html`);
  await page.waitForFunction(() => window.__parity !== undefined || window.__parityError !== undefined, null, { timeout: 30_000 });
  const err = await page.evaluate(() => window.__parityError);
  expect(err, err).toBeUndefined();
  const result = await page.evaluate(() => window.__parity);
  const expected = JSON.parse(readFileSync(join(HERE, "..", "test", "fixtures", "parity.expected.json"), "utf8"));
  expect(result).toEqual(expected);
  expect(errors).toEqual([]);
});

declare global {
  interface Window {
    __parity?: unknown;
    __parityError?: string;
  }
}
