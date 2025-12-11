import { defineConfig } from 'astro/config'
import tailwind from '@astrojs/tailwind'

// https://astro.build/config
export default defineConfig({
  output: 'static',
  outDir: './dist',

  // Site configuration (will be overridden per-website)
  site: 'https://example.com',

  // Build configuration
  build: {
    format: 'directory',
  },

  // Integrations
  integrations: [
    tailwind({
      applyBaseStyles: true,
    }),
  ],

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
