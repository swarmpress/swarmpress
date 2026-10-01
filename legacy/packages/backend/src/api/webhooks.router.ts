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
 * Resolve the contentId that this deployment most plausibly corresponds to.
 *
 * The deployment_status payload does NOT carry a PR reference directly —
 * GitHub Actions runs on the merge commit, and the `pr_content_mappings`
 * table does not (yet) store the merge SHA. So we use a best-effort
 * heuristic: the most-recently-merged mapping for this website that has
 * not yet seen a 'deployed' audit-log row.
 *
 * This is sufficient for the realistic deploy cadence (deploys are
 * serialized by the site repo's GitHub Actions and merges of multiple
 * editorial PRs within the same Actions run window are rare). Returns
 * null when there is no plausible recently-merged mapping — callers
 * should log + skip the signal in that case.
 */
async function resolveContentIdForDeployment(
  websiteId: string
): Promise<string | null> {
  const result = await db.query<{ content_id: string | null }>(
    `SELECT content_id
       FROM pr_content_mappings
      WHERE website_id = $1
        AND merged_at IS NOT NULL
        AND content_id IS NOT NULL
      ORDER BY merged_at DESC
      LIMIT 1`,
    [websiteId]
  )
  return result.rows[0]?.content_id ?? null
}

/**
 * Handle deployment_status events.
 * GitHub fires this when a deployment transitions through pending →
 * in_progress → success/failure/error. We mirror the terminal states
 * onto the websites row + record an audit-log entry on success AND fire
 * the `deploymentStatus` Temporal signal at the publishingWorkflow that
 * is waiting on this deploy (resolved by the deterministic workflow id
 * `publishing-${contentId}`).
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
  const targetUrl: string | null = payload?.deployment_status?.target_url ?? null

  // Best-effort: resolve the content_id this deployment corresponds to.
  // Used for both (a) audit-log entity alignment so future "did this
  // content deploy?" queries succeed, and (b) signal target resolution.
  // If resolution fails the audit log + websites row still get written
  // (the website-only fallback); only the signal is skipped.
  const contentId = await resolveContentIdForDeployment(website.id).catch((err) => {
    console.warn(
      `[Webhooks] resolveContentIdForDeployment failed: ${err instanceof Error ? err.message : err}`
    )
    return null
  })

  if (state === 'success') {
    // Audit-log the deploy + flip the website row to 'deployed'.
    await db.transaction(async (client) => {
      if (contentId) {
        // Augmented row when contentId is resolvable; carries entity_id
        // = content_id so readers can find "did this content deploy?"
        // via state_audit_log lookup keyed on the content.
        await client.query(
          `INSERT INTO state_audit_log
             (entity_type, entity_id, from_state, to_state, actor_type, actor_id, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
          [
            'content',
            contentId,
            null,
            'deployed',
            'github_webhook',
            null,
            JSON.stringify({
              event: 'deployed',
              environment,
              description,
              target_url: targetUrl,
              website_id: website.id,
            }),
          ]
        )
      }
      // Augmented row when contentId is resolvable; falls back to
      // website-only for orphan deploys (no recently-merged PR mapped to
      // a content_id — e.g. a hand-rolled deploy or a deploy that
      // predates the PR-mapping table).
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
            target_url: targetUrl,
            content_id: contentId,
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

    // Best-effort signal delivery to the publishingWorkflow waiting on
    // this deploy. If Temporal rejects (workflow not found / already
    // completed), we log and continue — DB writes already happened, so
    // downstream readers still see the deploy.
    if (contentId) {
      await signalPublishingWorkflow(contentId, {
        state: 'success',
        deploymentUrl: targetUrl ?? undefined,
        deployedAt: new Date().toISOString(),
      })
    }

    return { handled: true, action: contentId ? 'deployed' : 'deployed_orphan' }
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

    // Best-effort signal delivery on failure too — let the workflow
    // surface the error instead of waiting out its timeout.
    if (contentId) {
      await signalPublishingWorkflow(contentId, {
        state: state as 'failure' | 'error',
        error: description || `deploy ${state}`,
        deployedAt: new Date().toISOString(),
      })
    }

    return { handled: true, action: 'deploy_failed' }
  }

  // pending / in_progress / queued — no-op
  return { handled: true, action: `state:${state}` }
}

/**
 * Fire the `deploymentStatus` Temporal signal at the publishingWorkflow
 * for a content item. Best-effort: if the workflow can't be reached
 * (not running / wrong id / Temporal unavailable), we log and continue
 * rather than failing the webhook.
 *
 * The deterministic workflow id is `publishing-${contentId}` — mirrors
 * the `content-production-${contentId}` convention used elsewhere.
 */
async function signalPublishingWorkflow(
  contentId: string,
  payload: {
    state: 'success' | 'failure' | 'error'
    deploymentUrl?: string
    error?: string
    deployedAt?: string
  }
): Promise<void> {
  try {
    // Dynamic import to avoid pulling workflows package into webhook
    // handler's eager dependency graph (mirrors workflow.router.ts).
    const { signalWorkflow } = await import('@swarm-press/workflows')
    const workflowId = `publishing-${contentId}`
    await signalWorkflow(workflowId, 'deploymentStatus', [payload])
    console.log(
      `[Webhooks] Fired deploymentStatus signal to ${workflowId} (state=${payload.state})`
    )
  } catch (err) {
    // Workflow not found / already completed / Temporal unreachable.
    // Log and continue — the DB writes already happened.
    console.warn(
      `[Webhooks] deploymentStatus signal not delivered for content ${contentId}: ${err instanceof Error ? err.message : err}`
    )
  }
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
