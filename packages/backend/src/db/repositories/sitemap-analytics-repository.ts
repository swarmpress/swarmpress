/**
 * Sitemap Analytics Repository
 * Computes and caches analytics for sitemap optimization
 */

import { db } from '../connection'
import { pageRepository } from './page-repository'

// Import types (these are defined in packages/shared/src/types/sitemap.ts)
type PageStatus = 'planned' | 'draft' | 'published' | 'outdated' | 'deprecated'
type PagePriority = 'low' | 'medium' | 'high' | 'critical'

interface Page {
  id: string
  website_id: string
  slug: string
  title: string
  page_type: string
  status: PageStatus
  priority: PagePriority
  parent_id?: string
  seo_profile?: {
    primary_keyword?: string
    secondary_keywords?: string[]
    search_volume?: number
    serp_competition?: 'low' | 'medium' | 'high'
    meta_description?: string
    freshness_score?: number
    requires_update_after?: string
  }
  internal_links?: {
    outgoing?: Array<{ to: string; anchor: string }>
    incoming?: Array<{ from: string; anchor: string }>
  }
  updated_at: string
}

export interface SitemapAnalytics {
  website_id: string
  total_pages: number
  by_status: Record<PageStatus, number>
  by_priority: Record<PagePriority, number>
  by_page_type: Record<string, number>
  orphan_pages: OrphanPage[]
  pages_needing_update: PageNeedingUpdate[]
  avg_freshness_score: number
  total_internal_links: number
  link_graph_metrics: LinkGraphMetrics
  seo_metrics: SEOMetrics
  computed_at: string
}

export interface OrphanPage {
  id: string
  slug: string
  title: string
  status: PageStatus
  has_parent: boolean
  incoming_links_count: number
  outgoing_links_count: number
}

export interface PageNeedingUpdate {
  id: string
  slug: string
  title: string
  freshness_score: number
  days_since_update: number
  requires_update_after?: string
  last_updated: string
}

export interface LinkGraphMetrics {
  total_links: number
  avg_outgoing_links: number
  avg_incoming_links: number
  max_outgoing_links: number
  max_incoming_links: number
  pages_with_no_outgoing: number
  pages_with_no_incoming: number
  broken_links: BrokenLink[]
  hub_pages: HubPage[]
  authority_pages: AuthorityPage[]
}

export interface BrokenLink {
  source_page_id: string
  source_slug: string
  target_slug: string
  anchor: string
  reason: 'missing' | 'deprecated'
}

export interface HubPage {
  id: string
  slug: string
  title: string
  outgoing_links_count: number
}

export interface AuthorityPage {
  id: string
  slug: string
  title: string
  incoming_links_count: number
}

export interface SEOMetrics {
  pages_with_keywords: number
  pages_without_keywords: number
  avg_keywords_per_page: number
  total_search_volume: number
  high_competition_pages: number
  low_competition_pages: number
  pages_with_meta_description: number
  pages_without_meta_description: number
}

class SitemapAnalyticsRepository {
  /**
   * Compute comprehensive analytics for a website
   */
  async computeAnalytics(websiteId: string): Promise<SitemapAnalytics> {
    const pages = await pageRepository.findByWebsite(websiteId)

    const analytics: SitemapAnalytics = {
      website_id: websiteId,
      total_pages: pages.length,
      by_status: this.aggregateByStatus(pages),
      by_priority: this.aggregateByPriority(pages),
      by_page_type: this.aggregateByType(pages),
      orphan_pages: this.detectOrphanPages(pages),
      pages_needing_update: this.detectPagesNeedingUpdate(pages),
      avg_freshness_score: this.calculateAverageFreshness(pages),
      total_internal_links: this.countTotalLinks(pages),
      link_graph_metrics: this.analyzeLinkGraph(pages),
      seo_metrics: this.analyzeSEO(pages),
      computed_at: new Date().toISOString(),
    }

    // Cache the analytics
    await this.cacheAnalytics(websiteId, analytics)

    return analytics
  }

  /**
   * Get cached analytics or compute if stale
   */
  async getAnalytics(
    websiteId: string,
    maxAgeMinutes: number = 15
  ): Promise<SitemapAnalytics> {
    const cached = await this.getCachedAnalytics(websiteId)

    if (cached) {
      const age = Date.now() - new Date(cached.computed_at).getTime()
      if (age < maxAgeMinutes * 60 * 1000) {
        return cached
      }
    }

    return await this.computeAnalytics(websiteId)
  }

  /**
   * Aggregate pages by status
   */
  private aggregateByStatus(pages: Page[]): Record<PageStatus, number> {
    const counts: Record<PageStatus, number> = {
      planned: 0,
      draft: 0,
      published: 0,
      outdated: 0,
      deprecated: 0,
    }

    pages.forEach((page) => {
      counts[page.status] = (counts[page.status] || 0) + 1
    })

    return counts
  }

  /**
   * Aggregate pages by priority
   */
  private aggregateByPriority(pages: Page[]): Record<PagePriority, number> {
    const counts: Record<PagePriority, number> = {
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    }

    pages.forEach((page) => {
      counts[page.priority] = (counts[page.priority] || 0) + 1
    })

    return counts
  }

  /**
   * Aggregate pages by type
   */
  private aggregateByType(pages: Page[]): Record<string, number> {
    const counts: Record<string, number> = {}

    pages.forEach((page) => {
      counts[page.page_type] = (counts[page.page_type] || 0) + 1
    })

    return counts
  }

  /**
   * Detect orphan pages (no parent, no incoming links)
   */
  private detectOrphanPages(pages: Page[]): OrphanPage[] {
    return pages
      .filter((page) => {
        const hasParent = !!page.parent_id
        const incomingLinks = page.internal_links?.incoming || []
        return !hasParent && incomingLinks.length === 0
      })
      .map((page) => ({
        id: page.id,
        slug: page.slug,
        title: page.title,
        status: page.status,
        has_parent: !!page.parent_id,
        incoming_links_count: page.internal_links?.incoming?.length || 0,
        outgoing_links_count: page.internal_links?.outgoing?.length || 0,
      }))
  }

  /**
   * Detect pages needing content updates
   */
  private detectPagesNeedingUpdate(pages: Page[]): PageNeedingUpdate[] {
    const now = Date.now()

    return pages
      .filter((page) => {
        const freshnessScore = page.seo_profile?.freshness_score || 100
        return freshnessScore < 70 // Threshold for needing update
      })
      .map((page) => {
        const lastUpdated = new Date(page.updated_at).getTime()
        const daysSinceUpdate = Math.floor((now - lastUpdated) / (1000 * 60 * 60 * 24))

        return {
          id: page.id,
          slug: page.slug,
          title: page.title,
          freshness_score: page.seo_profile?.freshness_score || 0,
          days_since_update: daysSinceUpdate,
          requires_update_after: page.seo_profile?.requires_update_after,
          last_updated: page.updated_at,
        }
      })
      .sort((a, b) => a.freshness_score - b.freshness_score)
  }

  /**
   * Calculate average freshness score
   */
  private calculateAverageFreshness(pages: Page[]): number {
    if (pages.length === 0) return 100

    const sum = pages.reduce((acc, page) => {
      return acc + (page.seo_profile?.freshness_score || 100)
    }, 0)

    return Math.round(sum / pages.length)
  }

  /**
   * Count total internal links
   */
  private countTotalLinks(pages: Page[]): number {
    return pages.reduce((acc, page) => {
      return acc + (page.internal_links?.outgoing?.length || 0)
    }, 0)
  }

  /**
   * Analyze link graph structure
   */
  private analyzeLinkGraph(pages: Page[]): LinkGraphMetrics {
    const pageMap = new Map(pages.map((p) => [p.slug, p]))
    const outgoingCounts: number[] = []
    const incomingCounts: number[] = []
    const brokenLinks: BrokenLink[] = []

    pages.forEach((page) => {
      const outgoing = page.internal_links?.outgoing || []
      const incoming = page.internal_links?.incoming || []

      outgoingCounts.push(outgoing.length)
      incomingCounts.push(incoming.length)

      // Check for broken links
      outgoing.forEach((link: { to: string; anchor: string }) => {
        const targetPage = pageMap.get(link.to)
        if (!targetPage) {
          brokenLinks.push({
            source_page_id: page.id,
            source_slug: page.slug,
            target_slug: link.to,
            anchor: link.anchor,
            reason: 'missing',
          })
        } else if (targetPage.status === 'deprecated') {
          brokenLinks.push({
            source_page_id: page.id,
            source_slug: page.slug,
            target_slug: link.to,
            anchor: link.anchor,
            reason: 'deprecated',
          })
        }
      })
    })

    // Identify hub pages (most outgoing links)
    const hubPages = pages
      .map((page) => ({
        id: page.id,
        slug: page.slug,
        title: page.title,
        outgoing_links_count: page.internal_links?.outgoing?.length || 0,
      }))
      .sort((a, b) => b.outgoing_links_count - a.outgoing_links_count)
      .slice(0, 10)

    // Identify authority pages (most incoming links)
    const authorityPages = pages
      .map((page) => ({
        id: page.id,
        slug: page.slug,
        title: page.title,
        incoming_links_count: page.internal_links?.incoming?.length || 0,
      }))
      .sort((a, b) => b.incoming_links_count - a.incoming_links_count)
      .slice(0, 10)

    return {
      total_links: this.countTotalLinks(pages),
      avg_outgoing_links:
        outgoingCounts.reduce((a, b) => a + b, 0) / pages.length || 0,
      avg_incoming_links:
        incomingCounts.reduce((a, b) => a + b, 0) / pages.length || 0,
      max_outgoing_links: Math.max(...outgoingCounts, 0),
      max_incoming_links: Math.max(...incomingCounts, 0),
      pages_with_no_outgoing: outgoingCounts.filter((c) => c === 0).length,
      pages_with_no_incoming: incomingCounts.filter((c) => c === 0).length,
      broken_links: brokenLinks,
      hub_pages: hubPages,
      authority_pages: authorityPages,
    }
  }

  /**
   * Analyze SEO metrics
   */
  private analyzeSEO(pages: Page[]): SEOMetrics {
    let pagesWithKeywords = 0
    let totalKeywords = 0
    let totalSearchVolume = 0
    let highCompetition = 0
    let lowCompetition = 0
    let pagesWithMetaDescription = 0

    pages.forEach((page) => {
      const seo = page.seo_profile

      // Keywords
      if (seo?.primary_keyword || (seo?.secondary_keywords && seo.secondary_keywords.length > 0)) {
        pagesWithKeywords++
        totalKeywords += 1 + (seo.secondary_keywords?.length || 0)
      }

      // Search volume
      if (seo?.search_volume) {
        totalSearchVolume += seo.search_volume
      }

      // Competition
      if (seo?.serp_competition === 'high') highCompetition++
      if (seo?.serp_competition === 'low') lowCompetition++

      // Meta description
      if (seo?.meta_description) pagesWithMetaDescription++
    })

    return {
      pages_with_keywords: pagesWithKeywords,
      pages_without_keywords: pages.length - pagesWithKeywords,
      avg_keywords_per_page: pages.length > 0 ? totalKeywords / pages.length : 0,
      total_search_volume: totalSearchVolume,
      high_competition_pages: highCompetition,
      low_competition_pages: lowCompetition,
      pages_with_meta_description: pagesWithMetaDescription,
      pages_without_meta_description: pages.length - pagesWithMetaDescription,
    }
  }

  /**
   * Cache analytics in database
   */
  private async cacheAnalytics(
    websiteId: string,
    analytics: SitemapAnalytics
  ): Promise<void> {
    await db.query(
      `INSERT INTO sitemap_analytics_cache (website_id, analytics, computed_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (website_id)
       DO UPDATE SET analytics = $2, computed_at = $3`,
      [websiteId, JSON.stringify(analytics), analytics.computed_at]
    )
  }

  /**
   * Get cached analytics
   */
  private async getCachedAnalytics(
    websiteId: string
  ): Promise<SitemapAnalytics | null> {
    const result = await db.query(
      `SELECT analytics FROM sitemap_analytics_cache WHERE website_id = $1`,
      [websiteId]
    )

    if (result.rows.length === 0) return null

    return JSON.parse(result.rows[0].analytics)
  }

  /**
   * Clear analytics cache for a website
   */
  async clearCache(websiteId: string): Promise<void> {
    await db.query(
      `DELETE FROM sitemap_analytics_cache WHERE website_id = $1`,
      [websiteId]
    )
  }
}

export const sitemapAnalyticsRepository = new SitemapAnalyticsRepository()
