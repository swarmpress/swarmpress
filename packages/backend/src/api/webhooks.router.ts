/**
 * GitHub Webhooks Router
 * Receives GitHub webhook events and routes them to workflow signals
 *
 * This is the HTTP layer that receives GitHub webhooks and triggers
 * the Human-in-the-Loop workflow signals.
 */

import { Router, Request, Response } from 'express'
import crypto from 'crypto'

const router = Router()

// Webhook secret for signature verification
const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || ''

/**
 * Verify GitHub webhook signature
 */
function verifySignature(req: Request): boolean {
  if (!WEBHOOK_SECRET) {
    console.warn('[Webhooks] No GITHUB_WEBHOOK_SECRET configured, skipping verification')
    return true // Allow in development
  }

  const signature = req.headers['x-hub-signature-256'] as string
  if (!signature) {
    return false
  }

  const payload = JSON.stringify(req.body)
  const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET)
  const digest = 'sha256=' + hmac.update(payload).digest('hex')

  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest))
}

/**
 * Extract content ID from PR branch name
 * Branch format: content/{contentId}
 */
function extractContentIdFromBranch(branchName: string): string | null {
  const match = branchName.match(/content\/(.+)/)
  return match ? match[1] : null
}

/**
 * Create GitHub webhooks router
 */
export function createWebhooksRouter(): Router {
  console.log('[WebhooksRouter] Initializing GitHub webhooks router')

  // Health check for webhooks
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'github-webhooks' })
  })

  // Main webhook endpoint
  router.post('/github', async (req: Request, res: Response) => {
    // Verify signature
    if (!verifySignature(req)) {
      console.error('[Webhooks] Invalid signature')
      return res.status(401).json({ error: 'Invalid signature' })
    }

    const event = req.headers['x-github-event'] as string
    const deliveryId = req.headers['x-github-delivery'] as string
    const payload = req.body

    console.log(`[Webhooks] Received event: ${event} (delivery: ${deliveryId})`)

    try {
      // Dynamic import to avoid circular dependencies
      const { handlePRReviewSubmitted, handleIssueComment, handlePRMerged, handlePRClosed } =
        await import('@swarm-press/workflows/dist/services/github-webhook-handler')

      let result: { handled: boolean; action?: string; error?: string } = { handled: false }

      switch (event) {
        case 'pull_request_review':
          if (payload.action === 'submitted') {
            result = await handlePRReviewSubmitted(payload.pull_request, payload.review)
          }
          break

        case 'pull_request':
          if (payload.action === 'closed') {
            if (payload.pull_request.merged) {
              result = await handlePRMerged(payload.pull_request)
            } else {
              result = await handlePRClosed(payload.pull_request)
            }
          }
          break

        case 'issue_comment':
          if (payload.action === 'created') {
            result = await handleIssueComment(payload.issue, payload.comment)
          }
          break

        default:
          console.log(`[Webhooks] Unhandled event type: ${event}`)
          result = { handled: false, error: `Unhandled event: ${event}` }
      }

      console.log(`[Webhooks] Event ${event} result:`, result)

      return res.json({
        success: result.handled,
        event,
        action: result.action,
        error: result.error,
      })
    } catch (error) {
      console.error('[Webhooks] Error processing webhook:', error)
      return res.status(500).json({
        error: error instanceof Error ? error.message : 'Internal error',
      })
    }
  })

  return router
}

export const webhooksRouter = createWebhooksRouter()
