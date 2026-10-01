/**
 * AuditAgent Tool Definitions
 * Tools for comprehensive content integrity auditing
 */

import {
  ToolDefinition,
  stringProp,
  numberProp,
  booleanProp,
  arrayProp,
} from '../base/tools'

// ============================================================================
// Audit Tool Definitions
// ============================================================================

/**
 * Run comprehensive content audit
 */
export const runContentAuditTool: ToolDefinition = {
  name: 'run_content_audit',
  description: `Run a comprehensive content integrity audit on a content directory.

This tool scans all JSON content files and checks for:
- Broken images (404s, inaccessible URLs)
- Wrong images (using vision to verify content matches context)
- Broken internal links (pointing to non-existent pages)
- Broken external links (returning 404)
- Missing translations (incomplete LocalizedString fields)

Returns a detailed audit report with issues categorized by severity and type.`,
  input_schema: {
    type: 'object',
    properties: {
      content_path: stringProp('Path to the content directory to audit'),
      checks: arrayProp(
        'Types of checks to run (default: all)',
        { type: 'string', description: 'Check type: images, links, translations, all' }
      ),
      validate_image_content: booleanProp('Use vision API to validate image content (slower but more thorough)'),
      sitemap_slugs: arrayProp(
        'Valid page slugs for internal link validation',
        { type: 'string', description: 'A valid page slug' }
      ),
    },
    required: ['content_path'],
  },
}

/**
 * Run Linkinator crawl on live site
 */
export const runLinkinatorTool: ToolDefinition = {
  name: 'run_linkinator',
  description: `Run Linkinator to crawl a live website and detect broken links.

Linkinator crawls the entire site starting from the given URL and checks:
- All internal links
- All external links
- Images and other media
- Anchor links (#fragments)

Returns a detailed report of all broken links found.`,
  input_schema: {
    type: 'object',
    properties: {
      site_url: stringProp('Base URL of the site to crawl (e.g., "https://cinqueterre.travel")'),
      concurrency: numberProp('Number of concurrent requests (default: 10)'),
      timeout: numberProp('Request timeout in milliseconds (default: 30000)'),
      skip_patterns: arrayProp(
        'URL patterns to skip (regex)',
        { type: 'string', description: 'Pattern to skip' }
      ),
      recurse: booleanProp('Recursively crawl all pages (default: true)'),
    },
    required: ['site_url'],
  },
}

/**
 * Run Lighthouse audit
 */
export const runLighthouseTool: ToolDefinition = {
  name: 'run_lighthouse',
  description: `Run Lighthouse performance and quality audit on specific page(s).

Checks:
- Performance (Core Web Vitals, loading speed)
- Accessibility (WCAG compliance)
- Best Practices (security, modern standards)
- SEO (meta tags, structured data)

Run on representative templates, not the entire site.`,
  input_schema: {
    type: 'object',
    properties: {
      url: stringProp('URL of the page to audit'),
      categories: arrayProp(
        'Lighthouse categories to check (default: all)',
        { type: 'string', description: 'Category: performance, accessibility, best-practices, seo' }
      ),
      device: stringProp('Device to emulate', ['desktop', 'mobile']),
      output_format: stringProp('Output format', ['json', 'html']),
    },
    required: ['url'],
  },
}

/**
 * Check single URL accessibility
 */
export const checkUrlTool: ToolDefinition = {
  name: 'check_url',
  description: `Check if a single URL is accessible.

Performs an HTTP HEAD request to verify:
- URL is reachable
- Returns successful status code
- Response time

Use for quick spot-checks of specific URLs.`,
  input_schema: {
    type: 'object',
    properties: {
      url: stringProp('URL to check'),
      timeout: numberProp('Timeout in milliseconds (default: 5000)'),
    },
    required: ['url'],
  },
}

/**
 * Validate image content with vision
 */
export const validateImageTool: ToolDefinition = {
  name: 'validate_image',
  description: `Use AI vision to verify an image matches its expected context.

Analyzes the image and checks:
- Does it show the expected location (e.g., Cinque Terre, not Santorini)?
- Does it match the expected category (beach, restaurant, hiking)?
- Is it appropriate for the content context?

Returns whether the image is correct and details any mismatches.`,
  input_schema: {
    type: 'object',
    properties: {
      image_url: stringProp('URL of the image to validate'),
      expected_context: stringProp('What the image should show (e.g., "Vernazza harbor")'),
      village_context: stringProp('Specific village if applicable'),
      category_context: stringProp('Content category (beach, restaurant, hiking, etc.)'),
    },
    required: ['image_url', 'expected_context'],
  },
}

/**
 * Generate audit report
 */
export const generateAuditReportTool: ToolDefinition = {
  name: 'generate_audit_report',
  description: `Generate a formatted audit report from audit results.

Creates a comprehensive report including:
- Summary statistics
- Issues by severity and category
- Detailed issue descriptions with fix suggestions
- Recommendations for next steps

Can output as Markdown or structured JSON.`,
  input_schema: {
    type: 'object',
    properties: {
      audit_results: {
        type: 'object',
        description: 'The audit results to format',
      },
      format: stringProp('Output format', ['markdown', 'json', 'summary']),
      include_fixed: booleanProp('Include issues that were auto-fixed'),
    },
    required: ['audit_results'],
  },
}

/**
 * Compare audits
 */
export const compareAuditsTool: ToolDefinition = {
  name: 'compare_audits',
  description: `Compare two audit reports to see what changed.

Useful for:
- Tracking progress over time
- Verifying fixes were successful
- Identifying new issues

Returns new issues, resolved issues, and unchanged issues.`,
  input_schema: {
    type: 'object',
    properties: {
      previous_audit_path: stringProp('Path to the previous audit report JSON'),
      current_audit_path: stringProp('Path to the current audit report JSON'),
    },
    required: ['previous_audit_path', 'current_audit_path'],
  },
}

// ============================================================================
// Export All Audit Agent Tools
// ============================================================================

export const auditAgentTools: ToolDefinition[] = [
  runContentAuditTool,
  runLinkinatorTool,
  runLighthouseTool,
  checkUrlTool,
  validateImageTool,
  generateAuditReportTool,
  compareAuditsTool,
]

export const auditAgentToolMap: Record<string, ToolDefinition> = {
  run_content_audit: runContentAuditTool,
  run_linkinator: runLinkinatorTool,
  run_lighthouse: runLighthouseTool,
  check_url: checkUrlTool,
  validate_image: validateImageTool,
  generate_audit_report: generateAuditReportTool,
  compare_audits: compareAuditsTool,
}
