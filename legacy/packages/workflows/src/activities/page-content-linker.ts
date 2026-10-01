/**
 * Page-Content Linker Activities
 * Link content items to sitemap pages and track publishing status
 */

import {
  pageRepository,
  contentRepository,
  websiteRepository,
} from '@swarm-press/backend/dist/db/repositories'

// ============================================================================
// Types
// ============================================================================

export interface PageContentStatus {
  pageId: string
  slug: string
  title: string
  language: string
  hasContent: boolean
  contentId?: string
  contentStatus?: string
}

export interface WebsiteContentSummary {
  websiteId: string
  totalPages: number
  pagesWithContent: number
  pagesWithoutContent: number
  byLanguage: Record<string, { total: number; withContent: number }>
  byStatus: Record<string, number>
}

export interface LinkContentResult {
  success: boolean
  pageId: string
  contentId: string
  error?: string
}

// ============================================================================
// Activities
// ============================================================================

/**
 * Get content status for all pages of a website
 */
export async function getWebsiteContentStatus(
  websiteId: string
): Promise<PageContentStatus[]> {
  const pages = await pageRepository.findByWebsite(websiteId)

  const results: PageContentStatus[] = []

  for (const page of pages) {
    const contents = await contentRepository.findByPage(page.id)
    const content = contents[0] // Get first content item if any

    results.push({
      pageId: page.id,
      slug: page.slug,
      title: page.title,
      language: (page as any).metadata?.lang || 'en',
      hasContent: !!content,
      contentId: content?.id,
      contentStatus: content?.status,
    })
  }

  return results
}

/**
 * Get summary of content status for a website
 */
export async function getWebsiteContentSummary(
  websiteId: string
): Promise<WebsiteContentSummary> {
  const statuses = await getWebsiteContentStatus(websiteId)

  const summary: WebsiteContentSummary = {
    websiteId,
    totalPages: statuses.length,
    pagesWithContent: statuses.filter(s => s.hasContent).length,
    pagesWithoutContent: statuses.filter(s => !s.hasContent).length,
    byLanguage: {},
    byStatus: {},
  }

  // Group by language
  for (const status of statuses) {
    const lang = status.language
    if (!summary.byLanguage[lang]) {
      summary.byLanguage[lang] = { total: 0, withContent: 0 }
    }
    summary.byLanguage[lang].total++
    if (status.hasContent) {
      summary.byLanguage[lang].withContent++
    }

    // Group by content status
    const contentStatus = status.contentStatus || 'no_content'
    summary.byStatus[contentStatus] = (summary.byStatus[contentStatus] || 0) + 1
  }

  return summary
}

/**
 * Link a content item to a page
 */
export async function linkContentToPage(
  contentId: string,
  pageId: string
): Promise<LinkContentResult> {
  try {
    // Verify page exists
    const page = await pageRepository.findById(pageId)
    if (!page) {
      return {
        success: false,
        pageId,
        contentId,
        error: `Page ${pageId} not found`,
      }
    }

    // Verify content exists
    const content = await contentRepository.findById(contentId)
    if (!content) {
      return {
        success: false,
        pageId,
        contentId,
        error: `Content ${contentId} not found`,
      }
    }

    // Update content with page_id
    await contentRepository.update(contentId, { page_id: pageId })

    console.log(`[PageContentLinker] Linked content ${contentId} to page ${pageId}`)

    return {
      success: true,
      pageId,
      contentId,
    }
  } catch (error) {
    console.error(`[PageContentLinker] Error linking content to page:`, error)
    return {
      success: false,
      pageId,
      contentId,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Get pages without content for a specific language
 */
export async function getPagesWithoutContent(
  websiteId: string,
  language?: string
): Promise<PageContentStatus[]> {
  const statuses = await getWebsiteContentStatus(websiteId)

  return statuses.filter(s => {
    const noContent = !s.hasContent
    const matchesLanguage = !language || s.language === language
    return noContent && matchesLanguage
  })
}

/**
 * Get pages with content in a specific status
 */
export async function getPagesByContentStatus(
  websiteId: string,
  contentStatus: string
): Promise<PageContentStatus[]> {
  const statuses = await getWebsiteContentStatus(websiteId)
  return statuses.filter(s => s.contentStatus === contentStatus)
}

/**
 * Get count of content by status
 */
export async function getContentStatusCounts(
  websiteId: string
): Promise<Record<string, number>> {
  const summary = await getWebsiteContentSummary(websiteId)
  return summary.byStatus
}

/**
 * Mark page as having published content
 */
export async function markPagePublished(
  pageId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await pageRepository.update(pageId, {
      status: 'published',
    })

    console.log(`[PageContentLinker] Marked page ${pageId} as published`)
    return { success: true }
  } catch (error) {
    console.error(`[PageContentLinker] Error marking page as published:`, error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Get website details
 */
export async function getWebsiteDetails(
  websiteId: string
): Promise<{
  id: string
  name: string
  domain: string
  languages: string[]
} | null> {
  const website = await websiteRepository.findById(websiteId)
  if (!website) return null

  return {
    id: website.id,
    name: website.name,
    domain: website.domain,
    languages: (website as any).config?.locales || (website.settings as any)?.locales || ['en'],
  }
}
