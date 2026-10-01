import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'

export default defineConfig({
  plugins: [preact()],
  resolve: {
    alias: {
      // Built by `cargo xtask wasm` (wasm-bindgen --target web).
      'swarm-wasm': fileURLToPath(new URL('../../crates/client-wasm/pkg/client_wasm.js', import.meta.url)),
    },
  },
  server: {
    fs: { allow: ['../..'] },
  },
  build: {
    target: 'es2022',
    // LLM runtime: llm.html is the dev harness / e2e page for src/llm (see e2e/llm.spec.ts).
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        llm: fileURLToPath(new URL('./llm.html', import.meta.url)),
      },
    },
  },
  // LLM runtime: the model worker (src/llm/worker.ts) is a module worker with
  // code-split imports; the default 'iife' worker format cannot code-split.
  worker: { format: 'es' },
})
