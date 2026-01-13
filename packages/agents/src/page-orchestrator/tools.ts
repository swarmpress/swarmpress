/**
 * PageOrchestratorAgent Tool Definitions
 * Tools for coordinating page composition and ensuring editorial coherence
 */

import {
  ToolDefinition,
  stringProp,
  numberProp,
  arrayProp,
  booleanProp,
} from '../base/tools'

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * Create page brief - Generate component-by-component micro-briefs
 */
export const createPageBriefTool: ToolDefinition = {
  name: 'create_page_brief',
  description: `Generate a structured brief for a page, broken down by component.

Takes a page template/blueprint and produces detailed briefs for each section that
can be passed to WriterAgent for content generation.

Each component brief includes:
- Intent (showcase, inform, navigate, convert)
- Target word count
- Required elements (media, links, CTAs)
- Entity context (village, category)
- Style requirements from style-guide
- Dependencies on other components`,
  input_schema: {
    type: 'object',
    properties: {
      page_slug: stringProp('Page slug (e.g., "riomaggiore", "riomaggiore/restaurants")'),
      page_type: stringProp('Page type (e.g., "village", "collection", "editorial")'),
      template: stringProp('JSON string of page template/blueprint'),
      entity_context: stringProp('JSON string of entity context (village data, etc.)'),
      language: stringProp('Target language (default: "en")'),
    },
    required: ['page_slug', 'page_type', 'template'],
  },
}

/**
 * Validate page flow - Check narrative transitions and redundancy
 */
export const validatePageFlowTool: ToolDefinition = {
  name: 'validate_page_flow',
  description: `Analyze a page's narrative structure for coherence issues.

Checks:
- Logical flow from intro → body → conclusion
- Transition smoothness between sections
- Redundant information across components
- Missing expected sections for page type
- Appropriate progression (general → specific)`,
  input_schema: {
    type: 'object',
    properties: {
      content: stringProp('JSON string of page content blocks'),
      page_type: stringProp('Expected page type'),
      check_redundancy: booleanProp('Check for duplicate information (default: true)'),
    },
    required: ['content', 'page_type'],
  },
}

/**
 * Request component rewrite - Ask WriterAgent to revise specific component
 */
export const requestComponentRewriteTool: ToolDefinition = {
  name: 'request_component_rewrite',
  description: `Generate a rewrite request for a specific component.

Use this when:
- Component doesn't match page tone
- Transitions are jarring
- Content overlaps with other sections
- Style doesn't match guidelines

Returns a structured rewrite request that can be passed to WriterAgent.`,
  input_schema: {
    type: 'object',
    properties: {
      component_index: numberProp('Index of the component in the page'),
      component_type: stringProp('Type of the component (e.g., "paragraph", "hero")'),
      current_content: stringProp('Current content of the component'),
      issues: arrayProp(
        'List of issues to address',
        stringProp('Specific issue description')
      ),
      context: stringProp('Context from surrounding components'),
      style_requirements: stringProp('Style requirements from style-guide'),
    },
    required: ['component_index', 'component_type', 'current_content', 'issues'],
  },
}

/**
 * Get style guide - Retrieve editorial voice and style requirements
 */
export const getStyleGuideTool: ToolDefinition = {
  name: 'get_style_guide',
  description: `Retrieve the editorial style guide for content creation.

Returns:
- Voice/persona description
- Tone guidelines
- Formatting rules
- Vocabulary preferences (use/avoid)
- Examples of good writing`,
  input_schema: {
    type: 'object',
    properties: {
      section: stringProp('Specific section of guide to retrieve (optional)'),
    },
    required: [],
  },
}

/**
 * Analyze component dependencies - Map relationships between components
 */
export const analyzeComponentDependenciesTool: ToolDefinition = {
  name: 'analyze_component_dependencies',
  description: `Analyze how components on a page depend on each other.

Identifies:
- Information flow (what needs to be established first)
- Cross-references (components that mention each other)
- Shared entities (village, places mentioned in multiple sections)
- Visual progression (hero → gallery → detail)`,
  input_schema: {
    type: 'object',
    properties: {
      template: stringProp('JSON string of page template'),
      page_type: stringProp('Page type for expected patterns'),
    },
    required: ['template'],
  },
}

/**
 * Generate transition text - Create connective tissue between sections
 */
export const generateTransitionTextTool: ToolDefinition = {
  name: 'generate_transition_text',
  description: `Generate smooth transition text between two components.

Creates natural-sounding connective phrases that:
- Link the previous section's conclusion to the next section's focus
- Maintain narrative momentum
- Avoid abrupt topic changes
- Match the overall voice/tone`,
  input_schema: {
    type: 'object',
    properties: {
      previous_component: stringProp('JSON of the previous component'),
      next_component: stringProp('JSON of the next component'),
      style_context: stringProp('Voice/tone requirements'),
    },
    required: ['previous_component', 'next_component'],
  },
}

/**
 * Check editorial coherence - Verify unified voice across page
 */
export const checkEditorialCoherenceTool: ToolDefinition = {
  name: 'check_editorial_coherence',
  description: `Verify that the entire page maintains a unified editorial voice.

Checks:
- Consistent tone across components
- Matching vocabulary patterns
- Coherent narrative perspective (first/second/third person)
- Aligned formality level
- Personality consistency (per style-guide persona)`,
  input_schema: {
    type: 'object',
    properties: {
      content: stringProp('JSON string of all page content'),
      expected_voice: stringProp('Expected voice/persona from style-guide'),
    },
    required: ['content'],
  },
}

// ============================================================================
// Export All Tools
// ============================================================================

export const pageOrchestratorTools = [
  createPageBriefTool,
  validatePageFlowTool,
  requestComponentRewriteTool,
  getStyleGuideTool,
  analyzeComponentDependenciesTool,
  generateTransitionTextTool,
  checkEditorialCoherenceTool,
]
