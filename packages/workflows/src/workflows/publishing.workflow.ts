/**
 * Publishing Workflow
 * Orchestrates the content publishing process
 *
 * GitHub Integration: Each agent step is logged to the content's PR,
 * and the PR is merged when content is successfully published.
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
  syncPublishToGitHubActivity,
  logAgentActivityToGitHub,
  buildFromGitHubActivity,
  getWebsiteBuildConfigActivity,
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
  /** If true, build from GitHub repository instead of database */
  buildFromGitHub?: boolean
  /** Site URL for production builds */
  siteUrl?: string
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
  const { contentId, websiteId, seoAgentId, engineeringAgentId, siteUrl } = input
  const startTime = Date.now()

  // Determine if we should build from GitHub (explicit override or website setting)
  let buildFromGitHub = input.buildFromGitHub
  if (buildFromGitHub === undefined) {
    // Check website settings
    const buildConfig = await getWebsiteBuildConfigActivity({ websiteId })
    buildFromGitHub = buildConfig.buildFromGitHub
  }

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

    // Log SEO start to GitHub
    await logAgentActivityToGitHub({
      contentId,
      agentId: seoAgentId,
      agentName: 'SEOAgent',
      activity: 'Starting SEO optimization',
      details: 'Optimizing page title, meta description, keywords, URL structure, and links...',
      result: 'pending',
    })

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

    // Log SEO result to GitHub
    await logAgentActivityToGitHub({
      contentId,
      agentId: seoAgentId,
      agentName: 'SEOAgent',
      activity: 'SEO optimization completed',
      details: seoResult.success
        ? 'SEO metadata optimized successfully'
        : `Warning: ${seoResult.error}`,
      result: seoResult.success ? 'success' : 'failure',
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

    // Log validation start to GitHub
    await logAgentActivityToGitHub({
      contentId,
      agentId: engineeringAgentId,
      agentName: 'EngineeringAgent',
      activity: 'Starting content validation',
      details: 'Validating JSON block structure and verifying all assets...',
      result: 'pending',
    })

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
      // Log validation failure to GitHub
      await logAgentActivityToGitHub({
        contentId,
        agentId: engineeringAgentId,
        agentName: 'EngineeringAgent',
        activity: 'Validation failed',
        details: `Error: ${validationResult.error}`,
        result: 'failure',
      })
      throw new Error(`Validation failed: ${validationResult.error}`)
    }

    // Check validation results
    if (validationResult.result?.valid === false) {
      const errors = validationResult.result?.errors || []
      // Log validation errors to GitHub
      await logAgentActivityToGitHub({
        contentId,
        agentId: engineeringAgentId,
        agentName: 'EngineeringAgent',
        activity: 'Validation failed - content errors',
        details: `**Validation errors:**\n${errors.map((e: string) => `- ${e}`).join('\n')}`,
        result: 'failure',
      })
      throw new Error(`Content validation failed: ${errors.join(', ')}`)
    }

    // Log validation success to GitHub
    await logAgentActivityToGitHub({
      contentId,
      agentId: engineeringAgentId,
      agentName: 'EngineeringAgent',
      activity: 'Validation passed',
      details: 'Content structure and all assets validated successfully.',
      result: 'success',
    })

    console.log(`[Publishing] Validation passed`)

    // Step 5: Build and deploy
    console.log(`[Publishing] Invoking engineering agent for build and deployment`)
    console.log(`[Publishing] Build source: ${buildFromGitHub ? 'GitHub' : 'Database'}`)

    let publishedUrl: string

    if (buildFromGitHub) {
      // Build from GitHub as source of truth
      await logAgentActivityToGitHub({
        contentId,
        agentId: engineeringAgentId,
        agentName: 'EngineeringAgent',
        activity: 'Starting GitHub-based build',
        details: `Building static site from GitHub repository...\n\n**Website ID:** ${websiteId}\n**Build Source:** GitHub`,
        result: 'pending',
      })

      const buildResult = await buildFromGitHubActivity({
        websiteId,
        siteUrl,
      })

      if (!buildResult.success) {
        // Log build failure to GitHub
        await logAgentActivityToGitHub({
          contentId,
          agentId: engineeringAgentId,
          agentName: 'EngineeringAgent',
          activity: '❌ GitHub build failed',
          details: `**Error:** ${buildResult.error || 'Build from GitHub failed'}`,
          result: 'failure',
        })

        // Publish failure event
        await publishDeployEvent({
          type: 'deploy.failed',
          contentId,
          data: {
            error: buildResult.error || 'Build from GitHub failed',
          },
        })

        throw new Error(`GitHub build failed: ${buildResult.error}`)
      }

      console.log(`[Publishing] GitHub build successful`)

      // Deploy the built site using the engineering agent
      const deployTask = `Deploy the built site for website ${websiteId}.

The site has been built from GitHub at: ${buildResult.outputDir}

Use your deploy_site tool to deploy to production hosting and return the published URL.`

      const deployResult = await invokeEngineeringAgent({
        agentId: engineeringAgentId,
        task: deployTask,
        contentId,
        websiteId,
      })

      if (!deployResult.success) {
        await logAgentActivityToGitHub({
          contentId,
          agentId: engineeringAgentId,
          agentName: 'EngineeringAgent',
          activity: '❌ Deployment failed',
          details: `**Error:** ${deployResult.error || 'Deployment failed'}`,
          result: 'failure',
        })

        await publishDeployEvent({
          type: 'deploy.failed',
          contentId,
          data: {
            error: deployResult.error || 'Deployment failed',
          },
        })

        throw new Error(`Deployment failed: ${deployResult.error}`)
      }

      publishedUrl =
        deployResult.result?.url ||
        deployResult.result?.publishedUrl ||
        `https://www.example.com/content/${contentId}`

    } else {
      // Build from database (original flow)
      await logAgentActivityToGitHub({
        contentId,
        agentId: engineeringAgentId,
        agentName: 'EngineeringAgent',
        activity: 'Starting build and deployment',
        details: `Building static site with Astro and deploying to production...\n\n**Website ID:** ${websiteId}\n**Build Source:** Database`,
        result: 'pending',
      })

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
        // Log deployment failure to GitHub
        await logAgentActivityToGitHub({
          contentId,
          agentId: engineeringAgentId,
          agentName: 'EngineeringAgent',
          activity: '❌ Deployment failed',
          details: `**Error:** ${publishResult.error || 'Build/deployment failed'}`,
          result: 'failure',
        })

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

      publishedUrl =
        publishResult.result?.url ||
        publishResult.result?.publishedUrl ||
        `https://www.example.com/content/${contentId}`
    }

    console.log(`[Publishing] Build and deployment successful`)

    // Log deployment success to GitHub
    await logAgentActivityToGitHub({
      contentId,
      agentId: engineeringAgentId,
      agentName: 'EngineeringAgent',
      activity: '🚀 Deployment successful',
      details: `Content has been published successfully!\n\n**Published URL:** ${publishedUrl}`,
      result: 'success',
    })

    // Step 7: Merge GitHub PR (content is now live)
    console.log(`[Publishing] Merging GitHub PR`)
    const mergeResult = await syncPublishToGitHubActivity({ contentId })
    if (mergeResult.success) {
      console.log(`[Publishing] GitHub PR merged successfully`)
    }

    // Step 8: Transition to published state
    await transitionContentState({
      contentId,
      event: 'deploy_success',
      actor: 'EngineeringAgent',
      actorId: engineeringAgentId,
    })

    // Step 9: Publish success event
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
