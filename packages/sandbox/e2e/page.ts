/**
 * The browser side of the parity test: hands the served QuickJS wasm to the
 * sandbox, fetches the example bundles and runs the shared parity harness.
 * The result lands on `window.__parity` (or `window.__parityError`).
 */
import { MemoryStore, configureQuickJS, createSandbox } from "../src/index.ts";
import { runParity } from "../test/parity.ts";

declare global {
  interface Window {
    __parity?: unknown;
    __parityError?: string;
  }
}

(async () => {
  try {
    configureQuickJS({ wasmBinary: await (await fetch("./quickjs.wasm")).arrayBuffer() });
    const [factChecker, coffee] = await Promise.all(["./fact-checker.js", "./coffee.js"].map(async (u) => (await fetch(u)).text()));
    window.__parity = await runParity(createSandbox, MemoryStore, { factChecker, coffee });
  } catch (e) {
    window.__parityError = e instanceof Error ? `${e.name}: ${e.message}\n${e.stack}` : String(e);
  }
})();
