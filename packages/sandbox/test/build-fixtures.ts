/**
 * Builds the parity fixtures with Bun.build (run under Bun):
 * - the fact-checker and coffee-machine-rule example bundles (IIFE, `globalThis.ext`),
 *   built the same way `simpress build` does;
 * - with `--browser`: `e2e/.fixture/` = page.js (sandbox + parity harness), the QuickJS wasm,
 *   index.html and both example bundles, for the Playwright parity test.
 *
 *   bun test/build-fixtures.ts --browser
 */
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const HERE = import.meta.dir;
const PKG = join(HERE, "..");
const ROOT = join(PKG, "..", "..");
const SDK_RUNTIME = join(ROOT, "packages", "sdk", "src", "runtime.ts");

const sdkPlugin = {
  name: "simpress-sdk",
  setup(b: { onResolve(o: { filter: RegExp }, cb: () => { path: string }): void }) {
    b.onResolve({ filter: /^@simpress\/sdk(\/runtime)?$/ }, () => ({ path: SDK_RUNTIME }));
  },
};

export async function buildExample(name: "fact-checker" | "coffee-machine-rule"): Promise<string> {
  const dir = join(ROOT, "examples", "extensions", name);
  const tmp = join(PKG, ".build-" + name);
  await mkdir(tmp, { recursive: true });
  const entry = join(tmp, "entry.js");
  await writeFile(entry, `import * as m from ${JSON.stringify(join(dir, "src", "index.ts"))};\nglobalThis.ext = m.default ?? m;\n`);
  try {
    const r = await Bun.build({ entrypoints: [entry], format: "iife", target: "browser", plugins: [sdkPlugin as any] });
    if (!r.success) throw new Error(r.logs.map(String).join("\n"));
    return await r.outputs[0].text();
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

export async function buildBrowserFixture(out = join(PKG, "e2e", ".fixture")): Promise<string> {
  await mkdir(out, { recursive: true });
  const page = await Bun.build({ entrypoints: [join(PKG, "e2e", "page.ts")], format: "esm", target: "browser" });
  if (!page.success) throw new Error(page.logs.map(String).join("\n"));
  await writeFile(join(out, "page.js"), await page.outputs[0].text());
  const require = createRequire(import.meta.url);
  const wasm = join(dirname(require.resolve("@jitl/quickjs-wasmfile-release-sync")), "emscripten-module.wasm");
  await copyFile(wasm, join(out, "quickjs.wasm"));
  await writeFile(join(out, "fact-checker.js"), await buildExample("fact-checker"));
  await writeFile(join(out, "coffee.js"), await buildExample("coffee-machine-rule"));
  await writeFile(
    join(out, "index.html"),
    `<!doctype html><meta charset="utf-8"><title>sandbox parity</title><script type="module" src="./page.js"></script>\n`,
  );
  return out;
}

if (import.meta.main) {
  if (process.argv.includes("--browser")) console.log(`wrote ${await buildBrowserFixture()}`);
}
