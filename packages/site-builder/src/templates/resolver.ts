/**
 * Template Resolver for Collections
 * Resolves collection templates, checking for custom templates before falling back to defaults
 */

import { access } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { TemplateResolution, CollectionTemplates } from '../types/collection-types'

// =============================================================================
// CONFIGURATION
// =============================================================================

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url)
const __dirnameESM = dirname(__filename)

/**
 * Base paths for template resolution
 */
const TEMPLATES_DIR = join(__dirnameESM, '..', 'templates', 'collections')
const DEFAULT_TEMPLATE_DIR = '_default'

// =============================================================================
// TEMPLATE RESOLUTION
// =============================================================================

/**
 * Check if a file exists at the given path
 */
async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/**
 * Resolve a single template file
 * Checks for custom template first, then falls back to default
 */
export async function resolveTemplate(
  collectionType: string,
  templateName: 'listing' | 'detail' | 'card',
  customTemplatesDir?: string
): Promise<TemplateResolution> {
  const baseDir = customTemplatesDir || TEMPLATES_DIR
  const fileName = `${templateName}.astro`

  // Check for custom template: templates/collections/[type]/[template].astro
  const customPath = join(baseDir, collectionType, fileName)
  if (await fileExists(customPath)) {
    return {
      templatePath: customPath,
      templateType: 'custom',
      exists: true,
    }
  }

  // Fall back to default: templates/collections/_default/[template].astro
  const defaultPath = join(baseDir, DEFAULT_TEMPLATE_DIR, fileName)
  if (await fileExists(defaultPath)) {
    return {
      templatePath: defaultPath,
      templateType: 'default',
      exists: true,
    }
  }

  // No template found
  return {
    templatePath: defaultPath,
    templateType: 'default',
    exists: false,
  }
}

/**
 * Resolve all templates for a collection type
 */
export async function resolveCollectionTemplates(
  collectionType: string,
  customTemplatesDir?: string
): Promise<CollectionTemplates> {
  const [listing, detail, card] = await Promise.all([
    resolveTemplate(collectionType, 'listing', customTemplatesDir),
    resolveTemplate(collectionType, 'detail', customTemplatesDir),
    resolveTemplate(collectionType, 'card', customTemplatesDir),
  ])

  return {
    listing,
    detail,
    card: card.exists ? card : undefined,
  }
}

/**
 * Get template content paths for build
 * Returns paths relative to site-builder package
 */
export function getTemplateSourcePaths(siteBuilderDir: string): {
  templatesDir: string
  componentsDir: string
  layoutsDir: string
} {
  return {
    templatesDir: join(siteBuilderDir, 'src', 'templates', 'collections'),
    componentsDir: join(siteBuilderDir, 'src', 'components', 'collections'),
    layoutsDir: join(siteBuilderDir, 'src', 'layouts'),
  }
}

// =============================================================================
// TEMPLATE GENERATION (for programmatic page generation)
// =============================================================================

/**
 * Generate a listing page Astro file content
 */
export function generateListingPageContent(options: {
  collectionType: string
  displayName: string
  singularName?: string
  description?: string
  page: number
  totalPages: number
  itemsJson: string
  paginationJson: string
}): string {
  return `---
import CollectionLayout from '../../layouts/CollectionLayout.astro'
import CollectionGrid from '../../components/collections/CollectionGrid.astro'
import CollectionPagination from '../../components/collections/CollectionPagination.astro'

const collection = {
  type: '${options.collectionType}',
  displayName: '${options.displayName}',
  singularName: '${options.singularName || options.displayName}',
  description: '${options.description || ''}',
}

const items = ${options.itemsJson}
const pagination = ${options.paginationJson}
---

<CollectionLayout
  title={collection.displayName}
  description={collection.description}
  collectionType={collection.type}
>
  <header class="collection-header">
    <h1>{collection.displayName}</h1>
    {collection.description && <p class="collection-description">{collection.description}</p>}
  </header>

  <CollectionGrid items={items} collectionType={collection.type} />

  {pagination.totalPages > 1 && (
    <CollectionPagination
      currentPage={pagination.currentPage}
      totalPages={pagination.totalPages}
      baseUrl={'/${options.collectionType}'}
    />
  )}
</CollectionLayout>

<style>
  .collection-header {
    margin-bottom: 2rem;
    text-align: center;
  }

  .collection-header h1 {
    margin-bottom: 0.5rem;
  }

  .collection-description {
    color: var(--color-text-light);
    font-size: 1.125rem;
  }
</style>
`
}

/**
 * Generate a detail page Astro file content
 */
export function generateDetailPageContent(options: {
  collectionType: string
  displayName: string
  singularName?: string
  itemJson: string
  navigationJson: string
  relatedItemsJson: string
}): string {
  return `---
import CollectionLayout from '../../layouts/CollectionLayout.astro'
import CollectionCard from '../../components/collections/CollectionCard.astro'

const collection = {
  type: '${options.collectionType}',
  displayName: '${options.displayName}',
  singularName: '${options.singularName || options.displayName}',
}

const item = ${options.itemJson}
const navigation = ${options.navigationJson}
const relatedItems = ${options.relatedItemsJson}
---

<CollectionLayout
  title={item.title}
  description={item.summary || ''}
  collectionType={collection.type}
  image={item.image}
>
  <article class="collection-detail">
    {item.image && (
      <div class="detail-image">
        <img src={item.image} alt={item.title} />
      </div>
    )}

    <header class="detail-header">
      <h1>{item.title}</h1>
      {item.date && <time datetime={item.date}>{item.date}</time>}
      {item.summary && <p class="detail-summary">{item.summary}</p>}
    </header>

    <div class="detail-content">
      {/* Render additional fields from item.data here */}
      <pre>{JSON.stringify(item.data, null, 2)}</pre>
    </div>

    <nav class="detail-navigation">
      <a href="/${options.collectionType}" class="back-link">
        &larr; All {collection.displayName}
      </a>
      <div class="prev-next">
        {navigation.prevItem && (
          <a href={navigation.prevItem.url} class="prev-link">
            &larr; {navigation.prevItem.title}
          </a>
        )}
        {navigation.nextItem && (
          <a href={navigation.nextItem.url} class="next-link">
            {navigation.nextItem.title} &rarr;
          </a>
        )}
      </div>
    </nav>
  </article>

  {relatedItems.length > 0 && (
    <aside class="related-items">
      <h2>Related {collection.displayName}</h2>
      <div class="related-grid">
        {relatedItems.map((related) => (
          <CollectionCard item={related} collectionType={collection.type} />
        ))}
      </div>
    </aside>
  )}
</CollectionLayout>

<style>
  .collection-detail {
    max-width: 800px;
    margin: 0 auto;
  }

  .detail-image {
    margin-bottom: 2rem;
    border-radius: 8px;
    overflow: hidden;
  }

  .detail-image img {
    width: 100%;
    height: auto;
  }

  .detail-header {
    margin-bottom: 2rem;
  }

  .detail-header h1 {
    margin-bottom: 0.5rem;
  }

  .detail-header time {
    color: var(--color-text-light);
    font-size: 0.875rem;
  }

  .detail-summary {
    margin-top: 1rem;
    font-size: 1.25rem;
    color: var(--color-text-light);
    line-height: 1.6;
  }

  .detail-content {
    margin-bottom: 3rem;
  }

  .detail-navigation {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-top: 2rem;
    border-top: 1px solid var(--color-border);
    margin-bottom: 3rem;
  }

  .prev-next {
    display: flex;
    gap: 2rem;
  }

  .related-items {
    border-top: 1px solid var(--color-border);
    padding-top: 3rem;
  }

  .related-items h2 {
    margin-bottom: 1.5rem;
  }

  .related-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
    gap: 1.5rem;
  }
</style>
`
}

/**
 * Get the path where a collection page should be generated
 */
export function getCollectionPagePath(
  buildDir: string,
  collectionType: string,
  slug?: string,
  page?: number
): string {
  const pagesDir = join(buildDir, 'src', 'pages', collectionType)

  if (slug) {
    // Detail page: /[collection]/[slug].astro
    return join(pagesDir, `${slug}.astro`)
  }

  if (page && page > 1) {
    // Paginated listing: /[collection]/page/[num].astro
    return join(pagesDir, 'page', `${page}.astro`)
  }

  // First listing page: /[collection]/index.astro
  return join(pagesDir, 'index.astro')
}
