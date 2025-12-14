/**
 * Template Resolver
 *
 * Resolves template pages for collection instances.
 * Handles the Template + Override pattern:
 * - Template defines structure (shared across all instances)
 * - Content is per-instance, per-locale
 * - Overrides allow skipping pages, adding custom pages, or customizing prompts
 */

import type {
  ContentType,
  InstanceOverride,
  LocalizedString,
  InlinePrompt,
  SiteAIHints,
  SiteDefinition,
  SitemapNode,
} from '../types/site-definition'
import type { PageSection } from '../types/page-section'
import {
  getInstanceOverride,
  isPageSkipped,
  getPageOverride,
  getLocalizedValue,
} from '../types/site-definition'

// ============================================================================
// Types
// ============================================================================

/**
 * A resolved page for a specific instance
 * Combines template definition with any instance-specific overrides
 */
export interface ResolvedPage {
  slug: string
  pageType: string
  title: LocalizedString
  required: boolean
  sections?: PageSection[]
  prompts?: InlinePrompt
  ai_hints?: SiteAIHints
  collectionBinding?: {
    collection: string
    filter?: Record<string, unknown>
    limit?: number
    sort?: { field: string; direction: 'asc' | 'desc' }
  }
  isFromTemplate: boolean // true = from template, false = instance-specific addition
  isOverridden: boolean // true = has instance-specific overrides
}

/**
 * URL for a generated page
 */
export interface PageUrl {
  path: string
  page: ResolvedPage
  instanceId: string
  instanceSlug: string
  locale: string
}

/**
 * Collection instance (minimal interface for resolver)
 */
export interface CollectionInstance {
  id: string
  slug: string
  name?: LocalizedString
  [key: string]: unknown
}

// ============================================================================
// Page Resolution
// ============================================================================

/**
 * Resolve all pages for a specific collection instance
 * Applies template structure with any instance-specific overrides
 */
export function resolveInstancePages(
  contentType: ContentType,
  _instanceId: string, // Used for logging/debugging context
  override?: InstanceOverride
): ResolvedPage[] {
  const templatePages = contentType.pageStructure?.pages || []
  const resolvedPages: ResolvedPage[] = []

  // Add template pages (except skipped ones)
  for (const templatePage of templatePages) {
    if (isPageSkipped(override, templatePage.slug)) {
      continue
    }

    const pageOverride = getPageOverride(override, templatePage.slug)
    const isOverridden = !!pageOverride

    resolvedPages.push({
      slug: templatePage.slug,
      pageType: templatePage.pageType,
      title: templatePage.title,
      required: templatePage.required ?? true,
      sections: pageOverride?.sections || templatePage.sections,
      prompts: pageOverride?.prompts || templatePage.prompts,
      ai_hints: pageOverride?.ai_hints || templatePage.ai_hints,
      collectionBinding: templatePage.collectionBinding
        ? {
            collection: templatePage.collectionBinding.collection,
            filter: templatePage.collectionBinding.filter,
            limit: templatePage.collectionBinding.limit,
            sort: templatePage.collectionBinding.sort,
          }
        : undefined,
      isFromTemplate: true,
      isOverridden,
    })
  }

  // Add instance-specific additional pages
  if (override?.additionalPages) {
    for (const additionalPage of override.additionalPages) {
      resolvedPages.push({
        slug: additionalPage.slug,
        pageType: additionalPage.pageType,
        title: additionalPage.title,
        required: additionalPage.required ?? true,
        sections: additionalPage.sections,
        prompts: additionalPage.prompts,
        ai_hints: additionalPage.ai_hints,
        collectionBinding: additionalPage.collectionBinding
          ? {
              collection: additionalPage.collectionBinding.collection,
              filter: additionalPage.collectionBinding.filter,
              limit: additionalPage.collectionBinding.limit,
              sort: additionalPage.collectionBinding.sort,
            }
          : undefined,
        isFromTemplate: false,
        isOverridden: false,
      })
    }
  }

  return resolvedPages
}

/**
 * Resolve collection binding filter with instance context
 */
export function resolveCollectionBinding(
  page: ResolvedPage,
  _instance: CollectionInstance // Reserved for future filterTemplate resolution
): Record<string, unknown> | undefined {
  if (!page.collectionBinding) return undefined

  // If there's a static filter, use it
  if (page.collectionBinding.filter) {
    return page.collectionBinding.filter
  }

  // If there's a filter template, resolve it with instance context
  // Note: filterTemplate is on TemplatePage, but we've flattened to filter
  // This would need the original template page to access filterTemplate
  return undefined
}

// ============================================================================
// URL Generation
// ============================================================================

/**
 * Generate URLs for all pages of a collection instance across all locales
 */
export function generateInstancePageUrls(
  contentType: ContentType,
  instance: CollectionInstance,
  locales: string[],
  override?: InstanceOverride
): PageUrl[] {
  const pattern = contentType.pageStructure?.urlPattern || '/{locale}/{instance.slug}/{page.slug}'
  const pages = resolveInstancePages(contentType, instance.id, override)
  const urls: PageUrl[] = []

  for (const locale of locales) {
    for (const page of pages) {
      const path = pattern
        .replace('{locale}', locale)
        .replace('{instance.slug}', instance.slug)
        .replace('{instance.id}', instance.id)
        .replace('{page.slug}', page.slug === 'overview' ? '' : page.slug)
        // Clean up double slashes and trailing slashes
        .replace(/\/+/g, '/')
        .replace(/\/$/, '') || '/'

      urls.push({
        path,
        page,
        instanceId: instance.id,
        instanceSlug: instance.slug,
        locale,
      })
    }
  }

  return urls
}

/**
 * Generate a single page URL
 */
export function generatePageUrl(
  contentType: ContentType,
  instance: CollectionInstance,
  page: ResolvedPage,
  locale: string
): string {
  const pattern = contentType.pageStructure?.urlPattern || '/{locale}/{instance.slug}/{page.slug}'

  return (
    pattern
      .replace('{locale}', locale)
      .replace('{instance.slug}', instance.slug)
      .replace('{instance.id}', instance.id)
      .replace('{page.slug}', page.slug === 'overview' ? '' : page.slug)
      .replace(/\/+/g, '/')
      .replace(/\/$/, '') || '/'
  )
}

// ============================================================================
// Site Definition Helpers
// ============================================================================

/**
 * Get all template collections from a site definition
 */
export function getTemplateCollections(
  siteDefinition: SiteDefinition
): Array<{ id: string; contentType: ContentType; node?: SitemapNode }> {
  const result: Array<{ id: string; contentType: ContentType; node?: SitemapNode }> = []

  if (!siteDefinition.types.collections) return result

  for (const [id, contentType] of Object.entries(siteDefinition.types.collections)) {
    if (contentType.pageStructure?.pages && contentType.pageStructure.pages.length > 0) {
      // Find the corresponding sitemap node
      const node = siteDefinition.sitemap.nodes.find(
        (n) => n.type === `collection:${id}`
      )

      result.push({ id, contentType, node })
    }
  }

  return result
}

/**
 * Get all pages for all instances of a template collection
 */
export function getAllTemplatePages(
  contentType: ContentType,
  instances: CollectionInstance[],
  sitemapNode?: SitemapNode,
  locales: string[] = ['en']
): PageUrl[] {
  const allUrls: PageUrl[] = []

  for (const instance of instances) {
    const override = sitemapNode
      ? getInstanceOverride(sitemapNode, instance.id)
      : undefined

    const urls = generateInstancePageUrls(contentType, instance, locales, override)
    allUrls.push(...urls)
  }

  return allUrls
}

/**
 * Get template page summary for display
 */
export function getTemplatePageSummary(
  contentType: ContentType
): Array<{
  slug: string
  title: string
  pageType: string
  required: boolean
  hasCollectionBinding: boolean
  hasPrompts: boolean
}> {
  if (!contentType.pageStructure?.pages) return []

  return contentType.pageStructure.pages.map((page) => ({
    slug: page.slug,
    title: getLocalizedValue(page.title, 'en'),
    pageType: page.pageType,
    required: page.required ?? true,
    hasCollectionBinding: !!page.collectionBinding,
    hasPrompts: !!(page.prompts || page.ai_hints),
  }))
}

/**
 * Count how many instances have overrides
 */
export function countInstanceOverrides(node?: SitemapNode): {
  total: number
  withSkips: number
  withAdditionalPages: number
  withPageOverrides: number
} {
  const overrides = node?.data?.instanceOverrides || []

  return {
    total: overrides.length,
    withSkips: overrides.filter((o) => o.skipPages && o.skipPages.length > 0).length,
    withAdditionalPages: overrides.filter((o) => o.additionalPages && o.additionalPages.length > 0).length,
    withPageOverrides: overrides.filter((o) => o.pageOverrides && Object.keys(o.pageOverrides).length > 0).length,
  }
}
