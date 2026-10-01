/**
 * PageOrchestratorAgent Tool Handlers
 * Implementations for coordinating page composition and editorial coherence
 */

import { ToolHandler, ToolResult, toolSuccess, toolError } from '../base/tools'
import { getBlockMetadata } from '@swarm-press/shared'
import * as fs from 'fs/promises'
import * as path from 'path'

// ============================================================================
// Types
// ============================================================================

interface StyleGuide {
  voice: string
  persona: string
  tone: string
  formatting: {
    headings: string
    lists: string
    paragraphs: string
  }
  vocabulary: {
    preferred: string[]
    avoid: string[]
  }
  examples?: {
    good: string[]
    bad: string[]
  }
}

interface ComponentBrief {
  index: number
  type: string
  intent: string
  targetWordCount: { min: number; max: number }
  requiredElements: {
    media: boolean
    links: { min: number; max: number }
    ctas: boolean
  }
  entityContext: {
    village?: string
    category?: string
    entity?: string
  }
  styleRequirements: string
  dependencies: string[]
  additionalGuidance: string
}

interface FlowIssue {
  type: string
  severity: 'error' | 'warning' | 'info'
  location: string
  message: string
  suggestion?: string
}

// ============================================================================
// Config Access
// ============================================================================

let cachedStyleGuide: StyleGuide | null = null

async function getStyleGuide(): Promise<StyleGuide> {
  if (cachedStyleGuide) {
    return cachedStyleGuide
  }

  const basePath = process.env.CONTENT_REPO_PATH || path.join(process.cwd(), 'cinqueterre.travel')
  const guidePath = path.join(basePath, 'content', 'config', 'style-guide.json')

  try {
    const content = await fs.readFile(guidePath, 'utf-8')
    cachedStyleGuide = JSON.parse(content) as StyleGuide
    return cachedStyleGuide
  } catch {
    // Return default style guide
    return {
      voice: 'Giulia Rossi - warm, knowledgeable local expert',
      persona: 'You are Giulia, a lifelong resident of Cinque Terre who knows every hidden corner, best restaurants, and secret swimming spots. You share this knowledge like a friend, with genuine enthusiasm but practical honesty.',
      tone: 'conversational but informative, never salesy or generic',
      formatting: {
        headings: 'sentence case, descriptive',
        lists: '3-7 items, parallel structure',
        paragraphs: '2-4 sentences max, scannable',
      },
      vocabulary: {
        preferred: ['discover', 'experience', 'local', 'authentic', 'seasonal', 'traditional'],
        avoid: ['tourist trap', 'must-see', 'hidden gem', 'bucket list', 'instagrammable', 'best-kept secret'],
      },
    }
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function getWordCountForBlockType(blockType: string): { min: number; max: number } {
  const wordCounts: Record<string, { min: number; max: number }> = {
    'hero': { min: 20, max: 50 },
    'editorial-hero': { min: 30, max: 80 },
    'paragraph': { min: 50, max: 150 },
    'village-intro': { min: 100, max: 300 },
    'faq': { min: 200, max: 500 },
    'places-to-stay': { min: 100, max: 200 },
    'eat-drink': { min: 100, max: 200 },
    'highlights': { min: 150, max: 300 },
    'cta-section': { min: 30, max: 80 },
    'gallery': { min: 20, max: 50 },
  }

  return wordCounts[blockType] || { min: 50, max: 150 }
}

function extractTextFromBlock(block: Record<string, unknown>): string {
  const textParts: string[] = []

  function extract(obj: unknown): void {
    if (!obj || typeof obj !== 'object') return

    if (Array.isArray(obj)) {
      obj.forEach(extract)
      return
    }

    const record = obj as Record<string, unknown>
    for (const [key, value] of Object.entries(record)) {
      if (typeof value === 'string' && key !== 'type' && key !== 'image' && key !== 'src') {
        textParts.push(value)
      } else if (typeof value === 'object') {
        extract(value)
      }
    }
  }

  extract(block)
  return textParts.join(' ')
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(w => w.length > 0).length
}

// ============================================================================
// Tool Handlers
// ============================================================================

/**
 * Create page brief
 */
export const createPageBriefHandler: ToolHandler<{
  page_slug: string
  page_type: string
  template: string
  entity_context?: string
  language?: string
}> = async (input, _context): Promise<ToolResult> => {
  try {
    let template: unknown[]
    try {
      template = JSON.parse(input.template)
    } catch {
      return toolError('Invalid JSON template')
    }

    let entityContext: Record<string, unknown> = {}
    if (input.entity_context) {
      try {
        entityContext = JSON.parse(input.entity_context)
      } catch {
        // Ignore invalid entity context
      }
    }

    const styleGuide = await getStyleGuide()
    const briefs: ComponentBrief[] = []

    for (let i = 0; i < template.length; i++) {
      const component = template[i] as Record<string, unknown>
      const blockType = (component.type as string) || 'paragraph'
      const metadata = getBlockMetadata(blockType)

      const brief: ComponentBrief = {
        index: i,
        type: blockType,
        intent: metadata?.intent || 'inform',
        targetWordCount: getWordCountForBlockType(blockType),
        requiredElements: {
          media: metadata?.mediaRequirements?.required || false,
          links: {
            min: metadata?.linkingRules?.minInternalLinks || 0,
            max: metadata?.linkingRules?.maxInternalLinks || 3,
          },
          ctas: ['cta-section', 'hero-section', 'newsletter'].includes(blockType),
        },
        entityContext: {
          village: (entityContext.village as string) || (entityContext.slug as string),
          category: entityContext.category as string,
          entity: input.page_slug,
        },
        styleRequirements: `Voice: ${styleGuide.voice}. Tone: ${styleGuide.tone}`,
        dependencies: [],
        additionalGuidance: '',
      }

      // Add dependencies based on position
      if (i > 0) {
        brief.dependencies.push(`Follows: ${(template[i - 1] as Record<string, unknown>).type}`)
      }

      // Add specific guidance based on component type
      switch (blockType) {
        case 'hero':
        case 'editorial-hero':
          brief.additionalGuidance = 'Set the scene and capture attention. Establish the page topic immediately.'
          break
        case 'village-intro':
          brief.additionalGuidance = 'Introduce the village character. Include practical essentials (weather, getting there).'
          break
        case 'faq':
          brief.additionalGuidance = 'Answer real visitor questions. Be specific and practical.'
          break
        case 'cta-section':
          brief.additionalGuidance = 'Clear, actionable prompt. Connect to user benefit.'
          break
      }

      briefs.push(brief)
    }

    return toolSuccess({
      page_slug: input.page_slug,
      page_type: input.page_type,
      language: input.language || 'en',
      total_components: briefs.length,
      style_guide_summary: {
        voice: styleGuide.voice,
        tone: styleGuide.tone,
      },
      component_briefs: briefs,
      summary: `Generated ${briefs.length} component briefs for ${input.page_slug}`,
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to create page brief')
  }
}

/**
 * Validate page flow
 */
export const validatePageFlowHandler: ToolHandler<{
  content: string
  page_type: string
  check_redundancy?: boolean
}> = async (input, _context): Promise<ToolResult> => {
  try {
    let content: unknown[]
    try {
      content = JSON.parse(input.content)
    } catch {
      return toolError('Invalid JSON content')
    }

    const checkRedundancy = input.check_redundancy !== false
    const issues: FlowIssue[] = []

    // Expected flow patterns by page type
    const expectedPatterns: Record<string, string[]> = {
      'village': ['hero', 'intro', 'highlights', 'practical', 'cta'],
      'collection': ['hero', 'intro', 'items', 'cta'],
      'editorial': ['hero', 'intro', 'body', 'conclusion'],
      'itinerary': ['hero', 'overview', 'days', 'tips', 'cta'],
    }

    const expectedFlow = expectedPatterns[input.page_type] || expectedPatterns['editorial']

    // Check for expected sections
    const blockTypes = content.map(c => (c as Record<string, unknown>).type as string)
    const hasHero = blockTypes.some(t => t?.includes('hero'))
    const hasIntro = blockTypes.some(t => t?.includes('intro') || t === 'paragraph')

    if (!hasHero) {
      issues.push({
        type: 'missing_section',
        severity: 'warning',
        location: 'start',
        message: 'Page has no hero section',
        suggestion: 'Consider adding a hero block to establish context',
      })
    }

    if (!hasIntro && content.length > 1) {
      issues.push({
        type: 'missing_section',
        severity: 'info',
        location: 'after-hero',
        message: 'No introductory text after hero',
        suggestion: 'Add a brief intro paragraph to orient readers',
      })
    }

    // Check for redundancy
    if (checkRedundancy) {
      const textByBlock: Map<number, string> = new Map()

      for (let i = 0; i < content.length; i++) {
        const block = content[i] as Record<string, unknown>
        const text = extractTextFromBlock(block).toLowerCase()
        textByBlock.set(i, text)

        // Compare with previous blocks
        for (let j = 0; j < i; j++) {
          const prevText = textByBlock.get(j) || ''

          // Check for significant overlap (naive approach)
          const words = text.split(/\s+/).filter(w => w.length > 4)
          const prevWords = new Set(prevText.split(/\s+/).filter(w => w.length > 4))
          const overlap = words.filter(w => prevWords.has(w))

          if (overlap.length > 5 && overlap.length / words.length > 0.3) {
            issues.push({
              type: 'redundancy',
              severity: 'warning',
              location: `blocks[${j}] and blocks[${i}]`,
              message: `Significant content overlap detected (${overlap.length} shared terms)`,
              suggestion: 'Consider consolidating this information',
            })
          }
        }
      }
    }

    // Check flow transitions
    for (let i = 1; i < content.length; i++) {
      const prev = content[i - 1] as Record<string, unknown>
      const curr = content[i] as Record<string, unknown>
      const prevType = prev.type as string
      const currType = curr.type as string

      // Flag potentially jarring transitions
      const jarringTransitions = [
        ['hero', 'faq'],
        ['cta-section', 'paragraph'],
        ['gallery', 'gallery'],
      ]

      for (const [from, to] of jarringTransitions) {
        if (prevType?.includes(from) && currType?.includes(to)) {
          issues.push({
            type: 'flow',
            severity: 'info',
            location: `blocks[${i - 1}] → blocks[${i}]`,
            message: `Transition from ${prevType} to ${currType} may feel abrupt`,
            suggestion: 'Consider adding transitional content',
          })
        }
      }
    }

    const passed = issues.filter(i => i.severity === 'error').length === 0

    return toolSuccess({
      page_type: input.page_type,
      total_blocks: content.length,
      passed,
      issue_count: issues.length,
      issues,
      block_sequence: blockTypes,
      summary: passed
        ? `Page flow validated with ${issues.filter(i => i.severity === 'warning').length} warnings`
        : `Page flow has ${issues.filter(i => i.severity === 'error').length} critical issues`,
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to validate page flow')
  }
}

/**
 * Request component rewrite
 */
export const requestComponentRewriteHandler: ToolHandler<{
  component_index: number
  component_type: string
  current_content: string
  issues: string[]
  context?: string
  style_requirements?: string
}> = async (input, _context): Promise<ToolResult> => {
  try {
    const styleGuide = await getStyleGuide()
    const metadata = getBlockMetadata(input.component_type)

    const rewriteRequest = {
      component_index: input.component_index,
      component_type: input.component_type,
      current_content: input.current_content,
      issues_to_address: input.issues,
      surrounding_context: input.context,
      requirements: {
        intent: metadata?.intent || 'inform',
        word_count: getWordCountForBlockType(input.component_type),
        style: {
          voice: styleGuide.voice,
          tone: styleGuide.tone,
          avoid: styleGuide.vocabulary.avoid,
          prefer: styleGuide.vocabulary.preferred,
        },
        additional: input.style_requirements,
      },
      instructions: `Please rewrite this ${input.component_type} component to address the following issues:\n${input.issues.map((i, idx) => `${idx + 1}. ${i}`).join('\n')}\n\nMaintain the ${styleGuide.voice} voice and ${styleGuide.tone} tone.`,
    }

    return toolSuccess({
      rewrite_request: rewriteRequest,
      summary: `Generated rewrite request for block ${input.component_index} (${input.component_type}) with ${input.issues.length} issues`,
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to create rewrite request')
  }
}

/**
 * Get style guide
 */
export const getStyleGuideHandler: ToolHandler<{
  section?: string
}> = async (input, _context): Promise<ToolResult> => {
  try {
    const styleGuide = await getStyleGuide()

    if (input.section) {
      const sectionData = (styleGuide as Record<string, unknown>)[input.section]
      if (sectionData !== undefined) {
        return toolSuccess({
          section: input.section,
          content: sectionData,
        })
      }
      return toolError(`Section not found: ${input.section}`)
    }

    return toolSuccess({
      style_guide: styleGuide,
      summary: `Style guide loaded: ${styleGuide.voice}`,
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to get style guide')
  }
}

/**
 * Analyze component dependencies
 */
export const analyzeComponentDependenciesHandler: ToolHandler<{
  template: string
  page_type?: string
}> = async (input, _context): Promise<ToolResult> => {
  try {
    let template: unknown[]
    try {
      template = JSON.parse(input.template)
    } catch {
      return toolError('Invalid JSON template')
    }

    interface Dependency {
      from: number
      to: number
      type: string
      description: string
    }

    const dependencies: Dependency[] = []

    // Analyze component relationships
    for (let i = 0; i < template.length; i++) {
      const component = template[i] as Record<string, unknown>
      const blockType = component.type as string

      // Hero establishes context for everything after
      if (blockType?.includes('hero')) {
        for (let j = i + 1; j < template.length; j++) {
          dependencies.push({
            from: i,
            to: j,
            type: 'context',
            description: 'Hero establishes page context',
          })
        }
      }

      // Intro should reference hero elements
      if (blockType?.includes('intro') && i > 0) {
        dependencies.push({
          from: 0,
          to: i,
          type: 'reference',
          description: 'Intro should expand on hero promise',
        })
      }

      // CTA should relate to preceding content
      if (blockType?.includes('cta')) {
        if (i > 0) {
          dependencies.push({
            from: i - 1,
            to: i,
            type: 'transition',
            description: 'CTA should relate to preceding content',
          })
        }
      }
    }

    // Build dependency graph summary
    const blockTypes = template.map((c, i) => ({
      index: i,
      type: (c as Record<string, unknown>).type as string,
      dependencies_from: dependencies.filter(d => d.to === i).length,
      dependencies_to: dependencies.filter(d => d.from === i).length,
    }))

    return toolSuccess({
      total_components: template.length,
      total_dependencies: dependencies.length,
      dependencies,
      component_summary: blockTypes,
      recommended_order: blockTypes.sort((a, b) => b.dependencies_to - a.dependencies_to).map(b => b.index),
      summary: `Analyzed ${template.length} components with ${dependencies.length} dependencies`,
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to analyze dependencies')
  }
}

/**
 * Generate transition text
 */
export const generateTransitionTextHandler: ToolHandler<{
  previous_component: string
  next_component: string
  style_context?: string
}> = async (input, _context): Promise<ToolResult> => {
  try {
    let prevComponent: Record<string, unknown>
    let nextComponent: Record<string, unknown>

    try {
      prevComponent = JSON.parse(input.previous_component)
      nextComponent = JSON.parse(input.next_component)
    } catch {
      return toolError('Invalid JSON for components')
    }

    const styleGuide = await getStyleGuide()
    const prevType = prevComponent.type as string
    const nextType = nextComponent.type as string

    // Generate transition suggestions based on component types
    const transitionPatterns: Record<string, string[]> = {
      'hero→paragraph': [
        'Beyond the stunning views, {village} has much more to offer.',
        'There\'s more to {village} than meets the eye.',
        'Let me share what makes {village} truly special.',
      ],
      'paragraph→faq': [
        'Visitors often wonder about the practicalities.',
        'Here are answers to the questions I hear most often.',
        'Before you go, let me address some common questions.',
      ],
      'highlights→cta': [
        'Ready to experience this for yourself?',
        'Sound like your kind of adventure?',
        'Want to make this happen?',
      ],
      'default': [
        'Speaking of which...',
        'On a related note...',
        'While we\'re on the topic...',
      ],
    }

    const key = `${prevType?.split('-')[0]}→${nextType?.split('-')[0]}`
    const patterns = transitionPatterns[key] || transitionPatterns['default']

    return toolSuccess({
      previous_type: prevType,
      next_type: nextType,
      style_voice: styleGuide.voice,
      suggested_transitions: patterns,
      recommended: patterns[0],
      guidance: `Use a natural transition that maintains the ${styleGuide.tone} tone. The transition should feel conversational, as if ${styleGuide.voice.split(' - ')[0]} is guiding the reader.`,
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to generate transition')
  }
}

/**
 * Check editorial coherence
 */
export const checkEditorialCoherenceHandler: ToolHandler<{
  content: string
  expected_voice?: string
}> = async (input, _context): Promise<ToolResult> => {
  try {
    let content: unknown[]
    try {
      content = JSON.parse(input.content)
    } catch {
      return toolError('Invalid JSON content')
    }

    const styleGuide = await getStyleGuide()
    const expectedVoice = input.expected_voice || styleGuide.voice
    const issues: Array<{ block: number; type: string; message: string }> = []

    // Check vocabulary across blocks
    const avoidWords = styleGuide.vocabulary.avoid.map(w => w.toLowerCase())

    for (let i = 0; i < content.length; i++) {
      const block = content[i] as Record<string, unknown>
      const text = extractTextFromBlock(block).toLowerCase()
      const words = text.split(/\s+/)

      // Check for avoided vocabulary
      for (const word of words) {
        for (const avoid of avoidWords) {
          if (word.includes(avoid) || avoid.includes(word)) {
            issues.push({
              block: i,
              type: 'vocabulary',
              message: `Uses discouraged term near "${word}" (avoid: ${avoid})`,
            })
          }
        }
      }

      // Check for overly formal language (basic heuristic)
      const formalIndicators = ['hereby', 'whereas', 'henceforth', 'aforementioned']
      for (const formal of formalIndicators) {
        if (text.includes(formal)) {
          issues.push({
            block: i,
            type: 'tone',
            message: `Overly formal language detected: "${formal}"`,
          })
        }
      }

      // Check for generic marketing speak
      const genericPhrases = ['best in class', 'world-class', 'state of the art', 'one-of-a-kind']
      for (const phrase of genericPhrases) {
        if (text.includes(phrase)) {
          issues.push({
            block: i,
            type: 'authenticity',
            message: `Generic marketing language: "${phrase}"`,
          })
        }
      }
    }

    const passed = issues.length === 0

    return toolSuccess({
      expected_voice: expectedVoice,
      blocks_analyzed: content.length,
      passed,
      issue_count: issues.length,
      issues,
      vocabulary_check: {
        avoided_terms: styleGuide.vocabulary.avoid,
        preferred_terms: styleGuide.vocabulary.preferred,
      },
      summary: passed
        ? 'Editorial voice is consistent across all blocks'
        : `Found ${issues.length} voice/tone issues`,
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to check editorial coherence')
  }
}

// ============================================================================
// Export Handler Map
// ============================================================================

export const pageOrchestratorToolHandlers: Record<string, ToolHandler> = {
  create_page_brief: createPageBriefHandler,
  validate_page_flow: validatePageFlowHandler,
  request_component_rewrite: requestComponentRewriteHandler,
  get_style_guide: getStyleGuideHandler,
  analyze_component_dependencies: analyzeComponentDependenciesHandler,
  generate_transition_text: generateTransitionTextHandler,
  check_editorial_coherence: checkEditorialCoherenceHandler,
}
