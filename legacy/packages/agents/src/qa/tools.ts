/**
 * QAAgent Tool Definitions
 * Tools for validating media relevance, links, and content quality
 */

import {
  ToolDefinition,
  stringProp,
  booleanProp,
  arrayProp,
} from '../base/tools'

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * Check media relevance - Validate all images in content match their component entities
 */
export const checkMediaRelevanceTool: ToolDefinition = {
  name: 'check_media_relevance',
  description: `Validate that all media in a page matches the entity context of its components.

This is the primary tool for preventing "Caribbean image on Riomaggiore page" scenarios.

The tool will:
- Scan all image references in the content
- Look up each image in the media index
- Verify the image village tag matches the component's entity
- Report all mismatches with severity levels

Returns a detailed report of all valid and invalid media references.`,
  input_schema: {
    type: 'object',
    properties: {
      content: stringProp('JSON string of the page content to validate'),
      page_slug: stringProp('The page slug (e.g., "riomaggiore", "riomaggiore/restaurants")'),
      page_village: stringProp('The village context for this page'),
      strict_mode: booleanProp('If true, "region" images are also flagged as warnings'),
    },
    required: ['content', 'page_slug', 'page_village'],
  },
}

/**
 * Check broken media - Verify all image URLs are accessible
 */
export const checkBrokenMediaTool: ToolDefinition = {
  name: 'check_broken_media',
  description: `Verify that all image URLs in content are accessible (return HTTP 200).

This tool makes HEAD requests to check if images exist without downloading them.

Returns:
- List of valid URLs
- List of broken URLs with HTTP status codes
- List of URLs that timed out`,
  input_schema: {
    type: 'object',
    properties: {
      content: stringProp('JSON string of the page content to check'),
      timeout_ms: stringProp('Timeout in milliseconds per request (default: 5000)'),
    },
    required: ['content'],
  },
}

/**
 * Check broken internal links - Verify all internal links exist in sitemap
 */
export const checkBrokenInternalLinksTool: ToolDefinition = {
  name: 'check_broken_internal_links',
  description: `Verify that all internal links in content exist in the sitemap index.

This ensures that agents don't invent URLs that don't exist.

The tool will:
- Extract all href values from content
- Filter for internal links (start with / or are relative)
- Check each against the sitemap-index.json
- Report links that don't have corresponding pages`,
  input_schema: {
    type: 'object',
    properties: {
      content: stringProp('JSON string of the page content to check'),
      language: stringProp('Language code for URL matching (default: "en")'),
    },
    required: ['content'],
  },
}

/**
 * Check link density - Verify content meets linking guidelines
 */
export const checkLinkDensityTool: ToolDefinition = {
  name: 'check_link_density',
  description: `Check if content has appropriate internal link density based on block type.

Each block type has min/max internal links defined in block-metadata.ts.
This tool verifies compliance.

Returns:
- Current link count per block
- Expected min/max from metadata
- Pass/fail status per block`,
  input_schema: {
    type: 'object',
    properties: {
      content: stringProp('JSON string of the page content to check'),
      page_type: stringProp('The page type for density rules'),
    },
    required: ['content', 'page_type'],
  },
}

/**
 * Run full QA - Execute all quality checks
 */
export const runFullQATool: ToolDefinition = {
  name: 'run_full_qa',
  description: `Execute all QA checks on a page and return a consolidated report.

Checks performed:
1. Media relevance (images match entity context)
2. Broken media (all image URLs accessible)
3. Broken internal links (all links exist in sitemap)
4. Link density (appropriate number of links per block)

Returns a comprehensive report with:
- Overall pass/fail status
- Individual check results
- Severity-ranked issues
- Suggested fixes`,
  input_schema: {
    type: 'object',
    properties: {
      content: stringProp('JSON string of the page content to validate'),
      page_slug: stringProp('The page slug'),
      page_village: stringProp('The village context'),
      page_type: stringProp('The page type for density rules'),
      skip_broken_check: booleanProp('Skip HTTP checks for broken media (faster validation)'),
      language: stringProp('Language code (default: "en")'),
    },
    required: ['content', 'page_slug', 'page_village'],
  },
}

/**
 * Generate fix instructions - Create actionable repair tasks
 */
export const generateFixInstructionsTool: ToolDefinition = {
  name: 'generate_fix_instructions',
  description: `Generate specific fix instructions for QA issues found.

Takes a QA report and produces:
- Step-by-step fix instructions
- Suggested replacement images (from media-index)
- Suggested link corrections (from sitemap-index)
- Priority ordering for fixes`,
  input_schema: {
    type: 'object',
    properties: {
      qa_report: stringProp('JSON string of QA report from run_full_qa'),
      auto_fix_level: stringProp('"none" (report only), "safe" (auto-fix obvious issues), "aggressive" (fix all possible)'),
    },
    required: ['qa_report'],
  },
}

// ============================================================================
// Export All Tools
// ============================================================================

export const qaTools = [
  checkMediaRelevanceTool,
  checkBrokenMediaTool,
  checkBrokenInternalLinksTool,
  checkLinkDensityTool,
  runFullQATool,
  generateFixInstructionsTool,
]
