/**
 * GitHub Webhooks Router
 * Receives GitHub webhook events and routes them to workflow signals
 * + persists PR ↔ content mappings + records deployment status.
 *
 * This is the HTTP layer that receives GitHub webhooks and triggers
 * the Human-in-the-Loop workflow signals AND keeps Postgres in sync
 * with GitHub PR / deployment state for the repo-canonical content
 * workflow (see specs / `check-all-the-sources-mossy-locket.md` WS4).
 */

import { Router, Request, Response } from 'express'
import crypto from 'crypto'
import { db } from '../db/connection'
import {
  prContentMappingRepository,
  eventOutboxRepository,
} from '../db/repositories'

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
 * Extract content ID from PR branch name.
 * Supports both legacy and current draft branch conventions:
 *   - drafts/content-{contentId}   (current — repo-canonical migration)
 *   - content/{contentId}          (legacy)
 * Returns null if no contentId can be extracted (e.g. a hand-rolled branch).
 */
function extractContentIdFromBranch(branchName: string): string | null {
  if (!branchName) return null
  const draft = branchName.match(/^drafts\/content-(.+)$/)
  if (draft) return draft[1] ?? null
  const legacy = branchName.match(/^content\/(.+)$/)
  if (legacy) return legacy[1] ?? null
  return null
}

/**
 * Resolve the website row for a webhook payload's repository.
 * GitHub payloads include `repository.owner.login` and `repository.name`;
 * we match against `websites.github_owner` + `websites.github_repo`.
 *
 * Returns the bare row (not a typed Website) — webhook handlers only need
 * id, github_pages_branch, etc. Returns null when no matching website is
 * registered (the platform isn't responsible for that repo).
 */
interface WebsiteRow {
  id: string
  domain: string
  github_owner: string | null
  github_repo: string | null
  github_pages_branch: string | null
}

async function resolveWebsiteByRepo(
  owner: string | undefined,
  repo: string | undefined
): Promise<WebsiteRow | null> {
  if (!owner || !repo) return null
  const result = await db.query<WebsiteRow>(
    `SELECT id, domain, github_owner, github_repo, github_pages_branch
       FROM websites
      WHERE github_owner = $1
        AND github_repo = $2
      LIMIT 1`,
    [owner, repo]
  )
  return result.rows[0] ?? null
}

/**
 * Handle pull_request.opened — upsert the PR ↔ content mapping.
 * Idempotent: re-deliveries (or PRs opened outside the platform) are safe.
 */
async function handlePullRequestOpened(
  payload: any
): Promise<{ handled: boolean; action?: string; error?: string }> {
  const pr = payload?.pull_request
  if (!pr) return { handled: false, error: 'missing pull_request' }

  const website = await resolveWebsiteByRepo(
    payload?.repository?.owner?.login,
    payload?.repository?.name
  )
  if (!website) {
    console.log(
      `[Webhooks] pull_request.opened for unregistered repo ${payload?.repository?.full_name} — ignoring`
    )
    return { handled: false, action: 'unregistered_repo' }
  }

  const branchName: string = pr?.head?.ref ?? ''
  const contentId = extractContentIdFromBranch(branchName)

  await prContentMappingRepository.upsertByPrNumber({
    websiteId: website.id,
    prNumber: pr.number,
    prUrl: pr.html_url ?? '',
    branchName,
    contentId: contentId ?? undefined,
  })

  return { handled: true, action: 'mapping_upserted' }
}

/**
 * Handle push events to the website's deploy branch.
 * Emits a content.pushed CloudEvent into the outbox so subscribers
 * (cache rebuilders, sitemap regenerators, etc.) can react. We do
 * not act on the event ourselves — the site's own GitHub Action
 * handles the actual deploy.
 *
 * Note: GitHub pushes use refs like `refs/heads/main`. We only emit
 * for pushes to the website's configured deploy branch (default `main`).
 */
async function handlePush(
  payload: any
): Promise<{ handled: boolean; action?: string; error?: string }> {
  const website = await resolveWebsiteByRepo(
    payload?.repository?.owner?.login,
    payload?.repository?.name
  )
  if (!website) {
    return { handled: false, action: 'unregistered_repo' }
  }

  const ref: string = payload?.ref ?? ''
  const branch = ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref
  // Default to 'main' if the website hasn't configured a deploy branch yet.
  const deployBranch = website.github_pages_branch || 'main'

  // Only emit for pushes to the deploy branch — feature branch pushes
  // are noisy and not interesting for downstream rebuilds.
  if (branch !== deployBranch) {
    return { handled: false, action: `ignored_branch:${branch}` }
  }

  const commitSha: string = payload?.after ?? payload?.head_commit?.id ?? ''
  // GitHub push payloads include `commits[]`; aggregate modified files across them.
  const modifiedFiles: string[] = Array.isArray(payload?.commits)
    ? Array.from(
        new Set<string>(
          payload.commits.flatMap((c: any) => [
            ...((Array.isArray(c?.added) ? c.added : []) as string[]),
            ...((Array.isArray(c?.modified) ? c.modified : []) as string[]),
            ...((Array.isArray(c?.removed) ? c.removed : []) as string[]),
          ])
        )
      )
    : []

  await eventOutboxRepository.insert(
    'content.pushed',
    {
      websiteId: website.id,
      branch,
      commitSha,
      modifiedFiles,
    },
    'webhooks.router'
  )

  return { handled: true, action: 'event_emitted' }
}

/**
 * Handle deployment_status events.
 * GitHub fires this when a deployment transitions through pending →
 * in_progress → success/failure/error. We mirror the terminal states
 * onto the websites row + record an audit-log entry on success.
 */
async function handleDeploymentStatus(
  payload: any
): Promise<{ handled: boolean; action?: string; error?: string }> {
  const website = await resolveWebsiteByRepo(
    payload?.repository?.owner?.login,
    payload?.repository?.name
  )
  if (!website) {
    return { handled: false, action: 'unregistered_repo' }
  }

  const state: string = payload?.deployment_status?.state ?? ''
  const description: string =
    payload?.deployment_status?.description ?? payload?.deployment_status?.log_url ?? ''
  const environment: string = payload?.deployment?.environment ?? 'production'

  if (state === 'success') {
    // Audit-log the deploy + flip the website row to 'deployed'.
    await db.transaction(async (client) => {
      await client.query(
        `INSERT INTO state_audit_log
           (entity_type, entity_id, from_state, to_state, actor_type, actor_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
        [
          'website',
          website.id,
          null,
          'deployed',
          'github_webhook',
          null,
          JSON.stringify({
            event: 'deployed',
            environment,
            description,
            target_url: payload?.deployment_status?.target_url ?? null,
          }),
        ]
      )
      await client.query(
        `UPDATE websites
            SET last_deployed_at = NOW(),
                deployment_status = 'deployed',
                deployment_error = NULL,
                updated_at = NOW()
          WHERE id = $1`,
        [website.id]
      )
    })
    return { handled: true, action: 'deployed' }
  }

  if (state === 'failure' || state === 'error') {
    await db.query(
      `UPDATE websites
          SET deployment_status = 'failed',
              deployment_error = $2,
              updated_at = NOW()
        WHERE id = $1`,
      [website.id, description || `deploy ${state}`]
    )
    return { handled: true, action: 'deploy_failed' }
  }

  // pending / in_progress / queued — no-op
  return { handled: true, action: `state:${state}` }
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
          if (payload.action === 'opened' || payload.action === 'reopened') {
            // Persist mapping; this is purely a side-effect on the platform's
            // metadata store. We don't gate workflow signals on it.
            result = await handlePullRequestOpened(payload)
          } else if (payload.action === 'closed') {
            // Resolve the website + persist closed/merged state on the mapping
            // BEFORE delegating to the workflow signal handlers, so downstream
            // queries (e.g. EditorAgent retries) see the latest state.
            const website = await resolveWebsiteByRepo(
              payload?.repository?.owner?.login,
              payload?.repository?.name
            )

            if (payload.pull_request.merged) {
              if (website) {
                const mergedAt = payload.pull_request.merged_at
                  ? new Date(payload.pull_request.merged_at)
                  : new Date()
                await prContentMappingRepository.markMerged(
                  website.id,
                  payload.pull_request.number,
                  mergedAt
                )
              }
              result = await handlePRMerged(payload.pull_request)
            } else {
              if (website) {
                const closedAt = payload.pull_request.closed_at
                  ? new Date(payload.pull_request.closed_at)
                  : new Date()
                await prContentMappingRepository.markClosed(
                  website.id,
                  payload.pull_request.number,
                  closedAt
                )
              }
              result = await handlePRClosed(payload.pull_request)
            }
          }
          break

        case 'issue_comment':
          if (payload.action === 'created') {
            result = await handleIssueComment(payload.issue, payload.comment)
          }
          break

        case 'push':
          result = await handlePush(payload)
          break

        case 'deployment_status':
          result = await handleDeploymentStatus(payload)
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
