/**
 * Blueprint Brief Generator
 * Creates structured briefs for AI content agents from blueprints
 */

import type {
  Blueprint,
  BlueprintComponent,
  LinkingRules,
  SEOTemplate,
} from '../schemas/blueprint-schema'
import { getDefaultAIHints } from '../schemas/blueprint-schema'
import type { PageContext } from './blueprint-to-page'

// =============================================================================
// TYPES
// =============================================================================

export interface SectionBrief {
  /** Section identifier */
  id: string
  /** Section type (hero, features, etc.) */
  type: string
  /** Section variant */
  variant?: string
  /** Display order */
  order: number
  /** Whether content is required */
  required: boolean
  /** Fields to generate */
  fields: FieldBrief[]
  /** AI writing guidance */
  guidance: AIGuidance
}

export interface FieldBrief {
  name: string
  type: 'text' | 'localized_text' | 'array' | 'object' | 'number' | 'boolean'
  required: boolean
  description?: string
  constraints?: {
    minLength?: number
    maxLength?: number
    minItems?: number
    maxItems?: number
  }
}

export interface AIGuidance {
  purpose: string
  tone: string
  wordRange: { min: number; max: number }
  keywords?: string[]
  style?: string
  examples?: string[]
  doNotDo?: string[]
}

export interface LinkingGuidance {
  minLinks: number
  maxLinks: number
  mustLinkToTypes: string[]
  forbiddenSlugs: string[]
  preferredAnchors: string[]
}

export interface SEOGuidance {
  titlePattern?: string
  descriptionPattern?: string
  requiredKeywords: string[]
  keywordDensity?: number
  wordCountRange?: { min: number; max: number }
}

export interface GeneratedBrief {
  /** Brief metadata */
  meta: {
    blueprintId?: string
    blueprintName: string
    pageType: string
    version: string
    generatedAt: string
  }

  /** Page context */
  context: {
    village?: string
    region?: string
    languages: string[]
    defaultLanguage: string
  }

  /** Section-by-section briefs */
  sections: SectionBrief[]

  /** Page-level SEO guidance */
  seo: SEOGuidance

  /** Internal linking guidance */
  linking: LinkingGuidance

  /** Overall page guidance (text prompt) */
  overallPrompt: string
}

// =============================================================================
// BRIEF GENERATION
// =============================================================================

/**
 * Generate a complete brief from a blueprint and page context
 */
export function generateBriefFromBlueprint(
  blueprint: Blueprint,
  page: { id: string; title: string; slug?: string },
  context: PageContext
): GeneratedBrief {
  // Generate section briefs
  const sections = blueprint.components
    .sort((a, b) => a.order - b.order)
    .map((component) => generateSectionBrief(component))

  // Build SEO guidance
  const seo = buildSEOGuidance(blueprint.seo_template)

  // Build linking guidance
  const linking = buildLinkingGuidance(blueprint.global_linking_rules)

  // Generate overall prompt
  const overallPrompt = generateOverallPrompt(blueprint, page, context, sections)

  return {
    meta: {
      blueprintId: blueprint.id,
      blueprintName: blueprint.name,
      pageType: blueprint.page_type,
      version: blueprint.version || '1.0',
      generatedAt: new Date().toISOString(),
    },
    context: {
      village: context.village,
      region: context.region,
      languages: context.languages,
      defaultLanguage: context.defaultLang,
    },
    sections,
    seo,
    linking,
    overallPrompt,
  }
}

/**
 * Generate a brief for a single section
 */
function generateSectionBrief(component: BlueprintComponent): SectionBrief {
  const defaultHints = getDefaultAIHints(component.type, component.variant)
  const hints = { ...defaultHints, ...component.ai_hints }

  return {
    id: component.id,
    type: component.type,
    variant: component.variant,
    order: component.order,
    required: component.required || false,
    fields: generateFieldBriefs(component),
    guidance: {
      purpose: hints.purpose || `Generate content for ${component.type} section`,
      tone: hints.tone || 'professional',
      wordRange: {
        min: hints.min_words || 50,
        max: hints.max_words || 200,
      },
      keywords: hints.keywords,
      style: hints.style,
      examples: hints.examples,
    },
  }
}

/**
 * Generate field briefs for a component
 */
function generateFieldBriefs(component: BlueprintComponent): FieldBrief[] {
  const fields: FieldBrief[] = []

  // Add required fields
  for (const field of component.required_fields || []) {
    fields.push({
      name: field,
      type: inferFieldType(field),
      required: true,
      description: getFieldDescription(component.type, field),
    })
  }

  // Add optional fields
  for (const field of component.optional_fields || []) {
    fields.push({
      name: field,
      type: inferFieldType(field),
      required: false,
      description: getFieldDescription(component.type, field),
    })
  }

  // Add default fields based on component type if none specified
  if (fields.length === 0) {
    fields.push(...getDefaultFields(component.type))
  }

  return fields
}

/**
 * Infer field type from name
 */
function inferFieldType(fieldName: string): FieldBrief['type'] {
  const arrayFields = ['items', 'features', 'stats', 'testimonials', 'links', 'images']
  const objectFields = ['cta', 'button', 'image', 'author', 'display']
  const numberFields = ['count', 'limit', 'order', 'columns']
  const booleanFields = ['required', 'featured', 'visible', 'enabled']

  if (arrayFields.some((f) => fieldName.toLowerCase().includes(f))) return 'array'
  if (objectFields.some((f) => fieldName.toLowerCase().includes(f))) return 'object'
  if (numberFields.some((f) => fieldName.toLowerCase().includes(f))) return 'number'
  if (booleanFields.some((f) => fieldName.toLowerCase().includes(f))) return 'boolean'

  return 'localized_text'
}

/**
 * Get description for a field
 */
function getFieldDescription(componentType: string, fieldName: string): string {
  const descriptions: Record<string, Record<string, string>> = {
    hero: {
      title: 'Main headline that captures attention',
      subtitle: 'Supporting text that elaborates on the headline',
      description: 'Brief overview of the page content',
      cta: 'Call-to-action button with text and link',
    },
    features: {
      title: 'Section heading',
      features: 'List of features with title, description, and icon',
    },
    stats: {
      stats: 'List of statistics with value and label',
    },
    faq: {
      items: 'List of frequently asked questions with answers',
    },
    cta: {
      title: 'Compelling heading',
      description: 'Brief text explaining the value proposition',
      primaryButton: 'Main action button',
      secondaryButton: 'Alternative action button',
    },
  }

  return descriptions[componentType]?.[fieldName] || `The ${fieldName} field for this section`
}

/**
 * Get default fields for a component type
 */
function getDefaultFields(componentType: string): FieldBrief[] {
  const defaults: Record<string, FieldBrief[]> = {
    hero: [
      { name: 'title', type: 'localized_text', required: true, description: 'Main headline' },
      { name: 'subtitle', type: 'localized_text', required: false, description: 'Supporting text' },
    ],
    features: [
      { name: 'title', type: 'localized_text', required: true, description: 'Section heading' },
      { name: 'features', type: 'array', required: true, description: 'Feature list' },
    ],
    content: [
      { name: 'title', type: 'localized_text', required: false, description: 'Section heading' },
      { name: 'content', type: 'localized_text', required: true, description: 'Main content' },
    ],
    cta: [
      { name: 'title', type: 'localized_text', required: true, description: 'Compelling heading' },
      { name: 'description', type: 'localized_text', required: false, description: 'Supporting text' },
    ],
    faq: [
      { name: 'title', type: 'localized_text', required: false, description: 'Section heading' },
      { name: 'items', type: 'array', required: true, description: 'FAQ items' },
    ],
    stats: [
      { name: 'title', type: 'localized_text', required: false, description: 'Section heading' },
      { name: 'stats', type: 'array', required: true, description: 'Statistics' },
    ],
    testimonials: [
      { name: 'title', type: 'localized_text', required: false, description: 'Section heading' },
      { name: 'testimonials', type: 'array', required: true, description: 'Testimonial quotes' },
    ],
  }

  return defaults[componentType] || [
    { name: 'title', type: 'localized_text', required: false },
    { name: 'content', type: 'localized_text', required: true },
  ]
}

/**
 * Build SEO guidance from template
 */
function buildSEOGuidance(template?: SEOTemplate): SEOGuidance {
  return {
    titlePattern: template?.title_pattern,
    descriptionPattern: template?.meta_description_pattern,
    requiredKeywords: template?.required_keywords || [],
    keywordDensity: template?.keyword_density,
    wordCountRange: template?.min_word_count || template?.max_word_count
      ? { min: template.min_word_count || 300, max: template.max_word_count || 2000 }
      : undefined,
  }
}

/**
 * Build linking guidance from rules
 */
function buildLinkingGuidance(rules?: LinkingRules): LinkingGuidance {
  return {
    minLinks: rules?.min_total_links || 3,
    maxLinks: rules?.max_total_links || 10,
    mustLinkToTypes: rules?.must_link_to_page_type || [],
    forbiddenSlugs: rules?.forbidden_slugs || [],
    preferredAnchors: rules?.preferred_anchors || [],
  }
}

/**
 * Generate overall text prompt for the agent
 */
function generateOverallPrompt(
  blueprint: Blueprint,
  page: { id: string; title: string; slug?: string },
  context: PageContext,
  sections: SectionBrief[]
): string {
  const lines: string[] = []

  // Page overview
  lines.push(`# Content Brief: ${blueprint.name}`)
  lines.push('')
  lines.push(`## Page Overview`)
  lines.push(`- **Page Type:** ${blueprint.page_type}`)
  lines.push(`- **Title:** ${page.title}`)
  if (page.slug) lines.push(`- **Slug:** ${page.slug}`)
  if (context.village) lines.push(`- **Village:** ${context.village}`)
  if (context.region) lines.push(`- **Region:** ${context.region}`)
  lines.push(`- **Languages:** ${context.languages.join(', ')}`)
  lines.push('')

  // Blueprint description
  if (blueprint.description) {
    lines.push(`## Purpose`)
    lines.push(blueprint.description)
    lines.push('')
  }

  // Section instructions
  lines.push(`## Sections to Write`)
  lines.push('')

  for (const section of sections) {
    const requiredLabel = section.required ? ' (Required)' : ' (Optional)'
    lines.push(`### ${section.order + 1}. ${formatSectionName(section.type)}${requiredLabel}`)

    if (section.variant) {
      lines.push(`**Variant:** ${section.variant}`)
    }

    lines.push(`**Purpose:** ${section.guidance.purpose}`)
    lines.push(`**Tone:** ${section.guidance.tone}`)
    lines.push(`**Word count:** ${section.guidance.wordRange.min}-${section.guidance.wordRange.max} words`)

    if (section.guidance.keywords?.length) {
      lines.push(`**Keywords to include:** ${section.guidance.keywords.join(', ')}`)
    }

    lines.push('')
  }

  // SEO guidance
  if (blueprint.seo_template) {
    lines.push(`## SEO Requirements`)
    if (blueprint.seo_template.required_keywords?.length) {
      lines.push(`- Include keywords: ${blueprint.seo_template.required_keywords.join(', ')}`)
    }
    if (blueprint.seo_template.keyword_density) {
      lines.push(`- Target keyword density: ${blueprint.seo_template.keyword_density}%`)
    }
    lines.push('')
  }

  // Linking guidance
  if (blueprint.global_linking_rules) {
    lines.push(`## Internal Linking`)
    const rules = blueprint.global_linking_rules
    if (rules.min_total_links) {
      lines.push(`- Include at least ${rules.min_total_links} internal links`)
    }
    if (rules.max_total_links) {
      lines.push(`- No more than ${rules.max_total_links} internal links`)
    }
    if (rules.must_link_to_page_type?.length) {
      lines.push(`- Must link to: ${rules.must_link_to_page_type.join(', ')} pages`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

/**
 * Format section type name for display
 */
function formatSectionName(type: string): string {
  return type
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

// =============================================================================
// BRIEF FORMATTING
// =============================================================================

/**
 * Convert brief to markdown for human review
 */
export function briefToMarkdown(brief: GeneratedBrief): string {
  return brief.overallPrompt
}

/**
 * Convert brief to structured JSON for API
 */
export function briefToJSON(brief: GeneratedBrief): string {
  return JSON.stringify(brief, null, 2)
}

/**
 * Extract key prompts for each section
 */
export function extractSectionPrompts(brief: GeneratedBrief): Map<string, string> {
  const prompts = new Map<string, string>()

  for (const section of brief.sections) {
    const prompt = [
      `Write ${formatSectionName(section.type)} content.`,
      `Purpose: ${section.guidance.purpose}`,
      `Tone: ${section.guidance.tone}`,
      `Length: ${section.guidance.wordRange.min}-${section.guidance.wordRange.max} words`,
    ].join(' ')

    prompts.set(section.id, prompt)
  }

  return prompts
}

// =============================================================================
// EXPORTS
// =============================================================================

export default {
  generateBriefFromBlueprint,
  briefToMarkdown,
  briefToJSON,
  extractSectionPrompts,
}
