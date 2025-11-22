import { defineConfig } from 'astro/config'
import node from '@astrojs/node'

// https://astro.build/config
export default defineConfig({
  output: 'static',
  outDir: './dist',

  // Site configuration (will be overridden per-website)
  site: 'https://example.com',

  // Build configuration
  build: {
    format: 'file',
  },

  // Image optimization
  image: {
    service: {
      entrypoint: 'astro/assets/services/sharp',
    },
  },

  // Vite configuration
  vite: {
    ssr: {
      noExternal: ['@swarm-press/shared', '@swarm-press/backend'],
    },
  },
})
