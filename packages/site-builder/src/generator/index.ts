/**
 * Site Generator
 * Main entry point for site building and deployment
 */

export { buildSite, cleanBuildDir, validateContent } from './build'
export type { BuildOptions, BuildResult } from './build'

export { deploySite } from './deploy'
export type { DeployOptions, DeployResult } from './deploy'

// GitHub as source of truth
export { buildFromGitHub, cleanGitHubBuildDir } from './github-build'
export type { GitHubBuildOptions, GitHubBuildResult } from './github-build'

// Configuration-driven build (new architecture)
export { buildFromConfig } from './config-build'
export type { ConfigBuildOptions, ConfigBuildResult } from './config-build'

// Config loaders and generators
export { loadSiteConfiguration, ConfigLoader } from './config-loader'
export type { LoadedSiteConfiguration, ConfigLoaderOptions } from './config-loader'

export { generateThemeFiles, generateTailwindConfig, generateCSSVariables, THEME_PRESETS } from './theme-generator'
export type { ThemeGeneratorOptions, GeneratedTheme } from './theme-generator'

// Component resolution
export {
  resolveHeaderComponent,
  resolveFooterComponent,
  resolveHeroComponent,
  resolveComponent,
  buildHeaderProps,
  buildFooterProps,
  HEADER_COMPONENTS,
  FOOTER_COMPONENTS,
  HERO_COMPONENTS,
} from './component-resolver'
export type { ComponentCategory, ResolvedComponent } from './component-resolver'

// Sitemap parser
export { parseSitemap, loadSitemapFromGitHub } from './sitemap-parser'
export type { ParsedSitemap, SitemapNode, SiteConfig as SitemapSiteConfig } from './sitemap-parser'

// Collection generation
export { generateCollectionPages } from './collection-pages'
export type { CollectionGenerationResult } from '../types/collection-types'

export {
  fetchEnabledCollections,
  fetchAllCollections,
  fetchCollectionByType,
  fetchCollectionItems,
  fetchCollectionsForBuild,
  transformItemsForTemplate,
  transformItemForDetail,
} from './collections'

/**
 * Complete build and deploy pipeline
 */
import { buildSite, validateContent } from './build'
import { deploySite } from './deploy'
import { contentRepository } from '@swarm-press/backend'
import type { BuildOptions } from './build'
import type { DeployOptions } from './deploy'

export interface PublishOptions {
  websiteId: string
  deployTarget?: 'local' | 'netlify' | 's3' | 'github-pages'
  deployConfig?: Record<string, string>
  siteUrl?: string
  skipValidation?: boolean
}

export interface PublishResult {
  success: boolean
  url?: string
  buildTime?: number
  deployTime?: number
  error?: string
  validationErrors?: string[]
}

/**
 * Build and deploy a website
 */
export async function publishWebsite(options: PublishOptions): Promise<PublishResult> {
  try {
    console.log(`[Publisher] Starting publish for website ${options.websiteId}`)

    // Validate content before building (unless skipped)
    if (!options.skipValidation) {
      const content = await contentRepository.findAll({
        website_id: options.websiteId,
        status: 'published',
      })

      const validation = validateContent(content)
      if (!validation.valid) {
        return {
          success: false,
          error: 'Content validation failed',
          validationErrors: validation.errors,
        }
      }
    }

    // Build site
    const buildOptions: BuildOptions = {
      websiteId: options.websiteId,
      siteUrl: options.siteUrl,
    }

    const buildResult = await buildSite(buildOptions)
    if (!buildResult.success) {
      return {
        success: false,
        error: buildResult.error,
        buildTime: buildResult.buildTime,
      }
    }

    console.log(`[Publisher] Build successful: ${buildResult.outputDir}`)

    // Deploy site
    const deployOptions: DeployOptions = {
      websiteId: options.websiteId,
      buildDir: buildResult.outputDir!.replace('/dist', ''),
      deployTarget: options.deployTarget || 'local',
      config: options.deployConfig,
    }

    const deployResult = await deploySite(deployOptions)
    if (!deployResult.success) {
      return {
        success: false,
        error: deployResult.error,
        buildTime: buildResult.buildTime,
        deployTime: deployResult.deployTime,
      }
    }

    console.log(`[Publisher] Deployment successful: ${deployResult.url}`)

    // Clean up build directory (optional)
    // await cleanBuildDir(options.websiteId)

    return {
      success: true,
      url: deployResult.url,
      buildTime: buildResult.buildTime,
      deployTime: deployResult.deployTime,
    }
  } catch (error) {
    console.error('[Publisher] Publish failed:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
