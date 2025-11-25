/**
 * EngineeringAgent Tool Handlers
 * Implementations that connect tools to site-builder operations
 */

import { ToolHandler, ToolResult, toolSuccess, toolError } from '../base/tools'

// ============================================================================
// Repository Access
// ============================================================================

async function getContentRepository() {
  const { contentRepository } = await import('@swarm-press/backend')
  return contentRepository
}

async function getWebsiteRepository() {
  const { websiteRepository } = await import('@swarm-press/backend')
  return websiteRepository
}

// ============================================================================
// Site Builder Access
// ============================================================================

async function getSiteBuilder() {
  const siteBuilder = await import('@swarm-press/site-builder')
  return siteBuilder
}

// ============================================================================
// Tool Handlers
// ============================================================================

/**
 * Validate content structure before building
 */
export const validateContentHandler: ToolHandler<{ website_id: string }> = async (
  input,
  _context
): Promise<ToolResult> => {
  try {
    const contentRepository = await getContentRepository()
    const siteBuilder = await getSiteBuilder()

    // Fetch published content for the website
    const content = await contentRepository.findAll({
      website_id: input.website_id,
      status: 'published',
    })

    if (content.length === 0) {
      return toolError(`No published content found for website ${input.website_id}. Content must be published before validation.`)
    }

    // Validate content structure
    const validation = siteBuilder.validateContent(content)

    return toolSuccess({
      website_id: input.website_id,
      valid: validation.valid,
      content_count: content.length,
      errors: validation.errors,
      message: validation.valid
        ? `All ${content.length} content items are valid and ready for build`
        : `Validation failed with ${validation.errors.length} errors`,
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to validate content')
  }
}

/**
 * Build static site from published content
 */
export const buildSiteHandler: ToolHandler<{
  website_id: string
  site_url?: string
}> = async (input, _context): Promise<ToolResult> => {
  try {
    const siteBuilder = await getSiteBuilder()

    console.log(`[EngineeringAgent] Starting build for website ${input.website_id}`)

    const result = await siteBuilder.buildSite({
      websiteId: input.website_id,
      siteUrl: input.site_url,
    })

    if (!result.success) {
      return toolError(`Build failed: ${result.error}`)
    }

    return toolSuccess({
      website_id: input.website_id,
      success: true,
      output_dir: result.outputDir,
      build_time_ms: result.buildTime,
      url: result.url,
      message: `Site built successfully in ${result.buildTime}ms. Output: ${result.outputDir}`,
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to build site')
  }
}

/**
 * Deploy built site to hosting platform
 */
export const deploySiteHandler: ToolHandler<{
  website_id: string
  build_dir: string
  deploy_target: 'local' | 'netlify' | 's3' | 'github-pages'
  config?: Record<string, string>
}> = async (input, _context): Promise<ToolResult> => {
  try {
    const siteBuilder = await getSiteBuilder()

    console.log(`[EngineeringAgent] Deploying to ${input.deploy_target} for website ${input.website_id}`)

    const result = await siteBuilder.deploySite({
      websiteId: input.website_id,
      buildDir: input.build_dir,
      deployTarget: input.deploy_target,
      config: input.config,
    })

    if (!result.success) {
      return toolError(`Deployment failed: ${result.error}`)
    }

    return toolSuccess({
      website_id: input.website_id,
      success: true,
      url: result.url,
      deploy_target: input.deploy_target,
      deploy_time_ms: result.deployTime,
      message: `Site deployed successfully to ${input.deploy_target}. URL: ${result.url}`,
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to deploy site')
  }
}

/**
 * Complete publish workflow: validate, build, deploy
 */
export const publishWebsiteHandler: ToolHandler<{
  website_id: string
  deploy_target?: 'local' | 'netlify' | 's3' | 'github-pages'
  site_url?: string
  skip_validation?: boolean
  deploy_config?: Record<string, string>
}> = async (input, _context): Promise<ToolResult> => {
  try {
    const siteBuilder = await getSiteBuilder()
    const websiteRepository = await getWebsiteRepository()

    console.log(`[EngineeringAgent] Starting publish workflow for website ${input.website_id}`)

    // Get website info
    const website = await websiteRepository.findById(input.website_id)
    if (!website) {
      return toolError(`Website not found: ${input.website_id}`)
    }

    // Run publish workflow
    const result = await siteBuilder.publishWebsite({
      websiteId: input.website_id,
      deployTarget: input.deploy_target || 'local',
      siteUrl: input.site_url || website.domain,
      skipValidation: input.skip_validation,
      deployConfig: input.deploy_config,
    })

    if (!result.success) {
      if (result.validationErrors && result.validationErrors.length > 0) {
        return toolError(`Validation failed:\n${result.validationErrors.join('\n')}`)
      }
      return toolError(`Publish failed: ${result.error}`)
    }

    return toolSuccess({
      website_id: input.website_id,
      success: true,
      url: result.url,
      deploy_target: input.deploy_target || 'local',
      build_time_ms: result.buildTime,
      deploy_time_ms: result.deployTime,
      message: `Website published successfully! URL: ${result.url}`,
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to publish website')
  }
}

/**
 * Get website information and status
 */
export const getWebsiteInfoHandler: ToolHandler<{ website_id: string }> = async (
  input,
  _context
): Promise<ToolResult> => {
  try {
    const websiteRepository = await getWebsiteRepository()
    const contentRepository = await getContentRepository()

    // Get website
    const website = await websiteRepository.findById(input.website_id)
    if (!website) {
      return toolError(`Website not found: ${input.website_id}`)
    }

    // Get content counts by status
    const allContent = await contentRepository.findAll({ website_id: input.website_id })
    const statusCounts: Record<string, number> = {}
    for (const item of allContent) {
      statusCounts[item.status] = (statusCounts[item.status] || 0) + 1
    }

    return toolSuccess({
      id: website.id,
      name: website.name,
      domain: website.domain,
      description: website.description,
      settings: website.settings,
      created_at: website.created_at,
      updated_at: website.updated_at,
      content_stats: {
        total: allContent.length,
        by_status: statusCounts,
      },
      ready_to_publish: (statusCounts['published'] || 0) > 0,
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to get website info')
  }
}

// ============================================================================
// Export Handler Map
// ============================================================================

export const engineeringToolHandlers: Record<string, ToolHandler> = {
  validate_content: validateContentHandler,
  build_site: buildSiteHandler,
  deploy_site: deploySiteHandler,
  publish_website: publishWebsiteHandler,
  get_website_info: getWebsiteInfoHandler,
}
