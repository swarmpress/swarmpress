/**
 * Outbox Worker
 *
 * Drains the `event_outbox` table and publishes CloudEvents via the existing
 * NATS event bus. Provides at-least-once delivery: events are written in the
 * same DB transaction as their originating state change, and re-published on
 * failure until they succeed.
 *
 * Not auto-started — call `start()` from your application bootstrap.
 */

import { publishEvent } from '@swarm-press/event-bus'
import {
  eventOutboxRepository,
  type EventOutboxRow,
} from '../db/repositories/event-outbox-repository'

const POLL_INTERVAL_MS = 1_000
const BATCH_SIZE = 100

let timer: NodeJS.Timeout | null = null
let running = false
let stopping = false

/**
 * Drain one batch of unpublished events. Exposed for tests / on-demand flush.
 */
export async function drainOnce(): Promise<{
  attempted: number
  published: number
  failed: number
}> {
  const events = await eventOutboxRepository.claimUnpublished(BATCH_SIZE)
  let published = 0
  let failed = 0

  for (const event of events) {
    try {
      await publishCloudEvent(event)
      await eventOutboxRepository.markPublished(event.id)
      published++
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      try {
        await eventOutboxRepository.markFailed(event.id, message)
      } catch (markErr) {
        // Last-resort log — we cannot mark the failure, so it will be retried
        // on the next tick anyway.
        console.error(
          '[OutboxWorker] Failed to mark outbox row as failed',
          event.id,
          markErr
        )
      }
      failed++
    }
  }

  return { attempted: events.length, published, failed }
}

async function publishCloudEvent(event: EventOutboxRow): Promise<void> {
  const data = event.event_data as Record<string, unknown> & {
    subject?: string
  }
  const subject = typeof data.subject === 'string' ? data.subject : undefined

  await publishEvent({
    type: event.event_type,
    source: event.source ?? '/system/outbox',
    subject,
    data,
  })
}

async function tick(): Promise<void> {
  if (running || stopping) return
  running = true
  try {
    await drainOnce()
  } catch (err) {
    console.error('[OutboxWorker] Unexpected error during drain', err)
  } finally {
    running = false
  }
}

/**
 * Start the worker. Idempotent — calling twice is a no-op.
 */
export function start(): void {
  if (timer) return
  stopping = false
  // Fire immediately so events queued before bootstrap don't wait a full tick.
  void tick()
  timer = setInterval(() => {
    void tick()
  }, POLL_INTERVAL_MS)
  console.log(
    `[OutboxWorker] Started — polling every ${POLL_INTERVAL_MS}ms (batch=${BATCH_SIZE})`
  )
}

/**
 * Stop the worker. Waits for any in-flight drain to finish before resolving.
 */
export async function stop(): Promise<void> {
  stopping = true
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  // Spin briefly until in-flight tick completes.
  while (running) {
    await new Promise((r) => setTimeout(r, 50))
  }
  console.log('[OutboxWorker] Stopped')
}

export const outboxWorker = { start, stop, drainOnce }
