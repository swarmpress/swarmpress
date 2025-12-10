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
  generatePaginationUrls,
  getCollectionListingUrl,
  getCollectionDetailUrl,
} from '../types/collection-types'
import {
  generateListingPageContent,
  generateDetailPageContent,
  getCollectionPagePath,
} from '../templates/resolver'

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

    // Fetch all pages from GitHub
    const pageFiles = await contentService.listPages()
    console.log(`[GitHubBuild] Found ${pageFiles.length} pages`)

    // Fetch all collections with items
    const collections = await contentService.getAllCollections()
    console.log(`[GitHubBuild] Found ${collections.size} collections`)

    // Create build directory
    const buildDir = options.outputDir || join(process.cwd(), 'build', `${options.github.owner}-${options.github.repo}`)
    await mkdir(buildDir, { recursive: true })

    // Generate Astro pages from GitHub content
    const pages = pageFiles.map(pf => convertPageFile(pf.content))
    await generatePages(config, pages, buildDir)

    // Generate collection pages
    let collectionsGenerated = 0
    const siteUrl = options.siteUrl || config.domain || 'https://example.com'

    for (const [collectionType, { schema, items }] of collections) {
      const collection = convertCollectionSchema(collectionType, schema)
      const collectionItems = items.filter(i => i.published).map(convertCollectionItem)

      if (collectionItems.length > 0) {
        const count = await generateCollectionPagesFromGitHub(
          collection,
          collectionItems,
          buildDir,
          '',
          options.itemsPerPage || 12
        )
        collectionsGenerated += count
      }
    }

    // Run Astro build
    await runAstroBuild(buildDir, siteUrl)

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
// PAGE GENERATION
// =============================================================================

/**
 * Generate Astro page files from pages
 */
async function generatePages(
  config: { title: string; description?: string },
  pages: InternalPage[],
  buildDir: string
): Promise<void> {
  const pagesDir = join(buildDir, 'src', 'pages')
  await mkdir(pagesDir, { recursive: true })

  // Generate index page
  const indexContent = generateIndexPageContent(config, pages)
  await writeFile(join(pagesDir, 'index.astro'), indexContent)

  // Generate individual pages
  for (const page of pages) {
    const pageContent = generatePageContent(page)
    await writeFile(join(pagesDir, `${page.slug}.astro`), pageContent)
  }

  console.log(`[GitHubBuild] Generated ${pages.length + 1} pages`)
}

/**
 * Generate index page content
 */
function generateIndexPageContent(
  config: { title: string; description?: string },
  pages: InternalPage[]
): string {
  const publishedPages = pages.filter(p => p.status === 'published')

  return `---
import BaseLayout from '../layouts/BaseLayout.astro'

const title = '${config.title.replace(/'/g, "\\'")}'
const description = '${(config.description || '').replace(/'/g, "\\'")}'
const contentItems = ${JSON.stringify(publishedPages.map(p => ({
  id: p.id,
  title: p.title,
  slug: p.slug,
  description: p.description,
})))}
---

<BaseLayout title={title} description={description}>
  <h1>{title}</h1>
  ${config.description ? `<p class="site-description">${config.description}</p>` : ''}

  <div class="content-list">
    {contentItems.map((item) => (
      <article class="content-item">
        <h2>
          <a href={\`/\${item.slug}\`}>{item.title}</a>
        </h2>
        {item.description && <p>{item.description}</p>}
      </article>
    ))}
  </div>
</BaseLayout>

<style>
  .site-description {
    font-size: 1.25rem;
    color: var(--color-text-light);
    margin-bottom: 3rem;
  }

  .content-list {
    display: grid;
    gap: 2rem;
  }

  .content-item {
    padding: 1.5rem;
    border: 1px solid var(--color-border);
    border-radius: 8px;
    transition: box-shadow 0.2s;
  }

  .content-item:hover {
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  }

  .content-item h2 {
    margin-top: 0;
    margin-bottom: 0.5rem;
  }

  .content-item a {
    color: var(--color-text);
  }

  .content-item p {
    color: var(--color-text-light);
    margin: 0;
  }
</style>
`
}

/**
 * Generate individual page content
 */
function generatePageContent(page: InternalPage): string {
  return `---
import BaseLayout from '../layouts/BaseLayout.astro'
import ContentRenderer from '../components/ContentRenderer.astro'

const title = '${page.title.replace(/'/g, "\\'")}'
const description = '${(page.description || '').replace(/'/g, "\\'")}'
const blocks = ${JSON.stringify(page.body, null, 2)}
---

<BaseLayout title={title} description={description}>
  <article class="content-page">
    <header class="content-header">
      <h1>{title}</h1>
      ${page.description ? `<p class="content-brief">{description}</p>` : ''}
    </header>

    <ContentRenderer blocks={blocks} />
  </article>

  <nav class="content-nav">
    <a href="/">← Back to Home</a>
  </nav>
</BaseLayout>

<style>
  .content-page {
    max-width: 800px;
    margin: 0 auto;
  }

  .content-header {
    margin-bottom: 3rem;
    padding-bottom: 2rem;
    border-bottom: 2px solid var(--color-border);
  }

  .content-header h1 {
    margin-bottom: 1rem;
  }

  .content-brief {
    font-size: 1.25rem;
    color: var(--color-text-light);
    line-height: 1.6;
  }

  .content-nav {
    margin-top: 4rem;
    padding-top: 2rem;
    border-top: 1px solid var(--color-border);
  }

  .content-nav a {
    color: var(--color-primary);
    text-decoration: none;
    font-weight: 600;
  }

  .content-nav a:hover {
    text-decoration: underline;
  }
</style>
`
}

// =============================================================================
// COLLECTION PAGE GENERATION
// =============================================================================

/**
 * Generate collection pages from GitHub content
 */
async function generateCollectionPagesFromGitHub(
  collection: InternalCollection,
  items: InternalCollectionItem[],
  buildDir: string,
  baseUrl: string,
  itemsPerPage: number
): Promise<number> {
  let pagesGenerated = 0

  // Generate listing pages
  const listingCount = await generateListingPagesInternal(
    collection,
    items,
    buildDir,
    baseUrl,
    itemsPerPage
  )
  pagesGenerated += listingCount

  // Generate detail pages
  const detailCount = await generateDetailPagesInternal(
    collection,
    items,
    buildDir,
    baseUrl
  )
  pagesGenerated += detailCount

  console.log(
    `[GitHubBuild] Generated ${listingCount} listing and ${detailCount} detail pages for ${collection.collection_type}`
  )

  return pagesGenerated
}

/**
 * Generate listing pages with pagination
 */
async function generateListingPagesInternal(
  collection: InternalCollection,
  items: InternalCollectionItem[],
  buildDir: string,
  baseUrl: string,
  itemsPerPage: number
): Promise<number> {
  let pagesGenerated = 0
  const totalItems = items.length
  const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage))

  for (let page = 1; page <= totalPages; page++) {
    const startIndex = (page - 1) * itemsPerPage
    const endIndex = Math.min(startIndex + itemsPerPage, totalItems)
    const pageItems = items.slice(startIndex, endIndex)

    // Transform items for template
    const transformedItems = pageItems.map(item => ({
      id: item.id,
      slug: item.slug,
      title: getItemTitle(item, collection),
      summary: getItemSummary(item, collection),
      image: getItemImage(item, collection),
      date: getItemDate(item, collection),
      url: `${baseUrl}/${collection.collection_type}/${item.slug}`,
      data: item.data,
      featured: item.featured,
    }))

    // Generate pagination info
    const paginationUrls = generatePaginationUrls(collection.collection_type, page, totalPages)

    const pagination = {
      currentPage: page,
      totalPages,
      totalItems,
      itemsPerPage,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
      nextPageUrl: paginationUrls.nextUrl,
      prevPageUrl: paginationUrls.prevUrl,
    }

    // Generate page content
    const pageContent = generateListingPageContent({
      collectionType: collection.collection_type,
      displayName: collection.display_name,
      singularName: collection.singular_name,
      description: collection.description,
      page,
      totalPages,
      itemsJson: JSON.stringify(transformedItems, null, 2),
      paginationJson: JSON.stringify(pagination, null, 2),
    })

    // Write page file
    const pagePath = getCollectionPagePath(buildDir, collection.collection_type, undefined, page)
    await mkdir(dirname(pagePath), { recursive: true })
    await writeFile(pagePath, pageContent)

    pagesGenerated++
  }

  return pagesGenerated
}

/**
 * Generate detail pages for all items
 */
async function generateDetailPagesInternal(
  collection: InternalCollection,
  items: InternalCollectionItem[],
  buildDir: string,
  _baseUrl: string
): Promise<number> {
  let pagesGenerated = 0

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (!item) continue

    // Transform item for template
    const transformedItem = {
      id: item.id,
      slug: item.slug,
      title: getItemTitle(item, collection),
      summary: getItemSummary(item, collection),
      image: getItemImage(item, collection),
      date: getItemDate(item, collection),
      data: item.data,
      featured: item.featured,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
    }

    // Get navigation (prev/next items)
    const prevItem = i > 0 ? items[i - 1] : undefined
    const nextItem = i < items.length - 1 ? items[i + 1] : undefined

    const navigation = {
      prevItem: prevItem
        ? {
            slug: prevItem.slug,
            title: getItemTitle(prevItem, collection),
            url: getCollectionDetailUrl(collection.collection_type, prevItem.slug),
          }
        : undefined,
      nextItem: nextItem
        ? {
            slug: nextItem.slug,
            title: getItemTitle(nextItem, collection),
            url: getCollectionDetailUrl(collection.collection_type, nextItem.slug),
          }
        : undefined,
      listingUrl: getCollectionListingUrl(collection.collection_type),
    }

    // Get related items
    const relatedItems = items
      .filter(r => r.id !== item.id)
      .slice(0, 4)
      .map(r => ({
        slug: r.slug,
        title: getItemTitle(r, collection),
        summary: getItemSummary(r, collection),
        image: getItemImage(r, collection),
        url: getCollectionDetailUrl(collection.collection_type, r.slug),
      }))

    // Generate page content
    const pageContent = generateDetailPageContent({
      collectionType: collection.collection_type,
      displayName: collection.display_name,
      singularName: collection.singular_name,
      itemJson: JSON.stringify(transformedItem, null, 2),
      navigationJson: JSON.stringify(navigation, null, 2),
      relatedItemsJson: JSON.stringify(relatedItems, null, 2),
    })

    // Write page file
    const pagePath = getCollectionPagePath(buildDir, collection.collection_type, item.slug)
    await mkdir(dirname(pagePath), { recursive: true })
    await writeFile(pagePath, pageContent)

    pagesGenerated++
  }

  return pagesGenerated
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get item title from data using title_field
 */
function getItemTitle(item: InternalCollectionItem, collection: InternalCollection): string {
  const value = getNestedValue(item.data, collection.title_field)
  return typeof value === 'string' ? value : 'Untitled'
}

/**
 * Get item summary from data using summary_field
 */
function getItemSummary(item: InternalCollectionItem, collection: InternalCollection): string | undefined {
  if (!collection.summary_field) return undefined
  const value = getNestedValue(item.data, collection.summary_field)
  return typeof value === 'string' ? value : undefined
}

/**
 * Get item image from data using image_field
 */
function getItemImage(item: InternalCollectionItem, collection: InternalCollection): string | undefined {
  if (!collection.image_field) return undefined
  const value = getNestedValue(item.data, collection.image_field)
  return typeof value === 'string' ? value : undefined
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

// =============================================================================
// ASTRO BUILD
// =============================================================================

/**
 * Run Astro build command
 */
async function runAstroBuild(buildDir: string, siteUrl: string): Promise<void> {
  console.log(`[GitHubBuild] Running Astro build in ${buildDir}`)

  // Copy Astro config and source files from site-builder
  const siteBuilderDir = join(process.cwd(), 'packages', 'site-builder')

  // Copy astro.config.mjs
  await execAsync(`cp ${join(siteBuilderDir, 'astro.config.mjs')} ${buildDir}/`)

  // Copy layouts and components
  await execAsync(`cp -r ${join(siteBuilderDir, 'src', 'layouts')} ${join(buildDir, 'src')}/`)
  await execAsync(`cp -r ${join(siteBuilderDir, 'src', 'components')} ${join(buildDir, 'src')}/`)

  // Create package.json for build
  const packageJson = {
    name: 'github-site-build',
    version: '1.0.0',
    private: true,
    type: 'module',
    scripts: {
      build: `astro build --site ${siteUrl}`,
    },
    dependencies: {
      astro: '^4.3.0',
      '@astrojs/node': '^8.2.0',
      sharp: '^0.33.0',
    },
  }

  await writeFile(join(buildDir, 'package.json'), JSON.stringify(packageJson, null, 2))

  // Install dependencies and build
  await execAsync('pnpm install', { cwd: buildDir })
  await execAsync('pnpm build', { cwd: buildDir })

  console.log(`[GitHubBuild] Astro build complete`)
}

/**
 * Clean build directory
 */
export async function cleanGitHubBuildDir(owner: string, repo: string): Promise<void> {
  const buildDir = join(process.cwd(), 'build', `${owner}-${repo}`)
  await rm(buildDir, { recursive: true, force: true })
  console.log(`[GitHubBuild] Cleaned build directory: ${buildDir}`)
}
