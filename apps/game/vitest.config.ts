import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      'orchestrator-wasm': fileURLToPath(new URL('../../crates/orchestrator-wasm/pkg/orchestrator_wasm.js', import.meta.url)),
    },
  },
  test: { include: ['src/**/*.test.ts', 'src/**/*.test.tsx'] },
})
