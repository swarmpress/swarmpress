/**
 * Publishing Workflow (repo-canonical)
 *
 * After the repo-canonical migration, build+deploy is owned by each site's
 * own GitHub Actions workflow (`.github/workflows/deploy.yml` in the site
 * repo). This workflow no longer triggers builds and no longer pushes to
 * gh-pages. Its only responsibilities are:
 *
 *   1. Run the QA Gate (still platform-side: media relevance, links,
 *      editorial coherence) before declaring content ready for publish.
 *   2. Run SEO optimization (still platform-side).
 *   3. Merge the editorial PR — this is what actually triggers the site
 *      repo's GitHub Actions deploy job.
 *   4. Wait for the GitHub `deployment_status.success` webhook (recorded by
 *      WS4's webhook handler into `state_audit_log`) and transition state
 *      to `published` once observed.
 *
 * The legacy `EngineeringAgent.publish_site` / `deploy_site` /
 * `build_site` tools and the local Astro build path
 * (`packages/site-builder/src/generator/{build,deploy}.ts`) are deprecated
 * and no longer invoked from this workflow. See CLAUDE.md, section
 * "Build & Deploy", for the current architecture.
 *
 * GitHub Integration: agent step logs continue to be appended as PR
 * comments via `logAgentActivityToGitHub` so the editorial PR remains the
 * single auditable surface for the content lifecycle.
 *
 * QA Gate Integration: Runs QA validation before merging to ensure
 * media relevance, working links, and editorial coherence.
 */

import { proxyActivities } from '@temporalio/workflow'
import type * as activities from '../activities'
import { qaGateWorkflow, type QAGateResult } from './qa-gate.workflow'

const {
  invokeSEOAgent,
  getContentItem,
  transitionContentState,
  publishContentEvent,
  publishDeployEvent,
  syncPublishToGitHubActivity,
  logAgentActivityToGitHub,
  waitForDeploymentActivity,
  getCurrentTimestamp,
  measureDuration,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: '30 minutes',
  retry: {
    maximumAttempts: 3,
    initialInterval: '1s',
    backoffCoefficient: 2,
    maximumInterval: '30s',
  },
})

export interface PublishingInput {
  contentId: string
  websiteId: string
  seoAgentId: string
  /**
   * @deprecated Retained for source-compat with existing callers. The
   * EngineeringAgent is no longer invoked for build/deploy by this
   * workflow; each site repo's GitHub Actions owns build+deploy.
   */
  engineeringAgentId?: string
  /**
   * @deprecated No longer used — content is always built from the site
   * repo by GitHub Actions, never from the database by this workflow.
   */
  buildFromGitHub?: boolean
  /** Site URL (informational only — no longer used for local builds). */
  siteUrl?: string
  /** Maximum time to wait for the GitHub deploy webhook to confirm success. */
  deploymentTimeout?: string
  /** QA Gate configuration */
  qaGate?: {
    /** If true, run QA gate before publishing (default: true) */
    enabled?: boolean
    /** QA Agent ID */
    qaAgentId?: string
    /** MediaSelector Agent ID for auto-fixing media issues */
    mediaSelectorAgentId?: string
    /** Linker Agent ID for auto-fixing link issues */
    linkerAgentId?: string
    /** PagePolish Agent ID for auto-fixing editorial issues */
    pagePolishAgentId?: string
    /** Maximum attempts to fix issues (default: 3) */
    maxFixAttempts?: number
  }
}

export interface PublishingResult {
  success: boolean
  contentId: string
  websiteId: string
  publishedUrl?: string
  deploymentTime?: number
  qaGateResult?: QAGateResult
  error?: string
}

/**
 * Publishing Workflow (repo-canonical)
 *
 * Flow (post-migration):
 * 1. QA Gate validation (media relevance, links, editorial coherence)
 * 2. SEO agent optimizes content
 * 3. Transition to scheduled state
 * 4. Merge editorial PR (this triggers site repo's GitHub Actions deploy)
 * 5. Wait for `deployment_status.success` webhook (recorded by WS4 in
 *    `state_audit_log`)
 * 6. Transition to published state
 * 7. Publish success/failure events
 */
export async function publishingWorkflow(
  input: PublishingInput
): Promise<PublishingResult> {
  const { contentId, websiteId, seoAgentId, qaGate, deploymentTimeout } = input
  const startTime = await getCurrentTimestamp()
  let qaGateResult: QAGateResult | undefined

  try {
    console.log(`[Publishing] Starting workflow for ${contentId}`)

    // Step 1: Get content
    const content = await getContentItem(contentId)
    if (!content) {
      throw new Error(`Content ${contentId} not found`)
    }

    console.log(`[Publishing] Content status: ${content.status}`)

    // Step 1.5: QA Gate (if enabled)
    const qaGateEnabled = qaGate?.enabled !== false // Default to true
    if (qaGateEnabled && qaGate?.qaAgentId) {
      console.log(`[Publishing] Running QA Gate validation`)

      qaGateResult = await qaGateWorkflow({
        contentId,
        websiteId,
        qaAgentId: qaGate.qaAgentId,
        mediaSelectorAgentId: qaGate.mediaSelectorAgentId,
        linkerAgentId: qaGate.linkerAgentId,
        pagePolishAgentId: qaGate.pagePolishAgentId,
        maxFixAttempts: qaGate.maxFixAttempts || 3,
      })

      if (!qaGateResult.passed) {
        console.log(`[Publishing] QA Gate FAILED - blocking publication`)

        // Log QA failure to GitHub
        await logAgentActivityToGitHub({
          contentId,
          agentId: qaGate.qaAgentId,
          agentName: 'QAAgent',
          activity: 'Publishing blocked by QA Gate',
          details: `Content failed quality checks and cannot be published.

**Failed Checks:**
${!qaGateResult.checks.mediaRelevance.passed ? '- Media Relevance: FAIL ' + (qaGateResult.checks.mediaRelevance.issues[0] || 'Failed') : '- Media Relevance: OK'}
${!qaGateResult.checks.brokenLinks.passed ? '- Broken Links: FAIL ' + (qaGateResult.checks.brokenLinks.issues[0] || 'Failed') : '- Broken Links: OK'}
${!qaGateResult.checks.editorialCoherence.passed ? '- Editorial Coherence: FAIL ' + (qaGateResult.checks.editorialCoherence.issues[0] || 'Failed') : '- Editorial Coherence: OK'}

Please fix these issues before attempting to publish again.`,
          result: 'failure',
        })

        return {
          success: false,
          contentId,
          websiteId,
          qaGateResult,
          error: 'QA Gate validation failed - content blocked from publishing',
        }
      }

      console.log(`[Publishing] QA Gate PASSED - proceeding to SEO optimization`)
    } else if (!qaGate?.qaAgentId) {
      console.log(`[Publishing] QA Gate skipped (no qaAgentId provided)`)
    }

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

    // Step 4: Merge the editorial PR — this triggers the site repo's
    // own .github/workflows/deploy.yml to build + deploy via Actions.
    console.log(`[Publishing] Merging GitHub PR (triggers site repo's deploy workflow)`)
    await logAgentActivityToGitHub({
      contentId,
      agentId: seoAgentId,
      agentName: 'PublishingWorkflow',
      activity: 'Merging editorial PR',
      details:
        'Merging the editorial PR. The site repository\'s `.github/workflows/deploy.yml` will pick this up and own the build + deploy.',
      result: 'pending',
    })

    const mergeResult = await syncPublishToGitHubActivity({ contentId })
    if (!mergeResult.success) {
      await publishDeployEvent({
        type: 'deploy.failed',
        contentId,
        data: {
          error: mergeResult.error || 'PR merge failed',
        },
      })
      throw new Error(`PR merge failed: ${mergeResult.error || 'unknown error'}`)
    }
    console.log(`[Publishing] GitHub PR merged successfully`)

    // Step 5: Wait for the GitHub `deployment_status.success` webhook to
    // confirm the site repo's Actions workflow finished deploying.
    // The webhook handler (WS4) records this in `state_audit_log`; the
    // activity polls there. Implementation note: the activity body is a
    // best-effort poll; if it times out, we surface that as a workflow
    // failure rather than guessing the deploy succeeded.
    console.log(`[Publishing] Waiting for deployment_status webhook`)
    const deploymentResult = await waitForDeploymentActivity({
      websiteId,
      contentId,
      timeout: deploymentTimeout || '30 minutes',
    })

    if (!deploymentResult.success) {
      await logAgentActivityToGitHub({
        contentId,
        agentId: seoAgentId,
        agentName: 'PublishingWorkflow',
        activity: 'Deployment did not complete',
        details: `**Error:** ${deploymentResult.error || 'Timed out waiting for deployment_status webhook'}`,
        result: 'failure',
      })

      await publishDeployEvent({
        type: 'deploy.failed',
        contentId,
        data: {
          error: deploymentResult.error || 'Deployment did not complete',
        },
      })

      throw new Error(
        `Deployment did not complete: ${deploymentResult.error || 'timeout'}`
      )
    }

    const publishedUrl =
      deploymentResult.publishedUrl ||
      input.siteUrl ||
      `https://www.example.com/content/${contentId}`

    console.log(`[Publishing] Deployment confirmed: ${publishedUrl}`)

    // Log deployment success to GitHub
    await logAgentActivityToGitHub({
      contentId,
      agentId: seoAgentId,
      agentName: 'PublishingWorkflow',
      activity: 'Deployment confirmed',
      details: `Site repo's GitHub Actions deploy completed.\n\n**Published URL:** ${publishedUrl}`,
      result: 'success',
    })

    // Step 6: Transition to published state
    await transitionContentState({
      contentId,
      event: 'deploy_success',
      actor: 'EngineeringAgent',
      actorId: input.engineeringAgentId || seoAgentId,
    })

    // Step 7: Publish success event
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

    const deploymentTime = await measureDuration(startTime)

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
      qaGateResult,
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
      qaGateResult,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
