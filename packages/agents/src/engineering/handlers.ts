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

async function getBatchRepository() {
  const { batchRepository } = await import('@swarm-press/backend')
  return batchRepository
}

async function getBatchProcessingService() {
  const { getBatchProcessingService } = await import('@swarm-press/backend')
  return getBatchProcessingService()
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
// Batch Processing Handlers
// ============================================================================

/**
 * Submit a batch job for bulk content generation
 */
export const submitBatchJobHandler: ToolHandler<{
  website_id: string
  collection_type: string
  villages: string[]
  items_per_village?: number
}> = async (input, _context): Promise<ToolResult> => {
  try {
    const batchService = await getBatchProcessingService()
    const batchRepository = await getBatchRepository()
    const { events } = await import('@swarm-press/event-bus')

    console.log(`[EngineeringAgent] Submitting batch job for ${input.collection_type} with ${input.villages.length} villages`)

    // Create batch requests for each village
    const itemsPerVillage = input.items_per_village || 20
    const requests = input.villages.map((village) => ({
      customId: `${input.collection_type}-${village}`,
      village,
      collectionType: input.collection_type,
      itemsPerVillage,
    }))

    // Submit batch to Anthropic
    const batchId = await batchService.submitBatch(requests)

    // Record in database
    const job = await batchRepository.create({
      batch_id: batchId,
      job_type: 'content_generation',
      collection_type: input.collection_type,
      website_id: input.website_id,
      status: 'processing',
      items_count: input.villages.length,
      items_processed: 0,
      results_processed: false,
      metadata: { villages: input.villages, items_per_village: itemsPerVillage },
    })

    // Emit event
    await events.batchSubmitted(batchId, 'content_generation', input.website_id)

    return toolSuccess({
      batch_id: batchId,
      job_id: job.id,
      website_id: input.website_id,
      collection_type: input.collection_type,
      villages: input.villages,
      items_per_village: itemsPerVillage,
      total_requests: input.villages.length,
      status: 'processing',
      message: `Batch job submitted successfully. Job ID: ${job.id}, Batch ID: ${batchId}. Use check_batch_status to monitor progress.`,
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to submit batch job')
  }
}

/**
 * Check the status of a batch job
 */
export const checkBatchStatusHandler: ToolHandler<{
  job_id: string
}> = async (input, _context): Promise<ToolResult> => {
  try {
    const batchService = await getBatchProcessingService()
    const batchRepository = await getBatchRepository()
    const { events } = await import('@swarm-press/event-bus')

    // Get job from database
    const job = await batchRepository.findById(input.job_id)
    if (!job) {
      return toolError(`Batch job not found: ${input.job_id}`)
    }

    // Get status from Anthropic
    const status = await batchService.getBatchStatus(job.batch_id)

    const progress = {
      succeeded: status.request_counts?.succeeded || 0,
      errored: status.request_counts?.errored || 0,
      expired: status.request_counts?.expired || 0,
      canceled: status.request_counts?.canceled || 0,
      processing: status.request_counts?.processing || 0,
      total: job.items_count,
    }

    // Update database
    await batchRepository.updateStatus(job.id, status.processing_status, {
      items_processed: progress.succeeded,
      results_url: status.results_url,
    })

    // Emit progress event
    await events.batchProcessing(job.batch_id, { succeeded: progress.succeeded, total: progress.total })

    const isComplete = status.processing_status === 'ended'

    return toolSuccess({
      job_id: job.id,
      batch_id: job.batch_id,
      status: status.processing_status,
      progress,
      results_url: status.results_url,
      completed: isComplete,
      collection_type: job.collection_type,
      website_id: job.website_id,
      created_at: job.created_at,
      message: isComplete
        ? `Batch completed! ${progress.succeeded} succeeded, ${progress.errored} errors. Use process_batch_results to import.`
        : `Batch ${status.processing_status}: ${progress.succeeded}/${progress.total} completed`,
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to check batch status')
  }
}

/**
 * List batch jobs for a website
 */
export const listBatchJobsHandler: ToolHandler<{
  website_id: string
  status?: string
  collection_type?: string
  limit?: number
}> = async (input, _context): Promise<ToolResult> => {
  try {
    const batchRepository = await getBatchRepository()

    const jobs = await batchRepository.findByWebsite(input.website_id, {
      status: input.status as any,
      collection_type: input.collection_type,
      limit: input.limit || 20,
    })

    return toolSuccess({
      website_id: input.website_id,
      jobs: jobs.map((job) => ({
        id: job.id,
        batch_id: job.batch_id,
        collection_type: job.collection_type,
        status: job.status,
        items_count: job.items_count,
        items_processed: job.items_processed,
        results_processed: job.results_processed,
        created_at: job.created_at,
        completed_at: job.completed_at,
      })),
      count: jobs.length,
      message: `Found ${jobs.length} batch jobs for website ${input.website_id}`,
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to list batch jobs')
  }
}

// ============================================================================
// GitHub Export/Import Handlers
// ============================================================================

/**
 * Export collection items from database to GitHub
 */
export const exportToGitHubHandler: ToolHandler<{
  website_id: string
  collection_type: string
  published_only?: boolean
}> = async (input, _context): Promise<ToolResult> => {
  try {
    const { exportCollectionToGitHubActivity } = await import('@swarm-press/workflows/dist/activities')

    console.log(`[EngineeringAgent] Exporting ${input.collection_type} to GitHub for website ${input.website_id}`)

    const result = await exportCollectionToGitHubActivity({
      websiteId: input.website_id,
      collectionType: input.collection_type,
      publishedOnly: input.published_only ?? true,
    })

    if (result.errors.length > 0) {
      return toolSuccess({
        website_id: input.website_id,
        collection_type: input.collection_type,
        items_exported: result.itemsExported,
        errors: result.errors,
        partial_success: true,
        message: `Exported ${result.itemsExported} items with ${result.errors.length} errors`,
      })
    }

    return toolSuccess({
      website_id: input.website_id,
      collection_type: input.collection_type,
      items_exported: result.itemsExported,
      message: `Successfully exported ${result.itemsExported} ${input.collection_type} items to GitHub`,
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to export to GitHub')
  }
}

/**
 * Import collection items from GitHub to database
 */
export const importFromGitHubHandler: ToolHandler<{
  website_id: string
  collection_type: string
  overwrite?: boolean
}> = async (input, _context): Promise<ToolResult> => {
  try {
    const { importCollectionFromGitHubActivity } = await import('@swarm-press/workflows/dist/activities')

    console.log(`[EngineeringAgent] Importing ${input.collection_type} from GitHub for website ${input.website_id}`)

    const result = await importCollectionFromGitHubActivity({
      websiteId: input.website_id,
      collectionType: input.collection_type,
      overwrite: input.overwrite ?? false,
    })

    if (result.errors.length > 0) {
      return toolSuccess({
        website_id: input.website_id,
        collection_type: input.collection_type,
        items_imported: result.itemsImported,
        items_skipped: result.itemsSkipped,
        errors: result.errors,
        partial_success: true,
        message: `Imported ${result.itemsImported} items (${result.itemsSkipped} skipped) with ${result.errors.length} errors`,
      })
    }

    return toolSuccess({
      website_id: input.website_id,
      collection_type: input.collection_type,
      items_imported: result.itemsImported,
      items_skipped: result.itemsSkipped,
      message: `Successfully imported ${result.itemsImported} ${input.collection_type} items from GitHub (${result.itemsSkipped} skipped)`,
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to import from GitHub')
  }
}

/**
 * Build static site from GitHub repository content
 */
export const buildFromGitHubHandler: ToolHandler<{
  website_id: string
  site_url?: string
}> = async (input, _context): Promise<ToolResult> => {
  try {
    const siteBuilder = await getSiteBuilder()
    const websiteRepository = await getWebsiteRepository()

    // Get website with GitHub config
    const website = await websiteRepository.findById(input.website_id)
    if (!website) {
      return toolError(`Website not found: ${input.website_id}`)
    }

    if (!website.github_owner || !website.github_repo) {
      return toolError('Website is not connected to GitHub. Connect a GitHub repository first.')
    }

    console.log(`[EngineeringAgent] Building from GitHub for ${website.github_owner}/${website.github_repo}`)

    const result = await siteBuilder.buildFromGitHub({
      github: {
        owner: website.github_owner,
        repo: website.github_repo,
        token: website.github_access_token,
        branch: website.github_pages_branch || 'main',
      },
      siteUrl: input.site_url || website.github_pages_url || website.domain,
    })

    if (!result.success) {
      return toolError(`GitHub build failed: ${result.error}`)
    }

    return toolSuccess({
      website_id: input.website_id,
      success: true,
      output_dir: result.outputDir,
      build_time_ms: result.buildTime,
      pages_built: result.pagesBuilt,
      collections_built: result.collectionsBuilt,
      message: `Site built from GitHub successfully in ${result.buildTime}ms. Pages: ${result.pagesBuilt}, Collections: ${result.collectionsBuilt}`,
    })
  } catch (error) {
    return toolError(error instanceof Error ? error.message : 'Failed to build from GitHub')
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
  // Batch Processing
  submit_batch_job: submitBatchJobHandler,
  check_batch_status: checkBatchStatusHandler,
  list_batch_jobs: listBatchJobsHandler,
  // GitHub Export/Import
  export_collection_to_github: exportToGitHubHandler,
  import_collection_from_github: importFromGitHubHandler,
  build_from_github: buildFromGitHubHandler,
}
