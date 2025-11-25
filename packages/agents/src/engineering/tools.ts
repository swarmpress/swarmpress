/**
 * EngineeringAgent Tool Definitions
 * Tools for building and deploying static websites
 */

import {
  ToolDefinition,
  stringProp,
  booleanProp,
  objectProp,
} from '../base/tools'

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * Validate content - check JSON blocks are valid before build
 */
export const validateContentTool: ToolDefinition = {
  name: 'validate_content',
  description:
    'Validate content structure before building. Checks that all content items have valid JSON blocks, required fields (title, body), and proper block structure (images have alt text, headings have level, etc.).',
  input_schema: {
    type: 'object',
    properties: {
      website_id: stringProp('The UUID of the website to validate content for'),
    },
    required: ['website_id'],
  },
}

/**
 * Build site - generate static site from content
 */
export const buildSiteTool: ToolDefinition = {
  name: 'build_site',
  description:
    'Build a static website using Astro from the published content. This generates HTML, CSS, and assets ready for deployment. The site must have published content to build successfully.',
  input_schema: {
    type: 'object',
    properties: {
      website_id: stringProp('The UUID of the website to build'),
      site_url: stringProp(
        'The production URL for the site (e.g., https://cinqueterre.travel). Used for absolute URLs and sitemap.'
      ),
    },
    required: ['website_id'],
  },
}

/**
 * Deploy site - push built site to hosting platform
 */
export const deploySiteTool: ToolDefinition = {
  name: 'deploy_site',
  description: `Deploy a built website to a hosting platform. The site must be built first using build_site.

Supported deploy targets:
- "local": Copy to local directory (for testing)
- "github-pages": Deploy via GitHub Pages API
- "netlify": Deploy to Netlify (requires netlify_site_id and netlify_auth_token)
- "s3": Deploy to AWS S3 bucket (requires s3_bucket and AWS credentials)`,
  input_schema: {
    type: 'object',
    properties: {
      website_id: stringProp('The UUID of the website to deploy'),
      build_dir: stringProp('The build output directory from build_site'),
      deploy_target: stringProp(
        'Deployment target: "local", "github-pages", "netlify", or "s3"'
      ),
      config: objectProp(
        'Optional configuration for the deploy target (e.g., netlify_site_id, s3_bucket)'
      ),
    },
    required: ['website_id', 'build_dir', 'deploy_target'],
  },
}

/**
 * Publish website - complete build + deploy workflow
 */
export const publishWebsiteTool: ToolDefinition = {
  name: 'publish_website',
  description:
    'Complete workflow to validate, build, and deploy a website in one step. This is the recommended way to publish content. It validates content, builds the static site, and deploys it to the specified target.',
  input_schema: {
    type: 'object',
    properties: {
      website_id: stringProp('The UUID of the website to publish'),
      deploy_target: stringProp(
        'Deployment target: "local", "github-pages", "netlify", or "s3". Defaults to "local".'
      ),
      site_url: stringProp(
        'The production URL for the site (e.g., https://cinqueterre.travel)'
      ),
      skip_validation: booleanProp(
        'Skip content validation (not recommended). Defaults to false.'
      ),
      deploy_config: objectProp(
        'Optional configuration for the deploy target'
      ),
    },
    required: ['website_id'],
  },
}

/**
 * Get website info - fetch website details and status
 */
export const getWebsiteInfoTool: ToolDefinition = {
  name: 'get_website_info',
  description:
    'Get information about a website including its configuration, content count, and last build/deploy status.',
  input_schema: {
    type: 'object',
    properties: {
      website_id: stringProp('The UUID of the website to get info for'),
    },
    required: ['website_id'],
  },
}

// ============================================================================
// Export All Tools
// ============================================================================

export const engineeringTools = [
  validateContentTool,
  buildSiteTool,
  deploySiteTool,
  publishWebsiteTool,
  getWebsiteInfoTool,
]
