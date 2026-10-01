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
 *   2. Merge the editorial PR — this is what actually triggers the site
 *      repo's GitHub Actions deploy job.
 *   3. Wait for the GitHub `deployment_status` webhook, which fires the
 *      `deploymentStatus` signal directly on this workflow (see
 *      `webhooks.router.ts:handleDeploymentStatus`). Transition state to
 *      `published` once observed.
 *
 * SEO optimization was previously a Step 2 here, but `invokeSEOAgent` was
 * a silent no-op (no `SEOAgent` class exists in `packages/agents/src/seo/`,
 * the factory threw, and the result was discarded). The call has been
 * removed pending a real SEOAgent implementation.
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

import {
  proxyActivities,
  defineSignal,
  setHandler,
  condition,
} from '@temporalio/workflow'
import type * as activities from '../activities'
import { qaGateWorkflow, type QAGateResult } from './qa-gate.workflow'

/**
 * Payload of the `deploymentStatus` signal fired by the GitHub
 * `deployment_status` webhook (see
 * `packages/backend/src/api/webhooks.router.ts:handleDeploymentStatus`).
 *
 * The webhook handler resolves the active publishingWorkflow by
 * `publishing-${contentId}` deterministic id and signals it directly,
 * replacing the legacy polling stub `waitForDeploymentActivity`.
 */
export interface DeploymentSignalPayload {
  state: 'success' | 'failure' | 'error'
  deploymentUrl?: string
  error?: string
  deployedAt?: string
}

/**
 * Signal fired by the GitHub `deployment_status` webhook when the site
 * repo's own GitHub Actions deploy job finishes (success/failure/error).
 *
 * Mirrors the pattern used by `ceoApprovalSignal` in
 * `editorial-review.workflow.ts`. The handler is registered up-front so the
 * signal is preserved across workflow replay.
 */
export const deploymentStatusSignal =
  defineSignal<[DeploymentSignalPayload]>('deploymentStatus')

const {
  getContentItem,
  transitionContentState,
  publishContentEvent,
  publishDeployEvent,
  syncPublishToGitHubActivity,
  logAgentActivityToGitHub,
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
 * 2. Transition to scheduled state
 * 3. Merge editorial PR (this triggers site repo's GitHub Actions deploy)
 * 4. Await `deploymentStatus` signal fired by the GitHub
 *    `deployment_status` webhook (see `webhooks.router.ts`)
 * 5. Transition to published state
 * 6. Publish success/failure events
 *
 * (Step 2 used to be SEO optimization — removed; see header comment.)
 */
export async function publishingWorkflow(
  input: PublishingInput
): Promise<PublishingResult> {
  const { contentId, websiteId, seoAgentId, qaGate, deploymentTimeout } = input
  const startTime = await getCurrentTimestamp()
  let qaGateResult: QAGateResult | undefined

  // Register the deployment signal handler BEFORE any awaits so it is
  // available the moment the workflow begins (and across every replay).
  // The webhook handler may fire the signal as soon as the merged PR
  // triggers the site repo's GitHub Actions deploy job — possibly while
  // we're still in earlier steps. Capturing it eagerly avoids a race.
  let deploymentResult: DeploymentSignalPayload | null = null
  setHandler(deploymentStatusSignal, (payload) => {
    deploymentResult = payload
  })

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

      console.log(`[Publishing] QA Gate PASSED - proceeding to publish`)
    } else if (!qaGate?.qaAgentId) {
      console.log(`[Publishing] QA Gate skipped (no qaAgentId provided)`)
    }

    // Step 2: SEO optimization is deferred. A future workflow will run a
    // real SEOAgent once `packages/agents/src/seo/` is implemented. The
    // previous `invokeSEOAgent` call has been removed because there is
    // no SEOAgent class — the agent factory threw and the result was
    // discarded, so the call was a silent no-op. See plan-doc
    // /Users/drietsch/.claude/plans/check-all-the-sources-mossy-locket.md
    // (autonomy migration WS-C).

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

    // Step 5: Wait for the GitHub `deployment_status` webhook to confirm
    // the site repo's Actions workflow finished deploying. The webhook
    // handler in `webhooks.router.ts:handleDeploymentStatus` fires the
    // `deploymentStatus` signal directly on this workflow, so we resume
    // immediately instead of polling. If the signal never arrives within
    // the timeout, surface that as a workflow failure rather than
    // guessing the deploy succeeded.
    console.log(`[Publishing] Waiting for deploymentStatus signal`)

    // `condition` accepts Temporal's `Duration` type, which is a union of
    // `number` (milliseconds) and a template-literal string like
    // `${number} minutes`. A widened `string` won't satisfy the literal
    // member, so we cast — at runtime Temporal happily accepts any
    // human-readable duration string.
    const signalTimeout = deploymentTimeout || '30 minutes'
    const fired = await condition(
      () => deploymentResult !== null,
      signalTimeout as `${number} minutes`
    )

    if (!fired) {
      const timeoutMsg = `Timed out after ${signalTimeout} waiting for deploymentStatus signal`

      await logAgentActivityToGitHub({
        contentId,
        agentId: seoAgentId,
        agentName: 'PublishingWorkflow',
        activity: 'Deployment did not complete',
        details: `**Error:** ${timeoutMsg}`,
        result: 'failure',
      })

      await publishDeployEvent({
        type: 'deploy.failed',
        contentId,
        data: { error: timeoutMsg },
      })

      throw new Error(`Deployment did not complete: ${timeoutMsg}`)
    }

    // After `fired === true` we know the handler set `deploymentResult`,
    // but TS still considers it `DeploymentSignalPayload | null`. The
    // non-null assertion is safe inside this branch.
    const signal = deploymentResult as unknown as DeploymentSignalPayload

    if (signal.state !== 'success') {
      const failureMsg = signal.error || `Deployment ${signal.state}`

      await logAgentActivityToGitHub({
        contentId,
        agentId: seoAgentId,
        agentName: 'PublishingWorkflow',
        activity: 'Deployment did not complete',
        details: `**Error:** ${failureMsg}`,
        result: 'failure',
      })

      await publishDeployEvent({
        type: 'deploy.failed',
        contentId,
        data: { error: failureMsg },
      })

      throw new Error(`Deployment did not complete: ${failureMsg}`)
    }

    const publishedUrl =
      signal.deploymentUrl ||
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
