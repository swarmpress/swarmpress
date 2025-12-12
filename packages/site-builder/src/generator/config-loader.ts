/**
 * Configuration Loader
 * Loads and validates site configuration from GitHub repository
 */

import type { GitHubContentService } from '@swarm-press/github-integration'
import {
  SiteConfigSchema,
  NavigationConfigSchema,
  type SiteConfig,
  type NavigationConfig,
  type ThemeConfig,
} from '../schemas'

// =============================================================================
// TYPES
// =============================================================================

/**
 * Complete site configuration loaded from GitHub
 */
export interface LoadedSiteConfiguration {
  site: SiteConfig
  navigation: NavigationConfig
  // Convenience accessors
  theme: ThemeConfig
  siteInfo: SiteConfig['site']
}

/**
 * Options for loading configuration
 */
export interface ConfigLoaderOptions {
  /**
   * Path prefix for config files (default: "content/config")
   */
  configPath?: string
  /**
   * Whether to use defaults if config files are missing
   */
  useDefaults?: boolean
}

// =============================================================================
// DEFAULT CONFIGURATIONS
// =============================================================================

const DEFAULT_SITE_CONFIG: SiteConfig = {
  version: '1.0.0',
  site: {
    name: 'My Site',
    title: 'My Site',
    base_url: 'https://example.com',
    default_language: 'en',
    languages: ['en'],
  },
  theme: {
    colors: {
      primary: {
        '50': '#eff6ff',
        '500': '#3b82f6',
        '600': '#2563eb',
        '700': '#1d4ed8',
      },
    },
    borderRadius: '0.5rem',
    shadows: 'default',
  },
  layout: {
    header: { variant: 'simple', sticky: true, transparent_on_hero: false, show_cta_button: false },
    footer: { variant: 'four-column', show_social: true, show_newsletter: false },
    container: { max_width: '7xl', padding: '4' },
  },
  seo: {},
  analytics: {},
  features: {
    dark_mode: false,
    search: false,
    breadcrumbs: true,
    reading_time: false,
    share_buttons: false,
    table_of_contents: false,
    comments: false,
  },
}

const DEFAULT_NAVIGATION_CONFIG: NavigationConfig = {
  main_nav: [],
  footer_nav: [],
  social_links: [],
  legal_links: [],
}

// =============================================================================
// LOADER CLASS
// =============================================================================

export class ConfigLoader {
  private contentService: GitHubContentService
  private configPath: string
  private useDefaults: boolean
  private cache: Map<string, unknown> = new Map()

  constructor(contentService: GitHubContentService, options: ConfigLoaderOptions = {}) {
    this.contentService = contentService
    this.configPath = options.configPath || 'content/config'
    this.useDefaults = options.useDefaults ?? true
  }

  /**
   * Load a single JSON config file from GitHub
   */
  private async loadJsonFile<T>(filename: string): Promise<T | null> {
    const cacheKey = `${this.configPath}/${filename}`

    // Check cache
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey) as T
    }

    const filePath = `${this.configPath}/${filename}`
    try {
      const content = await this.contentService.getFileContent(filePath)
      if (!content) {
        console.log(`[ConfigLoader] ${filename} not found at ${filePath}`)
        return null
      }

      const parsed = JSON.parse(content) as T
      this.cache.set(cacheKey, parsed)
      return parsed
    } catch (error) {
      console.warn(`[ConfigLoader] Failed to load ${filename}:`, error)
      return null
    }
  }

  /**
   * Load and validate site.json
   */
  async loadSiteConfig(): Promise<SiteConfig> {
    const raw = await this.loadJsonFile<unknown>('site.json')

    if (!raw) {
      if (this.useDefaults) {
        console.log('[ConfigLoader] Using default site config')
        return DEFAULT_SITE_CONFIG
      }
      throw new Error('site.json not found and defaults disabled')
    }

    try {
      return SiteConfigSchema.parse(raw)
    } catch (error) {
      console.error('[ConfigLoader] Invalid site.json:', error)
      if (this.useDefaults) {
        console.log('[ConfigLoader] Falling back to default site config')
        return DEFAULT_SITE_CONFIG
      }
      throw error
    }
  }

  /**
   * Load and validate navigation.json
   */
  async loadNavigationConfig(): Promise<NavigationConfig> {
    const raw = await this.loadJsonFile<unknown>('navigation.json')

    if (!raw) {
      if (this.useDefaults) {
        console.log('[ConfigLoader] Using default navigation config')
        return DEFAULT_NAVIGATION_CONFIG
      }
      throw new Error('navigation.json not found and defaults disabled')
    }

    try {
      return NavigationConfigSchema.parse(raw)
    } catch (error) {
      console.error('[ConfigLoader] Invalid navigation.json:', error)
      if (this.useDefaults) {
        console.log('[ConfigLoader] Falling back to default navigation config')
        return DEFAULT_NAVIGATION_CONFIG
      }
      throw error
    }
  }

  /**
   * Load all configuration files
   */
  async loadAll(): Promise<LoadedSiteConfiguration> {
    console.log(`[ConfigLoader] Loading configuration from ${this.configPath}/`)

    // Load configs in parallel
    const [siteConfig, navigationConfig] = await Promise.all([
      this.loadSiteConfig(),
      this.loadNavigationConfig(),
    ])

    console.log(`[ConfigLoader] Loaded site: ${siteConfig.site.name}`)
    console.log(`[ConfigLoader] Theme primary color: ${siteConfig.theme.colors.primary['500']}`)
    console.log(`[ConfigLoader] Nav items: ${navigationConfig.main_nav.length}`)

    return {
      site: siteConfig,
      navigation: navigationConfig,
      // Convenience accessors
      theme: siteConfig.theme,
      siteInfo: siteConfig.site,
    }
  }

  /**
   * Clear the cache (useful for watch mode)
   */
  clearCache(): void {
    this.cache.clear()
  }
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Load site configuration from GitHub content service
 */
export async function loadSiteConfiguration(
  contentService: GitHubContentService,
  options?: ConfigLoaderOptions
): Promise<LoadedSiteConfiguration> {
  const loader = new ConfigLoader(contentService, options)
  return loader.loadAll()
}

/**
 * Merge user config with defaults (deep merge)
 */
export function mergeWithDefaults<T extends object>(
  userConfig: Partial<T>,
  defaults: T
): T {
  const result = { ...defaults } as T

  for (const key in userConfig) {
    const userValue = userConfig[key]
    const defaultValue = (defaults as Record<string, unknown>)[key]

    if (
      userValue !== undefined &&
      typeof userValue === 'object' &&
      userValue !== null &&
      !Array.isArray(userValue) &&
      typeof defaultValue === 'object' &&
      defaultValue !== null &&
      !Array.isArray(defaultValue)
    ) {
      // Deep merge objects
      (result as Record<string, unknown>)[key] = mergeWithDefaults(
        userValue as object,
        defaultValue as object
      )
    } else if (userValue !== undefined) {
      // Override with user value
      (result as Record<string, unknown>)[key] = userValue
    }
  }

  return result
}
