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
  },
})
