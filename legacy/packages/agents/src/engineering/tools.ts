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
// Batch Processing Tools
// ============================================================================

/**
 * Submit batch job - submit a batch job for bulk content generation
 */
export const submitBatchJobTool: ToolDefinition = {
  name: 'submit_batch_job',
  description: `Submit a batch job to generate collection content for multiple villages using Claude's Message Batches API.
This provides 50% cost savings compared to regular API calls.

The batch job will:
1. Research real items for each village using web search
2. Generate content in multiple languages (EN, DE, IT, FR)
3. Add SEO metadata and keywords
4. Import results to the database

Supported collection types: events, accommodations, restaurants, pois, hikes`,
  input_schema: {
    type: 'object',
    properties: {
      website_id: stringProp('The UUID of the website to associate the batch with'),
      collection_type: stringProp('Collection type: events, accommodations, restaurants, pois, or hikes'),
      villages: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of villages to generate content for (e.g., ["monterosso", "vernazza", "corniglia"])',
      },
      items_per_village: {
        type: 'number',
        description: 'Number of items to generate per village (default: 20, max: 50)',
      },
    },
    required: ['website_id', 'collection_type', 'villages'],
  },
}

/**
 * Check batch status - check the status of a running batch job
 */
export const checkBatchStatusTool: ToolDefinition = {
  name: 'check_batch_status',
  description:
    'Check the status of a batch job. Returns current status, progress (items succeeded/total), and results URL when complete.',
  input_schema: {
    type: 'object',
    properties: {
      job_id: stringProp('The UUID of the batch job to check'),
    },
    required: ['job_id'],
  },
}

/**
 * List batch jobs - list batch jobs for a website
 */
export const listBatchJobsTool: ToolDefinition = {
  name: 'list_batch_jobs',
  description:
    'List batch jobs for a website with optional filtering by status or collection type.',
  input_schema: {
    type: 'object',
    properties: {
      website_id: stringProp('The UUID of the website to list batch jobs for'),
      status: stringProp('Optional filter by status: pending, processing, ended, completed, failed'),
      collection_type: stringProp('Optional filter by collection type'),
      limit: {
        type: 'number',
        description: 'Maximum number of jobs to return (default: 20)',
      },
    },
    required: ['website_id'],
  },
}

// ============================================================================
// GitHub Export Tools
// ============================================================================

/**
 * Export collection to GitHub - export collection items from database to GitHub repository
 */
export const exportToGitHubTool: ToolDefinition = {
  name: 'export_collection_to_github',
  description: `Export collection items from the database to a GitHub repository.
The website must be connected to GitHub. Items are exported as JSON files organized by collection type and village.

This is useful for:
- Backing up content to GitHub
- Using GitHub as the source of truth for content
- Enabling GitHub-based editing workflows`,
  input_schema: {
    type: 'object',
    properties: {
      website_id: stringProp('The UUID of the website to export from'),
      collection_type: stringProp('Collection type to export (e.g., events, pois)'),
      published_only: booleanProp('Only export published items (default: true)'),
    },
    required: ['website_id', 'collection_type'],
  },
}

/**
 * Import collection from GitHub - import collection items from GitHub to database
 */
export const importFromGitHubTool: ToolDefinition = {
  name: 'import_collection_from_github',
  description: `Import collection items from a GitHub repository to the database.
The website must be connected to GitHub.

This is useful for:
- Syncing content that was edited directly in GitHub
- Migrating content from another system
- Restoring from a GitHub backup`,
  input_schema: {
    type: 'object',
    properties: {
      website_id: stringProp('The UUID of the website to import to'),
      collection_type: stringProp('Collection type to import (e.g., events, pois)'),
      overwrite: booleanProp('Overwrite existing items with same slug (default: false)'),
    },
    required: ['website_id', 'collection_type'],
  },
}

/**
 * Build from GitHub - build static site from GitHub repository content
 */
export const buildFromGitHubTool: ToolDefinition = {
  name: 'build_from_github',
  description: `Build a static website using content from a GitHub repository instead of the database.
This is an alternative to build_site that uses GitHub as the source of truth.

The website must be connected to GitHub and have content in the expected format:
- content/config.json - Website configuration
- content/pages/*.json - Page definitions
- content/[collection]/_schema.json - Collection schema
- content/[collection]/[village]/*.json - Collection items`,
  input_schema: {
    type: 'object',
    properties: {
      website_id: stringProp('The UUID of the website to build'),
      site_url: stringProp('The production URL for the site'),
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
  // Batch Processing
  submitBatchJobTool,
  checkBatchStatusTool,
  listBatchJobsTool,
  // GitHub Export/Import
  exportToGitHubTool,
  importFromGitHubTool,
  buildFromGitHubTool,
]
