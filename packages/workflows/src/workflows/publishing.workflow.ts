/**
 * Publishing Workflow
 * Orchestrates the content publishing process
 */

import { proxyActivities } from '@temporalio/workflow'
import type * as activities from '../activities'

const {
  invokeSEOAgent,
  invokeEngineeringAgent,
  getContentItem,
  transitionContentState,
  publishContentEvent,
  publishDeployEvent,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '20 minutes',
  retry: {
    maximumAttempts: 3,
  },
})

export interface PublishingInput {
  contentId: string
  websiteId: string
  seoAgentId: string
  engineeringAgentId: string
}

export interface PublishingResult {
  success: boolean
  contentId: string
  websiteId: string
  publishedUrl?: string
  deploymentTime?: number
  error?: string
}

/**
 * Publishing Workflow
 *
 * Flow:
 * 1. SEO agent optimizes content
 * 2. Transition to scheduled state
 * 3. Engineering agent validates content structure
 * 4. Engineering agent validates assets
 * 5. Build static site
 * 6. Deploy to production
 * 7. Transition to published state
 * 8. Publish success/failure events
 */
export async function publishingWorkflow(
  input: PublishingInput
): Promise<PublishingResult> {
  const { contentId, websiteId, seoAgentId, engineeringAgentId } = input
  const startTime = Date.now()

  try {
    console.log(`[Publishing] Starting workflow for ${contentId}`)

    // Step 1: Get content
    const content = await getContentItem(contentId)
    if (!content) {
      throw new Error(`Content ${contentId} not found`)
    }

    console.log(`[Publishing] Content status: ${content.status}`)

    // Step 2: SEO optimization
    console.log(`[Publishing] Invoking SEO agent for optimization`)

    const seoTask = `Optimize SEO metadata for content ${contentId}.

Review and optimize:
- Page title and meta description
- Keywords and tags
- URL structure
- Image alt text
- Internal/external links

Ensure all SEO best practices are followed.`

    const seoResult = await invokeSEOAgent({
      agentId: seoAgentId,
      task: seoTask,
      contentId,
    })

    if (!seoResult.success) {
      console.warn(`[Publishing] SEO optimization failed: ${seoResult.error}`)
      // Continue anyway - non-critical
    } else {
      console.log(`[Publishing] SEO optimization completed`)
    }

    // Step 3: Transition to scheduled state
    await transitionContentState({
      contentId,
      event: 'ready_for_publish',
      actor: 'SEOSpecialist',
      actorId: seoAgentId,
    })

    await publishContentEvent({
      type: 'content.scheduled',
      contentId,
      data: {
        content_id: contentId,
      },
    })

    console.log(`[Publishing] Content transitioned to scheduled`)

    // Step 4: Engineering validation
    console.log(`[Publishing] Invoking engineering agent for validation`)

    const validateTask = `Validate content ${contentId} for publication.

Use your tools to:
1. validate_content_structure: Check JSON block structure
2. validate_assets: Verify all images have URLs and alt text

Report any validation errors.`

    const validationResult = await invokeEngineeringAgent({
      agentId: engineeringAgentId,
      task: validateTask,
      contentId,
      websiteId,
    })

    if (!validationResult.success) {
      throw new Error(`Validation failed: ${validationResult.error}`)
    }

    // Check validation results
    if (validationResult.result?.valid === false) {
      const errors = validationResult.result?.errors || []
      throw new Error(`Content validation failed: ${errors.join(', ')}`)
    }

    console.log(`[Publishing] Validation passed`)

    // Step 5: Build and deploy
    console.log(`[Publishing] Invoking engineering agent for build and deployment`)

    const publishTask = `Publish content ${contentId} to website ${websiteId}.

Use your publish_site tool to:
1. Validate content structure and assets
2. Build the static site with Astro
3. Deploy to production hosting
4. Return the published URL

This is a complete end-to-end publishing workflow.`

    const publishResult = await invokeEngineeringAgent({
      agentId: engineeringAgentId,
      task: publishTask,
      contentId,
      websiteId,
    })

    if (!publishResult.success) {
      // Publish failure event
      await publishDeployEvent({
        type: 'deploy.failed',
        contentId,
        data: {
          error: publishResult.error || 'Build/deployment failed',
        },
      })

      throw new Error(`Publishing failed: ${publishResult.error}`)
    }

    console.log(`[Publishing] Build and deployment successful`)

    // Step 6: Transition to published state
    await transitionContentState({
      contentId,
      event: 'deploy_success',
      actor: 'EngineeringAgent',
      actorId: engineeringAgentId,
    })

    // Step 7: Extract published URL
    const publishedUrl =
      publishResult.result?.url ||
      publishResult.result?.publishedUrl ||
      `https://www.example.com/content/${contentId}`

    // Step 8: Publish success event
    await publishDeployEvent({
      type: 'deploy.success',
      contentId,
      data: {
        url: publishedUrl,
      },
    })

    await publishContentEvent({
      type: 'content.published',
      contentId,
      data: {
        content_id: contentId,
        website_id: websiteId,
      },
    })

    const deploymentTime = Date.now() - startTime

    console.log(
      `[Publishing] Workflow completed successfully in ${deploymentTime}ms`
    )
    console.log(`[Publishing] Published URL: ${publishedUrl}`)

    return {
      success: true,
      contentId,
      websiteId,
      publishedUrl,
      deploymentTime,
    }
  } catch (error) {
    console.error(`[Publishing] Workflow failed:`, error)

    // Ensure failure event is published
    try {
      await publishDeployEvent({
        type: 'deploy.failed',
        contentId,
        data: {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      })
    } catch (eventError) {
      console.error(`[Publishing] Failed to publish failure event:`, eventError)
    }

    return {
      success: false,
      contentId,
      websiteId,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
