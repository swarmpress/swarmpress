import { defineConfig } from 'vocs'

export default defineConfig({
  title: 'swarm.press',
  description: 'Autonomous Publishing Platform Documentation',
  sidebar: [
    {
      text: 'Getting Started',
      items: [
        { text: 'Installation', link: '/getting-started/installation' },
        { text: 'Quickstart', link: '/getting-started/quickstart' },
      ],
    },
    {
      text: 'Guides',
      items: [
        { text: 'Deployment', link: '/guides/deployment' },
        { text: 'GitHub OAuth', link: '/guides/github-oauth' },
        { text: 'User Guide', link: '/guides/user-guide' },
      ],
    },
    {
      text: 'Architecture',
      items: [
        { text: 'Overview', link: '/architecture/overview' },
        { text: 'Multi-Tenant', link: '/architecture/multi-tenant' },
        { text: 'Editorial Planning', link: '/architecture/editorial-planning' },
        { text: 'Sitemap System', link: '/architecture/sitemap-system' },
        { text: 'GitHub Integration', link: '/architecture/github-integration' },
      ],
    },
    {
      text: 'Reference',
      items: [
        { text: 'API', link: '/reference/api' },
      ],
    },
  ],
  topNav: [
    { text: 'Docs', link: '/getting-started/installation' },
    { text: 'API', link: '/reference/api' },
  ],
})
