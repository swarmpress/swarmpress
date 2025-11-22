import { eventBus } from './connection'
import { createCloudEvent } from './cloudevents'
import { StringCodec } from 'nats'

const codec = StringCodec()

/**
 * Publish a CloudEvent to NATS
 */
export async function publishEvent<T = unknown>(params: {
  type: string
  source: string
  subject?: string
  data?: T
}): Promise<void> {
  const event = createCloudEvent(params)

  const natsSubject = `swarmpress.${event.type}`
  const payload = codec.encode(JSON.stringify(event))

  const js = eventBus.getJetStream()
  await js.publish(natsSubject, payload)

  if (process.env.LOG_LEVEL === 'debug') {
    console.log(`📤 Published event: ${event.type}`, event.subject)
  }
}

/**
 * Helper function to publish common event types
 */

export const events = {
  // Content events
  async contentCreated(contentId: string, authorAgentId: string) {
    await publishEvent({
      type: 'content.created',
      source: '/agents/writer',
      subject: `content/${contentId}`,
      data: { content_id: contentId, author_agent_id: authorAgentId },
    })
  },

  async contentSubmittedForReview(contentId: string, writerAgentId: string) {
    await publishEvent({
      type: 'content.submittedForReview',
      source: `/agents/writer/${writerAgentId}`,
      subject: `content/${contentId}`,
      data: { content_id: contentId, submitted_by: writerAgentId },
    })
  },

  async contentNeedsChanges(contentId: string, editorAgentId: string, comments: string) {
    await publishEvent({
      type: 'content.needsChanges',
      source: `/agents/editor/${editorAgentId}`,
      subject: `content/${contentId}`,
      data: { content_id: contentId, editor_id: editorAgentId, comments },
    })
  },

  async contentApproved(contentId: string, editorAgentId: string) {
    await publishEvent({
      type: 'content.approved',
      source: `/agents/editor/${editorAgentId}`,
      subject: `content/${contentId}`,
      data: { content_id: contentId, approved_by: editorAgentId },
    })
  },

  async contentScheduled(contentId: string) {
    await publishEvent({
      type: 'content.scheduled',
      source: '/agents/seo',
      subject: `content/${contentId}`,
      data: { content_id: contentId },
    })
  },

  async contentPublished(contentId: string, websiteId: string) {
    await publishEvent({
      type: 'content.published',
      source: '/agents/engineering',
      subject: `content/${contentId}`,
      data: { content_id: contentId, website_id: websiteId },
    })
  },

  // Task events
  async taskCreated(taskId: string, agentId: string, taskType: string) {
    await publishEvent({
      type: 'task.created',
      source: '/system',
      subject: `task/${taskId}`,
      data: { task_id: taskId, agent_id: agentId, type: taskType },
    })
  },

  async taskCompleted(taskId: string, agentId: string) {
    await publishEvent({
      type: 'task.completed',
      source: `/agents/${agentId}`,
      subject: `task/${taskId}`,
      data: { task_id: taskId, completed_by: agentId },
    })
  },

  // Question Ticket events
  async ticketCreated(ticketId: string, createdByAgentId: string, target: string) {
    await publishEvent({
      type: 'ticket.created',
      source: `/agents/${createdByAgentId}`,
      subject: `ticket/${ticketId}`,
      data: { ticket_id: ticketId, created_by: createdByAgentId, target },
    })
  },

  async ticketAnswered(ticketId: string, answeredByAgentId: string) {
    await publishEvent({
      type: 'ticket.answered',
      source: `/agents/${answeredByAgentId}`,
      subject: `ticket/${ticketId}`,
      data: { ticket_id: ticketId, answered_by: answeredByAgentId },
    })
  },

  async ticketClosed(ticketId: string) {
    await publishEvent({
      type: 'ticket.closed',
      source: '/system',
      subject: `ticket/${ticketId}`,
      data: { ticket_id: ticketId },
    })
  },

  // Publishing events
  async deploySuccess(contentId: string, url: string) {
    await publishEvent({
      type: 'deploy.success',
      source: '/agents/engineering',
      subject: `content/${contentId}`,
      data: { content_id: contentId, url },
    })
  },

  async deployFailed(contentId: string, error: string) {
    await publishEvent({
      type: 'deploy.failed',
      source: '/agents/engineering',
      subject: `content/${contentId}`,
      data: { content_id: contentId, error },
    })
  },
}
