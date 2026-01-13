/**
 * LinkerAgent Tool Definitions
 * Tools for finding link opportunities and managing internal links
 */

import {
  ToolDefinition,
  stringProp,
  numberProp,
  arrayProp,
} from '../base/tools'

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * Find link opportunities - Scan text for entity mentions that could be linked
 */
export const findLinkOpportunitiesTool: ToolDefinition = {
  name: 'find_link_opportunities',
  description: `Scan content for entity mentions that could become internal links.

This tool analyzes text content and identifies:
- Village names and aliases (e.g., "Riomaggiore", "the easternmost village")
- Trail names (e.g., "Via dell'Amore", "Sentiero Azzurro")
- Category keywords (e.g., "restaurants", "hiking trails", "beaches")
- POI names and landmarks

For each mention, it suggests the appropriate link from sitemap-index.json.

IMPORTANT: Only suggests links that exist in the sitemap. Never invents URLs.`,
  input_schema: {
    type: 'object',
    properties: {
      content: stringProp('The text content to scan for link opportunities'),
      current_page: stringProp('Current page slug to avoid self-links'),
      language: stringProp('Language code for URL generation (default: "en")'),
      max_suggestions: numberProp('Maximum number of link suggestions (default: 10)'),
      exclude_slugs: arrayProp(
        'Page slugs to exclude from suggestions',
        stringProp('Page slug to exclude')
      ),
    },
    required: ['content', 'current_page'],
  },
}

/**
 * Insert links - Add markdown links to content
 */
export const insertLinksTool: ToolDefinition = {
  name: 'insert_links',
  description: `Insert internal links into content based on provided opportunities.

Takes the original content and a list of link insertions, returns the updated content
with markdown links added.

Rules:
- Links are inserted as markdown: [anchor text](url)
- Preserves existing links (won't double-link)
- Respects max links per block from linking policy
- Prioritizes links by relevance score`,
  input_schema: {
    type: 'object',
    properties: {
      content: stringProp('The original content to add links to'),
      links: stringProp('JSON array of {text: string, url: string, position?: number} objects'),
      max_links: numberProp('Maximum number of links to insert (default: 5)'),
    },
    required: ['content', 'links'],
  },
}

/**
 * Validate links - Check all links resolve to sitemap entries
 */
export const validateLinksTool: ToolDefinition = {
  name: 'validate_links',
  description: `Verify that all internal links in content exist in the sitemap index.

Returns:
- List of valid links with their target page info
- List of invalid links that need correction
- Suggested replacements for invalid links`,
  input_schema: {
    type: 'object',
    properties: {
      content: stringProp('Content containing links to validate'),
      language: stringProp('Language code for URL matching (default: "en")'),
    },
    required: ['content'],
  },
}

/**
 * Get linking policy - Retrieve linking rules for a block type
 */
export const getLinkingPolicyTool: ToolDefinition = {
  name: 'get_linking_policy',
  description: `Get the linking policy for a specific block type or page type.

Returns:
- minLinks: Minimum required internal links
- maxLinks: Maximum allowed internal links
- allowedTargets: Page types this block can link to
- anchorTextRules: Guidelines for anchor text`,
  input_schema: {
    type: 'object',
    properties: {
      block_type: stringProp('Block type to get policy for (e.g., "village-intro", "paragraph")'),
      page_type: stringProp('Page type for context (e.g., "village", "collection")'),
    },
    required: ['block_type'],
  },
}

/**
 * Suggest anchor text - Generate appropriate anchor text for a link
 */
export const suggestAnchorTextTool: ToolDefinition = {
  name: 'suggest_anchor_text',
  description: `Generate appropriate anchor text for a link to a target page.

Good anchor text:
- Describes the target page content
- Is natural and readable
- Avoids generic text like "click here" or "read more"
- Contains relevant keywords`,
  input_schema: {
    type: 'object',
    properties: {
      target_slug: stringProp('Target page slug'),
      context: stringProp('Surrounding content context for natural text'),
      language: stringProp('Language for anchor text (default: "en")'),
    },
    required: ['target_slug'],
  },
}

/**
 * Analyze link distribution - Check link balance across content
 */
export const analyzeLinkDistributionTool: ToolDefinition = {
  name: 'analyze_link_distribution',
  description: `Analyze how links are distributed across content blocks.

Checks for:
- Link clustering (too many links in one area)
- Orphan sections (areas with no links)
- Target page diversity (linking to variety of pages)
- Overlinked pages (same target linked multiple times)`,
  input_schema: {
    type: 'object',
    properties: {
      content: stringProp('JSON content structure to analyze'),
      page_type: stringProp('Page type for expected distribution'),
    },
    required: ['content'],
  },
}

// ============================================================================
// Export All Tools
// ============================================================================

export const linkerTools = [
  findLinkOpportunitiesTool,
  insertLinksTool,
  validateLinksTool,
  getLinkingPolicyTool,
  suggestAnchorTextTool,
  analyzeLinkDistributionTool,
]
