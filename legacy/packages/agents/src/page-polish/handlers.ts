/**
 * PagePolishAgent Tool Handlers
 * Implementations for refining page content, transitions, and voice
 */

import { ToolHandler, ToolResult, toolSuccess, toolError } from '../base/tools'
import * as fs from 'fs/promises'
import * as path from 'path'

// ============================================================================
// Types
// ============================================================================

interface StyleGuide {
  voice: string
  persona: string
  tone: string
  vocabulary: {
    preferred: string[]
    avoid: string[]
  }
}

interface TransitionIssue {
  fromBlock: number
  toBlock: number
  issue: string
  suggestion: string
  severity: 'weak' | 'jarring' | 'missing'
}

interface RedundancyIssue {
  blocks: number[]
  repeatedContent: string
  suggestion: string
}

interface VoiceIssue {
  block: number
  issue: string
  originalText: string
  suggestedText: string
  issueType: 'vocabulary' | 'tone' | 'perspective' | 'formality'
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
    return {
      voice: 'Giulia Rossi - warm, knowledgeable local expert',
      persona: 'A lifelong Cinque Terre resident sharing local knowledge like a friend.',
      tone: 'conversational but informative',
      vocabulary: {
        preferred: ['discover', 'experience', 'local', 'authentic'],
        avoid: ['tourist trap', 'must-see', 'hidden gem', 'bucket list'],
      },
    }
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

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
      if (typeof value === 'string' && !['type', 'image', 'src', 'href', 'id'].includes(key)) {
        textParts.push(value)
      } else if (typeof value === 'object') {
        extract(value)
      }
    }
  }

  extract(block)
  return textParts.join(' ')
}

function getLastSentence(text: string): string {
  const sentences = text.match(/[^.!?]+[.!?]+/g) || []
  return sentences.length > 0 ? sentences[sentences.length - 1].trim() : text.trim()
}

function getFirstSentence(text: string): string {
  const sentences = text.match(/[^.!?]+[.!?]+/g) || []
  return sentences.length > 0 ? sentences[0].trim() : text.trim()
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(w => w.length > 0).length
}

function getSentences(text: string): string[] {
  return text.match(/[^.!?]+[.!?]+/g)?.map(s => s.trim()) || []
}

function findCommonPhrases(text1: string, text2: string): string[] {
  const words1 = text1.toLowerCase().split(/\s+/)
  const words2 = text2.toLowerCase().split(/\s+/)
  const common: string[] = []

  // Find 3+ word phrases that appear in both
  for (let i = 0; i < words1.length - 2; i++) {
    const phrase = words1.slice(i, i + 3).join(' ')
    if (text2.toLowerCase().includes(phrase) && !common.includes(phrase)) {
      common.push(phrase)
    }
  }

  return common
}

// ============================================================================
// Tool Handlers
// ============================================================================

/**
 * Rewrite transitions
 */
export const rewriteTransitionsHandler: ToolHandler<{
  content: string
  style_voice?: string
}> = async (input, _context): Promise<ToolResult> => {
  try {
    let content: unknown[]
    try {
      content = JSON.parse(input.content)
    } catch {
      return toolError('Invalid JSON content')
    }

    const styleGuide = await getStyleGuide()
    const issues: TransitionIssue[] = []

    for (let i = 1; i < content.length; i++) {
      const prevBlock = content[i - 1] as Record<string, unknown>
      const currBlock = content[i] as Record<string, unknown>

      const prevText = extractTextFromBlock(prevBlock)
      const currText = extractTextFromBlock(currBlock)

      if (!prevText || !currText) continue

      const lastSentence = getLastSentence(prevText)
      const firstSentence = getFirstSentence(currText)

      // Check for jarring transitions
      const prevType = prevBlock.type as string
      const currType = currBlock.type as string

      // Detect abrupt topic changes
      if (prevType !== currType) {
        // Check if there's any connecting language
        const connectingWords = ['however', 'additionally', 'moreover', 'speaking of', 'while', 'beyond', 'in addition']
        const hasConnection = connectingWords.some(w => firstSentence.toLowerCase().includes(w))

        if (!hasConnection) {
          issues.push({
            fromBlock: i - 1,
            toBlock: i,
            issue: `Abrupt transition from ${prevType} to ${currType}`,
            suggestion: `Consider adding a connecting phrase. The ${prevType} ends with: "${lastSentence.substring(0, 50)}..." and ${currType} begins with: "${firstSentence.substring(0, 50)}..."`,
            severity: 'weak',
          })
        }
      }

      // Check for jarring tone shifts
      const prevWordCount = countWords(lastSentence)
      const currWordCount = countWords(firstSentence)

      if (Math.abs(prevWordCount - currWordCount) > 20) {
        issues.push({
          fromBlock: i - 1,
          toBlock: i,
          issue: 'Significant sentence length change may feel jarring',
          suggestion: 'Consider balancing sentence lengths at transition points',
          severity: 'weak',
        })
      }
    }

    return toolSuccess({
      blocks_analyzed: content.length,
      transition_points: content.length - 1,
      issues_found: issues.length,
      issues,
      summary: issues.length === 0
        ? 'All transitions are smooth'
        : `Found ${issues.length} transition issues to address`,
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to analyze transitions')
  }
}

/**
 * Remove redundancy
 */
export const removeRedundancyHandler: ToolHandler<{
  content: string
  consolidation_threshold?: string
}> = async (input, _context): Promise<ToolResult> => {
  try {
    let content: unknown[]
    try {
      content = JSON.parse(input.content)
    } catch {
      return toolError('Invalid JSON content')
    }

    const issues: RedundancyIssue[] = []
    const blockTexts: Map<number, string> = new Map()

    // Extract text from each block
    for (let i = 0; i < content.length; i++) {
      blockTexts.set(i, extractTextFromBlock(content[i] as Record<string, unknown>).toLowerCase())
    }

    // Compare each pair of blocks
    for (let i = 0; i < content.length; i++) {
      const text1 = blockTexts.get(i) || ''

      for (let j = i + 1; j < content.length; j++) {
        const text2 = blockTexts.get(j) || ''

        // Find common phrases
        const commonPhrases = findCommonPhrases(text1, text2)

        if (commonPhrases.length > 0) {
          issues.push({
            blocks: [i, j],
            repeatedContent: commonPhrases.slice(0, 3).join(', '),
            suggestion: `Consider consolidating repeated information about "${commonPhrases[0]}" - either keep in one place or use cross-references`,
          })
        }
      }
    }

    return toolSuccess({
      blocks_analyzed: content.length,
      redundancies_found: issues.length,
      issues,
      summary: issues.length === 0
        ? 'No significant redundancies detected'
        : `Found ${issues.length} areas with repeated information`,
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to check redundancy')
  }
}

/**
 * Unify voice
 */
export const unifyVoiceHandler: ToolHandler<{
  content: string
  target_voice?: string
  fix_automatically?: boolean
}> = async (input, _context): Promise<ToolResult> => {
  try {
    let content: unknown[]
    try {
      content = JSON.parse(input.content)
    } catch {
      return toolError('Invalid JSON content')
    }

    const styleGuide = await getStyleGuide()
    const issues: VoiceIssue[] = []

    const avoidWords = styleGuide.vocabulary.avoid.map(w => w.toLowerCase())
    const preferWords = styleGuide.vocabulary.preferred

    for (let i = 0; i < content.length; i++) {
      const block = content[i] as Record<string, unknown>
      const text = extractTextFromBlock(block)
      const lowerText = text.toLowerCase()

      // Check for vocabulary issues
      for (const avoid of avoidWords) {
        if (lowerText.includes(avoid)) {
          const sentences = getSentences(text)
          const problemSentence = sentences.find(s => s.toLowerCase().includes(avoid)) || text.substring(0, 100)

          issues.push({
            block: i,
            issue: `Uses discouraged phrase: "${avoid}"`,
            originalText: problemSentence,
            suggestedText: `Rewrite to avoid "${avoid}" - ${styleGuide.voice} wouldn't use this term`,
            issueType: 'vocabulary',
          })
        }
      }

      // Check for overly formal language
      const formalIndicators = ['hereby', 'pursuant', 'aforementioned', 'heretofore', 'whilst']
      for (const formal of formalIndicators) {
        if (lowerText.includes(formal)) {
          issues.push({
            block: i,
            issue: `Overly formal language: "${formal}"`,
            originalText: text.substring(0, 100),
            suggestedText: `Rewrite in conversational tone - ${styleGuide.voice.split(' - ')[0]} would say this more casually`,
            issueType: 'formality',
          })
        }
      }

      // Check for perspective consistency (basic check for "I" vs "we" vs "you")
      const hasI = /\bI\b/.test(text)
      const hasWe = /\bwe\b/i.test(text)
      if (hasI && hasWe) {
        issues.push({
          block: i,
          issue: 'Mixed first-person perspective (I and we)',
          originalText: text.substring(0, 100),
          suggestedText: 'Choose consistent perspective - prefer "we" for publication voice or "I" for personal anecdotes',
          issueType: 'perspective',
        })
      }
    }

    return toolSuccess({
      target_voice: input.target_voice || styleGuide.voice,
      blocks_analyzed: content.length,
      issues_found: issues.length,
      issues,
      vocabulary_guidance: {
        avoid: styleGuide.vocabulary.avoid,
        prefer: styleGuide.vocabulary.preferred,
      },
      summary: issues.length === 0
        ? 'Voice is consistent throughout'
        : `Found ${issues.length} voice/tone issues`,
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to unify voice')
  }
}

/**
 * Polish prose
 */
export const polishProseHandler: ToolHandler<{
  text: string
  preserve_meaning?: boolean
  target_reading_level?: string
}> = async (input, _context): Promise<ToolResult> => {
  try {
    const text = input.text
    interface ProseSuggestion {
      type: string
      original: string
      suggestion: string
      location: string
    }
    const suggestions: ProseSuggestion[] = []

    const sentences = getSentences(text)

    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i]

      // Check for passive voice (simple heuristic)
      if (/\b(is|are|was|were|been|being)\s+\w+ed\b/.test(sentence)) {
        suggestions.push({
          type: 'passive_voice',
          original: sentence,
          suggestion: 'Consider rewriting in active voice for more engaging prose',
          location: `sentence ${i + 1}`,
        })
      }

      // Check for filler words
      const fillers = ['very', 'really', 'quite', 'rather', 'somewhat', 'basically', 'actually', 'literally']
      for (const filler of fillers) {
        if (sentence.toLowerCase().includes(` ${filler} `)) {
          suggestions.push({
            type: 'filler_word',
            original: sentence,
            suggestion: `Consider removing "${filler}" for more concise prose`,
            location: `sentence ${i + 1}`,
          })
        }
      }

      // Check for weak verbs
      const weakVerbs = ['is a', 'there are', 'there is', 'it is']
      for (const weak of weakVerbs) {
        if (sentence.toLowerCase().startsWith(weak)) {
          suggestions.push({
            type: 'weak_opening',
            original: sentence,
            suggestion: 'Consider starting with a stronger verb or subject',
            location: `sentence ${i + 1}`,
          })
        }
      }

      // Check for very long sentences
      const wordCount = countWords(sentence)
      if (wordCount > 30) {
        suggestions.push({
          type: 'long_sentence',
          original: sentence,
          suggestion: `This sentence has ${wordCount} words - consider breaking into two sentences`,
          location: `sentence ${i + 1}`,
        })
      }
    }

    return toolSuccess({
      original_length: text.length,
      sentence_count: sentences.length,
      suggestions_count: suggestions.length,
      suggestions,
      summary: suggestions.length === 0
        ? 'Prose is clean'
        : `Found ${suggestions.length} opportunities to improve prose`,
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to polish prose')
  }
}

/**
 * Optimize scanability
 */
export const optimizeScanabilityHandler: ToolHandler<{
  content: string
  max_paragraph_sentences?: string
}> = async (input, _context): Promise<ToolResult> => {
  try {
    let content: unknown[]
    try {
      content = JSON.parse(input.content)
    } catch {
      return toolError('Invalid JSON content')
    }

    const maxSentences = parseInt(input.max_paragraph_sentences || '4', 10)
    interface ScanabilitySuggestion {
      block: number
      type: string
      message: string
    }
    const suggestions: ScanabilitySuggestion[] = []

    for (let i = 0; i < content.length; i++) {
      const block = content[i] as Record<string, unknown>
      const text = extractTextFromBlock(block)
      const sentences = getSentences(text)

      // Check paragraph length
      if (sentences.length > maxSentences) {
        suggestions.push({
          block: i,
          type: 'long_paragraph',
          message: `Block has ${sentences.length} sentences - consider breaking into smaller paragraphs`,
        })
      }

      // Check for bullet list opportunities
      if (text.includes(' and ') && text.includes(' and ', text.indexOf(' and ') + 5)) {
        suggestions.push({
          block: i,
          type: 'list_opportunity',
          message: 'Multiple items listed - consider using a bullet list for better scanability',
        })
      }

      // Check for important information buried
      const firstSentence = sentences[0] || ''
      if (firstSentence.toLowerCase().startsWith('but ') || firstSentence.toLowerCase().startsWith('however ')) {
        suggestions.push({
          block: i,
          type: 'front_load',
          message: 'Key point may be buried - consider front-loading the main insight',
        })
      }
    }

    return toolSuccess({
      blocks_analyzed: content.length,
      suggestions_count: suggestions.length,
      suggestions,
      summary: suggestions.length === 0
        ? 'Content is well-structured for scanning'
        : `Found ${suggestions.length} opportunities to improve scanability`,
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to optimize scanability')
  }
}

/**
 * Check reading flow
 */
export const checkReadingFlowHandler: ToolHandler<{
  content: string
  detailed_analysis?: boolean
}> = async (input, _context): Promise<ToolResult> => {
  try {
    let content: unknown[]
    try {
      content = JSON.parse(input.content)
    } catch {
      return toolError('Invalid JSON content')
    }

    interface FlowAnalysis {
      block: number
      sentenceCount: number
      avgSentenceLength: number
      hasEngagingOpener: boolean
      hasSatisfyingClose: boolean
    }
    const analysis: FlowAnalysis[] = []
    interface FlowIssue {
      type: string
      message: string
      block?: number
    }
    const issues: FlowIssue[] = []

    for (let i = 0; i < content.length; i++) {
      const block = content[i] as Record<string, unknown>
      const text = extractTextFromBlock(block)
      const sentences = getSentences(text)

      if (sentences.length === 0) continue

      const lengths = sentences.map(s => countWords(s))
      const avgLength = lengths.reduce((a, b) => a + b, 0) / lengths.length

      // Check for sentence length variation
      const minLength = Math.min(...lengths)
      const maxLength = Math.max(...lengths)
      const variation = maxLength - minLength

      if (variation < 5 && sentences.length > 3) {
        issues.push({
          type: 'monotonous_rhythm',
          message: `Block ${i} has little sentence length variation (${minLength}-${maxLength} words) - vary rhythm for engagement`,
          block: i,
        })
      }

      // Check opening engagement
      const firstSentence = sentences[0].toLowerCase()
      const engagingOpeners = ['imagine', 'picture', 'when', 'if you', 'there\'s', 'nothing']
      const hasEngagingOpener = engagingOpeners.some(o => firstSentence.startsWith(o))

      analysis.push({
        block: i,
        sentenceCount: sentences.length,
        avgSentenceLength: Math.round(avgLength),
        hasEngagingOpener,
        hasSatisfyingClose: sentences[sentences.length - 1].length > 20,
      })
    }

    return toolSuccess({
      blocks_analyzed: content.length,
      analysis: input.detailed_analysis ? analysis : undefined,
      issue_count: issues.length,
      issues,
      summary: issues.length === 0
        ? 'Reading flow is good'
        : `Found ${issues.length} flow issues`,
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to check reading flow')
  }
}

/**
 * Generate conclusion
 */
export const generateConclusionHandler: ToolHandler<{
  content: string
  page_type: string
  include_cta?: boolean
}> = async (input, _context): Promise<ToolResult> => {
  try {
    let content: unknown[]
    try {
      content = JSON.parse(input.content)
    } catch {
      return toolError('Invalid JSON content')
    }

    const styleGuide = await getStyleGuide()
    const includeCTA = input.include_cta !== false

    // Extract key themes from content
    const allText = content.map(b => extractTextFromBlock(b as Record<string, unknown>)).join(' ')
    const words = allText.toLowerCase().split(/\s+/)
    const wordFreq: Record<string, number> = {}
    for (const word of words) {
      if (word.length > 5) {
        wordFreq[word] = (wordFreq[word] || 0) + 1
      }
    }
    const keyThemes = Object.entries(wordFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([word]) => word)

    // Generate conclusion template based on page type
    const conclusionTemplates: Record<string, { opening: string; cta: string }> = {
      'village': {
        opening: '{village} offers a unique glimpse into Cinque Terre life.',
        cta: 'Ready to explore? Start planning your visit to {village}.',
      },
      'collection': {
        opening: 'Whether you\'re looking for {theme1} or {theme2}, you\'ll find it here.',
        cta: 'Browse our complete collection to find your perfect match.',
      },
      'editorial': {
        opening: 'From {theme1} to {theme2}, these experiences make {topic} unforgettable.',
        cta: 'Want to experience this yourself? Let us help you plan.',
      },
      'itinerary': {
        opening: 'This itinerary balances {theme1} with {theme2} for a complete experience.',
        cta: 'Ready to make this journey? Book your trip today.',
      },
    }

    const template = conclusionTemplates[input.page_type] || conclusionTemplates['editorial']

    return toolSuccess({
      page_type: input.page_type,
      key_themes_detected: keyThemes,
      conclusion_template: {
        opening: template.opening,
        cta: includeCTA ? template.cta : null,
      },
      style_guidance: `Write in ${styleGuide.voice} style - ${styleGuide.tone}`,
      suggested_structure: [
        'Summarize the key value proposition (1 sentence)',
        'Acknowledge what makes this special (1 sentence)',
        includeCTA ? 'Clear call to action (1 sentence)' : null,
      ].filter(Boolean),
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to generate conclusion')
  }
}

// ============================================================================
// Export Handler Map
// ============================================================================

export const pagePolishToolHandlers: Record<string, ToolHandler> = {
  rewrite_transitions: rewriteTransitionsHandler,
  remove_redundancy: removeRedundancyHandler,
  unify_voice: unifyVoiceHandler,
  polish_prose: polishProseHandler,
  optimize_scanability: optimizeScanabilityHandler,
  check_reading_flow: checkReadingFlowHandler,
  generate_conclusion: generateConclusionHandler,
}
