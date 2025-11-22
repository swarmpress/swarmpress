import { eventBus } from './connection'
import { CloudEvent, validateCloudEvent } from './cloudevents'
import { StringCodec } from 'nats'

const codec = StringCodec()

export type EventHandler<T = unknown> = (event: CloudEvent<T>) => Promise<void> | void

/**
 * Subscribe to events by pattern
 */
export async function subscribe<T = unknown>(
  pattern: string,
  handler: EventHandler<T>
): Promise<void> {
  const js = eventBus.getJetStream()

  const natsSubject = pattern.startsWith('swarmpress.')
    ? pattern
    : `swarmpress.${pattern}`

  console.log(`📥 Subscribing to: ${natsSubject}`)

  const consumer = await js.consumers.get('AGENTPRESS', `consumer-${Date.now()}`)

  const messages = await consumer.consume()

  ;(async () => {
    for await (const msg of messages) {
      try {
        const payload = codec.decode(msg.data)
        const event = validateCloudEvent(JSON.parse(payload)) as CloudEvent<T>

        await handler(event)

        msg.ack()
      } catch (error) {
        console.error('Error processing event:', error)
        msg.nak()
      }
    }
  })()
}

/**
 * Subscribe to all events (for monitoring/logging)
 */
export async function subscribeAll(handler: EventHandler): Promise<void> {
  await subscribe('swarmpress.>', handler)
}

/**
 * Subscribe to specific event types
 */
export const subscriptions = {
  // Content events
  onContentCreated: (handler: EventHandler) => subscribe('content.created', handler),
  onContentSubmitted: (handler: EventHandler) =>
    subscribe('content.submittedForReview', handler),
  onContentApproved: (handler: EventHandler) => subscribe('content.approved', handler),
  onContentPublished: (handler: EventHandler) =>
    subscribe('content.published', handler),

  // Task events
  onTaskCreated: (handler: EventHandler) => subscribe('task.created', handler),
  onTaskCompleted: (handler: EventHandler) => subscribe('task.completed', handler),

  // Ticket events
  onTicketCreated: (handler: EventHandler) => subscribe('ticket.created', handler),
  onTicketAnswered: (handler: EventHandler) => subscribe('ticket.answered', handler),

  // Deploy events
  onDeploySuccess: (handler: EventHandler) => subscribe('deploy.success', handler),
  onDeployFailed: (handler: EventHandler) => subscribe('deploy.failed', handler),
}
