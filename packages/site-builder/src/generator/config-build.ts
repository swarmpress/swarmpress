/**
 * Configuration-Driven Build Module
 * Builds static sites from GitHub repository using configuration files
 *
 * This replaces the hardcoded github-build.ts with a flexible,
 * configuration-driven approach using Astro components.
 */

import { exec } from 'child_process'
import { promisify } from 'util'
import { mkdir, writeFile, cp, rm } from 'fs/promises'
import { join, dirname } from 'path'
import {
  GitHubContentService,
  type GitHubContentConfig,
} from '@swarm-press/github-integration'
import {
  loadSiteConfiguration,
  type LoadedSiteConfiguration,
} from './config-loader'
import { generateThemeFiles } from './theme-generator'
import {
  loadSitemapFromGitHub,
  type ParsedSitemap,
} from './sitemap-parser'

const execAsync = promisify(exec)

// =============================================================================
// TYPES
// =============================================================================

export interface ConfigBuildOptions {
  /** GitHub configuration */
  github: GitHubContentConfig
  /** Output directory for generated site */
  outputDir?: string
  /** Site URL for builds */
  siteUrl?: string
  /** Items per page for collection pagination */
  itemsPerPage?: number
  /** Skip Astro build step (for development) */
  skipAstroBuild?: boolean
}

export interface ConfigBuildResult {
  success: boolean
  outputDir?: string
  url?: string
  error?: string
  buildTime?: number
  pagesGenerated?: number
  collectionsGenerated?: number
}

// =============================================================================
// BUILD CONTEXT
// =============================================================================

interface BuildContext {
  contentService: GitHubContentService
  config: LoadedSiteConfiguration
  sitemap: ParsedSitemap | null
  buildDir: string
  siteUrl: string
}

// =============================================================================
// MAIN BUILD FUNCTION
// =============================================================================

/**
 * Build a static site from GitHub repository using configuration
 */
export async function buildFromConfig(options: ConfigBuildOptions): Promise<ConfigBuildResult> {
  const startTime = Date.now()

  try {
    console.log(`[ConfigBuild] Starting config-driven build from ${options.github.owner}/${options.github.repo}`)

    // Initialize GitHub content service
    const contentService = new GitHubContentService(options.github)

    // =========================================================================
    // STEP 1: Load Configuration
    // =========================================================================
    console.log('[ConfigBuild] Step 1: Loading configuration...')

    const config = await loadSiteConfiguration(contentService)
    console.log(`[ConfigBuild] Loaded config for: ${config.siteInfo.name}`)

    // =========================================================================
    // STEP 2: Load Sitemap
    // =========================================================================
    console.log('[ConfigBuild] Step 2: Loading sitemap...')

    let sitemap: ParsedSitemap | null = null
    try {
      sitemap = await loadSitemapFromGitHub(contentService)
      console.log(`[ConfigBuild] Loaded sitemap with ${sitemap.pages.length} pages`)
    } catch (e) {
      console.warn('[ConfigBuild] No sitemap.json found, will use config only')
    }

    // =========================================================================
    // STEP 3: Setup Build Directory
    // =========================================================================
    console.log('[ConfigBuild] Step 3: Setting up build directory...')

    const buildDir = options.outputDir ||
      join(process.cwd(), 'build', `${options.github.owner}-${options.github.repo}`)

    // Clean and create build directory
    await rm(buildDir, { recursive: true, force: true })
    await mkdir(buildDir, { recursive: true })
    await mkdir(join(buildDir, 'src'), { recursive: true })
    await mkdir(join(buildDir, 'src', 'pages'), { recursive: true })
    await mkdir(join(buildDir, 'src', 'layouts'), { recursive: true })
    await mkdir(join(buildDir, 'src', 'components'), { recursive: true })

    const siteUrl = options.siteUrl || config.siteInfo.base_url

    // Build context for passing to generators
    const ctx: BuildContext = {
      contentService,
      config,
      sitemap,
      buildDir,
      siteUrl,
    }

    // =========================================================================
    // STEP 4: Generate Theme Files
    // =========================================================================
    console.log('[ConfigBuild] Step 4: Generating theme files...')

    const themeFiles = await generateThemeFiles(config.theme, {
      outputDir: buildDir,
      includePlugins: true,
    })
    console.log(`[ConfigBuild] Generated: ${themeFiles.tailwindConfigPath}`)
    console.log(`[ConfigBuild] Generated: ${themeFiles.cssVariablesPath}`)

    // =========================================================================
    // STEP 5: Copy Base Components & Layouts
    // =========================================================================
    console.log('[ConfigBuild] Step 5: Copying base components...')

    await copyBaseComponents(ctx)

    // =========================================================================
    // STEP 6: Generate Layout with Navigation
    // =========================================================================
    console.log('[ConfigBuild] Step 6: Generating layout...')

    await generateBaseLayout(ctx)

    // =========================================================================
    // STEP 7: Generate Pages
    // =========================================================================
    console.log('[ConfigBuild] Step 7: Generating pages...')

    const pagesGenerated = await generatePages(ctx)
    console.log(`[ConfigBuild] Generated ${pagesGenerated} pages`)

    // =========================================================================
    // STEP 8: Generate Collection Pages (TODO)
    // =========================================================================
    console.log('[ConfigBuild] Step 8: Generating collection pages...')

    const collectionsGenerated = await generateCollections(ctx)
    console.log(`[ConfigBuild] Generated ${collectionsGenerated} collection pages`)

    // =========================================================================
    // STEP 9: Generate Astro Config
    // =========================================================================
    console.log('[ConfigBuild] Step 9: Generating Astro config...')

    await generateAstroConfig(ctx)

    // =========================================================================
    // STEP 10: Run Astro Build (Optional)
    // =========================================================================
    if (!options.skipAstroBuild) {
      console.log('[ConfigBuild] Step 10: Running Astro build...')
      await runAstroBuild(buildDir)
    } else {
      console.log('[ConfigBuild] Step 10: Skipping Astro build (skipAstroBuild=true)')
    }

    // =========================================================================
    // DONE
    // =========================================================================
    const buildTime = Date.now() - startTime
    console.log(`[ConfigBuild] Build completed in ${buildTime}ms`)

    return {
      success: true,
      outputDir: join(buildDir, 'dist'),
      url: siteUrl,
      buildTime,
      pagesGenerated,
      collectionsGenerated,
    }

  } catch (error) {
    console.error('[ConfigBuild] Build failed:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

// =============================================================================
// STEP IMPLEMENTATIONS
// =============================================================================

/**
 * Copy base Astro components to build directory
 */
async function copyBaseComponents(ctx: BuildContext): Promise<void> {
  const { buildDir } = ctx

  // Create component directories
  const componentDirs = [
    'components/layout/header',
    'components/layout/footer',
    'components/marketing/hero',
    'components/blocks',
  ]

  for (const dir of componentDirs) {
    await mkdir(join(buildDir, 'src', dir), { recursive: true })
  }

  // Get the site-builder source directory (where this script lives)
  const siteBuilderSrc = join(dirname(dirname(__dirname)), 'src')

  // Copy layout components
  const layoutComponents = [
    'components/layout/header/HeaderSimple.astro',
    'components/layout/footer/FooterFourColumn.astro',
  ]

  for (const component of layoutComponents) {
    const srcPath = join(siteBuilderSrc, component)
    const destPath = join(buildDir, 'src', component)
    try {
      await cp(srcPath, destPath)
      console.log(`[ConfigBuild] Copied ${component}`)
    } catch (e) {
      console.warn(`[ConfigBuild] Could not copy ${component}:`, e)
    }
  }

  // Copy marketing components
  const marketingComponents = [
    'components/marketing/hero/HeroCentered.astro',
    'components/marketing/hero/HeroSplit.astro',
  ]

  for (const component of marketingComponents) {
    const srcPath = join(siteBuilderSrc, component)
    const destPath = join(buildDir, 'src', component)
    try {
      await cp(srcPath, destPath)
      console.log(`[ConfigBuild] Copied ${component}`)
    } catch (e) {
      console.warn(`[ConfigBuild] Could not copy ${component}:`, e)
    }
  }

  // Copy schemas (needed for component types)
  const schemasDir = join(siteBuilderSrc, 'schemas')
  const destSchemasDir = join(buildDir, 'src', 'schemas')
  try {
    await cp(schemasDir, destSchemasDir, { recursive: true })
    console.log(`[ConfigBuild] Copied schemas directory`)
  } catch (e) {
    console.warn(`[ConfigBuild] Could not copy schemas:`, e)
  }

  console.log('[ConfigBuild] Base components setup complete')
}

/**
 * Generate BaseLayout.astro with navigation using component imports
 */
async function generateBaseLayout(ctx: BuildContext): Promise<void> {
  const { config, buildDir } = ctx
  const { site: siteConfig, navigation: navConfig } = config

  // Serialize config data for use in the layout
  const siteConfigJson = JSON.stringify({
    site: siteConfig.site,
    theme: siteConfig.theme,
    layout: siteConfig.layout,
  })

  const navConfigJson = JSON.stringify(navConfig)

  const layoutContent = `---
/**
 * BaseLayout - Generated from configuration
 * Uses component-based header and footer
 */
import HeaderSimple from '../components/layout/header/HeaderSimple.astro'
import FooterFourColumn from '../components/layout/footer/FooterFourColumn.astro'

export interface Props {
  title: string
  description?: string
  ogImage?: string
  canonicalUrl?: string
}

const { title, description = '', ogImage, canonicalUrl } = Astro.props

// Site configuration (embedded from build)
const siteConfig = ${siteConfigJson}
const navConfig = ${navConfigJson}

const { site: siteInfo, theme, layout } = siteConfig
const siteName = siteInfo.name
const siteUrl = siteInfo.base_url
const lang = siteInfo.default_language || 'en'

// Header props
const headerProps = {
  siteName: siteInfo.name,
  logo: siteInfo.logo,
  baseUrl: siteUrl,
  navItems: navConfig.main_nav || [],
  ctaButton: navConfig.cta_button,
  sticky: layout?.header?.sticky ?? false,
  transparentOnHero: layout?.header?.transparent_on_hero ?? false,
  lang,
}

// Footer props
const footerProps = {
  siteName: siteInfo.name,
  logo: siteInfo.logo,
  footerNav: navConfig.footer_nav || [],
  socialLinks: navConfig.social_links || [],
  legalLinks: navConfig.legal_links || [],
  showNewsletter: layout?.footer?.show_newsletter ?? false,
  lang,
}
---

<!DOCTYPE html>
<html lang={lang}>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="generator" content={Astro.generator}>

  <title>{title} | {siteName}</title>
  {description && <meta name="description" content={description}>}

  <!-- Open Graph -->
  <meta property="og:title" content={title}>
  {description && <meta property="og:description" content={description}>}
  {ogImage && <meta property="og:image" content={ogImage}>}
  <meta property="og:type" content="website">
  <meta property="og:site_name" content={siteName}>

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content={title}>
  {description && <meta name="twitter:description" content={description}>}
  {ogImage && <meta name="twitter:image" content={ogImage}>}

  <!-- Canonical URL -->
  {canonicalUrl ? <link rel="canonical" href={canonicalUrl}> : <link rel="canonical" href={siteUrl}>}

  <!-- Favicon -->
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">

  <!-- Theme CSS -->
  <link rel="stylesheet" href="/styles/theme.css">

  <!-- Base styles -->
  <style is:global>
    html {
      scroll-behavior: smooth;
    }
    body {
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    main {
      flex: 1;
    }
  </style>
</head>
<body class="bg-white antialiased">
  <!-- Header -->
  <HeaderSimple {...headerProps} />

  <!-- Main Content -->
  <main>
    <slot />
  </main>

  <!-- Footer -->
  <FooterFourColumn {...footerProps} />
</body>
</html>
`

  const layoutPath = join(buildDir, 'src', 'layouts', 'BaseLayout.astro')
  await writeFile(layoutPath, layoutContent)
  console.log(`[ConfigBuild] Generated BaseLayout.astro with component imports`)
}

/**
 * Generate pages from sitemap
 */
async function generatePages(ctx: BuildContext): Promise<number> {
  const { config, sitemap: _sitemap, buildDir } = ctx
  // _sitemap will be used in full implementation for page generation from sitemap

  // For MVP, generate a simple index page
  const indexContent = `---
import BaseLayout from '../layouts/BaseLayout.astro'
---

<BaseLayout title="${config.siteInfo.name}" description="${config.siteInfo.tagline || ''}">
  <div class="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
    <div class="text-center">
      <h1 class="text-4xl font-bold tracking-tight text-gray-900 sm:text-6xl">
        ${config.siteInfo.tagline || config.siteInfo.name}
      </h1>
      <p class="mt-6 text-lg leading-8 text-gray-600">
        Welcome to ${config.siteInfo.name}
      </p>
    </div>
  </div>
</BaseLayout>
`

  const indexPath = join(buildDir, 'src', 'pages', 'index.astro')
  await writeFile(indexPath, indexContent)

  return 1  // For MVP, just the index page
}

/**
 * Generate collection pages
 */
async function generateCollections(_ctx: BuildContext): Promise<number> {
  // TODO: Implement collection page generation from ctx
  return 0
}

/**
 * Generate Astro configuration
 */
async function generateAstroConfig(ctx: BuildContext): Promise<void> {
  const { buildDir, siteUrl } = ctx

  const astroConfig = `import { defineConfig } from 'astro/config'
import tailwind from '@astrojs/tailwind'

export default defineConfig({
  site: '${siteUrl}',
  output: 'static',
  build: {
    format: 'directory',
  },
  integrations: [tailwind()],
})
`

  await writeFile(join(buildDir, 'astro.config.mjs'), astroConfig)

  // Generate package.json for build
  const packageJson = {
    name: 'generated-site',
    type: 'module',
    scripts: {
      build: 'astro build',
      dev: 'astro dev',
    },
    dependencies: {
      astro: '^4.0.0',
      '@astrojs/tailwind': '^5.0.0',
      tailwindcss: '^3.4.0',
      '@tailwindcss/typography': '^0.5.0',
      '@tailwindcss/forms': '^0.5.0',
      '@tailwindcss/aspect-ratio': '^0.4.0',
    },
  }

  await writeFile(join(buildDir, 'package.json'), JSON.stringify(packageJson, null, 2))
  console.log(`[ConfigBuild] Generated astro.config.mjs and package.json`)
}

/**
 * Run Astro build
 */
async function runAstroBuild(buildDir: string): Promise<void> {
  console.log('[ConfigBuild] Installing dependencies...')
  await execAsync('npm install', { cwd: buildDir })

  console.log('[ConfigBuild] Running Astro build...')
  await execAsync('npm run build', { cwd: buildDir })

  console.log('[ConfigBuild] Astro build complete')
}

// =============================================================================
// EXPORTS
// =============================================================================

export { loadSiteConfiguration, ConfigLoader, type LoadedSiteConfiguration } from './config-loader'
export { generateThemeFiles, generateTailwindConfig, generateCSSVariables, THEME_PRESETS } from './theme-generator'
export * from './component-resolver'
