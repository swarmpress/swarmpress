// Fixture site for the starter theme: cinqueterre-mini content + site.manifest.json.
// The theme dir is the starter theme itself (manifest "themeDir": "..").
import { defineConfig } from 'astro/config'
import siteKit from '@swarm-press/site-kit'

export default defineConfig({
  integrations: [siteKit({ base: process.env.SITE_KIT_BASE })],
})
