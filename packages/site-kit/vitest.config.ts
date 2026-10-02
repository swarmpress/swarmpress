import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 600_000,
    // The integration test builds a real Astro site; keep files sequential.
    fileParallelism: false,
  },
})
