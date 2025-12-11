/**
 * @swarm-press/site-builder
 * Astro-based static site builder exports
 */

// Export generator functions
export { buildSite, cleanBuildDir, validateContent } from './generator/build'
export type { BuildOptions, BuildResult } from './generator/build'

export { deploySite } from './generator/deploy'
export type { DeployOptions, DeployResult } from './generator/deploy'

export { publishWebsite } from './generator/index'
export type { PublishOptions, PublishResult } from './generator/index'

// GitHub Build (build from GitHub as source of truth)
export { buildFromGitHub, cleanGitHubBuildDir } from './generator/github-build'
export type { GitHubBuildOptions, GitHubBuildResult } from './generator/github-build'
