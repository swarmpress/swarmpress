import { fileURLToPath } from 'node:url'
import { defineConfig, type ProxyOptions } from 'vite'
import preact from '@preact/preset-vite'

// The central server (crates/server, `SWARMPRESS_BIND` default 127.0.0.1:8080).
const central = process.env.SWARMPRESS_CENTRAL_URL ?? 'http://127.0.0.1:8080'
const proxy: Record<string, ProxyOptions> = {
  '/auth': { target: central, changeOrigin: false },
  '/api': { target: central, changeOrigin: false },
  '/ws': { target: central, changeOrigin: false, ws: true },
  '/web': { target: central, changeOrigin: false },
}

// Cross-origin isolation (ADR-0041): Turso wasm's threads need
// SharedArrayBuffer. `credentialless` keeps no-cors subresources loadable
// without CORP (Chromium, Firefox); Safari ignores it and gets the sqlite-wasm
// store. SWARMPRESS_COEP=require-corp switches to the strict form.
// SWARMPRESS_ISOLATION=off drops both headers (to compare behaviour without isolation).
const isolation: Record<string, string> =
  process.env.SWARMPRESS_ISOLATION === 'off'
    ? {}
    : {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': process.env.SWARMPRESS_COEP ?? 'credentialless',
      }

export default defineConfig(({ mode }) => {
  // `vite build --mode harness` builds only the test harnesses (orchestrator.html,
  // bonsai.html, bench.html, eval.html) into dist-harness/; the production build never contains them.
  const harness = mode === 'harness'
  const input: Record<string, string> = harness
    ? {
        orchestrator: fileURLToPath(new URL('./orchestrator.html', import.meta.url)),
        bonsai: fileURLToPath(new URL('./bonsai.html', import.meta.url)),
        // The model qualification harness (src/llm/bench, e2e/bonsai-bench.spec.ts).
        bench: fileURLToPath(new URL('./bench.html', import.meta.url)),
        // The pipeline eval (src/harness/eval-harness.ts, e2e/eval.spec.ts, docs/runbooks/eval.md).
        eval: fileURLToPath(new URL('./eval.html', import.meta.url)),
      }
    : {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        llm: fileURLToPath(new URL('./llm.html', import.meta.url)),
      }
  return {
    plugins: [preact()],
    resolve: {
      alias: {
        // Built by `cargo xtask wasm` (wasm-bindgen --target web).
        'swarm-wasm': fileURLToPath(new URL('../../crates/client-wasm/pkg/client_wasm.js', import.meta.url)),
        'orchestrator-wasm': fileURLToPath(new URL('../../crates/orchestrator-wasm/pkg/orchestrator_wasm.js', import.meta.url)),
        // The construction kit (ADR-0065), loaded only behind ?office=bricks (src/render/bricks).
        'kit-wasm': fileURLToPath(new URL('../../crates/kit-wasm/pkg/kit_wasm.js', import.meta.url)),
        // Site blueprints and tool graphs (ADR-0072): the blueprint canvas checks and diffs with it.
        'blueprint-wasm': fileURLToPath(new URL('../../crates/blueprint-wasm/pkg/blueprint_wasm.js', import.meta.url)),
      },
    },
    server: {
      fs: { allow: ['../..'] },
      headers: isolation,
      proxy,
    },
    preview: {
      headers: isolation,
      proxy,
    },
    // Both database packages locate their wasm and workers relative to their
    // own modules; pre-bundling would break that.
    optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm', '@tursodatabase/database-wasm'] },
    build: {
      target: 'es2022',
      outDir: harness ? 'dist-harness' : 'dist',
      // LLM runtime: llm.html is the dev harness / e2e page for src/llm (see e2e/llm.spec.ts).
      rollupOptions: { input },
    },
    // LLM runtime: the model worker (src/llm/worker.ts) is a module worker with
    // code-split imports; the default 'iife' worker format cannot code-split.
    worker: { format: 'es' as const },
  }
})
