/**
 * Blueprint to Page Generator
 * Converts blueprints into i18n page JSON structure
 */

import { randomUUID } from 'crypto'

const uuidv4 = randomUUID
import type {
  Blueprint,
  BlueprintComponent,
  AIHints,
} from '../schemas/blueprint-schema'
import type { I18nPage, LocalizedString } from './i18n-processor'

// =============================================================================
// TYPES
// =============================================================================

export interface PageContext {
  /** Primary language */
  defaultLang: string
  /** All supported languages */
  languages: string[]
  /** Village name for village-specific pages */
  village?: string
  /** Region name */
  region?: string
  /** Page type from blueprint */
  pageType: string
  /** Additional variables for template resolution */
  variables?: Record<string, string | LocalizedString>
}

export interface GeneratedPageSection {
  id: string
  type: string
  variant?: string
  order: number
  /** Placeholder content (to be filled by AI agent) */
  content: Record<string, LocalizedString | any>
  /** AI hints for content generation */
  ai_hints?: AIHints
  /** Collection source if applicable */
  collectionSource?: {
    collection: string
    filter?: Record<string, unknown>
    limit?: number
  }
}

export interface GeneratedPage extends Omit<I18nPage, 'body'> {
  body: GeneratedPageSection[]
  /** Blueprint reference */
  blueprint_id?: string
  blueprint_version?: string
}

// =============================================================================
// TEMPLATE RESOLUTION
// =============================================================================

/**
 * Resolve template variables in a string
 * Supports {{variable}} syntax
 */
function resolveTemplate(
  template: string,
  context: PageContext
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match: string, key: string): string => {
    const value = context.variables?.[key]
    if (typeof value === 'string') return value
    if (typeof value === 'object' && value !== null && context.defaultLang in value) {
      return (value as LocalizedString)[context.defaultLang] || match
    }
    // Built-in variables
    if (key === 'village') return context.village || ''
    if (key === 'region') return context.region || ''
    if (key === 'pageType') return context.pageType
    return match // Keep unresolved
  })
}

/**
 * Resolve template for all languages
 */
function resolveLocalizedTemplate(
  template: string,
  context: PageContext
): LocalizedString {
  const result: LocalizedString = {}

  for (const lang of context.languages) {
    let resolved = template

    // Replace variables with localized versions
    resolved = resolved.replace(/\{\{(\w+)\}\}/g, (match, key): string => {
      const value = context.variables?.[key]
      if (typeof value === 'string') return value
      if (typeof value === 'object' && value !== null && lang in value) {
        return (value as LocalizedString)[lang] || match
      }
      // Built-in variables
      if (key === 'village') return context.village || ''
      if (key === 'region') return context.region || ''
      if (key === 'pageType') return context.pageType
      return match
    })

    result[lang] = resolved
  }

  return result
}

// =============================================================================
// SECTION GENERATION
// =============================================================================

/**
 * Generate placeholder content for a component based on its type
 */
function generatePlaceholderContent(
  component: BlueprintComponent,
  context: PageContext
): Record<string, LocalizedString | any> {
  const placeholders: Record<string, LocalizedString | any> = {}

  // Common fields for most section types
  const commonFields: Record<string, string> = {
    title: `[AI: Generate ${component.type} title]`,
    subtitle: `[AI: Generate ${component.type} subtitle]`,
    description: `[AI: Generate ${component.type} description]`,
  }

  // Add required fields as localized placeholders
  const fields = [...(component.required_fields || []), ...(component.optional_fields || [])]

  for (const field of fields) {
    const commonValue = commonFields[field]
    if (commonValue) {
      placeholders[field] = createLocalizedPlaceholder(commonValue, context)
    } else {
      placeholders[field] = createLocalizedPlaceholder(`[AI: Generate ${field}]`, context)
    }
  }

  // Type-specific defaults
  switch (component.type) {
    case 'hero':
      if (!fields.includes('title')) {
        placeholders.title = createLocalizedPlaceholder('[AI: Generate hero title]', context)
      }
      if (!fields.includes('subtitle')) {
        placeholders.subtitle = createLocalizedPlaceholder('[AI: Generate hero subtitle]', context)
      }
      placeholders.cta = {
        text: createLocalizedPlaceholder('[AI: CTA text]', context),
        href: '#',
      }
      break

    case 'features':
      placeholders.features = [
        {
          title: createLocalizedPlaceholder('[AI: Feature 1 title]', context),
          description: createLocalizedPlaceholder('[AI: Feature 1 description]', context),
          icon: 'star',
        },
        {
          title: createLocalizedPlaceholder('[AI: Feature 2 title]', context),
          description: createLocalizedPlaceholder('[AI: Feature 2 description]', context),
          icon: 'heart',
        },
        {
          title: createLocalizedPlaceholder('[AI: Feature 3 title]', context),
          description: createLocalizedPlaceholder('[AI: Feature 3 description]', context),
          icon: 'check',
        },
      ]
      break

    case 'stats':
      placeholders.stats = [
        { value: '100+', label: createLocalizedPlaceholder('[AI: Stat 1 label]', context) },
        { value: '50+', label: createLocalizedPlaceholder('[AI: Stat 2 label]', context) },
        { value: '24/7', label: createLocalizedPlaceholder('[AI: Stat 3 label]', context) },
      ]
      break

    case 'faq':
      placeholders.items = [
        {
          question: createLocalizedPlaceholder('[AI: FAQ question 1]', context),
          answer: createLocalizedPlaceholder('[AI: FAQ answer 1]', context),
        },
        {
          question: createLocalizedPlaceholder('[AI: FAQ question 2]', context),
          answer: createLocalizedPlaceholder('[AI: FAQ answer 2]', context),
        },
      ]
      break

    case 'testimonials':
      placeholders.testimonials = [
        {
          quote: createLocalizedPlaceholder('[AI: Testimonial quote]', context),
          author: 'Guest Name',
          role: createLocalizedPlaceholder('[AI: Author role]', context),
        },
      ]
      break

    case 'cta':
      if (!fields.includes('title')) {
        placeholders.title = createLocalizedPlaceholder('[AI: CTA heading]', context)
      }
      if (!fields.includes('description')) {
        placeholders.description = createLocalizedPlaceholder('[AI: CTA description]', context)
      }
      placeholders.primaryButton = {
        text: createLocalizedPlaceholder('[AI: Primary button]', context),
        href: '#',
      }
      break

    case 'content':
      placeholders.content = createLocalizedPlaceholder('[AI: Generate main content paragraph]', context)
      break

    case 'collection':
      // Collection sections get their content from the collection source
      placeholders.heading = createLocalizedPlaceholder('[AI: Collection heading]', context)
      placeholders.emptyMessage = createLocalizedPlaceholder('No items found', context)
      break
  }

  return placeholders
}

/**
 * Create a localized placeholder for all languages
 */
function createLocalizedPlaceholder(
  placeholder: string,
  context: PageContext
): LocalizedString {
  const result: LocalizedString = {}
  for (const lang of context.languages) {
    result[lang] = placeholder
  }
  return result
}

/**
 * Convert a blueprint component to a page section
 */
function componentToSection(
  component: BlueprintComponent,
  context: PageContext
): GeneratedPageSection {
  const section: GeneratedPageSection = {
    id: component.id || uuidv4(),
    type: component.type,
    variant: component.variant,
    order: component.order,
    content: generatePlaceholderContent(component, context),
  }

  // Add AI hints if present
  if (component.ai_hints) {
    section.ai_hints = component.ai_hints
  }

  // Add collection source if this is a collection component
  if (component.type === 'collection' && component.collectionSource) {
    section.collectionSource = {
      collection: component.collectionSource.collection,
      filter: component.collectionSource.filter,
      limit: component.collectionSource.limit,
    }
  }

  // Apply any custom props
  if (component.props) {
    section.content = {
      ...section.content,
      ...component.props,
    }
  }

  return section
}

// =============================================================================
// MAIN GENERATOR
// =============================================================================

/**
 * Generate a page from a blueprint
 */
export function generatePageFromBlueprint(
  blueprint: Blueprint,
  context: PageContext
): GeneratedPage {
  // Generate slug from page type and context
  const slug = generateSlug(blueprint.page_type, context)

  // Generate title from SEO template or page type
  const title = generateTitle(blueprint, context)

  // Generate SEO metadata
  const seo = generateSEO(blueprint, context)

  // Convert components to sections
  const body = blueprint.components
    .sort((a, b) => a.order - b.order)
    .map((component) => componentToSection(component, context))

  const page: GeneratedPage = {
    id: uuidv4(),
    slug,
    title,
    page_type: blueprint.page_type,
    seo,
    body,
    metadata: {
      city: context.village,
      region: context.region,
      page_type: blueprint.page_type,
    },
    status: 'draft',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  // Add blueprint reference
  if (blueprint.id) {
    page.blueprint_id = blueprint.id
    page.blueprint_version = blueprint.version
  }

  return page
}

/**
 * Generate a localized slug from page type and context
 */
function generateSlug(
  pageType: string,
  context: PageContext
): LocalizedString {
  const slug: LocalizedString = {}

  // Default slug patterns by language
  const patterns: Record<string, Record<string, string>> = {
    en: { village: '{{village}}', restaurants: '{{village}}/restaurants' },
    de: { village: '{{village}}', restaurants: '{{village}}/restaurants' },
    fr: { village: '{{village}}', restaurants: '{{village}}/restaurants' },
    it: { village: '{{village}}', restaurants: '{{village}}/ristoranti' },
  }

  for (const lang of context.languages) {
    const langPatterns = patterns[lang]
    const pattern = langPatterns?.[pageType] || `{{village}}/${pageType}`
    slug[lang] = resolveTemplate(pattern, { ...context, defaultLang: lang })
      .toLowerCase()
      .replace(/\s+/g, '-')
  }

  return slug
}

/**
 * Generate a localized title from blueprint SEO template
 */
function generateTitle(
  blueprint: Blueprint,
  context: PageContext
): LocalizedString {
  if (blueprint.seo_template?.title_pattern) {
    return resolveLocalizedTemplate(blueprint.seo_template.title_pattern, context)
  }

  // Default title pattern
  const defaultPattern = context.village
    ? `{{village}} - ${blueprint.name}`
    : blueprint.name

  return resolveLocalizedTemplate(defaultPattern, context)
}

/**
 * Generate SEO metadata from blueprint
 */
function generateSEO(
  blueprint: Blueprint,
  context: PageContext
): {
  title: LocalizedString
  description: LocalizedString
  keywords?: { [lang: string]: string[] }
} {
  const seo: {
    title: LocalizedString
    description: LocalizedString
    keywords?: { [lang: string]: string[] }
  } = {
    title: generateTitle(blueprint, context),
    description: createLocalizedPlaceholder('[AI: Generate meta description]', context),
  }

  // Apply SEO template if present
  if (blueprint.seo_template?.meta_description_pattern) {
    seo.description = resolveLocalizedTemplate(
      blueprint.seo_template.meta_description_pattern,
      context
    )
  }

  // Add keywords if specified
  if (blueprint.seo_template?.required_keywords) {
    seo.keywords = {}
    for (const lang of context.languages) {
      seo.keywords[lang] = [...blueprint.seo_template.required_keywords]
    }
  }

  return seo
}

/**
 * Batch generate pages from a blueprint for multiple contexts
 */
export function batchGeneratePages(
  blueprint: Blueprint,
  contexts: PageContext[]
): GeneratedPage[] {
  return contexts.map((context) => generatePageFromBlueprint(blueprint, context))
}

// =============================================================================
// EXPORTS
// =============================================================================

export default {
  generatePageFromBlueprint,
  batchGeneratePages,
  resolveTemplate,
  resolveLocalizedTemplate,
}
