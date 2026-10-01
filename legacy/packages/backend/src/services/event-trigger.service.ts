/**
 * Event Trigger Service
 *
 * Subscribes to NATS CloudEvents and starts Temporal workflows in response.
 * This is the "outer loop" that closes the autonomous publishing path:
 *
 *   scheduled-content workflow → createContentBrief activity emits
 *   `brief.created` (via the outbox + OutboxWorker) → NATS →
 *   EventTriggerService → starts contentProductionWorkflow.
 *
 * Idempotency: workflow IDs are deterministic (`content-production-{contentId}`).
 * If a workflow with that ID is already running, Temporal throws
 * `WorkflowExecutionAlreadyStartedError` which we catch and treat as a no-op.
 *
 * Not auto-started — call `start()` from your application bootstrap, after
 * `eventBus.connect()` has resolved.
 */

import { subscriptions } from '@swarm-press/event-bus'
import { agentRepository } from '../db/repositories/agent-repository'
import { contentRepository } from '../db/repositories/content-repository'

let started = false

/**
 * Look up a writer agent that can `write_draft`.
 *
 * Today the agents table is single-tenant in practice, so we scan all agents
 * and match on capabilities. If/when agents become website-scoped, narrow this
 * by `website_id` before matching.
 */
async function resolveWriterAgentId(_websiteId: string): Promise<string | null> {
  const allAgents = await agentRepository.findAll()
  const writer = allAgents.find((agent) => {
    const caps =
      (agent.capabilities as Array<{ name: string; enabled?: boolean }> | string[]) ||
      []
    const capabilityNames = caps.map((c) =>
      typeof c === 'string' ? c : c.name
    )
    return (
      capabilityNames.includes('write_draft') ||
      capabilityNames.includes('content_writing') ||
      capabilityNames.includes('research_topic')
    )
  })
  return writer?.id ?? null
}

/**
 * Handle a `brief.created` event by starting `contentProductionWorkflow`
 * with a deterministic workflow ID for idempotency.
 */
async function handleBriefCreated(event: {
  data?: { content_id?: string; website_id?: string }
}): Promise<void> {
  const contentId = event.data?.content_id
  const websiteId = event.data?.website_id

  if (!contentId || !websiteId) {
    console.error(
      '[EventTriggerService] brief.created missing content_id or website_id',
      event.data
    )
    return
  }

  try {
    const writerAgentId = await resolveWriterAgentId(websiteId)
    if (!writerAgentId) {
      console.error(
        `[EventTriggerService] No writer agent (write_draft capability) found for website ${websiteId}; cannot start contentProductionWorkflow for ${contentId}`
      )
      return
    }

    // Pull the brief metadata so we can pass a sensible `brief` string into
    // the workflow. The workflow needs *some* prompt text for the writer.
    const content = await contentRepository.findById(contentId)
    if (!content) {
      console.error(
        `[EventTriggerService] content_item ${contentId} not found; skipping workflow start`
      )
      return
    }
    const briefText =
      (content as { brief?: string; title?: string }).brief ||
      (content as { title?: string }).title ||
      ''

    // Lazy-load the temporal client to avoid pulling Temporal types into
    // every backend consumer at import time.
    const { temporalClient, startWorkflow } = await import(
      '@swarm-press/workflows'
    )

    if (!temporalClient.isConnected()) {
      await temporalClient.connect()
    }

    const workflowId = `content-production-${contentId}`

    try {
      const handle = await startWorkflow(
        'contentProductionWorkflow',
        [
          {
            contentId,
            writerAgentId,
            brief: briefText,
            maxRevisions: 0,
          },
        ],
        { workflowId }
      )
      console.log(
        `[EventTriggerService] Started contentProductionWorkflow ${handle.workflowId} (run ${handle.runId}) for content ${contentId}`
      )
    } catch (err) {
      // Temporal throws WorkflowExecutionAlreadyStartedError when a workflow
      // with the same workflow_id is already running. That is exactly the
      // idempotency guarantee we want — log and continue.
      const message = err instanceof Error ? err.message : String(err)
      const name = err instanceof Error ? err.name : ''
      if (
        name === 'WorkflowExecutionAlreadyStartedError' ||
        message.includes('already started') ||
        message.includes('AlreadyStarted')
      ) {
        console.log(
          `[EventTriggerService] contentProductionWorkflow already running for ${contentId} (workflowId=${workflowId}) — skipping (idempotent)`
        )
        return
      }
      throw err
    }
  } catch (err) {
    console.error(
      `[EventTriggerService] Failed to handle brief.created for ${contentId}:`,
      err
    )
  }
}

/**
 * Start the service. Idempotent — calling twice is a no-op.
 *
 * NOTE: The current `subscribe()` helper in @swarm-press/event-bus does not
 * return an unsubscribe handle. Until that is added, `stop()` only flips
 * the `started` flag; the underlying NATS subscription is dropped on
 * connection close at process shutdown.
 */
export async function start(): Promise<void> {
  if (started) return
  started = true
  await subscriptions.onBriefCreated(async (event) => {
    await handleBriefCreated(event as {
      data?: { content_id?: string; website_id?: string }
    })
  })
  console.log('[EventTriggerService] Started — subscribed to brief.created')
}

/**
 * Stop the service. See note in `start()` re: subscription teardown.
 */
export async function stop(): Promise<void> {
  if (!started) return
  started = false
  console.log('[EventTriggerService] Stopped')
}

export const eventTriggerService = { start, stop }
