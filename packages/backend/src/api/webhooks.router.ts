/**
 * GitHub Webhooks Router (Stubbed for MVP)
 * Circular dependency: backend ← github-integration → backend
 * TODO: Refactor to break circular dependency
 */

import { Router } from 'express'

const router = Router()

/**
 * Stub GitHub webhooks router
 */
export function createWebhooksRouter(): Router {
  console.log('[WebhooksRouter] GitHub integration disabled (circular dependency)')

  // Health check for webhooks
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'github-webhooks-stub' })
  })

  // Stub webhook endpoint
  router.post('/github', (_req, res) => {
    res.json({ status: 'not_implemented', message: 'GitHub integration disabled due to circular dependency' })
  })

  return router
}

export const webhooksRouter = createWebhooksRouter()
