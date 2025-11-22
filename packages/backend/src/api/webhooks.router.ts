/**
 * GitHub Webhooks Router
 * Handles incoming GitHub webhooks and syncs state
 */

import { Router } from 'express'
import {
  GitHubWebhooks,
  syncPRToInternal,
  syncPRReviewToInternal,
  syncIssueCommentToInternal,
} from '@agent-press/github-integration'

const router = Router()

/**
 * Initialize GitHub webhooks with handlers
 */
export function createWebhooksRouter(): Router {
  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET || 'dev-secret'

  const webhooks = new GitHubWebhooks(
    { secret: webhookSecret },
    {
      // PR opened → Trigger editorial review workflow
      onPROpened: async (pr) => {
        console.log(`[WebhookHandler] PR opened: #${pr.number}`)
        try {
          await syncPRToInternal(pr)
        } catch (error) {
          console.error('[WebhookHandler] Error syncing PR:', error)
        }
      },

      // PR review submitted → Update content state
      onPRReviewSubmitted: async (pr, review) => {
        console.log(`[WebhookHandler] PR review submitted: #${pr.number} - ${review.state}`)
        try {
          await syncPRReviewToInternal(pr, review)
        } catch (error) {
          console.error('[WebhookHandler] Error syncing PR review:', error)
        }
      },

      // PR closed/merged → Trigger publishing if merged
      onPRClosed: async (pr) => {
        console.log(`[WebhookHandler] PR ${pr.merged ? 'merged' : 'closed'}: #${pr.number}`)

        if (pr.merged) {
          // TODO: Trigger publishing workflow
          console.log(`[WebhookHandler] PR merged, should trigger publishing`)
        }
      },

      // Issue commented → Check for CEO answers
      onIssueCommented: async (issue, comment) => {
        console.log(`[WebhookHandler] Issue commented: #${issue.number}`)
        try {
          await syncIssueCommentToInternal(issue, comment)
        } catch (error) {
          console.error('[WebhookHandler] Error syncing issue comment:', error)
        }
      },
    }
  )

  // GitHub webhook endpoint
  router.use('/github', webhooks.getMiddleware())

  // Health check for webhooks
  router.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'github-webhooks' })
  })

  return router
}

export const webhooksRouter = createWebhooksRouter()
