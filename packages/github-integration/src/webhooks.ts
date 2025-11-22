/**
 * GitHub Webhooks Handler
 * Processes GitHub events and syncs with internal state
 */

import { Webhooks, createNodeMiddleware } from '@octokit/webhooks'
import type { Request, Response } from 'express'

export interface WebhookConfig {
  secret: string
}

export interface WebhookHandlers {
  onPROpened?: (pr: any) => Promise<void>
  onPRReviewSubmitted?: (pr: any, review: any) => Promise<void>
  onPRClosed?: (pr: any) => Promise<void>
  onIssueCreated?: (issue: any) => Promise<void>
  onIssueCommented?: (issue: any, comment: any) => Promise<void>
  onIssueClosed?: (issue: any) => Promise<void>
}

/**
 * GitHub Webhooks Manager
 */
export class GitHubWebhooks {
  private webhooks: Webhooks
  private handlers: WebhookHandlers

  constructor(config: WebhookConfig, handlers: WebhookHandlers = {}) {
    this.webhooks = new Webhooks({
      secret: config.secret,
    })
    this.handlers = handlers

    this.setupHandlers()
  }

  /**
   * Set up webhook event handlers
   */
  private setupHandlers(): void {
    // Pull Request opened
    this.webhooks.on('pull_request.opened', async ({ payload }) => {
      console.log(`[Webhook] PR opened: #${payload.pull_request.number}`)

      if (this.handlers.onPROpened) {
        await this.handlers.onPROpened(payload.pull_request)
      }
    })

    // Pull Request review submitted
    this.webhooks.on('pull_request_review.submitted', async ({ payload }) => {
      console.log(`[Webhook] PR review submitted: #${payload.pull_request.number}`)

      if (this.handlers.onPRReviewSubmitted) {
        await this.handlers.onPRReviewSubmitted(
          payload.pull_request,
          payload.review
        )
      }
    })

    // Pull Request closed (merged or just closed)
    this.webhooks.on('pull_request.closed', async ({ payload }) => {
      console.log(
        `[Webhook] PR ${payload.pull_request.merged ? 'merged' : 'closed'}: #${payload.pull_request.number}`
      )

      if (this.handlers.onPRClosed) {
        await this.handlers.onPRClosed(payload.pull_request)
      }
    })

    // Issue created
    this.webhooks.on('issues.opened', async ({ payload }) => {
      console.log(`[Webhook] Issue created: #${payload.issue.number}`)

      if (this.handlers.onIssueCreated) {
        await this.handlers.onIssueCreated(payload.issue)
      }
    })

    // Issue comment created
    this.webhooks.on('issue_comment.created', async ({ payload }) => {
      console.log(`[Webhook] Issue comment: #${payload.issue.number}`)

      if (this.handlers.onIssueCommented) {
        await this.handlers.onIssueCommented(payload.issue, payload.comment)
      }
    })

    // Issue closed
    this.webhooks.on('issues.closed', async ({ payload }) => {
      console.log(`[Webhook] Issue closed: #${payload.issue.number}`)

      if (this.handlers.onIssueClosed) {
        await this.handlers.onIssueClosed(payload.issue)
      }
    })

    // Error handling
    this.webhooks.onError((error) => {
      console.error('[Webhook] Error:', error)
    })
  }

  /**
   * Get Express middleware for webhook endpoint
   */
  getMiddleware() {
    return createNodeMiddleware(this.webhooks, { path: '/webhooks/github' })
  }

  /**
   * Manually verify and handle a webhook
   */
  async handleWebhook(req: Request, res: Response): Promise<void> {
    const signature = req.headers['x-hub-signature-256'] as string
    const event = req.headers['x-github-event'] as string
    const id = req.headers['x-github-delivery'] as string
    const payload = req.body

    try {
      await this.webhooks.verifyAndReceive({
        id,
        name: event as any,
        signature,
        payload,
      })

      res.status(200).json({ message: 'Webhook processed' })
    } catch (error) {
      console.error('[Webhook] Verification failed:', error)
      res.status(400).json({ error: 'Webhook verification failed' })
    }
  }
}
