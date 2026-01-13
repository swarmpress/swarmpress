/**
 * PagePolishAgent Tool Definitions
 * Tools for refining page content, transitions, and voice consistency
 */

import {
  ToolDefinition,
  stringProp,
  arrayProp,
  booleanProp,
} from '../base/tools'

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * Rewrite transitions - Smooth connective tissue between sections
 */
export const rewriteTransitionsTool: ToolDefinition = {
  name: 'rewrite_transitions',
  description: `Identify and improve weak transitions between page sections.

Analyzes the endings of sections and beginnings of subsequent sections to:
- Identify abrupt topic changes
- Find missing connective phrases
- Suggest smooth transition rewrites

Returns specific rewrite suggestions for each weak transition point.`,
  input_schema: {
    type: 'object',
    properties: {
      content: stringProp('JSON string of page content blocks'),
      style_voice: stringProp('Expected voice/persona for consistent tone'),
    },
    required: ['content'],
  },
}

/**
 * Remove redundancy - Identify and consolidate repeated information
 */
export const removeRedundancyTool: ToolDefinition = {
  name: 'remove_redundancy',
  description: `Find and consolidate redundant information across page sections.

Identifies:
- Repeated facts or details
- Similar phrasing appearing multiple times
- Information that could be consolidated
- Cross-references that could replace repetition

Returns specific edit suggestions to reduce redundancy while maintaining flow.`,
  input_schema: {
    type: 'object',
    properties: {
      content: stringProp('JSON string of page content blocks'),
      consolidation_threshold: stringProp('Minimum similarity for flagging (0-1, default: 0.3)'),
    },
    required: ['content'],
  },
}

/**
 * Unify voice - Ensure consistent tone throughout
 */
export const unifyVoiceTool: ToolDefinition = {
  name: 'unify_voice',
  description: `Analyze and adjust content to maintain consistent editorial voice.

Checks each section against the style guide persona and identifies:
- Tone inconsistencies (too formal/informal)
- Vocabulary that doesn't match the voice
- Perspective shifts (I/we/you inconsistencies)
- Personality drift from section to section

Returns specific rewrites to unify the voice.`,
  input_schema: {
    type: 'object',
    properties: {
      content: stringProp('JSON string of page content blocks'),
      target_voice: stringProp('Description of target voice/persona'),
      fix_automatically: booleanProp('Return fixed content (true) or just suggestions (false)'),
    },
    required: ['content'],
  },
}

/**
 * Polish prose - Improve sentence-level writing quality
 */
export const polishProseTool: ToolDefinition = {
  name: 'polish_prose',
  description: `Improve prose quality at the sentence level.

Identifies and fixes:
- Awkward phrasing
- Passive voice overuse
- Run-on sentences
- Unclear references
- Weak verbs
- Filler words

Returns polished text with tracked changes.`,
  input_schema: {
    type: 'object',
    properties: {
      text: stringProp('Text content to polish'),
      preserve_meaning: booleanProp('Prioritize meaning preservation over style (default: true)'),
      target_reading_level: stringProp('Target reading level: "general", "educated", "expert"'),
    },
    required: ['text'],
  },
}

/**
 * Optimize scanability - Improve content structure for quick reading
 */
export const optimizeScanabilityTool: ToolDefinition = {
  name: 'optimize_scanability',
  description: `Improve content structure for readers who scan rather than read deeply.

Suggests:
- Breaking long paragraphs
- Adding subheadings
- Using bullet lists where appropriate
- Front-loading important information
- Improving visual hierarchy`,
  input_schema: {
    type: 'object',
    properties: {
      content: stringProp('JSON string of page content blocks'),
      max_paragraph_sentences: stringProp('Maximum sentences per paragraph (default: 4)'),
    },
    required: ['content'],
  },
}

/**
 * Check reading flow - Verify content reads naturally
 */
export const checkReadingFlowTool: ToolDefinition = {
  name: 'check_reading_flow',
  description: `Analyze content for natural reading flow.

Checks:
- Sentence length variation (avoid monotony)
- Paragraph rhythm
- Natural topic progression
- Engaging opening sentences
- Satisfying conclusions`,
  input_schema: {
    type: 'object',
    properties: {
      content: stringProp('JSON string of page content blocks'),
      detailed_analysis: booleanProp('Include detailed sentence-level analysis (default: false)'),
    },
    required: ['content'],
  },
}

/**
 * Generate conclusion - Create satisfying page endings
 */
export const generateConclusionTool: ToolDefinition = {
  name: 'generate_conclusion',
  description: `Generate or improve the concluding section of a page.

Creates conclusions that:
- Summarize key points naturally
- Provide clear next steps
- Match the page's tone
- Leave readers satisfied
- Include appropriate CTA when needed`,
  input_schema: {
    type: 'object',
    properties: {
      content: stringProp('JSON string of preceding content blocks'),
      page_type: stringProp('Type of page for appropriate conclusion style'),
      include_cta: booleanProp('Include call-to-action (default: true for most page types)'),
    },
    required: ['content', 'page_type'],
  },
}

// ============================================================================
// Export All Tools
// ============================================================================

export const pagePolishTools = [
  rewriteTransitionsTool,
  removeRedundancyTool,
  unifyVoiceTool,
  polishProseTool,
  optimizeScanabilityTool,
  checkReadingFlowTool,
  generateConclusionTool,
]
