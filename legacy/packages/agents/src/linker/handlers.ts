/**
 * LinkerAgent Tool Handlers
 * Implementations for finding and managing internal links
 */

import { ToolHandler, ToolResult, toolSuccess, toolError } from '../base/tools'
import { getLinkingRules } from '@swarm-press/shared'
import * as fs from 'fs/promises'
import * as path from 'path'

// ============================================================================
// Types
// ============================================================================

interface SitemapPage {
  slug: string
  canonicalUrl: {
    en: string
    de?: string
    fr?: string
    it?: string
  }
  title: {
    en: string
    de?: string
    fr?: string
    it?: string
  }
  pageType: string
  keywords?: string[]
  entity?: string
  collection?: string
}

interface SitemapIndex {
  pages: Record<string, SitemapPage>
}

interface EntityVillage {
  slug: string
  name: { en: string }
  aliases: string[]
  keywords: string[]
}

interface EntityTrail {
  slug: string
  name: { en: string }
  aliases?: string[]
}

interface EntityIndex {
  villages: Record<string, EntityVillage>
  trails: Record<string, EntityTrail>
}

interface LinkingPolicy {
  policies: Record<string, {
    minLinks: number
    maxLinks: number
    allowedTargets: string[]
    anchorTextRules?: string
  }>
}

interface LinkOpportunity {
  text: string
  url: string
  targetSlug: string
  targetType: string
  position: number
  confidence: number
}

// ============================================================================
// Index Access
// ============================================================================

let cachedSitemapIndex: SitemapIndex | null = null
let cachedEntityIndex: EntityIndex | null = null
let cachedLinkingPolicy: LinkingPolicy | null = null
let cacheTimestamp = 0
const CACHE_TTL = 60000

async function getSitemapIndex(): Promise<SitemapIndex> {
  const now = Date.now()
  if (cachedSitemapIndex && (now - cacheTimestamp) < CACHE_TTL) {
    return cachedSitemapIndex
  }

  const basePath = process.env.CONTENT_REPO_PATH || path.join(process.cwd(), 'cinqueterre.travel')
  const indexPath = path.join(basePath, 'content', 'config', 'sitemap-index.json')

  try {
    const content = await fs.readFile(indexPath, 'utf-8')
    cachedSitemapIndex = JSON.parse(content) as SitemapIndex
    cacheTimestamp = now
    return cachedSitemapIndex
  } catch {
    return { pages: {} }
  }
}

async function getEntityIndex(): Promise<EntityIndex> {
  const now = Date.now()
  if (cachedEntityIndex && (now - cacheTimestamp) < CACHE_TTL) {
    return cachedEntityIndex
  }

  const basePath = process.env.CONTENT_REPO_PATH || path.join(process.cwd(), 'cinqueterre.travel')
  const indexPath = path.join(basePath, 'content', 'config', 'entity-index.json')

  try {
    const content = await fs.readFile(indexPath, 'utf-8')
    cachedEntityIndex = JSON.parse(content) as EntityIndex
    cacheTimestamp = now
    return cachedEntityIndex
  } catch {
    return { villages: {}, trails: {} }
  }
}

async function getLinkingPolicy(): Promise<LinkingPolicy> {
  if (cachedLinkingPolicy) {
    return cachedLinkingPolicy
  }

  const basePath = process.env.CONTENT_REPO_PATH || path.join(process.cwd(), 'cinqueterre.travel')
  const policyPath = path.join(basePath, 'content', 'config', 'linking-policy.json')

  try {
    const content = await fs.readFile(policyPath, 'utf-8')
    cachedLinkingPolicy = JSON.parse(content) as LinkingPolicy
    return cachedLinkingPolicy
  } catch {
    // Return default policy if file doesn't exist
    return {
      policies: {
        'paragraph': { minLinks: 0, maxLinks: 3, allowedTargets: ['villages', 'hikes', 'restaurants', 'accommodations'] },
        'village-intro': { minLinks: 2, maxLinks: 5, allowedTargets: ['hikes', 'restaurants', 'accommodations', 'beaches'] },
        'editorial-hero': { minLinks: 0, maxLinks: 1, allowedTargets: ['villages', 'itinerary'] },
        'faq': { minLinks: 1, maxLinks: 5, allowedTargets: ['villages', 'hikes', 'transport'] },
      },
    }
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function findEntityMentions(
  text: string,
  entityIndex: EntityIndex,
  sitemapIndex: SitemapIndex,
  language: string
): LinkOpportunity[] {
  const opportunities: LinkOpportunity[] = []
  const lowerText = text.toLowerCase()

  // Find village mentions
  for (const [slug, village] of Object.entries(entityIndex.villages)) {
    const searchTerms = [
      village.name.en.toLowerCase(),
      ...village.aliases.map(a => a.toLowerCase()),
    ]

    for (const term of searchTerms) {
      let position = lowerText.indexOf(term)
      while (position !== -1) {
        // Check if this is a whole word match
        const before = position > 0 ? lowerText[position - 1] || ' ' : ' '
        const after = position + term.length < lowerText.length ? lowerText[position + term.length] || ' ' : ' '

        if (/\s|[.,!?;:]/.test(before) && /\s|[.,!?;:]/.test(after)) {
          const page = sitemapIndex.pages[slug]
          if (page) {
            const langKey = language as keyof typeof page.canonicalUrl
            opportunities.push({
              text: text.substring(position, position + term.length),
              url: page.canonicalUrl[langKey] || page.canonicalUrl.en,
              targetSlug: slug,
              targetType: 'village',
              position,
              confidence: term === village.name.en.toLowerCase() ? 1.0 : 0.8,
            })
          }
        }
        position = lowerText.indexOf(term, position + 1)
      }
    }
  }

  // Find trail mentions
  for (const [slug, trail] of Object.entries(entityIndex.trails)) {
    const searchTerms = [
      trail.name.en.toLowerCase(),
      ...(trail.aliases || []).map(a => a.toLowerCase()),
    ]

    for (const term of searchTerms) {
      let position = lowerText.indexOf(term)
      while (position !== -1) {
        const hikesSlug = `hikes/${slug}`
        const page = sitemapIndex.pages[hikesSlug] || sitemapIndex.pages[slug]
        if (page) {
          const langKey = language as keyof typeof page.canonicalUrl
          opportunities.push({
            text: text.substring(position, position + term.length),
            url: page.canonicalUrl[langKey] || page.canonicalUrl.en,
            targetSlug: slug,
            targetType: 'trail',
            position,
            confidence: 0.9,
          })
        }
        position = lowerText.indexOf(term, position + 1)
      }
    }
  }

  // Sort by position and remove duplicates
  opportunities.sort((a, b) => a.position - b.position)

  // Remove overlapping opportunities (keep higher confidence)
  const filtered: LinkOpportunity[] = []
  for (const opp of opportunities) {
    const overlaps = filtered.some(
      f => (opp.position >= f.position && opp.position < f.position + f.text.length) ||
           (f.position >= opp.position && f.position < opp.position + opp.text.length)
    )
    if (!overlaps) {
      filtered.push(opp)
    }
  }

  return filtered
}

function extractExistingLinks(text: string): Array<{ text: string; url: string; start: number; end: number }> {
  const links: Array<{ text: string; url: string; start: number; end: number }> = []
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g
  let match

  while ((match = linkRegex.exec(text)) !== null) {
    const linkText = match[1] || ''
    const linkUrl = match[2] || ''
    links.push({
      text: linkText,
      url: linkUrl,
      start: match.index,
      end: match.index + match[0].length,
    })
  }

  return links
}

// ============================================================================
// Tool Handlers
// ============================================================================

/**
 * Find link opportunities
 */
export const findLinkOpportunitiesHandler: ToolHandler<{
  content: string
  current_page: string
  language?: string
  max_suggestions?: number
  exclude_slugs?: string[]
}> = async (input, _context): Promise<ToolResult> => {
  try {
    const language = input.language || 'en'
    const maxSuggestions = input.max_suggestions || 10
    const excludeSlugs = new Set([input.current_page, ...(input.exclude_slugs || [])])

    const sitemapIndex = await getSitemapIndex()
    const entityIndex = await getEntityIndex()

    // Find existing links to avoid
    const existingLinks = extractExistingLinks(input.content)
    const existingUrls = new Set(existingLinks.map(l => l.url))

    // Find entity mentions
    let opportunities = findEntityMentions(input.content, entityIndex, sitemapIndex, language)

    // Filter out:
    // - Self-links (current page)
    // - Already linked URLs
    // - Excluded slugs
    opportunities = opportunities.filter(opp => {
      if (excludeSlugs.has(opp.targetSlug)) return false
      if (existingUrls.has(opp.url)) return false

      // Check if position is within an existing link
      for (const existing of existingLinks) {
        if (opp.position >= existing.start && opp.position < existing.end) {
          return false
        }
      }
      return true
    })

    // Sort by confidence and take top suggestions
    opportunities.sort((a, b) => b.confidence - a.confidence)
    opportunities = opportunities.slice(0, maxSuggestions)

    return toolSuccess({
      current_page: input.current_page,
      existing_links: existingLinks.length,
      opportunities_found: opportunities.length,
      opportunities,
      summary: opportunities.length > 0
        ? `Found ${opportunities.length} link opportunities`
        : 'No new link opportunities found',
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to find link opportunities')
  }
}

/**
 * Insert links
 */
export const insertLinksHandler: ToolHandler<{
  content: string
  links: string
  max_links?: number
}> = async (input, _context): Promise<ToolResult> => {
  try {
    let links: Array<{ text: string; url: string; position?: number }>
    try {
      links = JSON.parse(input.links)
    } catch {
      return toolError('Invalid JSON for links parameter')
    }

    const maxLinks = input.max_links || 5
    let content = input.content
    let insertedCount = 0

    // Sort links by position (descending) to insert from end to start
    // This prevents position shifts from affecting earlier insertions
    const sortedLinks = [...links]
      .filter(l => l.position !== undefined)
      .sort((a, b) => (b.position || 0) - (a.position || 0))

    for (const link of sortedLinks) {
      if (insertedCount >= maxLinks) break

      const pos = link.position || 0
      const textEnd = pos + link.text.length

      // Find the exact text at position
      const foundText = content.substring(pos, textEnd)
      if (foundText.toLowerCase() === link.text.toLowerCase()) {
        // Check if already linked
        const before = content.substring(Math.max(0, pos - 1), pos)
        const after = content.substring(textEnd, textEnd + 2)

        if (before !== '[' && after !== '](') {
          // Insert markdown link
          const markdownLink = `[${foundText}](${link.url})`
          content = content.substring(0, pos) + markdownLink + content.substring(textEnd)
          insertedCount++
        }
      }
    }

    return toolSuccess({
      original_length: input.content.length,
      new_length: content.length,
      links_inserted: insertedCount,
      content,
      summary: `Inserted ${insertedCount} links`,
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to insert links')
  }
}

/**
 * Validate links
 */
export const validateLinksHandler: ToolHandler<{
  content: string
  language?: string
}> = async (input, _context): Promise<ToolResult> => {
  try {
    const language = input.language || 'en'
    const sitemapIndex = await getSitemapIndex()

    const links = extractExistingLinks(input.content)
    const internalLinks = links.filter(l =>
      !l.url.startsWith('http://') &&
      !l.url.startsWith('https://') &&
      !l.url.startsWith('#') &&
      !l.url.startsWith('mailto:')
    )

    // Build valid URL set
    const validUrls = new Set<string>()
    for (const page of Object.values(sitemapIndex.pages)) {
      const langKey = language as keyof typeof page.canonicalUrl
      if (page.canonicalUrl[langKey]) {
        validUrls.add(page.canonicalUrl[langKey]!)
      }
      validUrls.add(`/${page.slug}`)
      validUrls.add(`/${language}/${page.slug}`)
    }

    const validLinks: typeof links = []
    const invalidLinks: Array<typeof links[0] & { suggestion?: string }> = []

    for (const link of internalLinks) {
      const normalizedUrl = link.url.split('?')[0] || link.url

      if (validUrls.has(normalizedUrl)) {
        validLinks.push(link)
      } else {
        // Try to find a close match
        const urlParts = normalizedUrl.split('/')
        const urlSlug = urlParts[urlParts.length - 1] || ''
        const suggestion = Array.from(validUrls).find(url => {
          const parts = url.split('/')
          const slug = parts[parts.length - 1] || ''
          return url.endsWith(urlSlug) || normalizedUrl.includes(slug)
        })
        invalidLinks.push({ ...link, suggestion })
      }
    }

    return toolSuccess({
      total_links: links.length,
      internal_links: internalLinks.length,
      external_links: links.length - internalLinks.length,
      valid_count: validLinks.length,
      invalid_count: invalidLinks.length,
      valid_links: validLinks,
      invalid_links: invalidLinks,
      passed: invalidLinks.length === 0,
      summary: invalidLinks.length === 0
        ? `All ${validLinks.length} internal links are valid`
        : `Found ${invalidLinks.length} invalid internal links`,
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to validate links')
  }
}

/**
 * Get linking policy
 */
export const getLinkingPolicyHandler: ToolHandler<{
  block_type: string
  page_type?: string
}> = async (input, _context): Promise<ToolResult> => {
  try {
    // First try block metadata from shared package
    const blockRules = getLinkingRules(input.block_type)

    if (blockRules) {
      return toolSuccess({
        source: 'block-metadata',
        block_type: input.block_type,
        minLinks: blockRules.minInternalLinks,
        maxLinks: blockRules.maxInternalLinks,
        allowedTargets: blockRules.allowedTargets,
        anchorTextGuidance: blockRules.anchorTextGuidance,
      })
    }

    // Fall back to linking-policy.json
    const policy = await getLinkingPolicy()
    const blockPolicy = policy.policies[input.block_type]

    if (blockPolicy) {
      return toolSuccess({
        source: 'linking-policy.json',
        block_type: input.block_type,
        ...blockPolicy,
      })
    }

    // Return default policy
    return toolSuccess({
      source: 'default',
      block_type: input.block_type,
      minLinks: 0,
      maxLinks: 3,
      allowedTargets: ['villages', 'hikes', 'restaurants'],
      anchorTextGuidance: 'Use descriptive anchor text that describes the target page',
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to get linking policy')
  }
}

/**
 * Suggest anchor text
 */
export const suggestAnchorTextHandler: ToolHandler<{
  target_slug: string
  context?: string
  language?: string
}> = async (input, _context): Promise<ToolResult> => {
  try {
    const language = input.language || 'en'
    const sitemapIndex = await getSitemapIndex()
    const entityIndex = await getEntityIndex()

    const page = sitemapIndex.pages[input.target_slug]
    if (!page) {
      return toolError(`Page not found: ${input.target_slug}`)
    }

    const langKey = language as keyof typeof page.title
    const suggestions: string[] = []

    // Primary suggestion: page title
    if (page.title[langKey]) {
      suggestions.push(page.title[langKey]!)
    }

    // Check if it's a village
    const village = entityIndex.villages[input.target_slug]
    if (village) {
      suggestions.push(village.name.en)
      if (village.keywords.length > 0) {
        suggestions.push(`${village.name.en}'s ${village.keywords[0]}`)
      }
    }

    // Check if it's a trail
    const trail = entityIndex.trails[input.target_slug]
    if (trail) {
      suggestions.push(trail.name.en)
    }

    // Add contextual suggestions based on page type
    switch (page.pageType) {
      case 'village':
        suggestions.push(`explore ${page.title.en}`)
        suggestions.push(`visit ${page.title.en}`)
        break
      case 'collection':
        if (page.entity) {
          suggestions.push(`${page.collection} in ${page.entity}`)
        }
        break
    }

    return toolSuccess({
      target_slug: input.target_slug,
      page_title: page.title[langKey] || page.title.en,
      page_type: page.pageType,
      suggestions: Array.from(new Set(suggestions)),
      recommended: suggestions[0],
      guidance: 'Choose anchor text that describes what users will find on the target page',
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to suggest anchor text')
  }
}

/**
 * Analyze link distribution
 */
export const analyzeLinkDistributionHandler: ToolHandler<{
  content: string
  page_type?: string
}> = async (input, _context): Promise<ToolResult> => {
  try {
    let content: unknown
    try {
      content = JSON.parse(input.content)
    } catch {
      return toolError('Invalid JSON content')
    }

    const blocks = Array.isArray(content) ? content : [content]
    interface BlockLinkAnalysis {
      blockIndex: number
      blockType: string
      linkCount: number
      links: Array<{ text: string; url: string }>
    }
    const blockAnalysis: BlockLinkAnalysis[] = []
    const targetCounts: Record<string, number> = {}
    const allLinks: Array<{ text: string; url: string; blockIndex: number }> = []

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i] as Record<string, unknown>
      const blockStr = JSON.stringify(block)
      const links = extractExistingLinks(blockStr)

      blockAnalysis.push({
        blockIndex: i,
        blockType: (block.type as string) || 'unknown',
        linkCount: links.length,
        links: links.map(l => ({ text: l.text, url: l.url })),
      })

      for (const link of links) {
        targetCounts[link.url] = (targetCounts[link.url] || 0) + 1
        allLinks.push({ text: link.text, url: link.url, blockIndex: i })
      }
    }

    // Analyze issues
    const issues: Array<{ type: string; message: string; severity: string }> = []

    // Check for clustering (more than 3 links in one block)
    const clusteredBlocks = blockAnalysis.filter(b => b.linkCount > 3)
    if (clusteredBlocks.length > 0) {
      issues.push({
        type: 'clustering',
        message: `${clusteredBlocks.length} blocks have more than 3 links`,
        severity: 'warning',
      })
    }

    // Check for orphan sections (3+ consecutive blocks with no links)
    let orphanStreak = 0
    for (const analysis of blockAnalysis) {
      if (analysis.linkCount === 0) {
        orphanStreak++
        if (orphanStreak >= 3) {
          issues.push({
            type: 'orphan_section',
            message: `Found ${orphanStreak} consecutive blocks without links`,
            severity: 'info',
          })
        }
      } else {
        orphanStreak = 0
      }
    }

    // Check for overlinked targets
    const overlinked = Object.entries(targetCounts).filter(([, count]) => count > 2)
    if (overlinked.length > 0) {
      issues.push({
        type: 'overlinked_targets',
        message: `${overlinked.length} pages are linked more than twice`,
        severity: 'warning',
      })
    }

    return toolSuccess({
      total_blocks: blocks.length,
      total_links: allLinks.length,
      unique_targets: Object.keys(targetCounts).length,
      block_analysis: blockAnalysis,
      target_distribution: targetCounts,
      issues,
      summary: issues.length === 0
        ? 'Link distribution looks good'
        : `Found ${issues.length} distribution issues`,
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to analyze link distribution')
  }
}

// ============================================================================
// Export Handler Map
// ============================================================================

export const linkerToolHandlers: Record<string, ToolHandler> = {
  find_link_opportunities: findLinkOpportunitiesHandler,
  insert_links: insertLinksHandler,
  validate_links: validateLinksHandler,
  get_linking_policy: getLinkingPolicyHandler,
  suggest_anchor_text: suggestAnchorTextHandler,
  analyze_link_distribution: analyzeLinkDistributionHandler,
}
