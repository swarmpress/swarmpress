/**
 * QAAgent Tool Handlers
 * Implementations for validating media relevance, links, and content quality
 */

import { ToolHandler, ToolResult, toolSuccess, toolError } from '../base/tools'
import { getBlockMetadata, validateMediaForBlock, getLinkingRules } from '@swarm-press/shared'
import * as fs from 'fs/promises'
import * as path from 'path'

// ============================================================================
// Types
// ============================================================================

interface MediaImage {
  id: string
  url: string
  tags: {
    village: string
    category: string
    subcategory?: string
  }
}

interface MediaIndex {
  images: MediaImage[]
}

interface SitemapPage {
  slug: string
  canonicalUrl: {
    en: string
    de?: string
    fr?: string
    it?: string
  }
}

interface SitemapIndex {
  pages: Record<string, SitemapPage>
}

interface QAIssue {
  severity: 'error' | 'warning' | 'info'
  type: string
  path: string
  message: string
  suggestion?: string
}

// ============================================================================
// Index Access
// ============================================================================

let cachedMediaIndex: MediaIndex | null = null
let cachedSitemapIndex: SitemapIndex | null = null
let cacheTimestamp = 0
const CACHE_TTL = 60000

async function getMediaIndex(): Promise<MediaIndex> {
  const now = Date.now()
  if (cachedMediaIndex && (now - cacheTimestamp) < CACHE_TTL) {
    return cachedMediaIndex
  }

  const basePath = process.env.CONTENT_REPO_PATH || path.join(process.cwd(), 'cinqueterre.travel')
  const mediaIndexPath = path.join(basePath, 'content', 'config', 'media-index.json')

  try {
    const content = await fs.readFile(mediaIndexPath, 'utf-8')
    cachedMediaIndex = JSON.parse(content) as MediaIndex
    cacheTimestamp = now
    return cachedMediaIndex
  } catch {
    return { images: [] }
  }
}

async function getSitemapIndex(): Promise<SitemapIndex> {
  const now = Date.now()
  if (cachedSitemapIndex && (now - cacheTimestamp) < CACHE_TTL) {
    return cachedSitemapIndex
  }

  const basePath = process.env.CONTENT_REPO_PATH || path.join(process.cwd(), 'cinqueterre.travel')
  const sitemapIndexPath = path.join(basePath, 'content', 'config', 'sitemap-index.json')

  try {
    const content = await fs.readFile(sitemapIndexPath, 'utf-8')
    cachedSitemapIndex = JSON.parse(content) as SitemapIndex
    cacheTimestamp = now
    return cachedSitemapIndex
  } catch {
    return { pages: {} }
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

interface ImageRef {
  url: string
  path: string
  blockType?: string
}

function extractImagesFromContent(obj: unknown, currentPath = ''): ImageRef[] {
  const images: ImageRef[] = []

  if (!obj || typeof obj !== 'object') return images

  if (Array.isArray(obj)) {
    obj.forEach((item, idx) => {
      images.push(...extractImagesFromContent(item, `${currentPath}[${idx}]`))
    })
    return images
  }

  const record = obj as Record<string, unknown>
  const blockType = typeof record.type === 'string' ? record.type : undefined

  // Check common image properties
  const imageProps = ['image', 'src', 'backgroundImage', 'heroImage', 'thumbnail']
  for (const prop of imageProps) {
    if (typeof record[prop] === 'string' && isImageUrl(record[prop] as string)) {
      images.push({
        url: record[prop] as string,
        path: currentPath ? `${currentPath}.${prop}` : prop,
        blockType,
      })
    }
  }

  // Recurse into nested objects
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === 'object' && value !== null) {
      images.push(...extractImagesFromContent(value, currentPath ? `${currentPath}.${key}` : key))
    }
  }

  return images
}

interface LinkRef {
  href: string
  path: string
  blockType?: string
  anchorText?: string
}

function extractLinksFromContent(obj: unknown, currentPath = ''): LinkRef[] {
  const links: LinkRef[] = []

  if (!obj || typeof obj !== 'object') return links

  if (Array.isArray(obj)) {
    obj.forEach((item, idx) => {
      links.push(...extractLinksFromContent(item, `${currentPath}[${idx}]`))
    })
    return links
  }

  const record = obj as Record<string, unknown>
  const blockType = typeof record.type === 'string' ? record.type : undefined

  // Check for href properties
  if (typeof record.href === 'string') {
    links.push({
      href: record.href,
      path: currentPath ? `${currentPath}.href` : 'href',
      blockType,
      anchorText: typeof record.text === 'string' ? record.text : undefined,
    })
  }

  // Check for links in markdown content (simplified)
  if (typeof record.markdown === 'string') {
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g
    let match
    while ((match = linkRegex.exec(record.markdown as string)) !== null) {
      links.push({
        href: match[2],
        path: `${currentPath}.markdown`,
        blockType,
        anchorText: match[1],
      })
    }
  }

  // Recurse into nested objects
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === 'object' && value !== null) {
      links.push(...extractLinksFromContent(value, currentPath ? `${currentPath}.${key}` : key))
    }
  }

  return links
}

function isImageUrl(url: string): boolean {
  if (typeof url !== 'string') return false
  return (
    url.startsWith('https://images.unsplash.com/') ||
    url.startsWith('https://images.pexels.com/') ||
    url.match(/\.(jpg|jpeg|png|webp|gif)(\?|$)/i) !== null
  )
}

function isInternalLink(href: string): boolean {
  if (href.startsWith('http://') || href.startsWith('https://')) {
    return false
  }
  if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) {
    return false
  }
  return true
}

// ============================================================================
// Tool Handlers
// ============================================================================

/**
 * Check media relevance
 */
export const checkMediaRelevanceHandler: ToolHandler<{
  content: string
  page_slug: string
  page_village: string
  strict_mode?: boolean
}> = async (input, _context): Promise<ToolResult> => {
  try {
    let content: unknown
    try {
      content = JSON.parse(input.content)
    } catch {
      return toolError('Invalid JSON content provided')
    }

    const mediaIndex = await getMediaIndex()
    const images = extractImagesFromContent(content)
    const issues: QAIssue[] = []
    const validImages: ImageRef[] = []

    for (const imageRef of images) {
      // Find image in media index
      const indexImage = mediaIndex.images.find(img => img.url === imageRef.url)

      if (!indexImage) {
        issues.push({
          severity: 'warning',
          type: 'untracked_media',
          path: imageRef.path,
          message: `Image not found in media index: ${imageRef.url.substring(0, 50)}...`,
          suggestion: 'Run WKI builder to index this image, or add it manually with proper tags',
        })
        continue
      }

      // Validate using block metadata
      const validation = validateMediaForBlock(
        imageRef.blockType || 'image',
        indexImage.tags.village,
        input.page_village,
        indexImage.tags.category
      )

      if (!validation.valid) {
        issues.push({
          severity: 'error',
          type: 'entity_mismatch',
          path: imageRef.path,
          message: validation.reason || 'Entity mismatch',
          suggestion: `Replace with image tagged for village "${input.page_village}"`,
        })
      } else if (input.strict_mode && indexImage.tags.village === 'region') {
        issues.push({
          severity: 'warning',
          type: 'region_image',
          path: imageRef.path,
          message: `Using generic "region" image for ${input.page_village} content`,
          suggestion: `Consider finding a village-specific image for ${input.page_village}`,
        })
        validImages.push(imageRef)
      } else {
        validImages.push(imageRef)
      }
    }

    const passed = issues.filter(i => i.severity === 'error').length === 0

    return toolSuccess({
      page_slug: input.page_slug,
      page_village: input.page_village,
      passed,
      total_images: images.length,
      valid_images: validImages.length,
      issues,
      summary: passed
        ? `All ${validImages.length} images validated successfully`
        : `Found ${issues.filter(i => i.severity === 'error').length} errors and ${issues.filter(i => i.severity === 'warning').length} warnings`,
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to check media relevance')
  }
}

/**
 * Check broken media
 */
export const checkBrokenMediaHandler: ToolHandler<{
  content: string
  timeout_ms?: string
}> = async (input, _context): Promise<ToolResult> => {
  try {
    let content: unknown
    try {
      content = JSON.parse(input.content)
    } catch {
      return toolError('Invalid JSON content provided')
    }

    const images = extractImagesFromContent(content)
    const timeout = parseInt(input.timeout_ms || '5000', 10)
    const results = {
      valid: [] as string[],
      broken: [] as { url: string; status: number | string; path: string }[],
      timeout: [] as { url: string; path: string }[],
    }

    // Check each URL with HEAD request
    for (const imageRef of images) {
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), timeout)

        const response = await fetch(imageRef.url, {
          method: 'HEAD',
          signal: controller.signal,
        })

        clearTimeout(timeoutId)

        if (response.ok) {
          results.valid.push(imageRef.url)
        } else {
          results.broken.push({
            url: imageRef.url,
            status: response.status,
            path: imageRef.path,
          })
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          results.timeout.push({ url: imageRef.url, path: imageRef.path })
        } else {
          results.broken.push({
            url: imageRef.url,
            status: 'network_error',
            path: imageRef.path,
          })
        }
      }
    }

    const passed = results.broken.length === 0

    return toolSuccess({
      passed,
      total_checked: images.length,
      valid_count: results.valid.length,
      broken_count: results.broken.length,
      timeout_count: results.timeout.length,
      broken: results.broken,
      timeout: results.timeout,
      summary: passed
        ? `All ${results.valid.length} images are accessible`
        : `Found ${results.broken.length} broken images`,
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to check broken media')
  }
}

/**
 * Check broken internal links
 */
export const checkBrokenInternalLinksHandler: ToolHandler<{
  content: string
  language?: string
}> = async (input, _context): Promise<ToolResult> => {
  try {
    let content: unknown
    try {
      content = JSON.parse(input.content)
    } catch {
      return toolError('Invalid JSON content provided')
    }

    const sitemapIndex = await getSitemapIndex()
    const language = input.language || 'en'
    const links = extractLinksFromContent(content)
    const internalLinks = links.filter(l => isInternalLink(l.href))

    // Build a set of valid URLs from sitemap
    const validUrls = new Set<string>()
    for (const page of Object.values(sitemapIndex.pages)) {
      const langKey = language as keyof typeof page.canonicalUrl
      if (page.canonicalUrl[langKey]) {
        validUrls.add(page.canonicalUrl[langKey]!)
      }
      // Also add without language prefix for flexibility
      validUrls.add(`/${page.slug}`)
      validUrls.add(`/${language}/${page.slug}`)
    }

    const issues: QAIssue[] = []
    const validLinks: LinkRef[] = []

    for (const linkRef of internalLinks) {
      const normalizedHref = linkRef.href.split('?')[0] // Remove query params

      if (validUrls.has(normalizedHref)) {
        validLinks.push(linkRef)
      } else {
        // Try to find a close match
        const possibleMatch = Array.from(validUrls).find(url =>
          url.endsWith(normalizedHref) || normalizedHref.endsWith(url.split('/').pop()!)
        )

        issues.push({
          severity: 'error',
          type: 'broken_internal_link',
          path: linkRef.path,
          message: `Internal link not found in sitemap: ${linkRef.href}`,
          suggestion: possibleMatch ? `Did you mean "${possibleMatch}"?` : 'Check sitemap-index.json for valid URLs',
        })
      }
    }

    const passed = issues.length === 0

    return toolSuccess({
      passed,
      total_links: links.length,
      internal_links: internalLinks.length,
      external_links: links.length - internalLinks.length,
      valid_internal: validLinks.length,
      issues,
      summary: passed
        ? `All ${validLinks.length} internal links are valid`
        : `Found ${issues.length} broken internal links`,
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to check internal links')
  }
}

/**
 * Check link density
 */
export const checkLinkDensityHandler: ToolHandler<{
  content: string
  page_type: string
}> = async (input, _context): Promise<ToolResult> => {
  try {
    let content: unknown
    try {
      content = JSON.parse(input.content)
    } catch {
      return toolError('Invalid JSON content provided')
    }

    interface BlockAnalysis {
      blockType: string
      path: string
      linkCount: number
      expected: { min: number; max: number } | null
      status: 'pass' | 'too_few' | 'too_many' | 'no_rules'
    }

    const blocks = Array.isArray(content) ? content : [content]
    const analysis: BlockAnalysis[] = []
    const issues: QAIssue[] = []

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i] as Record<string, unknown>
      if (!block.type) continue

      const blockType = block.type as string
      const path = `blocks[${i}]`
      const links = extractLinksFromContent(block).filter(l => isInternalLink(l.href))
      const rules = getLinkingRules(blockType)

      const blockAnalysis: BlockAnalysis = {
        blockType,
        path,
        linkCount: links.length,
        expected: rules ? { min: rules.minInternalLinks, max: rules.maxInternalLinks } : null,
        status: 'no_rules',
      }

      if (rules) {
        if (links.length < rules.minInternalLinks) {
          blockAnalysis.status = 'too_few'
          issues.push({
            severity: 'warning',
            type: 'link_density_low',
            path,
            message: `Block "${blockType}" has ${links.length} internal links (minimum: ${rules.minInternalLinks})`,
            suggestion: `Add ${rules.minInternalLinks - links.length} more internal links to relevant pages`,
          })
        } else if (links.length > rules.maxInternalLinks) {
          blockAnalysis.status = 'too_many'
          issues.push({
            severity: 'warning',
            type: 'link_density_high',
            path,
            message: `Block "${blockType}" has ${links.length} internal links (maximum: ${rules.maxInternalLinks})`,
            suggestion: `Remove ${links.length - rules.maxInternalLinks} internal links`,
          })
        } else {
          blockAnalysis.status = 'pass'
        }
      }

      analysis.push(blockAnalysis)
    }

    const passed = issues.length === 0

    return toolSuccess({
      passed,
      page_type: input.page_type,
      blocks_analyzed: analysis.length,
      issues,
      analysis,
      summary: passed
        ? `All ${analysis.length} blocks have appropriate link density`
        : `Found ${issues.length} link density issues`,
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to check link density')
  }
}

/**
 * Run full QA
 */
export const runFullQAHandler: ToolHandler<{
  content: string
  page_slug: string
  page_village: string
  page_type?: string
  skip_broken_check?: boolean
  language?: string
}> = async (input, context): Promise<ToolResult> => {
  try {
    const results: Record<string, unknown> = {}
    const allIssues: QAIssue[] = []

    // 1. Media relevance check
    const mediaResult = await checkMediaRelevanceHandler({
      content: input.content,
      page_slug: input.page_slug,
      page_village: input.page_village,
    }, context)

    if (mediaResult.success && mediaResult.data) {
      results.mediaRelevance = mediaResult.data
      if (Array.isArray((mediaResult.data as Record<string, unknown>).issues)) {
        allIssues.push(...(mediaResult.data as Record<string, unknown>).issues as QAIssue[])
      }
    }

    // 2. Broken media check (optional)
    if (!input.skip_broken_check) {
      const brokenResult = await checkBrokenMediaHandler({
        content: input.content,
      }, context)

      if (brokenResult.success && brokenResult.data) {
        results.brokenMedia = brokenResult.data
        const brokenData = brokenResult.data as Record<string, unknown>
        if (Array.isArray(brokenData.broken)) {
          for (const broken of brokenData.broken as { url: string; path: string }[]) {
            allIssues.push({
              severity: 'error',
              type: 'broken_media',
              path: broken.path,
              message: `Image URL is not accessible: ${broken.url.substring(0, 50)}...`,
            })
          }
        }
      }
    }

    // 3. Internal links check
    const linksResult = await checkBrokenInternalLinksHandler({
      content: input.content,
      language: input.language,
    }, context)

    if (linksResult.success && linksResult.data) {
      results.internalLinks = linksResult.data
      if (Array.isArray((linksResult.data as Record<string, unknown>).issues)) {
        allIssues.push(...(linksResult.data as Record<string, unknown>).issues as QAIssue[])
      }
    }

    // 4. Link density check
    if (input.page_type) {
      const densityResult = await checkLinkDensityHandler({
        content: input.content,
        page_type: input.page_type,
      }, context)

      if (densityResult.success && densityResult.data) {
        results.linkDensity = densityResult.data
        if (Array.isArray((densityResult.data as Record<string, unknown>).issues)) {
          allIssues.push(...(densityResult.data as Record<string, unknown>).issues as QAIssue[])
        }
      }
    }

    // Aggregate results
    const errors = allIssues.filter(i => i.severity === 'error')
    const warnings = allIssues.filter(i => i.severity === 'warning')
    const passed = errors.length === 0

    return toolSuccess({
      passed,
      page_slug: input.page_slug,
      page_village: input.page_village,
      error_count: errors.length,
      warning_count: warnings.length,
      checks_run: Object.keys(results).length,
      results,
      issues: allIssues,
      summary: passed
        ? `QA passed with ${warnings.length} warnings`
        : `QA failed with ${errors.length} errors and ${warnings.length} warnings`,
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to run full QA')
  }
}

/**
 * Generate fix instructions
 */
export const generateFixInstructionsHandler: ToolHandler<{
  qa_report: string
  auto_fix_level?: string
}> = async (input, _context): Promise<ToolResult> => {
  try {
    let report: Record<string, unknown>
    try {
      report = JSON.parse(input.qa_report)
    } catch {
      return toolError('Invalid JSON QA report provided')
    }

    const issues = (report.issues as QAIssue[]) || []
    const autoFixLevel = input.auto_fix_level || 'none'

    interface FixInstruction {
      issue: QAIssue
      priority: number
      fixable: boolean
      autoFix?: string
      manualSteps: string[]
    }

    const instructions: FixInstruction[] = []

    for (const issue of issues) {
      const instruction: FixInstruction = {
        issue,
        priority: issue.severity === 'error' ? 1 : 2,
        fixable: false,
        manualSteps: [],
      }

      switch (issue.type) {
        case 'entity_mismatch':
          instruction.manualSteps = [
            `1. Open the content file and locate ${issue.path}`,
            `2. Use find_matching_images tool to find appropriate images for the correct village`,
            `3. Replace the image URL with one from the results`,
            `4. Run QA again to verify the fix`,
          ]
          if (autoFixLevel === 'aggressive') {
            instruction.fixable = true
            instruction.autoFix = 'Will search for matching images and replace automatically'
          }
          break

        case 'untracked_media':
          instruction.manualSteps = [
            `1. Run the WKI builder to index the image: npx tsx scripts/build-wki.ts`,
            `2. Manually add tags to the image in media-index.json if needed`,
            `3. Re-run QA to verify the image is now tracked`,
          ]
          break

        case 'broken_internal_link':
          instruction.manualSteps = [
            `1. Check sitemap-index.json for the correct URL`,
            `2. Update the href at ${issue.path}`,
            issue.suggestion ? `3. ${issue.suggestion}` : '3. Verify the page exists',
          ]
          break

        case 'link_density_low':
        case 'link_density_high':
          instruction.manualSteps = [
            `1. Review the block at ${issue.path}`,
            `2. ${issue.type === 'link_density_low' ? 'Add' : 'Remove'} internal links`,
            `3. Use sitemap-index.json to find relevant pages to link`,
          ]
          break

        default:
          instruction.manualSteps = [
            `1. Review the issue at ${issue.path}`,
            `2. ${issue.suggestion || 'Fix according to best practices'}`,
          ]
      }

      instructions.push(instruction)
    }

    // Sort by priority
    instructions.sort((a, b) => a.priority - b.priority)

    return toolSuccess({
      auto_fix_level: autoFixLevel,
      total_issues: issues.length,
      fixable_count: instructions.filter(i => i.fixable).length,
      instructions,
      summary: `Generated ${instructions.length} fix instructions (${instructions.filter(i => i.fixable).length} auto-fixable)`,
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to generate fix instructions')
  }
}

// ============================================================================
// Export Handler Map
// ============================================================================

export const qaToolHandlers: Record<string, ToolHandler> = {
  check_media_relevance: checkMediaRelevanceHandler,
  check_broken_media: checkBrokenMediaHandler,
  check_broken_internal_links: checkBrokenInternalLinksHandler,
  check_link_density: checkLinkDensityHandler,
  run_full_qa: runFullQAHandler,
  generate_fix_instructions: generateFixInstructionsHandler,
}
