/**
 * Brief Generator Activities
 * Generate content briefs from page metadata and blueprints
 */

import {
  pageRepository,
  blueprintRepository,
  contentRepository,
  websiteCollectionRepository,
  collectionItemRepository,
} from '@swarm-press/backend/dist/db/repositories'
import { randomUUID } from 'crypto'

// Blueprint types (from site-builder)
interface PageContext {
  defaultLang: string
  languages: string[]
  village?: string
  region?: string
  pageType: string
  variables?: Record<string, any>
}

interface BlueprintData {
  id?: string
  page_type: string
  name: string
  description?: string
  version?: string
  layout?: string
  components: Array<{
    id: string
    type: string
    variant?: string
    order: number
    required?: boolean
    ai_hints?: {
      purpose?: string
      tone?: string
      min_words?: number
      max_words?: number
    }
  }>
  global_linking_rules?: {
    min_links?: number
    max_links?: number
    min_total_links?: number
    max_total_links?: number
    must_link_to_page_type?: string[]
    forbidden_slugs?: string[]
  }
  seo_template?: {
    title_pattern?: string
    meta_description_pattern?: string
    required_keywords?: string[]
    keyword_density?: number
    min_word_count?: number
    max_word_count?: number
  }
}

// ============================================================================
// Types
// ============================================================================

export interface PageForContent {
  id: string
  websiteId: string
  slug: string
  title: string
  description?: string
  pageType?: string
  language: string
  blueprintId?: string
  seoKeywords?: string[]
  metadata?: Record<string, unknown>
}

export interface ContentBrief {
  contentId: string
  pageId: string
  websiteId: string
  title: string
  brief: string
  language: string
  pageType?: string
  collectionContext?: any
  seoKeywords?: string[]
}

export interface BriefGenerationResult {
  success: boolean
  contentId?: string
  brief?: string
  error?: string
}

// ============================================================================
// Language Configuration
// ============================================================================

const LANGUAGE_CONFIG: Record<string, { name: string; locale: string; instructions: string }> = {
  en: {
    name: 'English',
    locale: 'en-US',
    instructions: 'Write in clear, engaging American English. Use a friendly, informative tone suitable for travelers.',
  },
  de: {
    name: 'German',
    locale: 'de-DE',
    instructions: 'Schreibe in klarem, ansprechendem Deutsch. Verwende einen informativen, freundlichen Ton für Reisende.',
  },
  fr: {
    name: 'French',
    locale: 'fr-FR',
    instructions: "Écrivez en français clair et engageant. Utilisez un ton informatif et chaleureux adapté aux voyageurs.",
  },
  it: {
    name: 'Italian',
    locale: 'it-IT',
    instructions: "Scrivi in italiano chiaro e coinvolgente. Usa un tono informativo e accogliente adatto ai viaggiatori.",
  },
}

// ============================================================================
// Activities
// ============================================================================

/**
 * Get all pages for a website that need content
 * Filters out pages that already have content items
 */
export async function getPagesNeedingContent(
  websiteId: string,
  language?: string
): Promise<PageForContent[]> {
  // Get all pages for the website
  const pages = await pageRepository.findByWebsite(websiteId)

  // Filter by language if specified
  const filteredPages = language
    ? pages.filter((p: any) => p.metadata?.lang === language)
    : pages

  // Filter out pages that already have content
  const pagesNeedingContent: PageForContent[] = []
  for (const page of filteredPages) {
    const hasContent = await pageHasContent(page.id)
    if (!hasContent) {
      pagesNeedingContent.push({
        id: page.id,
        websiteId: page.website_id,
        slug: page.slug,
        title: page.title,
        description: (page as any).description,
        pageType: page.page_type,
        language: (page as any).metadata?.lang || 'en',
        blueprintId: page.blueprint_id,
        seoKeywords: (page as any).seo_keywords || [],
        metadata: (page as any).metadata,
      })
    }
  }

  return pagesNeedingContent
}

/**
 * Generate a content brief for a page
 * If a content item already exists for the page (with brief), return it instead of creating new
 */
export async function generateBriefForPage(
  page: PageForContent
): Promise<BriefGenerationResult> {
  try {
    // Check if content already exists for this page
    const existingContent = await contentRepository.findByPage(page.id)
    if (existingContent.length > 0 && existingContent[0]) {
      const existing = existingContent[0]
      // Get the brief from metadata if available
      const brief = (existing.metadata as any)?.content_brief || `Content brief for ${page.title}`
      console.log(`[BriefGenerator] Using existing content for page "${page.title}" (${page.language})`)
      return {
        success: true,
        contentId: existing.id,
        brief,
      }
    }

    // Get blueprint if exists
    let blueprint = null
    if (page.blueprintId) {
      blueprint = await blueprintRepository.findById(page.blueprintId)
    }

    // Get related collection data for context
    const collectionContext = await getCollectionContext(page)

    // Build the brief text
    const brief = buildBriefText(page, blueprint, collectionContext)

    // Create content item with brief
    const contentId = randomUUID()
    await contentRepository.create({
      id: contentId,
      website_id: page.websiteId,
      page_id: page.id,
      title: page.title,
      status: 'brief_created',
      body: [], // Empty - to be filled by writer
      metadata: {
        // Store custom data for the brief
        language: page.language,
        pageType: page.pageType,
        seoKeywords: page.seoKeywords,
        collectionContext: collectionContext ? { summary: collectionContext.summary } : null,
        content_brief: brief,
      } as any, // Cast to any for custom metadata fields
    })

    console.log(`[BriefGenerator] Created brief for page "${page.title}" (${page.language})`)

    return {
      success: true,
      contentId,
      brief,
    }
  } catch (error) {
    console.error(`[BriefGenerator] Error generating brief for page ${page.id}:`, error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Batch generate briefs for multiple pages
 */
export async function generateBriefsForPages(
  pages: PageForContent[]
): Promise<{ success: number; failed: number; results: BriefGenerationResult[] }> {
  const results: BriefGenerationResult[] = []
  let success = 0
  let failed = 0

  for (const page of pages) {
    const result = await generateBriefForPage(page)
    results.push(result)

    if (result.success) {
      success++
    } else {
      failed++
    }
  }

  return { success, failed, results }
}

/**
 * Check if a page already has content with actual body (not just a brief)
 */
export async function pageHasContent(pageId: string): Promise<boolean> {
  const contents = await contentRepository.findByPage(pageId)
  if (contents.length === 0) return false

  // Check if any content has actual body content (not empty)
  return contents.some((c: any) => {
    const body = c.body
    if (!body) return false
    if (Array.isArray(body)) return body.length > 0
    if (typeof body === 'object') return Object.keys(body).length > 0
    return false
  })
}

// ============================================================================
// Helpers
// ============================================================================

async function getCollectionContext(page: PageForContent): Promise<any | null> {
  // Determine which collections are relevant based on page type
  const relevantCollections = getRelevantCollections(page)

  if (relevantCollections.length === 0) {
    return null
  }

  const context: any = {
    collections: [],
    summary: '',
  }

  for (const collectionType of relevantCollections) {
    try {
      const collection = await websiteCollectionRepository.findByType(page.websiteId, collectionType)
      if (!collection) continue

      // Get sample items from the collection (limit to 5 for context)
      const items = await collectionItemRepository.findByCollection(collection.id, {
        limit: 5,
        publishedOnly: true,
      })

      if (items.length > 0) {
        context.collections.push({
          type: collectionType,
          displayName: collection.display_name,
          sampleItems: items.map((item: any) => ({
            name: item.data?.name || item.data?.title || item.slug,
            type: item.data?.type || item.data?.category?.primary,
          })),
          totalCount: await collectionItemRepository.countByCollection(collection.id),
        })
      }
    } catch (error) {
      console.warn(`[BriefGenerator] Could not get context for ${collectionType}:`, error)
    }
  }

  // Build summary
  if (context.collections.length > 0) {
    context.summary = context.collections
      .map((c: any) => `${c.displayName}: ${c.totalCount?.total || 0} items`)
      .join(', ')
  }

  return context.collections.length > 0 ? context : null
}

function getRelevantCollections(page: PageForContent): string[] {
  const slug = page.slug.toLowerCase()
  const pageType = page.pageType?.toLowerCase() || ''

  const collectionMap: Record<string, string[]> = {
    restaurants: ['cinqueterre_restaurants'],
    hiking: ['cinqueterre_hikes'],
    hotels: ['cinqueterre_accommodations'],
    apartments: ['cinqueterre_accommodations'],
    accommodations: ['cinqueterre_accommodations'],
    sights: ['cinqueterre_pois'],
    beaches: ['cinqueterre_pois'],
    events: ['cinqueterre_events'],
    transport: ['cinqueterre_transportation'],
    weather: ['cinqueterre_weather'],
    overview: ['cinqueterre_villages', 'cinqueterre_region'],
  }

  // Check slug and pageType for matches
  for (const [key, collections] of Object.entries(collectionMap)) {
    if (slug.includes(key) || pageType.includes(key)) {
      return collections
    }
  }

  // Village pages get village and POI context
  const villages = ['monterosso', 'vernazza', 'corniglia', 'manarola', 'riomaggiore']
  for (const village of villages) {
    if (slug.includes(village)) {
      return ['cinqueterre_villages', 'cinqueterre_pois', 'cinqueterre_restaurants']
    }
  }

  return []
}

function buildBriefText(page: PageForContent, blueprint: any | null, collectionContext: any | null): string {
  // Try to use new blueprint-based brief if blueprint has components
  if (blueprint?.schema?.components?.length > 0) {
    try {
      const blueprintData: BlueprintData = {
        id: blueprint.id,
        page_type: blueprint.schema.page_type || blueprint.name?.toLowerCase().replace(/\s+/g, '_') || page.pageType || 'general',
        name: blueprint.name,
        description: blueprint.description,
        version: blueprint.schema.version || '1.0',
        layout: blueprint.schema.layout || 'default',
        components: blueprint.schema.components,
        global_linking_rules: blueprint.schema.global_linking_rules,
        seo_template: blueprint.schema.seo_template,
      }

      // Build context from page data
      const context: PageContext = {
        defaultLang: page.language || 'en',
        languages: ['en', 'de', 'fr', 'it'],
        village: (page.metadata?.city as string) || undefined,
        region: (page.metadata?.region as string) || 'Cinque Terre',
        pageType: page.pageType || 'general',
        variables: {
          title: page.title,
        },
      }

      // Build brief from blueprint structure
      return buildBlueprintBriefText(page, blueprintData, context, collectionContext)
    } catch (error) {
      console.warn('[BriefGenerator] Could not use blueprint brief, falling back to legacy:', error)
    }
  }

  // Fallback to legacy brief generation
  return buildLegacyBriefText(page, blueprint, collectionContext)
}

/**
 * Build brief text from a valid blueprint structure
 */
function buildBlueprintBriefText(
  page: PageForContent,
  blueprint: BlueprintData,
  context: PageContext,
  collectionContext: any | null
): string {
  const lang = LANGUAGE_CONFIG[page.language] ?? LANGUAGE_CONFIG['en']!

  let brief = `# Content Brief: ${blueprint.name}

## Page Overview
- **Page Type**: ${blueprint.page_type}
- **Title**: ${page.title}
- **URL**: ${page.slug}
- **Language**: ${lang.name} (${lang.locale})
- **Languages**: ${context.languages.join(', ')}
`

  if (context.village) {
    brief += `- **Village**: ${context.village}\n`
  }

  brief += `\n## Language Instructions\n${lang.instructions}\n`

  if (blueprint.description) {
    brief += `\n## Purpose\n${blueprint.description}\n`
  }

  // Section instructions
  brief += `\n## Sections to Write\n`

  for (const component of blueprint.components.sort((a, b) => a.order - b.order)) {
    const requiredLabel = component.required ? ' (Required)' : ' (Optional)'
    const typeName = component.type.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')

    brief += `\n### ${component.order + 1}. ${typeName}${requiredLabel}\n`

    if (component.variant) {
      brief += `**Variant**: ${component.variant}\n`
    }

    if (component.ai_hints?.purpose) {
      brief += `**Purpose**: ${component.ai_hints.purpose}\n`
    }
    if (component.ai_hints?.tone) {
      brief += `**Tone**: ${component.ai_hints.tone}\n`
    }
    if (component.ai_hints?.min_words || component.ai_hints?.max_words) {
      brief += `**Word count**: ${component.ai_hints.min_words || 50}-${component.ai_hints.max_words || 200} words\n`
    }
  }

  // SEO guidance
  if (blueprint.seo_template) {
    brief += `\n## SEO Requirements\n`
    if (blueprint.seo_template.required_keywords?.length) {
      brief += `- Include keywords: ${blueprint.seo_template.required_keywords.join(', ')}\n`
    }
    if (blueprint.seo_template.keyword_density) {
      brief += `- Target keyword density: ${blueprint.seo_template.keyword_density}%\n`
    }
  }

  // Linking guidance
  if (blueprint.global_linking_rules) {
    const rules = blueprint.global_linking_rules
    brief += `\n## Internal Linking\n`
    if (rules.min_total_links) {
      brief += `- Include at least ${rules.min_total_links} internal links\n`
    }
    if (rules.max_total_links) {
      brief += `- No more than ${rules.max_total_links} internal links\n`
    }
    if (rules.must_link_to_page_type?.length) {
      brief += `- Must link to: ${rules.must_link_to_page_type.join(', ')} pages\n`
    }
  }

  // Add collection context if present
  if (collectionContext) {
    brief += `\n## Available Data\nThe following collection data is available and should be referenced:\n${collectionContext.summary}\n\nUse this data to enrich your content with specific examples, names, and details.\n`
  }

  return brief
}

/**
 * Legacy brief text builder (for pages without valid blueprints)
 */
function buildLegacyBriefText(page: PageForContent, blueprint: any | null, collectionContext: any | null): string {
  const lang = LANGUAGE_CONFIG[page.language] ?? LANGUAGE_CONFIG['en']!

  let brief = `# Content Brief: ${page.title}

## Page Information
- **Page Type**: ${page.pageType || 'general'}
- **URL**: ${page.slug}
- **Language**: ${lang.name} (${lang.locale})

## Language Instructions
${lang.instructions}

## Page Description
${page.description || 'Create comprehensive, helpful content for this travel guide page.'}

`

  // Add SEO keywords if present
  if (page.seoKeywords && page.seoKeywords.length > 0) {
    brief += `## SEO Keywords
Target these keywords naturally in your content:
${page.seoKeywords.map((k: string) => `- ${k}`).join('\n')}

`
  }

  // Add blueprint structure if present
  if (blueprint) {
    brief += `## Content Structure (from Blueprint)
${blueprint.structure_description || 'Follow the standard content structure for this page type.'}

### Sections
${blueprint.sections?.map((s: any) => `- ${s.name}: ${s.description || ''}`).join('\n') || 'Use appropriate sections for the content.'}

`
  }

  // Add collection context if present
  if (collectionContext) {
    brief += `## Available Data
The following collection data is available and should be referenced:
${collectionContext.summary}

Use this data to enrich your content with specific examples, names, and details.

`
  }

  // Add general writing guidelines
  brief += `## Writing Guidelines
1. Write engaging, informative content that helps travelers plan their visit
2. Include practical information (hours, prices, how to get there) when relevant
3. Use appropriate content blocks: headings, paragraphs, lists, images, FAQs
4. Ensure accuracy - only include information you're confident about
5. Make content scannable with clear headings and bullet points
6. Include local tips and insider knowledge when possible

## Content Blocks to Include
- Hero section with compelling headline
- Introduction paragraph
- Main content sections with headings
- Practical information (if applicable)
- Tips or recommendations list
- FAQ section (if relevant)
`

  return brief
}
