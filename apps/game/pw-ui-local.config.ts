import base from './playwright.config'
// Local-only: run on a private port (another worktree holds 4173). Not committed.
export default {
  ...base,
  use: { ...base.use, baseURL: 'http://localhost:4391' },
  webServer: { command: 'pnpm exec vite preview --port 4391 --strictPort', port: 4391, reuseExistingServer: false },
}
