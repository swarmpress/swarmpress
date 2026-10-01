/**
 * GitHub Build Module
 * Builds static sites directly from GitHub repository content
 * GitHub is the source of truth - no database required
 */

import { exec } from 'child_process'
import { promisify } from 'util'
import { mkdir, writeFile, rm } from 'fs/promises'
import { join, dirname } from 'path'
import {
  GitHubContentService,
  type GitHubContentConfig,
  type PageFile,
  type CollectionSchemaFile,
  type CollectionItemFile,
} from '@swarm-press/github-integration'
import {
  getCollectionListingUrl,
  getCollectionDetailUrl,
} from '../types/collection-types'
import {
  loadSitemapFromGitHub,
  parseSitemap,
  generateSitemapXml,
  getLocalizedTitle,
  getLocalizedBreadcrumb,
  type ParsedSitemap,
  type SitemapNode,
} from './sitemap-parser'
import {
  loadAndExpandI18nPages,
  type FlatPage,
} from './i18n-processor'

const execAsync = promisify(exec)

// =============================================================================
// TYPES
// =============================================================================

export interface GitHubBuildOptions {
  /** GitHub configuration */
  github: GitHubContentConfig
  /** Output directory for generated site */
  outputDir?: string
  /** Site URL for Astro build */
  siteUrl?: string
  /** Items per page for collection pagination */
  itemsPerPage?: number
  /** Path to local i18n pages directory (if set, uses local i18n pages instead of GitHub pages) */
  i18nPagesPath?: string
}

export interface GitHubBuildResult {
  success: boolean
  outputDir?: string
  url?: string
  error?: string
  buildTime?: number
  pagesGenerated?: number
  collectionsGenerated?: number
}

// =============================================================================
// INTERNAL TYPES (for compatibility with existing templates)
// =============================================================================

interface InternalPage {
  id: string
  slug: string
  title: string
  description?: string
  body: Array<Record<string, unknown>>
  status: string
}

interface InternalCollection {
  id: string
  collection_type: string
  display_name: string
  singular_name?: string
  description?: string
  icon?: string
  color?: string
  json_schema: Record<string, unknown>
  title_field: string
  summary_field?: string
  image_field?: string
  date_field?: string
}

interface InternalCollectionItem {
  id: string
  slug: string
  data: Record<string, unknown>
  published: boolean
  featured: boolean
  created_at: string
  updated_at: string
}

// =============================================================================
// NAVIGATION CONTEXT (from sitemap.json)
// =============================================================================

/**
 * Navigation context passed to page templates
 * Contains all information needed to render navigation elements
 */
interface NavigationContext {
  /** Site configuration from sitemap */
  site: {
    name: string
    tagline?: string
    logo?: string
    defaultLanguage: string
    siteUrl: string
  }
  /** Main navigation items (top-level pages with in_nav: true) */
  mainNav: Array<{
    title: string
    path: string
    isActive: boolean
  }>
  /** Breadcrumb trail from root to current page */
  breadcrumbs: Array<{
    title: string
    path: string
    isLast: boolean
  }>
  /** Previous page in sequence (null if first) */
  prevPage: { title: string; path: string } | null
  /** Next page in sequence (null if last) */
  nextPage: { title: string; path: string } | null
  /** Footer navigation sections */
  footerNav: Array<{
    title: string
    links: Array<{ title: string; path: string }>
  }>
  /** Current language code */
  language: string
}

// =============================================================================
// MAIN BUILD FUNCTION
// =============================================================================

/**
 * Build a static site from GitHub repository content
 */
export async function buildFromGitHub(options: GitHubBuildOptions): Promise<GitHubBuildResult> {
  const startTime = Date.now()

  try {
    console.log(`[GitHubBuild] Starting build from ${options.github.owner}/${options.github.repo}`)

    // Initialize GitHub content service
    const contentService = new GitHubContentService(options.github)

    // Check if repository is initialized
    const config = await contentService.getConfig()
    if (!config) {
      return {
        success: false,
        error: `Repository not initialized. Missing content/config.json`,
      }
    }

    console.log(`[GitHubBuild] Found website config: ${config.title}`)

    // Try to load sitemap.json for navigation
    let sitemap: ParsedSitemap | null = null
    try {
      sitemap = await loadSitemapFromGitHub(contentService)
      console.log(`[GitHubBuild] Loaded sitemap.json with ${sitemap.pages.length} pages`)
    } catch (e) {
      console.log(`[GitHubBuild] No sitemap.json found, using legacy navigation`)
    }

    // Fetch pages - either from local i18n files or GitHub
    let pages: InternalPage[]

    if (options.i18nPagesPath) {
      // Load and expand i18n pages from local path
      console.log(`[GitHubBuild] Loading i18n pages from: ${options.i18nPagesPath}`)
      const flatPages = await loadAndExpandI18nPages(options.i18nPagesPath)
      pages = flatPages.map(fp => convertFlatPage(fp))
      console.log(`[GitHubBuild] Expanded to ${pages.length} pages across all languages`)
    } else {
      // Fetch from GitHub (legacy mode)
      const pageFiles = await contentService.listPages()
      pages = pageFiles.map(pf => convertPageFile(pf.content))
      console.log(`[GitHubBuild] Found ${pages.length} pages from GitHub`)
    }

    // Fetch all collections with items - handling both individual and grouped formats
    const collections = await loadCollectionsWithGroupedItems(contentService)
    console.log(`[GitHubBuild] Found ${collections.size} collections`)

    // Create build directory
    const buildDir = options.outputDir || join(process.cwd(), 'build', `${options.github.owner}-${options.github.repo}`)
    await mkdir(buildDir, { recursive: true })

    const siteUrl = options.siteUrl || config.domain || 'https://example.com'

    // Generate pages with sitemap navigation if available
    if (sitemap) {
      await generatePagesWithSitemap(config, pages, buildDir, sitemap, siteUrl)
    } else {
      await generatePages(config, pages, buildDir)
    }

    // Generate collection pages
    let collectionsGenerated = 0

    for (const [collectionType, { schema, items }] of collections) {
      const collection = convertCollectionSchema(collectionType, schema)
      // Items are already in the correct format from loadCollectionsWithGroupedItems
      const collectionItems = items.map(convertCollectionItem)

      console.log(`[GitHubBuild] Processing ${collectionType}: ${collectionItems.length} items`)

      if (collectionItems.length > 0) {
        const count = await generateCollectionPagesFromGitHub(
          collection,
          collectionItems,
          buildDir,
          '',
          options.itemsPerPage || 12,
          sitemap || undefined
        )
        collectionsGenerated += count
      }
    }

    // Generate sitemap.xml if sitemap.json exists
    if (sitemap) {
      const sitemapXml = generateSitemapXml(sitemap)
      const distDir = join(buildDir, 'dist')
      await mkdir(distDir, { recursive: true })
      await writeFile(join(distDir, 'sitemap.xml'), sitemapXml)
      console.log(`[GitHubBuild] Generated sitemap.xml`)
    }

    const buildTime = Date.now() - startTime

    console.log(`[GitHubBuild] Build completed in ${buildTime}ms`)

    return {
      success: true,
      outputDir: join(buildDir, 'dist'),
      url: siteUrl,
      buildTime,
      pagesGenerated: pages.length + 1, // +1 for index
      collectionsGenerated,
    }
  } catch (error) {
    console.error('[GitHubBuild] Build failed:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

// =============================================================================
// GROUPED ITEMS LOADER
// =============================================================================

/**
 * Village-grouped item file format (from batch processing)
 */
interface GroupedItemsFile {
  collection_type: string
  village?: string
  generated_at?: string
  item_count?: number
  items: Array<Record<string, unknown>>
}

/**
 * Load collections handling both individual item files and grouped village files
 */
async function loadCollectionsWithGroupedItems(
  contentService: GitHubContentService
): Promise<Map<string, { schema: CollectionSchemaFile; items: CollectionItemFile[] }>> {
  const types = await contentService.listCollectionTypes()
  const collections = new Map<string, { schema: CollectionSchemaFile; items: CollectionItemFile[] }>()

  for (const type of types) {
    const schemaFile = await contentService.getCollectionSchema(type)
    if (!schemaFile) continue

    const rawItems = await contentService.listCollectionItems(type)
    const allItems: CollectionItemFile[] = []

    for (const rawItem of rawItems) {
      const content = rawItem.content as unknown

      // Check if this is a grouped file (has 'items' array)
      if (isGroupedItemsFile(content)) {
        const grouped = content as GroupedItemsFile
        console.log(`[GitHubBuild] Found grouped file for ${type}: ${grouped.items.length} items`)

        // Extract individual items from the grouped file
        for (const item of grouped.items) {
          const slug = item.slug as string || generateSlug(item, schemaFile.content.title_field)
          allItems.push({
            id: slug,
            slug,
            data: item,
            published: true, // Treat all items in grouped files as published
            featured: (item.featured as boolean) || false,
            created_at: (item.created_at as string) || new Date().toISOString(),
            updated_at: (item.updated_at as string) || new Date().toISOString(),
          })
        }
      } else if (isIndividualItemFile(content)) {
        // Standard individual item file
        const individual = rawItem.content
        if (individual.published) {
          allItems.push(individual)
        }
      } else {
        // Try to treat the whole file as item data
        const slug = rawItem.path.split('/').pop()?.replace('.json', '') || 'unknown'
        allItems.push({
          id: slug,
          slug,
          data: content as Record<string, unknown>,
          published: true,
          featured: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
      }
    }

    console.log(`[GitHubBuild] Collection ${type}: ${allItems.length} total items`)
    collections.set(type, {
      schema: schemaFile.content,
      items: allItems,
    })
  }

  return collections
}

/**
 * Check if content is a grouped items file
 */
function isGroupedItemsFile(content: unknown): content is GroupedItemsFile {
  if (!content || typeof content !== 'object') return false
  const obj = content as Record<string, unknown>
  return Array.isArray(obj.items) && (typeof obj.collection_type === 'string' || typeof obj.village === 'string')
}

/**
 * Check if content is a standard individual item file
 */
function isIndividualItemFile(content: unknown): content is CollectionItemFile {
  if (!content || typeof content !== 'object') return false
  const obj = content as Record<string, unknown>
  return typeof obj.slug === 'string' && typeof obj.data === 'object' && typeof obj.published === 'boolean'
}

/**
 * Generate a slug from item data
 */
function generateSlug(item: Record<string, unknown>, titleField?: string): string {
  // Try common fields
  if (item.slug) return String(item.slug)
  if (item.name?.en) return slugify(String(item.name.en))
  if (item.name) return slugify(String(item.name))
  if (titleField && item[titleField]) return slugify(String(item[titleField]))
  return `item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

/**
 * Convert string to URL-friendly slug
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
}

// =============================================================================
// CONVERSION FUNCTIONS
// =============================================================================

/**
 * Convert GitHub PageFile to internal page format
 */
function convertPageFile(file: PageFile): InternalPage {
  return {
    id: file.id,
    slug: file.slug,
    title: file.title,
    description: file.description,
    body: file.body,
    status: file.status,
  }
}

/**
 * Convert flattened i18n page to internal page format
 */
function convertFlatPage(page: FlatPage): InternalPage {
  // Remove leading slash from slug for consistency
  const slug = page.slug.startsWith('/') ? page.slug.slice(1) : page.slug
  return {
    id: page.id,
    slug,
    title: page.title,
    description: page.seo?.description,
    body: page.body,
    status: page.status,
  }
}

/**
 * Convert GitHub CollectionSchemaFile to internal collection format
 */
function convertCollectionSchema(type: string, schema: CollectionSchemaFile): InternalCollection {
  return {
    id: type, // Use type as ID since we don't have DB IDs
    collection_type: type,
    display_name: schema.display_name,
    singular_name: schema.singular_name,
    description: schema.description,
    icon: schema.icon,
    color: schema.color,
    json_schema: schema.json_schema,
    title_field: schema.title_field || 'name',
    summary_field: schema.summary_field,
    image_field: schema.image_field,
    date_field: schema.date_field,
  }
}

/**
 * Convert GitHub CollectionItemFile to internal item format
 */
function convertCollectionItem(file: CollectionItemFile): InternalCollectionItem {
  return {
    id: file.id,
    slug: file.slug,
    data: file.data,
    published: file.published,
    featured: file.featured || false,
    created_at: file.created_at,
    updated_at: file.updated_at,
  }
}

// =============================================================================
// DIRECT HTML PAGE GENERATION
// =============================================================================

/**
 * Generate HTML pages directly (no Astro intermediate format)
 */
async function generatePages(
  config: { title: string; description?: string; collections?: Array<{ type: string; displayName: string }> },
  pages: InternalPage[],
  buildDir: string
): Promise<void> {
  const distDir = join(buildDir, 'dist')
  await mkdir(distDir, { recursive: true })

  // Generate index HTML
  const indexHtml = generateIndexHtml(config, pages)
  await writeFile(join(distDir, 'index.html'), indexHtml)

  // Generate individual page HTML files
  for (const page of pages) {
    const pageDir = join(distDir, page.slug)
    await mkdir(pageDir, { recursive: true })
    const pageHtml = generatePageHtml(page, config)
    await writeFile(join(pageDir, 'index.html'), pageHtml)
  }

  console.log(`[GitHubBuild] Generated ${pages.length + 1} pages`)
}

/**
 * Generate pages with sitemap-driven navigation
 */
async function generatePagesWithSitemap(
  config: { title: string; description?: string; collections?: Array<{ type: string; displayName: string }> },
  pages: InternalPage[],
  buildDir: string,
  sitemap: ParsedSitemap,
  siteUrl: string
): Promise<void> {
  const distDir = join(buildDir, 'dist')
  await mkdir(distDir, { recursive: true })

  const language = sitemap.site.default_language

  // Generate index HTML with sitemap navigation
  const indexNav = buildNavigationContext(sitemap, '/', language)
  const indexHtml = generateIndexHtmlWithNav(config, pages, indexNav)
  await writeFile(join(distDir, 'index.html'), indexHtml)

  // Generate individual page HTML files with navigation context
  for (const page of pages) {
    const pagePath = `/${page.slug}/`
    const pageNav = buildNavigationContext(sitemap, pagePath, language)
    const pageDir = join(distDir, page.slug)
    await mkdir(pageDir, { recursive: true })
    const pageHtml = generatePageHtmlWithNav(page, pageNav)
    await writeFile(join(pageDir, 'index.html'), pageHtml)
  }

  console.log(`[GitHubBuild] Generated ${pages.length + 1} pages with sitemap navigation`)
}

/**
 * Generate index page HTML with sitemap navigation
 */
function generateIndexHtmlWithNav(
  config: { title: string; description?: string; collections?: Array<{ type: string; displayName: string }> },
  pages: InternalPage[],
  nav: NavigationContext
): string {
  const publishedPages = pages.filter(p => p.status === 'published')
  const collections = config.collections || []

  // Collection icons mapping
  const collectionIcons: Record<string, string> = {
    villages: `<svg class="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" /></svg>`,
    restaurants: `<svg class="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8.25v-1.5m0 1.5c-1.355 0-2.697.056-4.024.166C6.845 8.51 6 9.473 6 10.608v2.513m6-4.87c1.355 0 2.697.055 4.024.165C17.155 8.51 18 9.473 18 10.608v2.513m-3-4.87v-1.5m-6 1.5v-1.5m12 9.75l-1.5.75a3.354 3.354 0 01-3 0 3.354 3.354 0 00-3 0 3.354 3.354 0 01-3 0 3.354 3.354 0 00-3 0 3.354 3.354 0 01-3 0L3 16.5m15-3.38a48.474 48.474 0 00-6-.37c-2.032 0-4.034.125-6 .37m12 0c.39.049.777.102 1.163.16 1.07.16 1.837 1.094 1.837 2.175v5.17c0 .62-.504 1.124-1.125 1.124H4.125A1.125 1.125 0 013 20.625v-5.17c0-1.08.768-2.014 1.837-2.174A47.78 47.78 0 016 13.12M12.265 3.11a.375.375 0 11-.53 0L12 2.845l.265.265zm-3 0a.375.375 0 11-.53 0L9 2.845l.265.265zm6 0a.375.375 0 11-.53 0L15 2.845l.265.265z" /></svg>`,
    hikes: `<svg class="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 00-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0z" /></svg>`,
    accommodations: `<svg class="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 21v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21m0 0h4.5V3.545M12.75 21h7.5V10.75M2.25 21h1.5m18 0h-18M2.25 9l4.5-1.636M18.75 3l-1.5.545m0 6.205l3 1m1.5.5l-1.5-.5M6.75 7.364V3h-3v18m3-13.636l10.5-3.819" /></svg>`,
    pois: `<svg class="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" /></svg>`,
    events: `<svg class="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" /></svg>`,
    weather: `<svg class="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z" /></svg>`,
    transportation: `<svg class="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" /></svg>`,
    region: `<svg class="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" /></svg>`,
  }

  // Build collections grid with cards
  const collectionsHtml = collections.map(c => {
    const icon = collectionIcons[c.type] || collectionIcons['pois']
    return `
    <a href="/${escapeHtml(c.type)}/" class="group relative flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white p-6 shadow-sm transition hover:shadow-md hover:border-ocean-200">
      <div class="mb-4 text-ocean-500 group-hover:text-ocean-600">
        ${icon}
      </div>
      <h3 class="text-lg font-semibold text-slate-900 group-hover:text-ocean-700">${escapeHtml(c.displayName)}</h3>
      <p class="mt-1 text-sm text-slate-500">Discover ${escapeHtml(c.displayName.toLowerCase())}</p>
      <div class="mt-4 flex items-center text-sm font-medium text-ocean-600">
        <span>Browse all</span>
        <svg class="ml-1 h-4 w-4 transition group-hover:translate-x-1" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M3 10a.75.75 0 01.75-.75h10.638L10.23 5.29a.75.75 0 111.04-1.08l5.5 5.25a.75.75 0 010 1.08l-5.5 5.25a.75.75 0 11-1.04-1.08l4.158-3.96H3.75A.75.75 0 013 10z" clip-rule="evenodd" />
        </svg>
      </div>
    </a>`
  }).join('')

  // Build page list HTML
  const pagesListHtml = publishedPages.map(p => `
    <a href="/${escapeHtml(p.slug)}/" class="group rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow-md">
      <h3 class="font-semibold text-slate-900 group-hover:text-ocean-600">${escapeHtml(p.title)}</h3>
      ${p.description ? `<p class="mt-1 text-sm text-slate-500">${escapeHtml(p.description)}</p>` : ''}
    </a>
  `).join('')

  const contentHtml = `
    <!-- Hero Section -->
    <div class="relative isolate overflow-hidden">
      <div class="mx-auto max-w-4xl text-center">
        <h1 class="text-4xl font-bold tracking-tight text-slate-900 sm:text-6xl">
          ${escapeHtml(nav.site.tagline || config.title)}
        </h1>
        <p class="mt-6 text-lg leading-8 text-slate-600">
          ${escapeHtml(config.description || 'Discover amazing content curated by our team.')}
        </p>
      </div>
    </div>

    ${collections.length > 0 ? `
    <!-- Collections Grid -->
    <section class="mt-16">
      <h2 class="text-2xl font-bold text-slate-900 mb-8">Explore</h2>
      <div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        ${collectionsHtml}
      </div>
    </section>
    ` : ''}

    ${publishedPages.length > 0 ? `
    <!-- Pages Section -->
    <section class="mt-16">
      <h2 class="text-2xl font-bold text-slate-900 mb-6">More Information</h2>
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        ${pagesListHtml}
      </div>
    </section>
    ` : ''}`

  return wrapInHtmlDocumentWithNav(
    nav.site.name,
    config.description || '',
    contentHtml,
    nav
  )
}

/**
 * Generate individual page HTML with sitemap navigation
 */
function generatePageHtmlWithNav(page: InternalPage, nav: NavigationContext): string {
  // Convert blocks to HTML
  const contentHtml = renderBlocks(page.body)

  return wrapInHtmlDocumentWithNav(
    page.title,
    page.description || '',
    `
    <article>
      <h1 class="text-3xl font-bold text-slate-900 mb-4">${escapeHtml(page.title)}</h1>
      ${page.description ? `<p class="text-lg text-slate-600 mb-8">${escapeHtml(page.description)}</p>` : ''}
      <div class="prose-cinqueterre">
        ${contentHtml}
      </div>
    </article>
    `,
    nav
  )
}

/**
 * Generate index page HTML
 */
function generateIndexHtml(
  config: { title: string; description?: string; collections?: Array<{ type: string; displayName: string }> },
  pages: InternalPage[]
): string {
  const publishedPages = pages.filter(p => p.status === 'published')
  const collections = config.collections || []

  // Collection icons mapping
  const collectionIcons: Record<string, string> = {
    villages: `<svg class="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" /></svg>`,
    restaurants: `<svg class="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8.25v-1.5m0 1.5c-1.355 0-2.697.056-4.024.166C6.845 8.51 6 9.473 6 10.608v2.513m6-4.87c1.355 0 2.697.055 4.024.165C17.155 8.51 18 9.473 18 10.608v2.513m-3-4.87v-1.5m-6 1.5v-1.5m12 9.75l-1.5.75a3.354 3.354 0 01-3 0 3.354 3.354 0 00-3 0 3.354 3.354 0 01-3 0 3.354 3.354 0 00-3 0 3.354 3.354 0 01-3 0L3 16.5m15-3.38a48.474 48.474 0 00-6-.37c-2.032 0-4.034.125-6 .37m12 0c.39.049.777.102 1.163.16 1.07.16 1.837 1.094 1.837 2.175v5.17c0 .62-.504 1.124-1.125 1.124H4.125A1.125 1.125 0 013 20.625v-5.17c0-1.08.768-2.014 1.837-2.174A47.78 47.78 0 016 13.12M12.265 3.11a.375.375 0 11-.53 0L12 2.845l.265.265zm-3 0a.375.375 0 11-.53 0L9 2.845l.265.265zm6 0a.375.375 0 11-.53 0L15 2.845l.265.265z" /></svg>`,
    hikes: `<svg class="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 00-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0z" /></svg>`,
    accommodations: `<svg class="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 21v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21m0 0h4.5V3.545M12.75 21h7.5V10.75M2.25 21h1.5m18 0h-18M2.25 9l4.5-1.636M18.75 3l-1.5.545m0 6.205l3 1m1.5.5l-1.5-.5M6.75 7.364V3h-3v18m3-13.636l10.5-3.819" /></svg>`,
    pois: `<svg class="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" /></svg>`,
    events: `<svg class="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" /></svg>`,
    weather: `<svg class="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z" /></svg>`,
    transportation: `<svg class="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" /></svg>`,
    region: `<svg class="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" /></svg>`,
  }

  // Build collections grid with cards
  const collectionsHtml = collections.map(c => {
    const icon = collectionIcons[c.type] || collectionIcons['pois']
    return `
    <a href="/${escapeHtml(c.type)}/" class="group relative flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white p-6 shadow-sm transition hover:shadow-md hover:border-ocean-200">
      <div class="mb-4 text-ocean-500 group-hover:text-ocean-600">
        ${icon}
      </div>
      <h3 class="text-lg font-semibold text-slate-900 group-hover:text-ocean-700">${escapeHtml(c.displayName)}</h3>
      <p class="mt-1 text-sm text-slate-500">Discover ${escapeHtml(c.displayName.toLowerCase())}</p>
      <div class="mt-4 flex items-center text-sm font-medium text-ocean-600">
        <span>Browse all</span>
        <svg class="ml-1 h-4 w-4 transition group-hover:translate-x-1" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M3 10a.75.75 0 01.75-.75h10.638L10.23 5.29a.75.75 0 111.04-1.08l5.5 5.25a.75.75 0 010 1.08l-5.5 5.25a.75.75 0 11-1.04-1.08l4.158-3.96H3.75A.75.75 0 013 10z" clip-rule="evenodd" />
        </svg>
      </div>
    </a>`
  }).join('')

  // Build page list HTML
  const pagesListHtml = publishedPages.map(p => `
    <a href="/${escapeHtml(p.slug)}/" class="group rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow-md">
      <h3 class="font-semibold text-slate-900 group-hover:text-ocean-600">${escapeHtml(p.title)}</h3>
      ${p.description ? `<p class="mt-1 text-sm text-slate-500">${escapeHtml(p.description)}</p>` : ''}
    </a>
  `).join('')

  return wrapInHtmlDocument(
    config.title,
    config.description || '',
    `
    <!-- Hero Section -->
    <div class="relative isolate overflow-hidden">
      <div class="mx-auto max-w-4xl text-center">
        <h1 class="text-4xl font-bold tracking-tight text-slate-900 sm:text-6xl">
          Your Complete Guide to the <span class="text-ocean-600">Italian Riviera</span>
        </h1>
        <p class="mt-6 text-lg leading-8 text-slate-600">
          ${escapeHtml(config.description || 'Discover the magic of Cinque Terre - five colorful villages perched on the rugged Italian coastline.')}
        </p>
      </div>
    </div>

    ${collections.length > 0 ? `
    <!-- Collections Grid -->
    <section class="mt-16">
      <h2 class="text-2xl font-bold text-slate-900 mb-8">Explore Cinque Terre</h2>
      <div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        ${collectionsHtml}
      </div>
    </section>
    ` : ''}

    ${publishedPages.length > 0 ? `
    <!-- Pages Section -->
    <section class="mt-16">
      <h2 class="text-2xl font-bold text-slate-900 mb-6">More Information</h2>
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        ${pagesListHtml}
      </div>
    </section>
    ` : ''}
    `,
    'https://cinqueterre.travel'
  )
}

/**
 * Generate individual page HTML
 */
function generatePageHtml(page: InternalPage, config: { title: string }): string {
  // Convert blocks to HTML
  const contentHtml = renderBlocks(page.body)

  return wrapInHtmlDocument(
    `${page.title} | ${config.title}`,
    page.description || '',
    `
    <nav class="breadcrumb">
      <a href="/">Home</a> / ${escapeHtml(page.title)}
    </nav>
    <article>
      <h1>${escapeHtml(page.title)}</h1>
      ${page.description ? `<p class="lead">${escapeHtml(page.description)}</p>` : ''}
      <div class="content">
        ${contentHtml}
      </div>
    </article>
    `,
    'https://cinqueterre.travel'
  )
}

/**
 * Render content blocks to HTML
 */
function renderBlocks(blocks: Array<Record<string, unknown>>): string {
  return blocks.map(block => {
    const type = block.type as string
    switch (type) {
      case 'paragraph':
        return `<p class="text-slate-700 leading-relaxed">${escapeHtml(String(block.markdown || block.text || ''))}</p>`

      case 'heading':
        const level = block.level || 2
        const headingClasses: Record<number, string> = {
          2: 'text-2xl font-bold text-slate-900 mt-8 mb-4',
          3: 'text-xl font-semibold text-slate-800 mt-6 mb-3',
          4: 'text-lg font-medium text-slate-700 mt-4 mb-2',
        }
        return `<h${level} class="${headingClasses[level as number] || headingClasses[2]}">${escapeHtml(String(block.text || ''))}</h${level}>`

      case 'hero':
        return renderHeroBlock(block)

      case 'image':
        return `<figure class="my-8">
          <img src="${escapeHtml(String(block.src || ''))}" alt="${escapeHtml(String(block.alt || ''))}" class="w-full rounded-xl shadow-lg">
          ${block.caption ? `<figcaption class="mt-2 text-sm text-slate-500 text-center">${escapeHtml(String(block.caption))}</figcaption>` : ''}
        </figure>`

      case 'gallery':
        return renderGalleryBlock(block)

      case 'list':
        const items = (block.items as string[]) || []
        const tag = block.ordered ? 'ol' : 'ul'
        const listClass = block.ordered ? 'list-decimal' : 'list-disc'
        return `<${tag} class="${listClass} list-inside space-y-2 text-slate-700 my-4">${items.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</${tag}>`

      case 'quote':
        return `<blockquote class="my-8 pl-6 border-l-4 border-ocean-500 italic text-slate-700">
          <p class="text-lg">${escapeHtml(String(block.text || ''))}</p>
          ${block.attribution ? `<footer class="mt-2 text-sm text-slate-500 not-italic">— ${escapeHtml(String(block.attribution))}</footer>` : ''}
        </blockquote>`

      case 'faq':
        return renderFAQBlock(block)

      case 'callout':
        return renderCalloutBlock(block)

      case 'embed':
        return renderEmbedBlock(block)

      case 'collection-embed':
        return renderCollectionEmbedBlock(block)

      default:
        return ''
    }
  }).join('\n')
}

/**
 * Render Hero block with Tailwind styling
 */
function renderHeroBlock(block: Record<string, unknown>): string {
  const title = String(block.title || '')
  const subtitle = block.subtitle ? String(block.subtitle) : null
  const backgroundImage = block.backgroundImage ? String(block.backgroundImage) : null

  if (backgroundImage) {
    return `
      <div class="relative -mx-4 sm:-mx-6 lg:-mx-8 mb-12 overflow-hidden rounded-xl">
        <div class="absolute inset-0">
          <img src="${escapeHtml(backgroundImage)}" alt="" class="h-full w-full object-cover">
          <div class="absolute inset-0 bg-gradient-to-t from-slate-900/80 via-slate-900/50 to-transparent"></div>
        </div>
        <div class="relative px-6 py-24 sm:py-32 text-center">
          <h1 class="text-4xl font-bold tracking-tight text-white sm:text-5xl">${escapeHtml(title)}</h1>
          ${subtitle ? `<p class="mt-4 text-xl text-slate-200">${escapeHtml(subtitle)}</p>` : ''}
        </div>
      </div>
    `
  }

  return `
    <div class="mb-12 text-center">
      <h1 class="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">${escapeHtml(title)}</h1>
      ${subtitle ? `<p class="mt-4 text-xl text-slate-600">${escapeHtml(subtitle)}</p>` : ''}
    </div>
  `
}

/**
 * Render Gallery block with Tailwind grid
 */
function renderGalleryBlock(block: Record<string, unknown>): string {
  const images = (block.images as Array<{ src: string; alt: string; caption?: string }>) || []
  const layout = String(block.layout || 'grid')

  if (images.length === 0) return ''

  const columns = layout === 'masonry' ? 'columns-2 md:columns-3 gap-4' : 'grid gap-4 grid-cols-2 md:grid-cols-3'

  return `
    <div class="my-8 ${columns}">
      ${images.map(img => `
        <figure class="${layout === 'masonry' ? 'break-inside-avoid mb-4' : ''}">
          <img src="${escapeHtml(img.src)}" alt="${escapeHtml(img.alt)}" class="w-full rounded-lg shadow-md hover:shadow-lg transition">
          ${img.caption ? `<figcaption class="mt-1 text-xs text-slate-500">${escapeHtml(img.caption)}</figcaption>` : ''}
        </figure>
      `).join('')}
    </div>
  `
}

/**
 * Render FAQ block with expandable sections
 */
function renderFAQBlock(block: Record<string, unknown>): string {
  const items = (block.items as Array<{ question: string; answer: string }>) || []

  if (items.length === 0) return ''

  return `
    <div class="my-8 space-y-4">
      ${items.map((item, i) => `
        <details class="group rounded-lg border border-slate-200 bg-white">
          <summary class="flex cursor-pointer items-center justify-between p-4 font-medium text-slate-900 hover:bg-slate-50">
            <span>${escapeHtml(item.question)}</span>
            <svg class="h-5 w-5 text-slate-500 transition group-open:rotate-180" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd" />
            </svg>
          </summary>
          <div class="border-t border-slate-200 p-4 text-slate-700">
            ${escapeHtml(item.answer)}
          </div>
        </details>
      `).join('')}
    </div>
  `
}

/**
 * Render Callout block with style variants
 */
function renderCalloutBlock(block: Record<string, unknown>): string {
  const style = String(block.style || 'info')
  const title = block.title ? String(block.title) : null
  const content = String(block.content || '')

  const styles: Record<string, { bg: string; border: string; icon: string; iconColor: string }> = {
    info: {
      bg: 'bg-ocean-50',
      border: 'border-ocean-200',
      iconColor: 'text-ocean-600',
      icon: `<path stroke-linecap="round" stroke-linejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />`,
    },
    warning: {
      bg: 'bg-amber-50',
      border: 'border-amber-200',
      iconColor: 'text-amber-600',
      icon: `<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />`,
    },
    success: {
      bg: 'bg-green-50',
      border: 'border-green-200',
      iconColor: 'text-green-600',
      icon: `<path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />`,
    },
    error: {
      bg: 'bg-red-50',
      border: 'border-red-200',
      iconColor: 'text-red-600',
      icon: `<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />`,
    },
  }

  const s = styles[style] || styles.info

  return `
    <div class="my-6 rounded-lg border ${s.border} ${s.bg} p-4">
      <div class="flex">
        <svg class="h-6 w-6 ${s.iconColor} flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          ${s.icon}
        </svg>
        <div class="ml-3">
          ${title ? `<h4 class="font-medium text-slate-900">${escapeHtml(title)}</h4>` : ''}
          <p class="${title ? 'mt-1 ' : ''}text-sm text-slate-700">${escapeHtml(content)}</p>
        </div>
      </div>
    </div>
  `
}

/**
 * Render Embed block (YouTube, Vimeo, Maps)
 */
function renderEmbedBlock(block: Record<string, unknown>): string {
  const provider = String(block.provider || 'custom')
  const url = String(block.url || '')
  const title = block.title ? String(block.title) : null

  let embedHtml = ''

  if (provider === 'youtube') {
    // Extract YouTube video ID
    const videoId = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&]+)/)?.[1]
    if (videoId) {
      embedHtml = `<iframe src="https://www.youtube.com/embed/${videoId}" frameborder="0" allowfullscreen class="w-full aspect-video rounded-lg"></iframe>`
    }
  } else if (provider === 'vimeo') {
    const videoId = url.match(/vimeo\.com\/(\d+)/)?.[1]
    if (videoId) {
      embedHtml = `<iframe src="https://player.vimeo.com/video/${videoId}" frameborder="0" allowfullscreen class="w-full aspect-video rounded-lg"></iframe>`
    }
  } else if (provider === 'maps') {
    embedHtml = `<iframe src="${escapeHtml(url)}" frameborder="0" class="w-full h-96 rounded-lg"></iframe>`
  } else {
    embedHtml = `<iframe src="${escapeHtml(url)}" frameborder="0" class="w-full aspect-video rounded-lg"></iframe>`
  }

  return `
    <div class="my-8">
      ${title ? `<p class="mb-2 text-sm font-medium text-slate-700">${escapeHtml(title)}</p>` : ''}
      ${embedHtml}
    </div>
  `
}

/**
 * Render Collection Embed block with Tailwind grid layout
 */
function renderCollectionEmbedBlock(block: Record<string, unknown>): string {
  const collectionType = String(block.collectionType || '')
  const displayName = block.displayName ? String(block.displayName) : collectionType
  const items = (block.items as Array<{
    slug: string
    title: string
    summary?: string
    image?: string
    date?: string
    url?: string
    data?: Record<string, unknown>
  }>) || []
  const display = (block.display as {
    layout?: string
    columns?: number
    showImage?: boolean
    showSummary?: boolean
    showDate?: boolean
    imageAspect?: string
  }) || { layout: 'grid', columns: 3 }
  const heading = block.heading ? String(block.heading) : null
  const headingLevel = (block.headingLevel as number) || 2
  const showViewAll = block.showViewAll as boolean
  const viewAllUrl = block.viewAllUrl ? String(block.viewAllUrl) : `/${collectionType}/`

  if (items.length === 0) return ''

  const layout = display.layout || 'grid'
  const columns = display.columns || 3
  const showImage = display.showImage !== false
  const showSummary = display.showSummary !== false
  const showDate = display.showDate === true
  const imageAspect = display.imageAspect || 'video'

  const aspectClasses: Record<string, string> = {
    square: 'aspect-square',
    video: 'aspect-video',
    portrait: 'aspect-[3/4]',
    landscape: 'aspect-[4/3]',
  }

  let html = ''

  // Heading
  if (heading) {
    html += `<h${headingLevel} class="text-2xl font-bold text-slate-900 mb-6">${escapeHtml(heading)}</h${headingLevel}>`
  }

  // Grid layout
  if (layout === 'grid' || layout === 'carousel') {
    const gridCols = columns === 2 ? 'lg:grid-cols-2' : columns === 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3'
    html += `<div class="grid gap-6 sm:grid-cols-2 ${gridCols}">`

    for (const item of items) {
      const itemUrl = item.url || `/${collectionType}/${item.slug}/`
      html += `
        <a href="${escapeHtml(itemUrl)}" class="group flex flex-col rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm transition hover:shadow-md hover:border-ocean-200">
          ${showImage && item.image ? `
            <div class="${aspectClasses[imageAspect]} overflow-hidden bg-slate-100">
              <img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.title)}" class="h-full w-full object-cover transition group-hover:scale-105">
            </div>
          ` : ''}
          <div class="flex-1 p-5">
            <h3 class="font-semibold text-slate-900 group-hover:text-ocean-600">${escapeHtml(item.title)}</h3>
            ${showSummary && item.summary ? `<p class="mt-2 text-sm text-slate-600 line-clamp-2">${escapeHtml(item.summary)}</p>` : ''}
            ${showDate && item.date ? `<time class="mt-3 block text-xs text-slate-500">${escapeHtml(item.date)}</time>` : ''}
          </div>
        </a>
      `
    }

    html += '</div>'
  }

  // List layout
  else if (layout === 'list') {
    html += '<div class="space-y-4">'

    for (const item of items) {
      const itemUrl = item.url || `/${collectionType}/${item.slug}/`
      html += `
        <a href="${escapeHtml(itemUrl)}" class="group flex items-center gap-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow-md hover:border-ocean-200">
          ${showImage && item.image ? `
            <div class="h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg bg-slate-100">
              <img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.title)}" class="h-full w-full object-cover">
            </div>
          ` : ''}
          <div class="flex-1 min-w-0">
            <h3 class="font-semibold text-slate-900 group-hover:text-ocean-600 truncate">${escapeHtml(item.title)}</h3>
            ${showSummary && item.summary ? `<p class="mt-1 text-sm text-slate-600 truncate">${escapeHtml(item.summary)}</p>` : ''}
          </div>
        </a>
      `
    }

    html += '</div>'
  }

  // Compact layout
  else if (layout === 'compact') {
    html += '<div class="flex flex-wrap gap-2">'

    for (const item of items) {
      const itemUrl = item.url || `/${collectionType}/${item.slug}/`
      html += `
        <a href="${escapeHtml(itemUrl)}" class="inline-flex items-center rounded-full bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-ocean-100 hover:text-ocean-700 transition">
          ${escapeHtml(item.title)}
        </a>
      `
    }

    html += '</div>'
  }

  // View All link
  if (showViewAll) {
    html += `
      <div class="mt-6 text-center">
        <a href="${escapeHtml(viewAllUrl)}" class="inline-flex items-center gap-1 text-ocean-600 font-medium hover:text-ocean-700 transition">
          View all ${escapeHtml(displayName)}
          <svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M3 10a.75.75 0 01.75-.75h10.638L10.23 5.29a.75.75 0 111.04-1.08l5.5 5.25a.75.75 0 010 1.08l-5.5 5.25a.75.75 0 11-1.04-1.08l4.158-3.96H3.75A.75.75 0 013 10z" clip-rule="evenodd" />
          </svg>
        </a>
      </div>
    `
  }

  return `<section class="my-12">${html}</section>`
}

// =============================================================================
// COLLECTION PAGE GENERATION (Direct HTML)
// =============================================================================

/**
 * Generate collection pages from GitHub content
 */
async function generateCollectionPagesFromGitHub(
  collection: InternalCollection,
  items: InternalCollectionItem[],
  buildDir: string,
  baseUrl: string,
  itemsPerPage: number,
  sitemap?: ParsedSitemap
): Promise<number> {
  let pagesGenerated = 0

  // Generate listing pages
  const listingCount = await generateListingPagesInternal(
    collection,
    items,
    buildDir,
    baseUrl,
    itemsPerPage,
    sitemap
  )
  pagesGenerated += listingCount

  // Generate detail pages
  const detailCount = await generateDetailPagesInternal(
    collection,
    items,
    buildDir,
    baseUrl,
    sitemap
  )
  pagesGenerated += detailCount

  console.log(
    `[GitHubBuild] Generated ${listingCount} listing and ${detailCount} detail pages for ${collection.collection_type}`
  )

  return pagesGenerated
}

/**
 * Generate listing pages with pagination (Direct HTML output)
 */
async function generateListingPagesInternal(
  collection: InternalCollection,
  items: InternalCollectionItem[],
  buildDir: string,
  _baseUrl: string,
  itemsPerPage: number,
  sitemap?: ParsedSitemap
): Promise<number> {
  let pagesGenerated = 0
  const totalItems = items.length
  const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage))
  const distDir = join(buildDir, 'dist')

  for (let page = 1; page <= totalPages; page++) {
    const startIndex = (page - 1) * itemsPerPage
    const endIndex = Math.min(startIndex + itemsPerPage, totalItems)
    const pageItems = items.slice(startIndex, endIndex)

    // Transform items for display
    const transformedItems = pageItems.map(item => ({
      slug: item.slug,
      title: getItemTitle(item, collection),
      summary: getItemSummary(item, collection),
      image: getItemImage(item, collection),
      date: getItemDate(item, collection),
      url: `/${collection.collection_type}/${item.slug}/`,
    }))

    // Build item cards HTML with Tailwind
    const itemsHtml = transformedItems.map(item => `
      <a href="${escapeHtml(item.url)}" class="group flex flex-col rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm transition hover:shadow-md hover:border-ocean-200">
        ${item.image ? `
          <div class="aspect-video overflow-hidden bg-slate-100">
            <img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.title)}" class="h-full w-full object-cover transition group-hover:scale-105">
          </div>
        ` : ''}
        <div class="flex-1 p-5">
          <h3 class="font-semibold text-slate-900 group-hover:text-ocean-600">${escapeHtml(item.title)}</h3>
          ${item.summary ? `<p class="mt-2 text-sm text-slate-600 line-clamp-2">${escapeHtml(item.summary)}</p>` : ''}
          ${item.date ? `<time class="mt-3 block text-xs text-slate-500">${escapeHtml(item.date)}</time>` : ''}
        </div>
      </a>
    `).join('')

    // Build pagination HTML with Tailwind
    const paginationHtml = totalPages > 1 ? `
      <nav class="mt-12 flex items-center justify-center gap-2">
        ${page > 1 ? `
          <a href="/${collection.collection_type}${page === 2 ? '/' : `/page/${page - 1}/`}"
             class="inline-flex items-center gap-1 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50">
            <svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clip-rule="evenodd" />
            </svg>
            Previous
          </a>
        ` : ''}
        <span class="px-4 py-2 text-sm text-slate-600">Page ${page} of ${totalPages}</span>
        ${page < totalPages ? `
          <a href="/${collection.collection_type}/page/${page + 1}/"
             class="inline-flex items-center gap-1 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50">
            Next
            <svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clip-rule="evenodd" />
            </svg>
          </a>
        ` : ''}
      </nav>
    ` : ''

    // Generate page HTML
    const pageTitle = page === 1
      ? collection.display_name
      : `${collection.display_name} - Page ${page}`

    const contentHtml = `
      <!-- Header -->
      <div class="mb-8">
        <h1 class="text-3xl font-bold text-slate-900">${escapeHtml(collection.display_name)}</h1>
        ${collection.description ? `<p class="mt-2 text-lg text-slate-600">${escapeHtml(collection.description)}</p>` : ''}
        <p class="mt-2 text-sm text-slate-500">${totalItems} items${totalPages > 1 ? ` • Showing ${startIndex + 1}-${endIndex}` : ''}</p>
      </div>

      <!-- Grid -->
      <div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        ${itemsHtml}
      </div>

      ${paginationHtml}
      `

    let html: string
    if (sitemap) {
      const collectionPath = `/${collection.collection_type}/`
      const nav = buildNavigationContext(sitemap, collectionPath, sitemap.site.default_language)
      // Add collection to breadcrumbs if not already present
      if (!nav.breadcrumbs.find(b => b.path === collectionPath)) {
        nav.breadcrumbs.push({
          title: collection.display_name,
          path: collectionPath,
          isLast: true,
        })
      }
      html = wrapInHtmlDocumentWithNav(
        pageTitle,
        collection.description || `Browse all ${collection.display_name.toLowerCase()}`,
        contentHtml,
        nav
      )
    } else {
      html = wrapInHtmlDocument(
        pageTitle,
        collection.description || `Browse all ${collection.display_name.toLowerCase()}`,
        `
        <!-- Breadcrumb -->
        <nav class="flex mb-6" aria-label="Breadcrumb">
          <ol class="inline-flex items-center space-x-1 text-sm text-slate-500">
            <li><a href="/" class="hover:text-ocean-600">Home</a></li>
            <li><span class="mx-2">/</span></li>
            <li class="text-slate-900 font-medium">${escapeHtml(collection.display_name)}</li>
          </ol>
        </nav>
        ${contentHtml}
        `,
        'https://cinqueterre.travel'
      )
    }

    // Write to appropriate path
    let outputPath: string
    if (page === 1) {
      outputPath = join(distDir, collection.collection_type, 'index.html')
    } else {
      outputPath = join(distDir, collection.collection_type, 'page', String(page), 'index.html')
    }
    await mkdir(dirname(outputPath), { recursive: true })
    await writeFile(outputPath, html)

    pagesGenerated++
  }

  return pagesGenerated
}

/**
 * Generate detail pages for all items (Direct HTML output)
 */
async function generateDetailPagesInternal(
  collection: InternalCollection,
  items: InternalCollectionItem[],
  buildDir: string,
  _baseUrl: string,
  sitemap?: ParsedSitemap
): Promise<number> {
  let pagesGenerated = 0
  const distDir = join(buildDir, 'dist')

  // Create data directory for raw JSON files (optional - for API-like access)
  const dataDir = join(distDir, '_data', collection.collection_type)
  await mkdir(dataDir, { recursive: true })

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (!item) continue

    // Write full item data to a separate JSON file
    const dataFilePath = join(dataDir, `${item.slug}.json`)
    await writeFile(dataFilePath, JSON.stringify(item.data, null, 2))

    // Get item display values
    const title = getItemTitle(item, collection)
    const summary = getItemSummary(item, collection)
    const image = getItemImage(item, collection)
    const displayData = extractDisplayData(item.data, collection)

    // Get navigation (prev/next items)
    const prevItem = i > 0 ? items[i - 1] : undefined
    const nextItem = i < items.length - 1 ? items[i + 1] : undefined

    // Build navigation HTML with Tailwind
    const navHtml = `
      <nav class="mt-12 pt-8 border-t border-slate-200">
        <div class="flex items-center justify-between">
          ${prevItem ? `
            <a href="/${collection.collection_type}/${prevItem.slug}/" class="group flex items-center gap-2 text-sm text-slate-600 hover:text-ocean-600">
              <svg class="h-5 w-5 transition group-hover:-translate-x-1" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clip-rule="evenodd" />
              </svg>
              <span class="max-w-[200px] truncate">${escapeHtml(getItemTitle(prevItem, collection))}</span>
            </a>
          ` : '<span></span>'}
          <a href="/${collection.collection_type}/" class="inline-flex items-center gap-1 px-4 py-2 text-sm font-medium text-ocean-600 hover:text-ocean-700">
            <svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M4.25 5.5a.75.75 0 00-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 00.75-.75v-4a.75.75 0 011.5 0v4A2.25 2.25 0 0112.75 17h-8.5A2.25 2.25 0 012 14.75v-8.5A2.25 2.25 0 014.25 4h5a.75.75 0 010 1.5h-5z" clip-rule="evenodd" />
              <path fill-rule="evenodd" d="M6.194 12.753a.75.75 0 001.06.053L16.5 4.44v2.81a.75.75 0 001.5 0v-4.5a.75.75 0 00-.75-.75h-4.5a.75.75 0 000 1.5h2.553l-9.056 8.194a.75.75 0 00-.053 1.06z" clip-rule="evenodd" />
            </svg>
            All ${escapeHtml(collection.display_name)}
          </a>
          ${nextItem ? `
            <a href="/${collection.collection_type}/${nextItem.slug}/" class="group flex items-center gap-2 text-sm text-slate-600 hover:text-ocean-600">
              <span class="max-w-[200px] truncate">${escapeHtml(getItemTitle(nextItem, collection))}</span>
              <svg class="h-5 w-5 transition group-hover:translate-x-1" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clip-rule="evenodd" />
              </svg>
            </a>
          ` : '<span></span>'}
        </div>
      </nav>
    `

    // Build display data HTML
    const dataHtml = renderDisplayData(displayData)

    // Generate page HTML with Tailwind
    const contentHtml = `
      <article class="max-w-4xl">
        ${image ? `
          <div class="mb-8 rounded-xl overflow-hidden shadow-lg">
            <img src="${escapeHtml(image)}" alt="${escapeHtml(title)}" class="w-full h-auto object-cover">
          </div>
        ` : ''}

        <!-- Header -->
        <header class="mb-8">
          <h1 class="text-3xl font-bold text-slate-900 sm:text-4xl">${escapeHtml(title)}</h1>
          ${summary ? `<p class="mt-4 text-xl text-slate-600 leading-relaxed">${escapeHtml(summary)}</p>` : ''}
        </header>

        <!-- Content -->
        <div class="prose-cinqueterre">
          ${dataHtml}
        </div>

        ${navHtml}
      </article>
      `

    let html: string
    if (sitemap) {
      const itemPath = `/${collection.collection_type}/${item.slug}/`
      const nav = buildNavigationContext(sitemap, itemPath, sitemap.site.default_language)
      // Build custom breadcrumbs for collection item
      nav.breadcrumbs = [
        { title: 'Home', path: '/', isLast: false },
        { title: collection.display_name, path: `/${collection.collection_type}/`, isLast: false },
        { title: title, path: itemPath, isLast: true },
      ]
      html = wrapInHtmlDocumentWithNav(
        `${title} | ${collection.display_name}`,
        summary || '',
        contentHtml,
        nav
      )
    } else {
      html = wrapInHtmlDocument(
        `${title} | ${collection.display_name}`,
        summary || '',
        `
        <!-- Breadcrumb -->
        <nav class="flex mb-6" aria-label="Breadcrumb">
          <ol class="inline-flex items-center space-x-1 text-sm text-slate-500">
            <li><a href="/" class="hover:text-ocean-600">Home</a></li>
            <li><span class="mx-2">/</span></li>
            <li><a href="/${collection.collection_type}/" class="hover:text-ocean-600">${escapeHtml(collection.display_name)}</a></li>
            <li><span class="mx-2">/</span></li>
            <li class="text-slate-900 font-medium truncate max-w-[200px]">${escapeHtml(title)}</li>
          </ol>
        </nav>
        ${contentHtml}
        `,
        'https://cinqueterre.travel'
      )
    }

    // Write to appropriate path
    const outputPath = join(distDir, collection.collection_type, item.slug, 'index.html')
    await mkdir(dirname(outputPath), { recursive: true })
    await writeFile(outputPath, html)

    pagesGenerated++
  }

  return pagesGenerated
}

/**
 * Render display data as HTML - recursive renderer for nested data
 */
function renderDisplayData(data: Record<string, unknown>, depth: number = 0): string {
  const entries = Object.entries(data).filter(([key, v]) => {
    // Skip metadata fields
    if (['slug', 'id', 'created_at', 'updated_at', 'published', 'featured'].includes(key)) return false
    return v !== undefined && v !== null && v !== ''
  })

  if (entries.length === 0) return ''

  // Don't go too deep to avoid infinite recursion
  if (depth > 4) {
    return `<pre class="json-data">${escapeHtml(JSON.stringify(data, null, 2))}</pre>`
  }

  return entries.map(([key, value]) => renderDataField(key, value, depth)).join('')
}

/**
 * Render a single data field - handles different types recursively with Tailwind classes
 */
function renderDataField(key: string, value: unknown, depth: number): string {
  const label = formatFieldLabel(key)
  const headingClass = depth === 0
    ? 'text-xl font-semibold text-slate-900 mt-8 mb-4'
    : depth === 1
      ? 'text-lg font-medium text-slate-800 mt-6 mb-3'
      : 'text-base font-medium text-slate-700 mt-4 mb-2'

  // Handle null/undefined
  if (value === null || value === undefined) return ''

  // Handle multilingual fields - extract English
  if (isMultilingualField(value)) {
    const langValue = (value as Record<string, unknown>).en || Object.values(value as Record<string, unknown>)[0]
    return renderDataField(key, langValue, depth)
  }

  // Handle primitives
  if (typeof value === 'string') {
    // Check if it's a long text (multiple sentences)
    if (value.length > 200 || value.includes('\n')) {
      return `<section class="mt-6">
        <h${Math.min(3 + depth, 6)} class="${headingClass}">${escapeHtml(label)}</h${Math.min(3 + depth, 6)}>
        <div class="prose prose-slate max-w-none">${formatTextContent(value)}</div>
      </section>`
    }
    return `<div class="py-2 flex flex-wrap gap-2">
      <span class="text-sm font-medium text-slate-500">${escapeHtml(label)}:</span>
      <span class="text-sm text-slate-900">${escapeHtml(value)}</span>
    </div>`
  }

  if (typeof value === 'number') {
    return `<div class="py-2 flex flex-wrap gap-2">
      <span class="text-sm font-medium text-slate-500">${escapeHtml(label)}:</span>
      <span class="text-sm text-slate-900">${value}</span>
    </div>`
  }

  if (typeof value === 'boolean') {
    return `<div class="py-2 flex flex-wrap gap-2">
      <span class="text-sm font-medium text-slate-500">${escapeHtml(label)}:</span>
      <span class="text-sm text-slate-900">${value ? 'Yes' : 'No'}</span>
    </div>`
  }

  // Handle arrays
  if (Array.isArray(value)) {
    if (value.length === 0) return ''

    // Array of primitives - render as tags or list
    if (typeof value[0] === 'string' || typeof value[0] === 'number') {
      if (value.length <= 5 && value.every(v => String(v).length < 30)) {
        return `<div class="py-2 flex flex-wrap items-center gap-2">
          <span class="text-sm font-medium text-slate-500">${escapeHtml(label)}:</span>
          <div class="flex flex-wrap gap-1.5">
            ${value.map(v => `<span class="inline-flex items-center rounded-full bg-ocean-50 px-2.5 py-0.5 text-xs font-medium text-ocean-700">${escapeHtml(String(v))}</span>`).join('')}
          </div>
        </div>`
      }
      return `<section class="mt-4">
        <h${Math.min(3 + depth, 6)} class="${headingClass}">${escapeHtml(label)}</h${Math.min(3 + depth, 6)}>
        <ul class="mt-2 space-y-1 list-disc list-inside text-sm text-slate-700">
          ${value.map(v => `<li>${escapeHtml(String(v))}</li>`).join('')}
        </ul>
      </section>`
    }

    // Array of objects - render each item as cards
    return `<section class="mt-6">
      <h${Math.min(3 + depth, 6)} class="${headingClass}">${escapeHtml(label)}</h${Math.min(3 + depth, 6)}>
      <div class="mt-4 grid gap-4 sm:grid-cols-2">
        ${value.map((item) => {
          if (typeof item !== 'object' || item === null) {
            return `<div class="text-sm text-slate-600">${escapeHtml(String(item))}</div>`
          }
          const itemTitle = getObjectTitle(item as Record<string, unknown>)
          return `<article class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            ${itemTitle ? `<h${Math.min(4 + depth, 6)} class="font-medium text-slate-900 mb-2">${escapeHtml(itemTitle)}</h${Math.min(4 + depth, 6)}>` : ''}
            ${renderDisplayData(item as Record<string, unknown>, depth + 1)}
          </article>`
        }).join('')}
      </div>
    </section>`
  }

  // Handle objects
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>

    return `<section class="${depth === 0 ? 'mt-8 pt-6 border-t border-slate-200' : 'mt-4 pl-4 border-l-2 border-slate-100'}">
      <h${Math.min(3 + depth, 6)} class="${headingClass}">${escapeHtml(label)}</h${Math.min(3 + depth, 6)}>
      ${renderDisplayData(obj, depth + 1)}
    </section>`
  }

  return ''
}

/**
 * Get a title for an object from common title fields
 */
function getObjectTitle(obj: Record<string, unknown>): string | null {
  const titleFields = ['name', 'title', 'headline', 'label', 'period_name', 'era', 'event', 'year']
  for (const field of titleFields) {
    if (obj[field] && typeof obj[field] === 'string') {
      return obj[field] as string
    }
  }
  return null
}

/**
 * Format a field key into a readable label
 */
function formatFieldLabel(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, c => c.toUpperCase())
}

/**
 * Format text content - preserves paragraphs
 */
function formatTextContent(text: string): string {
  const paragraphs = text.split(/\n\n+/)
  if (paragraphs.length > 1) {
    return paragraphs.map(p => `<p>${escapeHtml(p.trim())}</p>`).join('')
  }
  return `<p>${escapeHtml(text)}</p>`
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get item title from data using title_field
 */
function getItemTitle(item: InternalCollectionItem, collection: InternalCollection): string {
  const value = getNestedValue(item.data, collection.title_field)
  return extractStringValue(value) || 'Untitled'
}

/**
 * Get item summary from data using summary_field
 */
function getItemSummary(item: InternalCollectionItem, collection: InternalCollection): string | undefined {
  if (!collection.summary_field) return undefined
  const value = getNestedValue(item.data, collection.summary_field)
  return extractStringValue(value)
}

/**
 * Get item image from data using image_field
 */
function getItemImage(item: InternalCollectionItem, collection: InternalCollection): string | undefined {
  if (!collection.image_field) return undefined
  const value = getNestedValue(item.data, collection.image_field)
  return extractStringValue(value)
}

/**
 * Extract string value from a value that might be multilingual
 */
function extractStringValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (isMultilingualField(value)) {
    const langObj = value as Record<string, unknown>
    return (langObj.en || langObj.de || langObj.fr || langObj.it || Object.values(langObj)[0]) as string
  }
  return undefined
}

/**
 * Get item date from data using date_field
 */
function getItemDate(item: InternalCollectionItem, collection: InternalCollection): string | undefined {
  if (!collection.date_field) return undefined
  const value = getNestedValue(item.data, collection.date_field)
  if (!value) return undefined

  if (typeof value === 'string') {
    const date = new Date(value)
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0]
    }
    return value
  }

  return undefined
}

/**
 * Get nested value from object using dot notation
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const keys = path.split('.')
  let current: unknown = obj

  for (const key of keys) {
    if (current === null || current === undefined) return undefined
    if (typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[key]
  }

  return current
}

/**
 * Extract display data from item data - now passes all data for rendering
 * The renderDisplayData function handles the recursive rendering
 */
function extractDisplayData(
  data: Record<string, unknown>,
  _collection: InternalCollection
): Record<string, unknown> {
  // Return all data - let renderDisplayData handle the rendering
  // Skip only the slug field as it's shown in the URL
  const { slug, ...displayData } = data
  return displayData
}

/**
 * Check if a value is a multilingual field (has language keys like 'en', 'de', etc.)
 */
function isMultilingualField(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const keys = Object.keys(value as Record<string, unknown>)
  const langKeys = ['en', 'de', 'fr', 'it', 'es']
  return keys.some(k => langKeys.includes(k)) && keys.every(k => langKeys.includes(k) || k === 'default')
}

// =============================================================================
// NAVIGATION BUILDING FUNCTIONS
// =============================================================================

/**
 * Build navigation context from sitemap for a specific page
 */
function buildNavigationContext(
  sitemap: ParsedSitemap,
  currentPath: string,
  language: string = 'en'
): NavigationContext {
  // Find current node
  const currentNode = sitemap.pageMap.get(currentPath)

  // Build main navigation from top-level pages with in_nav: true
  const mainNav = sitemap.pages
    .filter(page => page.in_nav !== false)
    .map(page => ({
      title: getLocalizedTitle(page, language),
      path: page.path,
      isActive: currentPath === page.path || currentPath.startsWith(page.path + '/'),
    }))

  // Build breadcrumbs
  const breadcrumbs: Array<{ title: string; path: string; isLast: boolean }> = []
  if (currentNode) {
    // Add home
    breadcrumbs.push({
      title: 'Home',
      path: '/',
      isLast: false,
    })
    // Add ancestors
    for (const ancestor of currentNode.ancestors) {
      breadcrumbs.push({
        title: getLocalizedBreadcrumb(ancestor, language) || getLocalizedTitle(ancestor, language),
        path: ancestor.path,
        isLast: false,
      })
    }
    // Add current (if not home)
    if (currentPath !== '/') {
      breadcrumbs.push({
        title: getLocalizedBreadcrumb(currentNode, language) || getLocalizedTitle(currentNode, language),
        path: currentNode.path,
        isLast: true,
      })
    } else {
      // Mark home as last if it's the current page
      breadcrumbs[0].isLast = true
    }
  }

  // Build prev/next navigation
  let prevPage: { title: string; path: string } | null = null
  let nextPage: { title: string; path: string } | null = null

  if (currentNode) {
    const siblings = currentNode.siblings
    const currentIndex = siblings.findIndex(s => s.path === currentPath)

    if (currentIndex > 0) {
      const prev = siblings[currentIndex - 1]
      prevPage = {
        title: getLocalizedTitle(prev, language),
        path: prev.path,
      }
    }
    if (currentIndex < siblings.length - 1) {
      const next = siblings[currentIndex + 1]
      nextPage = {
        title: getLocalizedTitle(next, language),
        path: next.path,
      }
    }
  }

  // Build footer navigation from sitemap footer_nav
  const footerNav: Array<{ title: string; links: Array<{ title: string; path: string }> }> = []
  if (sitemap.footerNav) {
    for (const section of sitemap.footerNav) {
      footerNav.push({
        title: section.title,
        links: section.links.map(link => ({
          title: link.title,
          path: link.url,
        })),
      })
    }
  }

  return {
    site: {
      name: sitemap.site.name,
      tagline: sitemap.site.tagline,
      logo: sitemap.site.logo,
      defaultLanguage: sitemap.site.default_language,
      siteUrl: sitemap.site.base_url,
    },
    mainNav,
    breadcrumbs,
    prevPage,
    nextPage,
    footerNav,
    language,
  }
}

/**
 * Render main navigation as HTML
 */
function renderMainNav(nav: NavigationContext): string {
  const navItems = nav.mainNav.map(item => {
    const activeClass = item.isActive ? 'text-ocean-600 font-semibold' : 'text-slate-600'
    return `<a href="${item.path}" class="text-sm font-medium ${activeClass} hover:text-ocean-600">${escapeHtml(item.title)}</a>`
  }).join('\n            ')

  return navItems
}

/**
 * Render breadcrumbs as HTML
 */
function renderBreadcrumbs(nav: NavigationContext): string {
  if (nav.breadcrumbs.length <= 1) return '' // Don't show breadcrumbs for home page

  const items = nav.breadcrumbs.map((crumb, index) => {
    const separator = index > 0 ? `<span class="mx-2 text-slate-400">/</span>` : ''
    const link = crumb.isLast
      ? `<span class="text-slate-900">${escapeHtml(crumb.title)}</span>`
      : `<a href="${crumb.path}" class="text-ocean-600 hover:text-ocean-700">${escapeHtml(crumb.title)}</a>`
    return `${separator}${link}`
  }).join('')

  return `
    <nav class="text-sm mb-6" aria-label="Breadcrumb">
      <div class="flex items-center">
        ${items}
      </div>
    </nav>`
}

/**
 * Render prev/next navigation as HTML
 */
function renderPrevNextNav(nav: NavigationContext): string {
  if (!nav.prevPage && !nav.nextPage) return ''

  const prevLink = nav.prevPage
    ? `<a href="${nav.prevPage.path}" class="flex items-center gap-2 text-ocean-600 hover:text-ocean-700">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/>
        </svg>
        <span>${escapeHtml(nav.prevPage.title)}</span>
      </a>`
    : '<span></span>'

  const nextLink = nav.nextPage
    ? `<a href="${nav.nextPage.path}" class="flex items-center gap-2 text-ocean-600 hover:text-ocean-700">
        <span>${escapeHtml(nav.nextPage.title)}</span>
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
        </svg>
      </a>`
    : '<span></span>'

  return `
    <nav class="flex justify-between items-center mt-12 pt-6 border-t border-slate-200">
      ${prevLink}
      ${nextLink}
    </nav>`
}

/**
 * Render footer navigation as HTML
 */
function renderFooterNav(nav: NavigationContext): string {
  if (nav.footerNav.length === 0) {
    // Default footer if no footer_nav in sitemap
    return `
          <div>
            <h3 class="text-sm font-semibold text-slate-900">About</h3>
            <ul class="mt-4 space-y-2 text-sm text-slate-600">
              <li><a href="/" class="hover:text-ocean-600">Home</a></li>
            </ul>
          </div>`
  }

  return nav.footerNav.map(section => `
          <div>
            <h3 class="text-sm font-semibold text-slate-900">${escapeHtml(section.title)}</h3>
            <ul class="mt-4 space-y-2 text-sm text-slate-600">
              ${section.links.map(link =>
                `<li><a href="${link.path}" class="hover:text-ocean-600">${escapeHtml(link.title)}</a></li>`
              ).join('\n              ')}
            </ul>
          </div>`
  ).join('\n')
}

// =============================================================================
// HTML DOCUMENT WRAPPER
// =============================================================================

/**
 * Wrap content in a complete HTML document with sitemap-driven navigation
 */
function wrapInHtmlDocumentWithNav(
  title: string,
  description: string,
  content: string,
  nav: NavigationContext
): string {
  const breadcrumbsHtml = renderBreadcrumbs(nav)
  const mainNavHtml = renderMainNav(nav)
  const footerNavHtml = renderFooterNav(nav)
  const prevNextHtml = renderPrevNextNav(nav)

  return `<!DOCTYPE html>
<html lang="${nav.language}" class="h-full">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(String(title))} | ${escapeHtml(nav.site.name)}</title>
  <meta name="description" content="${escapeHtml(String(description))}">
  <meta property="og:title" content="${escapeHtml(String(title))}">
  <meta property="og:description" content="${escapeHtml(String(description))}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${nav.site.siteUrl}">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="canonical" href="${nav.site.siteUrl}">
  <script src="https://cdn.tailwindcss.com?plugins=typography"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            ocean: {
              50: '#f0fdfa', 100: '#ccfbf1', 200: '#99f6e4', 300: '#5eead4',
              400: '#2dd4bf', 500: '#14b8a6', 600: '#0d9488', 700: '#0f766e',
              800: '#115e59', 900: '#134e4a',
            },
            terracotta: {
              50: '#fdf4f3', 100: '#fce7e4', 200: '#fbd3cd', 300: '#f7b4a8',
              400: '#f08a76', 500: '#e4664c', 600: '#d14a2e', 700: '#af3b23',
              800: '#913421', 900: '#793121',
            },
          }
        }
      }
    }
  </script>
  <style type="text/tailwindcss">
    @layer utilities {
      .prose-cinqueterre { @apply prose prose-slate max-w-none prose-headings:text-slate-900 prose-a:text-ocean-600 hover:prose-a:text-ocean-700; }
    }
  </style>
</head>
<body class="h-full bg-white">
  <div class="min-h-full flex flex-col">
    <!-- Navigation -->
    <nav class="bg-white border-b border-slate-200">
      <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div class="flex h-16 items-center justify-between">
          <a href="/" class="flex items-center gap-2 font-semibold text-slate-900 hover:text-ocean-600">
            ${nav.site.logo
              ? `<img src="${nav.site.logo}" alt="${escapeHtml(nav.site.name)}" class="h-8 w-8">`
              : `<svg class="h-8 w-8 text-ocean-500" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
            </svg>`}
            <span>${escapeHtml(nav.site.name)}</span>
          </a>
          <div class="flex items-center gap-4">
            ${mainNavHtml}
          </div>
        </div>
      </div>
    </nav>

    <!-- Main Content -->
    <main class="flex-1">
      <div class="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
${breadcrumbsHtml}
${content}
${prevNextHtml}
      </div>
    </main>

    <!-- Footer -->
    <footer class="bg-slate-50 border-t border-slate-200">
      <div class="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-8">
${footerNavHtml}
        </div>
        <div class="mt-8 pt-8 border-t border-slate-200 text-center text-sm text-slate-500">
          <p>Powered by swarm.press - Autonomous Publishing Platform</p>
          <p class="mt-1">Built on ${new Date().toISOString().split('T')[0]}</p>
        </div>
      </div>
    </footer>
  </div>
</body>
</html>`
}

/**
 * Wrap content in a complete HTML document with Tailwind CSS
 * @deprecated Use wrapInHtmlDocumentWithNav for sitemap-driven navigation
 */
function wrapInHtmlDocument(title: string, description: string, content: string, siteUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en" class="h-full">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(String(title))}</title>
  <meta name="description" content="${escapeHtml(String(description))}">
  <meta property="og:title" content="${escapeHtml(String(title))}">
  <meta property="og:description" content="${escapeHtml(String(description))}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${siteUrl}">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="canonical" href="${siteUrl}">
  <script src="https://cdn.tailwindcss.com?plugins=typography"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            ocean: {
              50: '#f0fdfa', 100: '#ccfbf1', 200: '#99f6e4', 300: '#5eead4',
              400: '#2dd4bf', 500: '#14b8a6', 600: '#0d9488', 700: '#0f766e',
              800: '#115e59', 900: '#134e4a',
            },
            terracotta: {
              50: '#fdf4f3', 100: '#fce7e4', 200: '#fbd3cd', 300: '#f7b4a8',
              400: '#f08a76', 500: '#e4664c', 600: '#d14a2e', 700: '#af3b23',
              800: '#913421', 900: '#793121',
            },
          }
        }
      }
    }
  </script>
  <style type="text/tailwindcss">
    @layer utilities {
      .prose-cinqueterre { @apply prose prose-slate max-w-none prose-headings:text-slate-900 prose-a:text-ocean-600 hover:prose-a:text-ocean-700; }
    }
  </style>
</head>
<body class="h-full bg-white">
  <div class="min-h-full flex flex-col">
    <!-- Navigation -->
    <nav class="bg-white border-b border-slate-200">
      <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div class="flex h-16 items-center justify-between">
          <a href="/" class="flex items-center gap-2 font-semibold text-slate-900 hover:text-ocean-600">
            <svg class="h-8 w-8 text-ocean-500" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
            </svg>
            <span>Cinqueterre.travel</span>
          </a>
          <div class="flex items-center gap-4">
            <a href="/villages/" class="text-sm font-medium text-slate-600 hover:text-ocean-600">Villages</a>
            <a href="/restaurants/" class="text-sm font-medium text-slate-600 hover:text-ocean-600">Dining</a>
            <a href="/hikes/" class="text-sm font-medium text-slate-600 hover:text-ocean-600">Hiking</a>
            <a href="/accommodations/" class="text-sm font-medium text-slate-600 hover:text-ocean-600">Stay</a>
          </div>
        </div>
      </div>
    </nav>

    <!-- Main Content -->
    <main class="flex-1">
      <div class="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
${content}
      </div>
    </main>

    <!-- Footer -->
    <footer class="bg-slate-50 border-t border-slate-200">
      <div class="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-8">
          <div>
            <h3 class="text-sm font-semibold text-slate-900">Explore</h3>
            <ul class="mt-4 space-y-2 text-sm text-slate-600">
              <li><a href="/villages/" class="hover:text-ocean-600">Villages</a></li>
              <li><a href="/hikes/" class="hover:text-ocean-600">Hiking Trails</a></li>
              <li><a href="/pois/" class="hover:text-ocean-600">Points of Interest</a></li>
            </ul>
          </div>
          <div>
            <h3 class="text-sm font-semibold text-slate-900">Dining & Stay</h3>
            <ul class="mt-4 space-y-2 text-sm text-slate-600">
              <li><a href="/restaurants/" class="hover:text-ocean-600">Restaurants</a></li>
              <li><a href="/accommodations/" class="hover:text-ocean-600">Hotels & B&Bs</a></li>
            </ul>
          </div>
          <div>
            <h3 class="text-sm font-semibold text-slate-900">Plan Your Trip</h3>
            <ul class="mt-4 space-y-2 text-sm text-slate-600">
              <li><a href="/transportation/" class="hover:text-ocean-600">Getting There</a></li>
              <li><a href="/weather/" class="hover:text-ocean-600">Weather</a></li>
              <li><a href="/events/" class="hover:text-ocean-600">Events</a></li>
            </ul>
          </div>
          <div>
            <h3 class="text-sm font-semibold text-slate-900">About</h3>
            <ul class="mt-4 space-y-2 text-sm text-slate-600">
              <li><a href="/region/" class="hover:text-ocean-600">Cinque Terre Region</a></li>
            </ul>
          </div>
        </div>
        <div class="mt-8 pt-8 border-t border-slate-200 text-center text-sm text-slate-500">
          <p>Powered by swarm.press - Autonomous Publishing Platform</p>
          <p class="mt-1">Built on ${new Date().toISOString().split('T')[0]}</p>
        </div>
      </div>
    </footer>
  </div>
</body>
</html>`
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

/**
 * Clean build directory
 */
export async function cleanGitHubBuildDir(owner: string, repo: string): Promise<void> {
  const buildDir = join(process.cwd(), 'build', `${owner}-${repo}`)
  await rm(buildDir, { recursive: true, force: true })
  console.log(`[GitHubBuild] Cleaned build directory: ${buildDir}`)
}
